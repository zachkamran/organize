import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Analysis {
  category: string;
  description: string;
  filename: string;
}

interface CacheEntry extends Analysis {
  cachedAt: string;
}

type CacheData = Record<string, CacheEntry>;

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

  get(key: string): Analysis | null {
    const entry = this.data[key];
    if (!entry) return null;
    const { category, description, filename } = entry;
    return { category, description, filename };
  }

  set(key: string, analysis: Analysis): void {
    this.data[key] = { ...analysis, cachedAt: new Date().toISOString() };
    this.dirty = true;
  }

  /** Persist to disk (call after each batch; cheap, atomic-enough for a CLI). */
  save(): void {
    if (!this.dirty) return;
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(this.data, null, 2));
    this.dirty = false;
  }

  static clear(): void {
    rmSync(cachePath(), { force: true });
  }
}
