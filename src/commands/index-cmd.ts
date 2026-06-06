import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { analyzeImages } from "../lib/analyze";
import { AnalysisCache } from "../lib/cache";
import { loadConfig } from "../lib/config";
import { embedTexts, resolveEmbeddingModel, VectorStore } from "../lib/embeddings";
import { formatCost, formatRunningCost, loadPriceCatalog } from "../lib/pricing";
import { resolveModel } from "../lib/providers";
import { scanImages } from "../lib/scan";

export interface IndexOptions {
  model?: string;
  prompt?: string;
  concurrency?: string;
  includeSubdirs?: boolean;
  embed?: boolean;
}

/**
 * Analyze and cache every image WITHOUT moving anything — builds the local
 * search index that `organize find` queries. Ideal for huge libraries you
 * want searchable but not reorganized.
 */
export async function indexCommand(dirArg: string | undefined, options: IndexOptions): Promise<void> {
  const config = loadConfig();
  const dir = resolve(dirArg ?? ".");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(pc.red(`Not a directory: ${dir}`));
    process.exit(1);
  }

  const modelString = options.model ?? config.model;
  let concurrency = config.concurrency;
  if (options.concurrency !== undefined) {
    concurrency = parseInt(options.concurrency, 10);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
      console.error(pc.red(`--concurrency must be an integer between 1 and 50, got "${options.concurrency}"`));
      process.exit(1);
    }
  }

  let resolved;
  try {
    resolved = resolveModel(modelString);
  } catch (error) {
    console.error(pc.red((error as Error).message));
    process.exit(1);
  }

  const { images, skipped } = scanImages(dir, { recursive: options.includeSubdirs ?? false });
  for (const skip of skipped) console.error(pc.yellow(`skipping ${skip.path}: ${skip.reason}`));
  if (images.length === 0) {
    console.log("No images found.");
    return;
  }
  console.log(`Indexing ${pc.bold(String(images.length))} image(s) with ${pc.cyan(modelString)}\n`);

  await loadPriceCatalog();
  const { failures, cacheHits, usage } = await analyzeImages(images, {
    resolved,
    modelString,
    pinnedCategories: config.categories,
    instructions: [config.instructions, options.prompt ?? ""].filter((s) => s.trim() !== "").join("\n"),
    concurrency,
    noCache: false,
    onProgress: (done, total, _fromCache, runningUsage) => {
      const cost = formatRunningCost(resolved.modelId, runningUsage);
      process.stderr.write(`\r${pc.dim(`indexing ${done}/${total}${cost ? ` · ${cost}` : ""}   `)}`);
    },
  });
  process.stderr.write("\n");

  console.log(pc.green(`Indexed ${images.length - failures.length}/${images.length} image(s)`));
  if (cacheHits > 0) console.log(pc.dim(`${cacheHits} already indexed (cache)`));
  for (const failure of failures) console.error(pc.red(`  ${failure.path}: ${failure.error}`));
  console.log(pc.dim(`API usage: ${formatCost(resolved.modelId, usage)}`));

  if (options.embed) {
    await embedMissing(config.embeddingModel);
  }

  console.log(`\nSearch it: ${pc.cyan(`organize find "what you remember"`)}`);
}

/** Embed every cached analysis that doesn't have a vector yet (batched). */
async function embedMissing(embeddingModelString: string): Promise<void> {
  let model;
  try {
    model = resolveEmbeddingModel(embeddingModelString);
  } catch (error) {
    console.error(pc.red((error as Error).message));
    return;
  }

  const store = new VectorStore(embeddingModelString);
  const missing = new AnalysisCache().entries().filter(({ key }) => !store.has(key));
  if (missing.length === 0) {
    console.log(pc.dim("Embeddings already up to date."));
    return;
  }

  console.log(pc.dim(`Embedding ${missing.length} description(s) with ${embeddingModelString}…`));
  const BATCH = 100;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const texts = batch.map(({ entry }) => `${entry.filename}. ${entry.category}. ${entry.description}`);
    const vectors = await embedTexts(model, texts);
    batch.forEach(({ key }, j) => store.set(key, vectors[j]!));
    process.stderr.write(`\r${pc.dim(`embedding ${Math.min(i + BATCH, missing.length)}/${missing.length}   `)}`);
  }
  process.stderr.write("\n");
  store.save();
  console.log(pc.green(`Embedded ${missing.length} description(s) — semantic search enabled.`));
}
