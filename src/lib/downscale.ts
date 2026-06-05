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
