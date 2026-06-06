import { existsSync, unlinkSync } from "node:fs";
import { basename, dirname } from "node:path";
import pc from "picocolors";
import { executeMove } from "../lib/files";
import { clearManifest, loadManifest } from "../lib/manifest";

export function undoCommand(): void {
  const manifest = loadManifest();
  if (!manifest) {
    console.log("Nothing to undo — no previous run recorded.");
    return;
  }

  const verb = manifest.copied ? "Deleting copies from" : "Reverting";
  console.log(
    `${verb} the run from ${new Date(manifest.ranAt).toLocaleString()} ` +
      `(${manifest.moves.length} file(s), ${manifest.dir} → ${manifest.outRoot})\n`,
  );

  let reverted = 0;
  const problems: string[] = [];

  for (const move of manifest.moves) {
    try {
      if (!existsSync(move.to)) {
        problems.push(`${basename(move.to)}: no longer at ${move.to}, skipped`);
        continue;
      }
      if (manifest.copied) {
        // The original never moved — undoing a copy just removes the copy.
        unlinkSync(move.to);
      } else {
        executeMove(
          { from: move.to, toDir: dirname(move.from), toName: basename(move.from) },
          false,
        );
      }
      reverted++;
    } catch (error) {
      problems.push(`${basename(move.to)}: ${(error as Error).message}`);
    }
  }

  console.log(pc.green(`Reverted ${reverted}/${manifest.moves.length} file(s).`));
  for (const problem of problems) console.error(pc.yellow(`  ${problem}`));

  if (problems.length === 0) {
    clearManifest();
  } else {
    console.log(pc.dim("Manifest kept so you can retry after resolving the issues above."));
  }
}
