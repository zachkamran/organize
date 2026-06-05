import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { analyzeImages, consolidateCategories } from "../lib/analyze";
import { loadConfig } from "../lib/config";
import {
  executeMove,
  resolveCollision,
  sanitizeCategory,
  sanitizeFilename,
  type PlannedMove,
} from "../lib/files";
import { resolveModel } from "../lib/providers";
import { scanImages } from "../lib/scan";

export interface RunOptions {
  dryRun?: boolean;
  yes?: boolean;
  out?: string;
  model?: string;
  prompt?: string;
  categories?: string;
  rename?: boolean; // commander sets false for --no-rename
  copy?: boolean;
  concurrency?: string;
  cache?: boolean; // commander sets false for --no-cache
}

export async function runCommand(dirArg: string | undefined, options: RunOptions): Promise<void> {
  const config = loadConfig();
  const dir = resolve(dirArg ?? ".");

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(pc.red(`Not a directory: ${dir}`));
    process.exit(1);
  }

  const modelString = options.model ?? config.model;
  const rename = options.rename === false ? false : config.rename;
  const concurrency = options.concurrency ? parseInt(options.concurrency, 10) : config.concurrency;
  const outRoot = resolve(options.out ?? join(dir, "Organized"));
  const pinnedCategories = [
    ...config.categories,
    ...(options.categories ? options.categories.split(",").map((c) => c.trim()).filter(Boolean) : []),
  ];
  const instructions = [config.instructions, options.prompt ?? ""]
    .filter((s) => s.trim() !== "")
    .join("\n");

  // --- Scan ---------------------------------------------------------------
  const { images, skipped } = scanImages(dir);
  for (const skip of skipped) {
    console.error(pc.yellow(`skipping ${skip.path}: ${skip.reason}`));
  }
  if (images.length === 0) {
    console.log("No images found.");
    return;
  }
  console.log(`Found ${pc.bold(String(images.length))} image(s) in ${dir}`);
  console.log(`Model: ${pc.cyan(modelString)}\n`);

  // --- Resolve model (validates API key before any work) -------------------
  let resolved;
  try {
    resolved = resolveModel(modelString);
  } catch (error) {
    console.error(pc.red((error as Error).message));
    process.exit(1);
  }

  // --- Analyze --------------------------------------------------------------
  const { results, failures, cacheHits } = await analyzeImages(images, {
    resolved,
    modelString,
    pinnedCategories,
    instructions,
    concurrency,
    noCache: options.cache === false,
    onProgress: (done, total, fromCache) => {
      process.stderr.write(
        `\r${pc.dim(`analyzing ${done}/${total}${fromCache ? " (cache)" : ""}   `)}`,
      );
    },
  });
  process.stderr.write("\n");

  if (cacheHits > 0) {
    console.log(pc.dim(`${cacheHits} result(s) reused from cache — no API cost`));
  }
  if (results.size === 0) {
    console.error(pc.red("All analyses failed."));
    for (const failure of failures.slice(0, 5)) {
      console.error(pc.red(`  ${failure.path}: ${failure.error}`));
    }
    process.exit(1);
  }

  // --- Consolidate categories ----------------------------------------------
  const rawCategories = [...new Set([...results.values()].map((r) => r.category))];
  const mapping = await consolidateCategories(rawCategories, resolved, pinnedCategories);

  // --- Build move plan -------------------------------------------------------
  const takenByDir = new Map<string, Set<string>>();
  const plan: Array<PlannedMove & { category: string; description: string }> = [];

  for (const image of images) {
    const analysis = results.get(image.path);
    if (!analysis) continue;
    const category = sanitizeCategory(mapping[analysis.category] ?? analysis.category);
    const toDir = join(outRoot, category);

    const fallback = image.name.slice(0, image.name.length - image.ext.length);
    const base = rename ? sanitizeFilename(analysis.filename, fallback) : fallback;

    let taken = takenByDir.get(toDir);
    if (!taken) takenByDir.set(toDir, (taken = new Set()));
    const toName = resolveCollision(toDir, base, image.ext, taken);

    plan.push({ from: image.path, toDir, toName, category, description: analysis.description });
  }

  // --- Show plan -------------------------------------------------------------
  const byCategory = new Map<string, typeof plan>();
  for (const move of plan) {
    const list = byCategory.get(move.category) ?? [];
    list.push(move);
    byCategory.set(move.category, list);
  }

  console.log();
  for (const [category, moves] of [...byCategory.entries()].sort()) {
    console.log(pc.bold(pc.green(`${category}/`)) + pc.dim(` (${moves.length})`));
    for (const move of moves) {
      const fromName = move.from.split("/").pop();
      console.log(`  ${pc.dim(fromName ?? "")} ${pc.dim("→")} ${move.toName}`);
      console.log(`    ${pc.dim(move.description)}`);
    }
  }
  if (failures.length > 0) {
    console.log(pc.red(`\n${failures.length} file(s) failed to analyze and will be left in place:`));
    for (const failure of failures) {
      console.log(pc.red(`  ${failure.path.split("/").pop()}: ${failure.error}`));
    }
  }

  if (options.dryRun) {
    console.log(pc.cyan(`\nDry run — nothing moved. Results are cached; running again is free.`));
    return;
  }

  // --- Confirm ---------------------------------------------------------------
  if (!options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (
      await rl.question(
        `\n${options.copy ? "Copy" : "Move"} ${plan.length} file(s) into ${outRoot}? [y/N] `,
      )
    ).trim();
    rl.close();
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Aborted. (Analyses are cached — re-running is free.)");
      return;
    }
  }

  // --- Execute ----------------------------------------------------------------
  let moved = 0;
  const moveErrors: string[] = [];
  for (const move of plan) {
    try {
      executeMove(move, options.copy ?? false);
      moved++;
    } catch (error) {
      moveErrors.push(`${move.from}: ${(error as Error).message}`);
    }
  }

  console.log(
    pc.green(`\n${options.copy ? "Copied" : "Moved"} ${moved}/${plan.length} file(s) into ${outRoot}`),
  );
  for (const message of moveErrors) console.error(pc.red(`  ${message}`));
}
