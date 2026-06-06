import { existsSync, mkdirSync, statSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pc from "picocolors";
import { indexCommand } from "./index-cmd";

export interface WatchOptions {
  embed?: boolean;
  includeSubdirs?: boolean;
  install?: boolean;
  uninstall?: boolean;
}

const LAUNCHD_LABEL = "ai.organize.watch";

/**
 * Keep a directory's search index fresh as screenshots arrive.
 *
 * Foreground: `organize watch ~/Desktop --embed` — fs-watch with a debounce,
 * re-indexing only what's new (everything else is cache hits).
 *
 * Background (macOS): `organize watch ~/Desktop --embed --install` writes a
 * launchd agent that runs `organize index` whenever the folder changes — no
 * daemon, survives reboots, uninstall with `--uninstall`.
 */
export async function watchCommand(dirArg: string | undefined, options: WatchOptions): Promise<void> {
  const dir = resolve(dirArg ?? ".");

  if (options.uninstall) return uninstallAgent();
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(pc.red(`Not a directory: ${dir}`));
    process.exit(1);
  }
  if (options.install) return installAgent(dir, options);

  // --- Foreground watch -----------------------------------------------------
  console.log(`Watching ${pc.bold(dir)} — new images are indexed${options.embed ? " + embedded" : ""} automatically. Ctrl-C to stop.\n`);
  await runIndex(dir, options); // catch up on anything added while not watching

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  watch(dir, { recursive: options.includeSubdirs ?? false }, (_event, filename) => {
    if (!filename || !/\.(png|jpe?g|webp|gif|heic|tiff?)$/i.test(filename)) return;
    if (basename(filename).startsWith(".")) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) return; // an index run is already in flight; next change re-triggers
      running = true;
      console.log(pc.dim(`\nchange detected (${filename}) — reindexing…`));
      try {
        await runIndex(dir, options);
      } finally {
        running = false;
      }
    }, 5000); // let screenshot bursts settle
  });

  await new Promise(() => {}); // run until interrupted
}

async function runIndex(dir: string, options: WatchOptions): Promise<void> {
  try {
    await indexCommand(dir, { includeSubdirs: options.includeSubdirs, embed: options.embed });
  } catch (error) {
    console.error(pc.red((error as Error).message));
  }
}

// --- launchd (macOS) ---------------------------------------------------------

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

function installAgent(dir: string, options: WatchOptions): void {
  if (process.platform !== "darwin") {
    console.error(pc.red("--install uses launchd and is macOS-only. Run `organize watch` in the foreground instead."));
    process.exit(1);
  }

  const args = [process.execPath, "index", dir];
  if (options.includeSubdirs) args.push("--include-subdirs");
  if (options.embed) args.push("--embed");

  const logPath = join(homedir(), "Library", "Logs", "organize-watch.log");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${a}</string>`).join("\n")}
  </array>
  <key>WatchPaths</key>
  <array><string>${dir}</string></array>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`;

  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(plistPath(), plist);
  spawnSync("launchctl", ["unload", plistPath()], { stdio: "ignore" }); // replace if present
  const result = spawnSync("launchctl", ["load", plistPath()], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(pc.red(`launchctl load failed: ${result.stderr?.trim()}`));
    process.exit(1);
  }

  console.log(pc.green(`Installed: ${dir} is now auto-indexed${options.embed ? " + embedded" : ""} whenever it changes.`));
  console.log(pc.dim(`Agent: ${plistPath()}`));
  console.log(pc.dim(`Logs:  ${logPath}`));
  console.log(pc.dim(`Remove with: organize watch --uninstall`));
  console.log(
    pc.yellow(
      `\nNote: launchd doesn't read your shell env — make sure keys the indexer needs are in the macOS Keychain (organize auth <provider>), not just exported in ~/.zshrc.`,
    ),
  );
}

function uninstallAgent(): void {
  if (!existsSync(plistPath())) {
    console.log("No watch agent installed.");
    return;
  }
  spawnSync("launchctl", ["unload", plistPath()], { stdio: "ignore" });
  unlinkSync(plistPath());
  console.log(pc.green("Watch agent removed."));
}
