import pc from "picocolors";
import { keychainSetInteractive, PROVIDER_ENV_VARS, type Provider } from "../lib/auth";

export function authCommand(providerArg: string): void {
  const provider = providerArg.toLowerCase();
  if (!(provider in PROVIDER_ENV_VARS)) {
    console.error(pc.red(`Unknown provider "${providerArg}". Supported: anthropic, openai, google, voyage.`));
    process.exit(1);
  }

  console.log(`Storing ${provider} API key in the macOS Keychain (service: organize-cli).`);
  console.log(pc.dim("You'll be prompted for the key — it never touches shell history or disk.\n"));

  if (keychainSetInteractive(provider as Provider)) {
    console.log(pc.green(`\nDone. organize will now find your ${provider} key automatically.`));
  } else {
    console.error(pc.red("\nFailed to store the key."));
    process.exit(1);
  }
}
