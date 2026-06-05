import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./cache";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

interface Prices {
  input: number; // USD per token
  output: number;
}

/**
 * Providers return token usage but never dollar pricing, so prices come from
 * the community-maintained LiteLLM catalog, fetched at most once per day and
 * cached locally. The small built-in table below is the offline fallback.
 */
const CATALOG_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/** Fallback: USD per 1M tokens [input, output]. */
const FALLBACK: Array<[RegExp, [number, number]]> = [
  [/claude-opus-4/, [5, 25]],
  [/claude-sonnet-4/, [3, 15]],
  [/claude-haiku-4/, [1, 5]],
  [/gpt-5/, [1.25, 10]],
  [/gpt-4o-mini/, [0.15, 0.6]],
  [/gpt-4o/, [2.5, 10]],
  [/gemini-.*-flash/, [0.3, 2.5]],
  [/gemini-.*-pro/, [1.25, 10]],
];

type Catalog = Record<string, { input_cost_per_token?: number; output_cost_per_token?: number }>;

let catalog: Catalog | null = null;

function catalogPath(): string {
  return join(cacheDir(), "model-prices.json");
}

/** Load the price catalog: fresh local cache → network → stale cache → null. */
export async function loadPriceCatalog(): Promise<void> {
  const path = catalogPath();
  try {
    if (existsSync(path) && Date.now() - statSync(path).mtimeMs < CATALOG_TTL_MS) {
      catalog = JSON.parse(readFileSync(path, "utf8")) as Catalog;
      return;
    }
  } catch {
    // fall through to network
  }

  try {
    const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(String(response.status));
    const text = await response.text();
    catalog = JSON.parse(text) as Catalog;
    mkdirSync(cacheDir(), { recursive: true });
    const temp = `${path}.tmp-${process.pid}`;
    writeFileSync(temp, text);
    renameSync(temp, path);
  } catch {
    // Offline / fetch failed: use a stale cached catalog if one exists.
    try {
      if (existsSync(path)) catalog = JSON.parse(readFileSync(path, "utf8")) as Catalog;
    } catch {
      catalog = null;
    }
  }
}

function lookupPrices(modelId: string): Prices | null {
  if (catalog) {
    // LiteLLM keys vary by provider prefix; try common forms.
    for (const key of [modelId, `anthropic/${modelId}`, `openai/${modelId}`, `gemini/${modelId}`]) {
      const entry = catalog[key];
      if (entry?.input_cost_per_token != null && entry?.output_cost_per_token != null) {
        return { input: entry.input_cost_per_token, output: entry.output_cost_per_token };
      }
    }
  }
  for (const [pattern, [inPrice, outPrice]] of FALLBACK) {
    if (pattern.test(modelId)) {
      return { input: inPrice / 1_000_000, output: outPrice / 1_000_000 };
    }
  }
  return null;
}

export function estimateCost(modelId: string, usage: Usage): number | null {
  const prices = lookupPrices(modelId);
  if (!prices) return null;
  return usage.inputTokens * prices.input + usage.outputTokens * prices.output;
}

/** Short form for the live progress line, e.g. "$0.43". */
export function formatRunningCost(modelId: string, usage: Usage): string | null {
  const cost = estimateCost(modelId, usage);
  if (cost === null) return null;
  return cost < 0.005 ? "<$0.01" : `$${cost.toFixed(2)}`;
}

/** Full form for the end-of-run summary. */
export function formatCost(modelId: string, usage: Usage): string {
  if (usage.inputTokens === 0 && usage.outputTokens === 0) {
    return "$0.00 (everything served from cache)";
  }
  const tokens = `${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out tokens`;
  const cost = estimateCost(modelId, usage);
  if (cost === null) return tokens;
  return `${tokens} (~${cost < 0.005 ? "<$0.01" : `$${cost.toFixed(2)}`})`;
}
