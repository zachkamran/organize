import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embed, embedMany, type EmbeddingModel } from "ai";
import { cacheDir } from "./cache";
import { missingKeyMessage, resolveApiKey } from "./auth";

/**
 * Embedding model strings mirror the chat-model format:
 *
 *   voyage/voyage-multimodal-3                      (TRUE IMAGE embeddings)
 *   openrouter/google/gemini-embedding-2            (TRUE IMAGE embeddings)
 *   openrouter/nvidia/llama-nemotron-embed-vl-1b-v2:free  (image embeddings, free)
 *   openrouter/<any-text-embedding-model>           (text-only: embeds descriptions)
 *   openai/text-embedding-3-small                   (cloud, text-only)
 *   google/gemini-embedding-001                     (cloud, text-only)
 *   ollama/nomic-embed-text                         (local, free, text-only)
 *   lmstudio/<model>                                (local, free, text-only)
 *
 * Anthropic has no embeddings API, so the default is OpenAI's small model.
 */
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

/** Multimodal models embed pixels; text models embed the AI description. */
export function isMultimodalEmbedding(modelString: string): boolean {
  if (modelString.startsWith("voyage/")) return true;
  if (modelString.startsWith("openrouter/")) {
    // Image-capable embedding models on OpenRouter (text-only ones embed descriptions)
    return /gemini-embedding-2|embed-vl/i.test(modelString);
  }
  return false;
}

export function resolveEmbeddingModel(modelString: string): EmbeddingModel {
  const slash = modelString.indexOf("/");
  const providerName = slash === -1 ? "openai" : modelString.slice(0, slash);
  const modelId = slash === -1 ? modelString : modelString.slice(slash + 1);

  switch (providerName) {
    case "openai": {
      const apiKey = resolveApiKey("openai");
      if (!apiKey) throw new Error(missingKeyMessage("openai"));
      return createOpenAI({ apiKey }).embeddingModel(modelId);
    }
    case "google": {
      const apiKey = resolveApiKey("google");
      if (!apiKey) throw new Error(missingKeyMessage("google"));
      return createGoogleGenerativeAI({ apiKey }).textEmbedding(modelId);
    }
    case "ollama":
    case "lmstudio": {
      const baseURL =
        providerName === "ollama"
          ? (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1")
          : (process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1");
      return createOpenAICompatible({ name: providerName, baseURL, apiKey: "local" }).textEmbeddingModel(
        modelId,
      );
    }
    default:
      throw new Error(
        `Unknown embedding provider "${providerName}". Supported: openai, google, ollama, lmstudio.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Vector store: cacheKey → Float32 vector (base64), persisted next to the
// analysis cache. Kept separate so the analysis cache stays small.
// ---------------------------------------------------------------------------

interface VectorStoreData {
  model: string;
  vectors: Record<string, string>; // cacheKey → base64 Float32Array
}

function storePath(): string {
  return join(cacheDir(), "embeddings.json");
}

export class VectorStore {
  private data: VectorStoreData;

  constructor(model: string) {
    this.data = this.load(model);
  }

  private load(model: string): VectorStoreData {
    try {
      if (existsSync(storePath())) {
        const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as VectorStoreData;
        // Vectors from a different model aren't comparable — start fresh.
        if (parsed.model === model) return parsed;
      }
    } catch {
      // corrupted store — rebuild
    }
    return { model, vectors: {} };
  }

  has(key: string): boolean {
    return key in this.data.vectors;
  }

  get(key: string): Float32Array | null {
    const encoded = this.data.vectors[key];
    if (!encoded) return null;
    const buffer = Buffer.from(encoded, "base64");
    return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  }

  set(key: string, vector: number[]): void {
    this.data.vectors[key] = Buffer.from(new Float32Array(vector).buffer).toString("base64");
  }

  size(): number {
    return Object.keys(this.data.vectors).length;
  }

  save(): void {
    mkdirSync(cacheDir(), { recursive: true });
    const temp = `${storePath()}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify(this.data));
    renameSync(temp, storePath());
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/** Embed many texts (batched). Returns vectors in input order. */
export async function embedTexts(modelString: string, texts: string[]): Promise<number[][]> {
  if (modelString.startsWith("voyage/")) {
    return voyageEmbed(modelString, texts.map((text) => ({ type: "text", text })), "document");
  }
  if (modelString.startsWith("openrouter/")) {
    return openrouterEmbed(modelString, texts);
  }
  const { embeddings } = await embedMany({
    model: resolveEmbeddingModel(modelString),
    values: texts,
    maxRetries: 2,
  });
  return embeddings;
}

/** Embed images themselves (multimodal models only). One vector per image. */
export async function embedImages(
  modelString: string,
  images: Array<{ base64: string; mediaType: string }>,
): Promise<number[][]> {
  if (!isMultimodalEmbedding(modelString)) {
    throw new Error(
      `${modelString} is text-only — image embedding needs e.g. voyage/voyage-multimodal-3 or openrouter/google/gemini-embedding-2`,
    );
  }
  if (modelString.startsWith("voyage/")) {
    return voyageEmbed(modelString, images.map((img) => ({ type: "image", ...img })), "document");
  }
  return openrouterEmbed(
    modelString,
    images.map((img) => `data:${img.mediaType};base64,${img.base64}`),
  );
}

export async function embedQuery(modelString: string, text: string): Promise<Float32Array> {
  if (modelString.startsWith("voyage/")) {
    const [vector] = await voyageEmbed(modelString, [{ type: "text", text }], "query");
    return new Float32Array(vector!);
  }
  if (modelString.startsWith("openrouter/")) {
    const [vector] = await openrouterEmbed(modelString, [text]);
    return new Float32Array(vector!);
  }
  const { embedding } = await embed({
    model: resolveEmbeddingModel(modelString),
    value: text,
    maxRetries: 2,
  });
  return new Float32Array(embedding);
}

/**
 * OpenRouter embeddings — OpenAI-compatible /v1/embeddings. Multimodal models
 * (gemini-embedding-2, nemotron-embed-vl) accept data-URL strings as inputs.
 */
async function openrouterEmbed(modelString: string, inputs: string[]): Promise<number[][]> {
  const apiKey = resolveApiKey("openrouter");
  if (!apiKey) throw new Error(missingKeyMessage("openrouter"));
  const model = modelString.slice("openrouter/".length);

  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: inputs }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenRouter embeddings error ${response.status}: ${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

// ---------------------------------------------------------------------------
// Voyage AI multimodal embeddings (REST — no AI SDK provider exists yet).
// Text queries and images land in the same vector space.
// ---------------------------------------------------------------------------

type VoyageInput = { type: "text"; text: string } | { type: "image"; base64: string; mediaType: string };

async function voyageEmbed(
  modelString: string,
  inputs: VoyageInput[],
  inputType: "document" | "query",
): Promise<number[][]> {
  const apiKey = resolveApiKey("voyage");
  if (!apiKey) throw new Error(missingKeyMessage("voyage"));
  const model = modelString.slice("voyage/".length);

  const response = await fetch("https://api.voyageai.com/v1/multimodalembeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      input_type: inputType,
      inputs: inputs.map((input) => ({
        content: [
          input.type === "text"
            ? { type: "text", text: input.text }
            : { type: "image_base64", image_base64: `data:${input.mediaType};base64,${input.base64}` },
        ],
      })),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Voyage API error ${response.status}: ${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}
