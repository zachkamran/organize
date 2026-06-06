import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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
import { findExactDupes, findNearDupes } from "../lib/dupes";
import { saveManifest } from "../lib/manifest";
import { formatCost, formatRunningCost, loadPriceCatalog } from "../lib/pricing";
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
  includeSubdirs?: boolean;
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
  let concurrency = config.concurrency;
  if (options.concurrency !== undefined) {
    concurrency = parseInt(options.concurrency, 10);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
      console.error(pc.red(`--concurrency must be an integer between 1 and 50, got "${options.concurrency}"`));
      process.exit(1);
    }
  }
  const outRoot = resolve(options.out ?? join(dir, "Organized"));
  const pinnedCategories = [
    ...config.categories,
    ...(options.categories ? options.categories.split(",").map((c) => c.trim()).filter(Boolean) : []),
  ];
  const instructions = [config.instructions, options.prompt ?? ""]
    .filter((s) => s.trim() !== "")
    .join("\n");

  // --- Resolve model (validates API key before any work) -------------------
  let resolved;
  try {
    resolved = resolveModel(modelString);
  } catch (error) {
    console.error(pc.red((error as Error).message));
    process.exit(1);
  }

  // --- Scan ---------------------------------------------------------------
  const { images, skipped } = scanImages(dir, {
    recursive: options.includeSubdirs ?? false,
    exclude: [outRoot],
  });
  for (const skip of skipped) {
    console.error(pc.yellow(`skipping ${skip.path}: ${skip.reason}`));
  }
  if (images.length === 0) {
    console.log("No images found.");
    return;
  }
  console.log(`Found ${pc.bold(String(images.length))} image(s) in ${dir}`);
  console.log(`Model: ${pc.cyan(modelString)}\n`);

  // --- Analyze --------------------------------------------------------------
  await loadPriceCatalog(); // live model prices (cached 24h, offline fallback)
  const { results, failures, cacheHits, usage, fileHashes, phashes } = await analyzeImages(images, {
    resolved,
    modelString,
    pinnedCategories,
    instructions,
    concurrency,
    noCache: options.cache === false,
    onProgress: (done, total, fromCache, runningUsage) => {
      const cost = formatRunningCost(resolved.modelId, runningUsage);
      process.stderr.write(
        `\r${pc.dim(`analyzing ${done}/${total}${cost ? ` · ${cost}` : ""}${fromCache ? " (cache)" : ""}   `)}`,
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

  // --- Duplicates -------------------------------------------------------------
  const exactGroups = findExactDupes(fileHashes);
  const dupeOf = new Map<string, string>(); // extra copy → keeper path
  for (const group of exactGroups) {
    for (const path of group.slice(1)) dupeOf.set(path, group[0]!);
  }

  // --- Consolidate categories ----------------------------------------------
  const rawCategories = [...new Set([...results.values()].map((r) => r.category))];
  const mapping = await consolidateCategories(rawCategories, resolved, pinnedCategories, usage);

  // --- Build move plan -------------------------------------------------------
  const takenByDir = new Map<string, Set<string>>();
  const plan: Array<PlannedMove & { category: string; description: string }> = [];

  for (const image of images) {
    const analysis = results.get(image.path);
    if (!analysis) continue;

    const keeper = dupeOf.get(image.path);
    const category = keeper
      ? "Duplicates"
      : sanitizeCategory(mapping[analysis.category] ?? analysis.category);
    const toDir = join(outRoot, category);

    const fallback = image.name.slice(0, image.name.length - image.ext.length);
    const base = keeper || !rename ? fallback : sanitizeFilename(analysis.filename, fallback);

    let taken = takenByDir.get(toDir);
    if (!taken) takenByDir.set(toDir, (taken = new Set()));
    const toName = resolveCollision(toDir, base, image.ext, taken);

    plan.push({
      from: image.path,
      toDir,
      toName,
      category,
      description: keeper ? `Exact duplicate of ${basename(keeper)}` : analysis.description,
    });
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
      console.log(`  ${pc.dim(basename(move.from))} ${pc.dim("→")} ${move.toName}`);
      console.log(`    ${pc.dim(move.description)}`);
    }
  }
  // Near-duplicates: visually similar but not byte-identical — report only.
  const nearClusters = findNearDupes(phashes, new Set(dupeOf.keys()));
  if (nearClusters.length > 0) {
    console.log(pc.yellow(`\nPossible near-duplicates (organized normally — review manually):`));
    for (const cluster of nearClusters) {
      console.log(pc.yellow(`  ${cluster.map((p) => basename(p)).join("  ≈  ")}`));
    }
  }

  if (failures.length > 0) {
    console.log(pc.red(`\n${failures.length} file(s) failed to analyze and will be left in place:`));
    for (const failure of failures) {
      console.log(pc.red(`  ${basename(failure.path)}: ${failure.error}`));
    }
  }

  console.log(pc.dim(`\nAPI usage: ${formatCost(resolved.modelId, usage)}`));

  if (options.dryRun) {
    console.log(pc.cyan(`Dry run — nothing moved. Results are cached; running again is free.`));
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
  const executed: Array<{ from: string; to: string }> = [];
  const moveErrors: string[] = [];
  for (const move of plan) {
    try {
      const dest = executeMove(move, options.copy ?? false);
      executed.push({ from: move.from, to: dest });
    } catch (error) {
      moveErrors.push(`${move.from}: ${(error as Error).message}`);
    }
  }

  if (executed.length > 0) {
    saveManifest({
      ranAt: new Date().toISOString(),
      dir,
      outRoot,
      copied: options.copy ?? false,
      moves: executed,
    });
  }

  console.log(
    pc.green(
      `\n${options.copy ? "Copied" : "Moved"} ${executed.length}/${plan.length} file(s) into ${outRoot}`,
    ),
  );
  for (const message of moveErrors) console.error(pc.red(`  ${message}`));
  if (executed.length > 0) {
    console.log(pc.dim(`Changed your mind? \`organize undo\` reverts this run.`));
  }
}
