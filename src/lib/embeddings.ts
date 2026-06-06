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
 *   openai/text-embedding-3-small   (cloud, cheap: ~$0.02 per 1M tokens)
 *   google/gemini-embedding-001     (cloud)
 *   ollama/nomic-embed-text         (local, free)
 *   lmstudio/<model>                (local, free)
 *
 * Anthropic has no embeddings API, so the default is OpenAI's small model.
 */
export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small";

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
export async function embedTexts(model: EmbeddingModel, texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model, values: texts, maxRetries: 2 });
  return embeddings;
}

export async function embedQuery(model: EmbeddingModel, text: string): Promise<Float32Array> {
  const { embedding } = await embed({ model, value: text, maxRetries: 2 });
  return new Float32Array(embedding);
}
