import { readFileSync } from "node:fs";
import { generateObject } from "ai";
import { z } from "zod";
import { AnalysisCache, cacheKey, sha256, type Analysis } from "./cache";
import { convertHeicForAnalysis, downscaleForAnalysis } from "./downscale";
import { perceptualHash } from "./dupes";
import { runPool } from "./pool";
import type { Usage } from "./pricing";
import type { ResolvedModel } from "./providers";
import { MAX_FILE_BYTES, MEDIA_TYPES, type ScannedImage } from "./scan";

const analysisSchema = z.object({
  category: z
    .string()
    .describe(
      "A broad Title Case category for organizing this image into a folder, e.g. 'Code & Terminal', 'Receipts'. Reuse an existing category when one fits.",
    ),
  description: z.string().describe("One concise sentence describing what the image shows."),
  filename: z
    .string()
    .describe(
      "A short descriptive kebab-case filename (3-8 words, no extension), e.g. 'stripe-invoice-march-2026'.",
    ),
});

export interface AnalyzeOptions {
  resolved: ResolvedModel;
  modelString: string;
  pinnedCategories: string[];
  instructions: string; // config instructions + --prompt, already merged
  concurrency: number;
  noCache: boolean;
  onProgress?: (done: number, total: number, fromCache: boolean, usage: Usage) => void;
}

export interface AnalyzeOutcome {
  results: Map<string, Analysis>; // keyed by file path
  failures: Array<{ path: string; error: string }>;
  cacheHits: number;
  usage: Usage;
  /** sha256 of file contents, for exact-duplicate detection. */
  fileHashes: Map<string, string>;
  /** Perceptual hashes (where computable), for near-duplicate detection. */
  phashes: Map<string, string>;
}

function buildSystemPrompt(pinned: string[], seen: Set<string>, instructions: string): string {
  const parts = [
    "You are a file-organization assistant. You will be shown one image (usually a screenshot).",
    "Categorize it into a broad folder category, describe it in one sentence, and suggest a short descriptive kebab-case filename.",
    "Keep categories BROAD — aim for a small set of folders, not one folder per image.",
  ];
  const known = [...new Set([...pinned, ...seen])];
  if (known.length > 0) {
    parts.push(
      `Existing categories (STRONGLY prefer reusing one of these; only invent a new category when none fits): ${known.join(", ")}`,
    );
  }
  if (instructions.trim() !== "") {
    parts.push(`User instructions (follow these closely):\n${instructions.trim()}`);
  }
  return parts.join("\n\n");
}

