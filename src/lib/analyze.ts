import { readFileSync } from "node:fs";
import { generateObject } from "ai";
import { z } from "zod";
import { AnalysisCache, cacheKey, type Analysis } from "./cache";
import { runPool } from "./pool";
import type { ResolvedModel } from "./providers";
import { MEDIA_TYPES, type ScannedImage } from "./scan";

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
  onProgress?: (done: number, total: number, fromCache: boolean) => void;
}

export interface AnalyzeOutcome {
  results: Map<string, Analysis>; // keyed by file path
  failures: Array<{ path: string; error: string }>;
  cacheHits: number;
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
  let cacheHits = 0;
  let done = 0;

  const poolResults = await runPool(images, options.concurrency, async (image) => {
    const bytes = readFileSync(image.path);
    const key = cacheKey(bytes, options.modelString, options.pinnedCategories, options.instructions);

    if (!options.noCache) {
      const cached = cache.get(key);
      if (cached) {
        cacheHits++;
        seenCategories.add(cached.category);
        options.onProgress?.(++done, images.length, true);
        return { path: image.path, analysis: cached };
      }
    }

    const { object } = await generateObject({
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
              image: bytes,
              mediaType: MEDIA_TYPES[image.ext] ?? "image/png",
            },
            { type: "text", text: `Original filename: ${image.name}` },
          ],
        },
      ],
    });

    seenCategories.add(object.category);
    cache.set(key, object);
    options.onProgress?.(++done, images.length, false);
    return { path: image.path, analysis: object };
  });

  cache.save();

  poolResults.forEach((result, i) => {
    if (result.ok) {
      results.set(result.value.path, result.value.analysis);
    } else {
      options.onProgress?.(++done, images.length, false);
      failures.push({ path: images[i]!.path, error: result.error.message });
    }
  });

  return { results, failures, cacheHits };
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
): Promise<Record<string, string>> {
  const identity = Object.fromEntries(categories.map((c) => [c, c]));
  if (categories.length <= 2) return identity;

  try {
    const { object } = await generateObject({
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

    const mapping = { ...identity };
    for (const { from, to } of object.mapping) {
      if (from in mapping && to.trim() !== "") mapping[from] = to.trim();
    }
    return mapping;
  } catch {
    return identity; // consolidation is best-effort
  }
}
