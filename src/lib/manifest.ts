import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ExecutedMove {
  from: string; // original absolute path
  to: string; // where it ended up
}

export interface RunManifest {
  ranAt: string;
  dir: string;
  outRoot: string;
  copied: boolean;
  moves: ExecutedMove[];
}

function stateDir(): string {
  const base =
    process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.trim() !== ""
      ? process.env.XDG_STATE_HOME
      : join(homedir(), ".local", "state");
  return join(base, "organize");
}

function manifestPath(): string {
  return join(stateDir(), "last-run.json");
}

/** Persist the manifest of the last run (atomically) so `organize undo` can revert it. */
export function saveManifest(manifest: RunManifest): void {
  mkdirSync(stateDir(), { recursive: true });
  const target = manifestPath();
  const temp = `${target}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(manifest, null, 2));
  renameSync(temp, target);
}

export function loadManifest(): RunManifest | null {
  if (!existsSync(manifestPath())) return null;
  try {
    return JSON.parse(readFileSync(manifestPath(), "utf8")) as RunManifest;
  } catch {
    return null;
  }
}

export function clearManifest(): void {
  rmSync(manifestPath(), { force: true });
}
