import { closeSync, lstatSync, openSync, readdirSync, readSync } from "node:fs";
import { extname, join, resolve } from "node:path";

export const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".heic",
  ".tif",
  ".tiff",
]);

export const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic", // converted to JPEG before sending — providers don't accept heic
  ".tif": "image/tiff", // converted to JPEG before sending
  ".tiff": "image/tiff",
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

export interface ScanOptions {
  /** Recurse into subdirectories. */
  recursive?: boolean;
  /** Absolute paths never descended into (e.g. the output root). */
  exclude?: string[];
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
    case ".heic":
      // ISO-BMFF: size (4 bytes) then "ftyp" then a heif-family brand
      return head.subarray(4, 8).toString("latin1") === "ftyp";
    case ".tif":
    case ".tiff": {
      const tag = head.subarray(0, 4);
      return (
        tag.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || // little-endian II*\0
        tag.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])) // big-endian MM\0*
      );
    }
    default:
      return false;
  }
}

/** Find images in `dir`; optionally recursive (excluded dirs are never entered). */
export function scanImages(dir: string, options: ScanOptions = {}): ScanResult {
  const images: ScannedImage[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const excluded = new Set((options.exclude ?? []).map((p) => resolve(p)));

  function walk(current: string): void {
    if (excluded.has(resolve(current))) return;

    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const path = join(current, entry);

      let stats;
      try {
        stats = lstatSync(path);
      } catch {
        continue;
      }

      if (stats.isSymbolicLink()) {
        if (IMAGE_EXTENSIONS.has(extname(entry).toLowerCase())) {
          skipped.push({ path, reason: "symlink (not followed)" });
        }
        continue;
      }

      if (stats.isDirectory()) {
        // Skip dependency trees and macOS bundles — never user screenshots
        if (entry === "node_modules" || /\.(app|photoslibrary|bundle|framework)$/i.test(entry)) continue;
        if (options.recursive) walk(path);
        continue;
      }
      if (!stats.isFile()) continue;

      const ext = extname(entry).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;

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
  }

  walk(dir);
  images.sort((a, b) => a.path.localeCompare(b.path));
  return { images, skipped };
}
