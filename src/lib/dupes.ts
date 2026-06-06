import { Jimp } from "jimp";

/**
 * 64-bit perceptual dHash: downscale to 9x8 grayscale, compare horizontally
 * adjacent pixels. Returned as 16 hex chars. Robust to re-encoding/resizing.
 */
export async function perceptualHash(bytes: Buffer): Promise<string> {
  const image = await Jimp.read(bytes);
  image.resize({ w: 9, h: 8 }).greyscale();

  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = image.getPixelColor(x, y) >>> 24; // red channel of greyscale
      const right = image.getPixelColor(x + 1, y) >>> 24;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, "0");
}

export function hammingDistance(a: string, b: string): number {
  let xor = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

/** Groups of paths with byte-identical content (first entry = keeper). */
export function findExactDupes(fileHashes: Map<string, string>): string[][] {
  const byHash = new Map<string, string[]>();
  for (const [path, hash] of fileHashes) {
    const list = byHash.get(hash) ?? [];
    list.push(path);
    byHash.set(hash, list);
  }
  return [...byHash.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort());
}

const NEAR_DUPE_THRESHOLD = 6;

/**
 * Cluster visually-similar images (burst screenshots, re-encodes) by
 * perceptual-hash hamming distance. Exact dupes are excluded — they're
 * handled separately. O(n²) on hash pairs; fine for tens of thousands.
 */
export function findNearDupes(
  phashes: Map<string, string>,
  excludePaths: Set<string>,
): string[][] {
  const paths = [...phashes.keys()].filter((p) => !excludePaths.has(p)).sort();
  const clusterOf = new Map<string, Set<string>>();

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i]!;
      const b = paths[j]!;
      if (hammingDistance(phashes.get(a)!, phashes.get(b)!) > NEAR_DUPE_THRESHOLD) continue;
      const cluster = clusterOf.get(a) ?? clusterOf.get(b) ?? new Set([a]);
      cluster.add(a);
      cluster.add(b);
      clusterOf.set(a, cluster);
      clusterOf.set(b, cluster);
    }
  }

  const seen = new Set<Set<string>>();
  const clusters: string[][] = [];
  for (const cluster of clusterOf.values()) {
    if (seen.has(cluster)) continue;
    seen.add(cluster);
    clusters.push([...cluster].sort());
  }
  return clusters;
}
