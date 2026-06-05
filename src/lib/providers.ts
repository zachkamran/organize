import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { missingKeyMessage, resolveApiKey, type Provider } from "./auth";

export interface ResolvedModel {
  provider: Provider;
  modelId: string;
  model: LanguageModel;
}

/**
 * Resolve a model string like "anthropic/claude-opus-4-8", "openai/gpt-5.2",
 * or "google/gemini-3-pro" to an AI SDK language model. A bare model name
 * (no "provider/" prefix) defaults to Anthropic.
 */
export function resolveModel(modelString: string): ResolvedModel {
  const slash = modelString.indexOf("/");
  const providerName = slash === -1 ? "anthropic" : modelString.slice(0, slash);
  const modelId = slash === -1 ? modelString : modelString.slice(slash + 1);

  if (!["anthropic", "openai", "google"].includes(providerName)) {
    throw new Error(
      `Unknown provider "${providerName}". Supported: anthropic, openai, google.`,
    );
  }
  const provider = providerName as Provider;

  const apiKey = resolveApiKey(provider);
  if (!apiKey) throw new Error(missingKeyMessage(provider));

  switch (provider) {
    case "anthropic":
      return { provider, modelId, model: createAnthropic({ apiKey })(modelId) };
    case "openai":
      return { provider, modelId, model: createOpenAI({ apiKey })(modelId) };
    case "google":
      return { provider, modelId, model: createGoogleGenerativeAI({ apiKey })(modelId) };
  }
}