export async function analyzeImages(
  images: ScannedImage[],
  options: AnalyzeOptions,
): Promise<AnalyzeOutcome> {
  const cache = new AnalysisCache();
  const results = new Map<string, Analysis>();
  const failures: Array<{ path: string; error: string }> = [];
  const seenCategories = new Set<string>(options.pinnedCategories);
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const fileHashes = new Map<string, string>();
  const phashes = new Map<string, string>();
  let cacheHits = 0;
  let done = 0;

  async function processOne(image: ScannedImage): Promise<void> {
    try {
      const bytes = readFileSync(image.path);
      fileHashes.set(image.path, sha256(bytes));
      const key = cacheKey(bytes, options.modelString, options.pinnedCategories, options.instructions);

      if (!options.noCache) {
        const cached = cache.get(key);
        if (cached) {
          cacheHits++;
          seenCategories.add(cached.category);
          results.set(image.path, cached);
          if (cached.phash) phashes.set(image.path, cached.phash);
          cache.touch(key, image.path);
          options.onProgress?.(++done, images.length, true, usage);
          return;
        }
      }

      // Formats providers can't ingest are converted, and oversized images are
      // downscaled — both in memory only; the file on disk is untouched.
      let sendBytes: Buffer = bytes;
      let mediaType = MEDIA_TYPES[image.ext] ?? "image/png";
      if (image.ext === ".heic") {
        const prepared = convertHeicForAnalysis(image.path);
        sendBytes = prepared.bytes;
        mediaType = prepared.mediaType;
      } else if (image.ext === ".tif" || image.ext === ".tiff" || bytes.length > MAX_FILE_BYTES) {
        const prepared = await downscaleForAnalysis(bytes); // jimp decodes tiff → jpeg
        sendBytes = prepared.bytes;
        mediaType = prepared.mediaType;
      }

      // Perceptual hash for near-duplicate detection (gif animations excluded)
      let phash: string | undefined;
      if (image.ext !== ".gif") {
        try {
          phash = await perceptualHash(sendBytes);
          phashes.set(image.path, phash);
        } catch {
          // non-fatal — jimp can't decode everything (e.g. some webp variants)
        }
      }

      const { object, usage: callUsage } = await generateObject({
        model: options.resolved.model,
        schema: analysisSchema,
        maxOutputTokens: 1024,
        maxRetries: 3,
        system: buildSystemPrompt(options.pinnedCategories, seenCategories, options.instructions),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                image: sendBytes,
                mediaType,
              },
              { type: "text", text: `Original filename: ${image.name}` },
            ],
          },
        ],
      });

      usage.inputTokens += callUsage.inputTokens ?? 0;
      usage.outputTokens += callUsage.outputTokens ?? 0;
      seenCategories.add(object.category);
      cache.set(key, object, { path: image.path, phash });
      results.set(image.path, object);
      options.onProgress?.(++done, images.length, false, usage);
    } catch (error) {
      failures.push({
        path: image.path,
        error: error instanceof Error ? error.message : String(error),
      });
      options.onProgress?.(++done, images.length, false, usage);
    }
  }

  // Seed the category vocabulary: process the first image alone so concurrent
  // lanes don't all start with an empty "existing categories" list.
  const needsSeed = seenCategories.size === 0 && images.length > 1;
  const [first, ...rest] = images;
  if (needsSeed && first) {
    await processOne(first);
    await runPool(rest, options.concurrency, processOne);
  } else {
    await runPool(images, options.concurrency, processOne);
  }

  cache.save();
  return { results, failures, cacheHits, usage, fileHashes, phashes };
}

/**
 * Merge near-duplicate categories (e.g. "Code" vs "Code Screenshots") with a
 * single cheap text-only call. Returns a mapping old → canonical. Falls back
 * to identity mapping on any failure.
 */
export async function consolidateCategories(
  categories: string[],
  resolved: ResolvedModel,
  pinned: string[],
  usage?: Usage,
): Promise<Record<string, string>> {
  const identity = Object.fromEntries(categories.map((c) => [c, c]));
  if (categories.length <= 2) return identity;

  try {
    const { object, usage: callUsage } = await generateObject({
      model: resolved.model,
      schema: z.object({
        mapping: z
          .array(z.object({ from: z.string(), to: z.string() }))
          .describe("One entry per input category, mapping it to its canonical category."),
      }),
      maxOutputTokens: 4096,
      maxRetries: 2,
      system: [
        "You consolidate folder category names. Given a list of categories, merge near-duplicates and overly specific ones into a clean, small set of broad canonical categories.",
        "Every input category must appear exactly once as 'from'. 'to' is the canonical name (may equal 'from').",
        pinned.length > 0
          ? `These pinned categories must be kept verbatim as canonical names: ${pinned.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      messages: [{ role: "user", content: `Categories:\n${categories.join("\n")}` }],
    });

    if (usage) {
      usage.inputTokens += callUsage.inputTokens ?? 0;
      usage.outputTokens += callUsage.outputTokens ?? 0;
    }
    const mapping = { ...identity };
    for (const { from, to } of object.mapping) {
      if (from in mapping && to.trim() !== "") mapping[from] = to.trim();
    }
    return mapping;
  } catch {
    return identity; // consolidation is best-effort
  }
}
