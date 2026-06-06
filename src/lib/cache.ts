import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Analysis {
  category: string;
  description: string;
  filename: string;
}

export interface CacheEntry extends Analysis {
  cachedAt: string;
  /** Last known location of the file — powers `organize find`. */
  path?: string;
  /** Perceptual dHash (16 hex chars) — powers near-duplicate detection. */
  phash?: string;
}

type CacheData = Record<string, CacheEntry>;

/** Cap cache size; oldest entries are evicted first. Sized for large image
 * libraries — entries are small (~300 bytes), so 50k ≈ 15MB on disk. */
const MAX_ENTRIES = 50_000;

export function cacheDir(): string {
  const base =
    process.env.XDG_CACHE_HOME && process.env.XDG_CACHE_HOME.trim() !== ""
      ? process.env.XDG_CACHE_HOME
      : join(homedir(), ".cache");
  return join(base, "organize");
}

function cachePath(): string {
  return join(cacheDir(), "analysis.json");
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Cache key: file content + everything that changes the analysis outcome. */
export function cacheKey(
  fileBytes: Buffer,
  model: string,
  pinnedCategories: string[],
  instructions: string,
): string {
  const context = JSON.stringify({ model, pinnedCategories, instructions });
  return sha256(Buffer.concat([fileBytes, Buffer.from(context)]));
}

export class AnalysisCache {
  private data: CacheData;
  private dirty = false;

  constructor() {
    this.data = this.load();
  }

  private load(): CacheData {
    const path = cachePath();
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, "utf8")) as CacheData;
    } catch {
      return {};
    }
  }

  get(key: string): CacheEntry | null {
    return this.data[key] ?? null;
  }

  set(key: string, analysis: Analysis, extra?: { path?: string; phash?: string }): void {
    this.data[key] = { ...analysis, ...extra, cachedAt: new Date().toISOString() };
    this.dirty = true;
    this.scheduleSave();
  }

  /** Refresh the last-known path (and phash) on a cache hit. */
  touch(key: string, path: string, phash?: string): void {
    const entry = this.data[key];
    if (!entry) return;
    if (entry.path !== path || (phash && entry.phash !== phash)) {
      entry.path = path;
      if (phash) entry.phash = phash;
      this.dirty = true;
      this.scheduleSave();
    }
  }

  /** All entries with their keys — for `organize find` and embedding sync. */
  entries(): Array<{ key: string; entry: CacheEntry }> {
    return Object.entries(this.data).map(([key, entry]) => ({ key, entry }));
  }

  /** Debounced save so an interrupted run keeps the analyses already paid for. */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 1000);
    // Don't keep the process alive just to flush the cache
    this.saveTimer.unref?.();
  }

  /** Persist to disk atomically (temp file + rename). */
  save(): void {
    if (!this.dirty) return;
    this.prune();
    mkdirSync(cacheDir(), { recursive: true });
    const target = cachePath();
    const temp = `${target}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify(this.data));
    renameSync(temp, target);
    this.dirty = false;
  }

  /** Evict oldest entries beyond the cap so the cache can't grow unbounded. */
  private prune(): void {
    const keys = Object.keys(this.data);
    if (keys.length <= MAX_ENTRIES) return;
    keys
      .sort((a, b) => (this.data[a]!.cachedAt < this.data[b]!.cachedAt ? -1 : 1))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((key) => delete this.data[key]);
  }

  static clear(): void {
    rmSync(cachePath(), { force: true });
  }
}
