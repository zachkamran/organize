import { existsSync } from "node:fs";
import { basename } from "node:path";
import pc from "picocolors";
import { AnalysisCache, type CacheEntry } from "../lib/cache";
import { loadConfig } from "../lib/config";
import { cosineSimilarity, embedQuery, resolveEmbeddingModel, VectorStore } from "../lib/embeddings";
import { detectGraphics, renderImage } from "../lib/render";

export interface FindOptions {
  limit?: string;
  all?: boolean;
  keyword?: boolean; // force keyword-only search
  preview?: boolean; // render image thumbnails inline (Ghostty/Kitty/iTerm2/ANSI)
}

/**
 * Search every image you've ever analyzed — straight from the local cache.
 * Uses semantic search when embeddings exist (see `organize index --embed`),
 * blended with keyword matching; pure keyword otherwise. Zero vision calls.
 */
export async function findCommand(query: string, options: FindOptions): Promise<void> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) {
    console.error(pc.red('Give me something to search for: organize find "stripe invoice"'));
    process.exit(1);
  }

  const entries = new AnalysisCache().entries().filter(({ entry }) => entry.path);
  if (entries.length === 0) {
    console.log("Nothing indexed yet. Run `organize <dir>` or `organize index <dir>` first.");
    return;
  }

  // Semantic scores when a vector store exists (built by `organize index --embed`)
  const config = loadConfig();
  const semantic = new Map<string, number>(); // cacheKey → cosine similarity
  if (!options.keyword) {
    const store = new VectorStore(config.embeddingModel);
    if (store.size() > 0) {
      try {
        const queryVector = await embedQuery(resolveEmbeddingModel(config.embeddingModel), query);
        for (const { key } of entries) {
          const vector = store.get(key);
          if (vector) semantic.set(key, cosineSimilarity(queryVector, vector));
        }
      } catch (error) {
        console.error(pc.yellow(`semantic search unavailable (${(error as Error).message.split("\n")[0]}), falling back to keywords`));
      }
    }
  }

  const scored = entries
    .map(({ key, entry }) => {
      const keyword = keywordScore(entry, terms);
      const cosine = semantic.get(key) ?? 0;
      // Hybrid: keyword hits dominate; cosine breaks ties and catches synonyms.
      const score = semantic.size > 0 ? keyword + cosine * 10 : keyword;
      return { entry, score, cosine };
    })
    .filter(({ score, cosine }) => score > 0 && (semantic.size === 0 || cosine > 0.25 || score > 1))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    console.log(`No matches for "${query}" across ${entries.length.toLocaleString()} indexed image(s).`);
    return;
  }

  const graphics = options.preview ? detectGraphics() : "none";
  const limit = options.all
    ? scored.length
    : parseInt(options.limit ?? (options.preview ? "5" : "10"), 10) || 10;
  for (const { entry } of scored.slice(0, limit)) {
    const gone = !existsSync(entry.path!);
    console.log(
      `${pc.bold(basename(entry.path!))} ${pc.dim(`[${entry.category}]`)}${gone ? pc.red(" (missing)") : ""}`,
    );
    console.log(`  ${entry.description}`);
    console.log(`  ${pc.dim(entry.path!)}`);
    if (graphics !== "none" && !gone) {
      try {
        process.stdout.write(await renderImage(entry.path!, graphics));
      } catch {
        // unrenderable image — text result already shown
      }
    }
  }
  if (scored.length > limit) {
    console.log(pc.dim(`\n…and ${scored.length - limit} more. Use --all or --limit <n>.`));
  }
}

function keywordScore(entry: CacheEntry, terms: string[]): number {
  const description = entry.description.toLowerCase();
  const filename = entry.filename.toLowerCase();
  const category = entry.category.toLowerCase();
  const name = basename(entry.path ?? "").toLowerCase();

  let total = 0;
  for (const term of terms) {
    let hit = 0;
    if (filename.includes(term) || name.includes(term)) hit += 3;
    if (description.includes(term)) hit += 2;
    if (category.includes(term)) hit += 1;
    total += hit;
  }
  return total;
}
