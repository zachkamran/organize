import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { missingKeyMessage, resolveApiKey, type Provider } from "./auth";

export type ProviderName = Provider | "ollama" | "lmstudio";

export interface ResolvedModel {
  provider: ProviderName;
  modelId: string;
  model: LanguageModel;
  /** Local models run on your machine — no API cost. */
  local: boolean;
}

/**
 * Resolve a model string to an AI SDK language model:
 *
 *   anthropic/claude-opus-4-8   (cloud — default provider for bare names)
 *   openai/gpt-5.2              (cloud)
 *   google/gemini-3-pro         (cloud)
 *   ollama/qwen3-vl             (local — http://localhost:11434/v1, no key)
 *   lmstudio/qwen3-vl           (local — http://localhost:1234/v1, no key)
 *
 * Local endpoints can be overridden with OLLAMA_BASE_URL / LMSTUDIO_BASE_URL.
 */
export function resolveModel(modelString: string): ResolvedModel {
  const slash = modelString.indexOf("/");
  const providerName = slash === -1 ? "anthropic" : modelString.slice(0, slash);
  const modelId = slash === -1 ? modelString : modelString.slice(slash + 1);

  switch (providerName) {
    case "anthropic":
    case "openai":
    case "google": {
      const provider = providerName as Provider;
      const apiKey = resolveApiKey(provider);
      if (!apiKey) throw new Error(missingKeyMessage(provider));
      const create =
        provider === "anthropic"
          ? createAnthropic
          : provider === "openai"
            ? createOpenAI
            : createGoogleGenerativeAI;
      return { provider, modelId, model: create({ apiKey })(modelId), local: false };
    }

    case "ollama":
    case "lmstudio": {
      const baseURL =
        providerName === "ollama"
          ? (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1")
          : (process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1");
      const provider = createOpenAICompatible({
        name: providerName,
        baseURL,
        // Local servers don't require auth; some reject an empty header, so
        // send a placeholder only — never a real key.
        apiKey: "local",
        // Ollama (≥0.5) and LM Studio support json_schema response_format,
        // which generateObject uses for reliable structured output.
        supportsStructuredOutputs: true,
      });
      return { provider: providerName, modelId, model: provider(modelId), local: true };
    }

    default:
      throw new Error(
        `Unknown provider "${providerName}". Supported: anthropic, openai, google, ollama, lmstudio.`,
      );
  }
}
