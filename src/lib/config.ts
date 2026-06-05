import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** Provider-qualified model, e.g. "anthropic/claude-opus-4-8" */
  model: string;
  /** Rename files to AI-suggested descriptive names */
  rename: boolean;
  /** Persistent user instructions merged into every analysis prompt */
  instructions: string;
  /** Pinned categories the model is told to prefer (not a closed list) */
  categories: string[];
  /** Parallel API calls */
  concurrency: number;
}

export const DEFAULT_CONFIG: Config = {
  model: "anthropic/claude-opus-4-8",
  rename: true,
  instructions: "",
  categories: [],
  concurrency: 5,
};

export function configDir(): string {
  const base =
    process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim() !== ""
      ? process.env.XDG_CONFIG_HOME
      : join(homedir(), ".config");
  return join(base, "organize");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function loadConfig(): Config {
  const path = configPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
    return mergeConfig(raw);
  } catch {
    console.error(`warning: could not parse ${path}, using defaults`);
    return { ...DEFAULT_CONFIG };
  }
}

export function mergeConfig(partial: Partial<Config>): Config {
  const merged = { ...DEFAULT_CONFIG, ...partial };
  // Guard against bad types from a hand-edited file
  if (!Array.isArray(merged.categories)) merged.categories = [];
  if (typeof merged.concurrency !== "number" || merged.concurrency < 1) {
    merged.concurrency = DEFAULT_CONFIG.concurrency;
  }
  return merged;
}

export function saveConfig(config: Config): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}
