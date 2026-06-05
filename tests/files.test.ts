import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCollision, sanitizeCategory, sanitizeFilename } from "../src/lib/files";
import { mergeConfig, DEFAULT_CONFIG } from "../src/lib/config";

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
