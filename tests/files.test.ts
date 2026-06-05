import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeMove,
  resolveCollision,
  sanitizeCategory,
  sanitizeFilename,
} from "../src/lib/files";
import { mergeConfig, DEFAULT_CONFIG } from "../src/lib/config";
import { hasImageMagicBytes, scanImages } from "../src/lib/scan";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]);

describe("sanitizeFilename", () => {
  test("kebab-cases and strips junk", () => {
    expect(sanitizeFilename("Stripe Invoice (March 2026)!", "fb")).toBe(
      "stripe-invoice-march-2026",
    );
  });
  test("strips extension the model added", () => {
    expect(sanitizeFilename("my-screenshot.png", "fb")).toBe("my-screenshot");
  });
  test("falls back when empty", () => {
    expect(sanitizeFilename("???", "fallback-name")).toBe("fallback-name");
  });
  test("caps length at 80", () => {
    expect(sanitizeFilename("a".repeat(200), "fb").length).toBeLessThanOrEqual(80);
  });
});

describe("sanitizeCategory", () => {
  test("removes path-hostile characters", () => {
    expect(sanitizeCategory("Code/Terminal: stuff")).toBe("Code Terminal stuff");
  });
  test("falls back to Other", () => {
    expect(sanitizeCategory("///")).toBe("Other");
  });
});

describe("resolveCollision", () => {
  test("appends -2, -3 on collisions within a run", () => {
    const dir = mkdtempSync(join(tmpdir(), "organize-test-"));
    const taken = new Set<string>();
    expect(resolveCollision(dir, "shot", ".png", taken)).toBe("shot.png");
    expect(resolveCollision(dir, "shot", ".png", taken)).toBe("shot-2.png");
    expect(resolveCollision(dir, "shot", ".png", taken)).toBe("shot-3.png");
  });

  test("avoids files already on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "organize-test-"));
    writeFileSync(join(dir, "shot.png"), "x");
    const taken = new Set<string>();
    expect(resolveCollision(dir, "shot", ".png", taken)).toBe("shot-2.png");
  });
});

describe("executeMove", () => {
  test("re-suffixes instead of overwriting a file created after planning", () => {
    const dir = mkdtempSync(join(tmpdir(), "organize-test-"));
    writeFileSync(join(dir, "src.png"), "new");
    const outDir = join(dir, "dest");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "shot.png"), "OLD CONTENT"); // appeared after planning

    const dest = executeMove({ from: join(dir, "src.png"), toDir: outDir, toName: "shot.png" }, false);
    expect(dest).toBe(join(outDir, "shot-2.png"));
    expect(readFileSync(join(outDir, "shot.png"), "utf8")).toBe("OLD CONTENT");
    expect(readFileSync(dest, "utf8")).toBe("new");
  });
});

describe("scanImages", () => {
  test("skips symlinks and fake images, keeps real ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "organize-test-"));
    writeFileSync(join(dir, "real.png"), PNG_HEADER);
    writeFileSync(join(dir, "fake.png"), "this is actually text");
    writeFileSync(join(dir, "elsewhere.png"), PNG_HEADER);
    symlinkSync(join(dir, "elsewhere.png"), join(dir, "link.png"));

    const { images, skipped } = scanImages(dir);
    expect(images.map((i) => i.name).sort()).toEqual(["elsewhere.png", "real.png"]);
    expect(skipped.some((s) => s.reason.includes("symlink"))).toBe(true);
    expect(skipped.some((s) => s.reason.includes("not a real image"))).toBe(true);
  });
});

describe("hasImageMagicBytes", () => {
  test("accepts real png header, rejects mismatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "organize-test-"));
    const png = join(dir, "a.png");
    writeFileSync(png, PNG_HEADER);
    expect(hasImageMagicBytes(png, ".png")).toBe(true);
    expect(hasImageMagicBytes(png, ".jpg")).toBe(false);
  });
});

describe("mergeConfig", () => {
  test("fills defaults", () => {
    expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
  });
  test("repairs bad types", () => {
    const merged = mergeConfig({ categories: "nope" as unknown as string[], concurrency: -1 });
    expect(merged.categories).toEqual([]);
    expect(merged.concurrency).toBe(DEFAULT_CONFIG.concurrency);
  });
  test("keeps user values", () => {
    expect(mergeConfig({ model: "openai/gpt-5.2" }).model).toBe("openai/gpt-5.2");
  });
});
