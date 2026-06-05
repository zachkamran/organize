import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** API limit guard — most providers reject images over ~5MB. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface ScannedImage {
  path: string;
  name: string;
  ext: string;
  bytes: number;
}

export interface ScanResult {
  images: ScannedImage[];
  skipped: Array<{ path: string; reason: string }>;
}

/** Find images in `dir` (top level only — we don't recurse into organized output). */
export function scanImages(dir: string): ScanResult {
  const images: ScannedImage[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const path = join(dir, entry);
    const ext = extname(entry).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;

    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;

    if (stats.size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: `too large (${(stats.size / 1024 / 1024).toFixed(1)}MB > 5MB)` });
      continue;
    }
    if (stats.size === 0) {
      skipped.push({ path, reason: "empty file" });
      continue;
    }

    images.push({ path, name: entry, ext, bytes: stats.size });
  }

  images.sort((a, b) => a.name.localeCompare(b.name));
  return { images, skipped };
}
