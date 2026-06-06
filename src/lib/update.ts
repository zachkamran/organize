import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { cacheDir } from "./cache";

const RELEASES_API = "https://api.github.com/repos/zachkamran/organize/releases/latest";
const RELEASES_URL = "https://github.com/zachkamran/organize/releases/latest";
const CHECK_TTL_MS = 24 * 60 * 60 * 1000; // at most one network check per day

function checkPath(): string {
  return join(cacheDir(), "update-check.json");
}

/**
 * Print a quiet upgrade hint when a newer release exists. Network check runs
 * at most once a day with a short timeout; offline/rate-limited failures are
 * silent. Never blocks the actual work — call after the command finishes.
 */
export async function maybeNotifyUpdate(currentVersion: string): Promise<void> {
  if (!process.stdout.isTTY || process.env.ORGANIZE_NO_UPDATE_CHECK) return;

  let latest: string | null = null;
  try {
    const path = checkPath();
    if (existsSync(path) && Date.now() - statSync(path).mtimeMs < CHECK_TTL_MS) {
      latest = (JSON.parse(readFileSync(path, "utf8")) as { latest: string }).latest;
    } else {
      const response = await fetch(RELEASES_API, {
        signal: AbortSignal.timeout(1500),
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) return;
      const release = (await response.json()) as { tag_name?: string };
      latest = release.tag_name?.replace(/^v/, "") ?? null;
      if (latest) {
        mkdirSync(cacheDir(), { recursive: true });
        const temp = `${path}.tmp-${process.pid}`;
        writeFileSync(temp, JSON.stringify({ latest }));
        renameSync(temp, path);
      }
    }
  } catch {
    return; // offline, rate-limited, or slow — never bother the user
  }

  if (latest && isNewer(latest, currentVersion)) {
    console.error(
      pc.dim(`\nUpdate available: ${currentVersion} → ${latest}  ${RELEASES_URL}`),
    );
  }
}

export function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
