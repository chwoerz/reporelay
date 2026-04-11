/**
 * Tests for the inlined language constants and detection logic.
 *
 * Verifies both the standalone behaviour and that the inlined copies
 * stay in sync with the canonical definitions in `src/core/types.ts`
 * and `src/git/language-detector.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Languages, detectLanguagesFromDir } from "./languages.js";
import { Languages as CanonicalLanguages } from "../core/types.js";

describe("Languages (sync with canonical)", () => {
  it("matches the canonical Languages array from core/types", () => {
    expect(Languages).toEqual(CanonicalLanguages);
  });
});

describe("detectLanguagesFromDir (standalone)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "proxy-lang-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects typescript/javascript from package.json", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["javascript", "typescript"]);
  });

  it("detects rust from Cargo.toml", async () => {
    await writeFile(join(tempDir, "Cargo.toml"), "[package]");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["rust"]);
  });

  it("detects java/kotlin from build.gradle.kts", async () => {
    await writeFile(join(tempDir, "build.gradle.kts"), "plugins {}");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["java", "kotlin"]);
  });

  it("returns empty array for empty directory", async () => {
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual([]);
  });

  it("returns sorted, deduplicated results", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "tsconfig.json"), "{}");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["javascript", "typescript"]);
  });
});
