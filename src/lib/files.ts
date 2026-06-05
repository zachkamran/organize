import { constants, copyFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { join, parse } from "node:path";

/** Sanitize an AI-suggested filename into safe kebab-case (no extension). */
export function sanitizeFilename(suggested: string, fallback: string): string {
  const cleaned = suggested
    .toLowerCase()
    .replace(/\.(png|jpe?g|webp|gif)$/i, "") // strip any image extension the model added
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

/**
 * Move (or copy) a file, creating directories; rename with cross-device
 * fallback. Never overwrites: if the planned name was taken between planning
 * and execution, a -2/-3 suffix is retried.
 */
export function executeMove(move: PlannedMove, copy: boolean): string {
  mkdirSync(move.toDir, { recursive: true });

  const { name: base, ext } = parse(move.toName);
  let toName = move.toName;
  for (let attempt = 2; ; attempt++) {
    const dest = join(move.toDir, toName);
    try {
      if (copy) {
        copyFileSync(move.from, dest, constants.COPYFILE_EXCL);
      } else {
        // No atomic no-overwrite rename in node — link+unlink gives EEXIST safety.
        moveNoOverwrite(move.from, dest);
      }
      return dest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        toName = `${base}-${attempt}${ext}`; // name got taken since planning; re-suffix
        continue;
      }
      throw error;
    }
  }
}

function moveNoOverwrite(from: string, dest: string): void {
  if (existsSync(dest)) {
    const error = new Error(`destination exists: ${dest}`) as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  }
  try {
    renameSync(from, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      copyFileSync(from, dest, constants.COPYFILE_EXCL);
      unlinkSync(from);
    } else {
      throw error;
    }
  }
}
