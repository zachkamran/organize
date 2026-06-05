import { spawnSync } from "node:child_process";

export type Provider = "anthropic" | "openai" | "google";

export const PROVIDER_ENV_VARS: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

const KEYCHAIN_SERVICE = "organize-cli";

/** Read a key from the macOS Keychain. Returns null on any failure / non-macOS. */
export function keychainGet(provider: Provider): string | null {
  if (process.platform !== "darwin") return null;
  const result = spawnSync(
    "security",
    ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", provider, "-w"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  const key = result.stdout.trim();
  return key.length > 0 ? key : null;
}

/**
 * Store a key in the macOS Keychain interactively (`security` prompts for the
 * secret itself, so it never touches argv, shell history, or this process).
 */
export function keychainSetInteractive(provider: Provider): boolean {
  if (process.platform !== "darwin") {
    console.error("Keychain storage is only available on macOS.");
    console.error(`Set the ${PROVIDER_ENV_VARS[provider]} environment variable instead.`);
    return false;
  }
  const result = spawnSync(
    "security",
    ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", provider, "-w"],
    { stdio: "inherit" },
  );
  return result.status === 0;
}

/** Resolve an API key: env var first, then macOS Keychain. */
export function resolveApiKey(provider: Provider): string | null {
  const fromEnv = process.env[PROVIDER_ENV_VARS[provider]];
  if (fromEnv && fromEnv.trim() !== "") return fromEnv;
  return keychainGet(provider);
}

export function missingKeyMessage(provider: Provider): string {
  const envVar = PROVIDER_ENV_VARS[provider];
  return [
    `No API key found for ${provider}.`,
    ``,
    `Either set the environment variable:`,
    `  export ${envVar}=...`,
    ``,
    `Or store it securely in the macOS Keychain:`,
    `  organize auth ${provider}`,
  ].join("\n");
}
