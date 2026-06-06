import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Jimp, JimpMime } from "jimp";

/** Provider request limits we downscale to stay under. */
export const TARGET_BYTES = 4 * 1024 * 1024; // headroom under the ~5MB API limit
const MAX_LONG_EDGE = 2000; // plenty of detail for "what is this screenshot"

export interface PreparedImage {
  bytes: Buffer;
  mediaType: string;
  downscaled: boolean;
}

/**
 * Downscale an oversized image in memory for analysis. The original file on
 * disk is never modified. Re-encodes as JPEG (smallest for screenshots at
 * vision-quality settings), halving quality/size until under the limit.
 */
export async function downscaleForAnalysis(bytes: Buffer): Promise<PreparedImage> {
  const image = await Jimp.read(bytes);

  const longEdge = Math.max(image.width, image.height);
  if (longEdge > MAX_LONG_EDGE) {
    image.scaleToFit({ w: MAX_LONG_EDGE, h: MAX_LONG_EDGE });
  }

  for (const quality of [85, 70, 50]) {
    const out = await image.getBuffer(JimpMime.jpeg, { quality });
    if (out.length <= TARGET_BYTES) {
      return { bytes: Buffer.from(out), mediaType: JimpMime.jpeg, downscaled: true };
    }
  }
  // Last resort: shrink harder at low quality
  image.scaleToFit({ w: 1000, h: 1000 });
  const out = await image.getBuffer(JimpMime.jpeg, { quality: 50 });
  return { bytes: Buffer.from(out), mediaType: JimpMime.jpeg, downscaled: true };
}

/**
 * Convert a HEIC file (iPhone screenshots/photos) to an analysis-sized JPEG
 * using macOS's built-in `sips` — converts and downscales in one pass. The
 * original file is never modified.
 */
export function convertHeicForAnalysis(path: string): PreparedImage {
  if (process.platform !== "darwin") {
    throw new Error("HEIC analysis requires macOS (uses the built-in `sips` converter)");
  }
  const temp = join(tmpdir(), `organize-heic-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    const result = spawnSync(
      "sips",
      ["-s", "format", "jpeg", "-s", "formatOptions", "85", "-Z", String(MAX_LONG_EDGE), path, "--out", temp],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`sips failed to convert HEIC: ${result.stderr?.trim() || "unknown error"}`);
    }
    return { bytes: readFileSync(temp), mediaType: "image/jpeg", downscaled: true };
  } finally {
    rmSync(temp, { force: true });
  }
}
