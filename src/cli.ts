#!/usr/bin/env node
import { Command } from "commander";
import { authCommand } from "./commands/auth";
import { configCommand } from "./commands/config";
import { runCommand } from "./commands/run";
import { AnalysisCache } from "./lib/cache";

const program = new Command();

program
  .name("organize")
  .description(
    "AI-powered file organizer — looks at your screenshots, describes them, and sorts them into folders.",
  )
  .version("0.1.0");

program
  .argument("[dir]", "directory to organize (default: current directory)")
  .option("--dry-run", "analyze and show the plan without moving anything")
  .option("-y, --yes", "skip the confirmation prompt")
  .option("--out <dir>", "destination root (default: <dir>/Organized)")
  .option("--model <id>", "model, e.g. anthropic/claude-opus-4-8, openai/gpt-5.2")
  .option("--prompt <text>", "extra instructions, e.g. \"use SOC 2 trust criteria as categories\"")
  .option("--categories <list>", "comma-separated pinned categories the AI should prefer")
  .option("--no-rename", "keep original filenames")
  .option("--copy", "copy instead of move")
  .option("--concurrency <n>", "parallel API calls")
  .option("--no-cache", "force fresh analysis, ignoring cached results")
  .action(runCommand);

program
  .command("auth")
  .description("store an API key securely in the macOS Keychain")
  .argument("[provider]", "anthropic | openai | google", "anthropic")
  .action(authCommand);

program
  .command("config")
  .description("show or edit the config file (~/.config/organize/config.json)")
  .argument("[action]", "show | get | set | path")
  .argument("[key]")
  .argument("[value]")
  .action(configCommand);

program
  .command("cache")
  .description("manage the analysis cache")
  .argument("<action>", "clear")
  .action((action: string) => {
    if (action === "clear") {
      AnalysisCache.clear();
      console.log("Cache cleared.");
    } else {
      console.error(`Unknown action "${action}". Use: clear`);
      process.exit(1);
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
