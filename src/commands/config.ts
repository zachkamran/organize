import pc from "picocolors";
import {
  configPath,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  type Config,
} from "../lib/config";

const ARRAY_KEYS = new Set(["categories"]);
const BOOLEAN_KEYS = new Set(["rename"]);
const NUMBER_KEYS = new Set(["concurrency"]);

export function configCommand(action?: string, key?: string, value?: string): void {
  const config = loadConfig();

  switch (action) {
    case undefined:
    case "show":
      console.log(JSON.stringify(config, null, 2));
      return;

    case "path":
      console.log(configPath());
      return;

    case "get": {
      if (!key || !(key in DEFAULT_CONFIG)) return badKey(key);
      console.log(JSON.stringify(config[key as keyof Config]));
      return;
    }

    case "set": {
      if (!key || !(key in DEFAULT_CONFIG)) return badKey(key);
      if (value === undefined) {
        console.error(pc.red("Usage: organize config set <key> <value>"));
        process.exit(1);
      }
      const updated = { ...config } as Record<string, unknown>;
      if (ARRAY_KEYS.has(key)) {
        updated[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (BOOLEAN_KEYS.has(key)) {
        updated[key] = value === "true";
      } else if (NUMBER_KEYS.has(key)) {
        updated[key] = parseInt(value, 10);
      } else {
        updated[key] = value;
      }
      saveConfig(updated as unknown as Config);
      console.log(pc.green(`${key} = ${JSON.stringify(updated[key])}`));
      return;
    }

    default:
      console.error(pc.red(`Unknown action "${action}". Use: show, get, set, path.`));
      process.exit(1);
  }
}

function badKey(key?: string): void {
  console.error(
    pc.red(`Unknown config key "${key ?? ""}". Keys: ${Object.keys(DEFAULT_CONFIG).join(", ")}`),
  );
  process.exit(1);
}
