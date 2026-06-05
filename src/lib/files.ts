import { copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Sanitize an AI-suggested filename into safe kebab-case (no extension). */
export function sanitizeFilename(suggested: string, fallback: string): string {
  const cleaned = suggested
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/i, "") // strip any extension the model added
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Sanitize a category into a safe folder name (Title Case preserved). */
export function sanitizeCategory(category: string): string {
  const cleaned = category
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : "Other";
}

/** Pick a non-colliding destination path, appending -2, -3, ... as needed. */
export function resolveCollision(
  dir: string,
  base: string,
  ext: string,
  taken: Set<string>,
): string {
  let candidate = `${base}${ext}`;
  let n = 2;
  while (taken.has(candidate.toLowerCase()) || existsSync(join(dir, candidate))) {
    candidate = `${base}-${n}${ext}`;
    n++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

export interface PlannedMove {
  from: string;
  toDir: string;
  toName: string;
}

/** Move (or copy) a file, creating directories; rename with cross-device fallback. */
export function executeMove(move: PlannedMove, copy: boolean): string {
  mkdirSync(move.toDir, { recursive: true });
  const dest = join(move.toDir, move.toName);
  if (copy) {
    copyFileSync(move.from, dest);
  } else {
    try {
      renameSync(move.from, dest);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        copyFileSync(move.from, dest);
        unlinkSync(move.from);
      } else {
        throw error;
      }
    }
  }
  return dest;
}
