#!/usr/bin/env node
import { Command } from "commander";
import { authCommand } from "./commands/auth";
import { configCommand } from "./commands/config";
import { findCommand } from "./commands/find";
import { indexCommand } from "./commands/index-cmd";
import { runCommand } from "./commands/run";
import { undoCommand } from "./commands/undo";
import { watchCommand } from "./commands/watch";
import { AnalysisCache } from "./lib/cache";
import { maybeNotifyUpdate } from "./lib/update";

const VERSION = "0.3.1";

const program = new Command();

program
  .name("organize")
  .description(
    "AI-powered file organizer — looks at your screenshots, describes them, and sorts them into folders.",
  )
  .version(VERSION)
  // Without this, root options (e.g. --include-subdirs) swallow identically
  // named subcommand options before the subcommand can see them.
  .enablePositionalOptions();

program
  .argument("[dir]", "directory to organize (default: current directory)")
  .option("--dry-run", "analyze and show the plan without moving anything")
  .option("-y, --yes", "skip the confirmation prompt")
  .option("--out <dir>", "destination root (default: <dir>/Organized)")
  .option("--model <id>", "model, e.g. anthropic/claude-haiku-4-5 or ollama/qwen3-vl (local)")
  .option("--include-subdirs", "recurse into subdirectories")
  .option("--prompt <text>", "extra instructions, e.g. \"use SOC 2 trust criteria as categories\"")
  .option("--categories <list>", "comma-separated pinned categories the AI should prefer")
  .option("--no-rename", "keep original filenames")
  .option("--copy", "copy instead of move")
  .option("--concurrency <n>", "parallel API calls")
  .option("--no-cache", "force fresh analysis, ignoring cached results")
  .action(runCommand);

program
  .command("undo")
  .description("revert the last run (moves files back where they came from)")
  .action(undoCommand);

program
  .command("find")
  .description("search analyzed images by description — instant, no API calls")
  .argument("<query>", 'what you remember about the image, e.g. "stripe invoice march"')
  .option("--limit <n>", "max results to show", "10")
  .option("--all", "show all matches")
  .option("--keyword", "keyword matching only (skip semantic search)")
  .option("-p, --preview", "show image thumbnails inline (Ghostty/Kitty/iTerm2; ANSI elsewhere)")
  .action(findCommand);

program
  .command("index")
  .description("analyze images to make them searchable WITHOUT moving anything")
  .argument("[dir]", "directory to index (default: current directory)")
  .option("--model <id>", "model, e.g. anthropic/claude-haiku-4-5 or ollama/qwen3-vl")
  .option("--prompt <text>", "extra analysis instructions")
  .option("--concurrency <n>", "parallel API calls")
  .option("--include-subdirs", "recurse into subdirectories")
  .option("--embed", "also compute embeddings for semantic find")
  .action(indexCommand);

program
  .command("watch")
  .description("auto-index (and optionally embed) new images as they're added")
  .argument("[dir]", "directory to watch (default: current directory)")
  .option("--embed", "also embed new images for semantic find")
  .option("--include-subdirs", "watch subdirectories too")
  .option("--install", "install as a macOS launchd agent (runs in background, survives reboot)")
  .option("--uninstall", "remove the launchd agent")
  .action(watchCommand);

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

program
  .parseAsync()
  .then(() => maybeNotifyUpdate(VERSION))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
