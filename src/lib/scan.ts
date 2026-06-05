import { closeSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { extname, join } from "node:path";

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Above this, images are downscaled in memory before analysis (~5MB API limit). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

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

/** Cheap magic-byte sniff so corrupt/renamed files don't waste API calls. */
export function hasImageMagicBytes(path: string, ext: string): boolean {
  const head = Buffer.alloc(12);
  try {
    const fd = openSync(path, "r");
    try {
      if (readSync(fd, head, 0, 12, 0) < 12) return false;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
  switch (ext) {
    case ".png":
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case ".jpg":
    case ".jpeg":
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case ".gif":
      return head.subarray(0, 4).toString("latin1") === "GIF8";
    case ".webp":
      return head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
    default:
      return false;
  }
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
      stats = lstatSync(path);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) {
      skipped.push({ path, reason: "symlink (not followed)" });
      continue;
    }
    if (!stats.isFile()) continue;

    if (stats.size === 0) {
      skipped.push({ path, reason: "empty file" });
      continue;
    }
    if (!hasImageMagicBytes(path, ext)) {
      skipped.push({ path, reason: "not a real image (content doesn't match extension)" });
      continue;
    }

    images.push({ path, name: entry, ext, bytes: stats.size });
  }

  images.sort((a, b) => a.name.localeCompare(b.name));
  return { images, skipped };
}
