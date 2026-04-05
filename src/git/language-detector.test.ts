import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectLanguagesFromDir } from "./language-detector.js";

describe("Language Detector", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lang-detect-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects typescript/javascript from package.json", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["javascript", "typescript"]);
  });

  it("detects typescript/javascript from tsconfig.json", async () => {
    await writeFile(join(tempDir, "tsconfig.json"), "{}");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["javascript", "typescript"]);
  });

  it("detects typescript/javascript from deno.json", async () => {
    await writeFile(join(tempDir, "deno.json"), "{}");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["javascript", "typescript"]);
  });

  it("detects rust from Cargo.toml", async () => {
    await writeFile(join(tempDir, "Cargo.toml"), "[package]");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["rust"]);
  });

  it("detects go from go.mod", async () => {
    await writeFile(join(tempDir, "go.mod"), "module example.com/foo");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["go"]);
  });

  it("detects python from pyproject.toml", async () => {
    await writeFile(join(tempDir, "pyproject.toml"), "[project]");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["python"]);
  });

  it("detects python from requirements.txt", async () => {
    await writeFile(join(tempDir, "requirements.txt"), "flask==2.0");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["python"]);
  });

  it("detects python from setup.py", async () => {
    await writeFile(join(tempDir, "setup.py"), "from setuptools import setup");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["python"]);
  });

  it("detects java/kotlin from pom.xml", async () => {
    await writeFile(join(tempDir, "pom.xml"), "<project></project>");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["java", "kotlin"]);
  });

  it("detects java/kotlin from build.gradle", async () => {
    await writeFile(join(tempDir, "build.gradle"), "plugins {}");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["java", "kotlin"]);
  });

  it("detects java/kotlin from build.gradle.kts", async () => {
    await writeFile(join(tempDir, "build.gradle.kts"), "plugins {}");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["java", "kotlin"]);
  });

  it("detects c/cpp from CMakeLists.txt", async () => {
    await writeFile(join(tempDir, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.10)");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["c", "cpp"]);
  });

  it("deduplicates languages from multiple manifests", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "tsconfig.json"), "{}");
    const result = await detectLanguagesFromDir(tempDir);
    // Both map to ["typescript", "javascript"] — should be deduplicated
    expect(result).toEqual(["javascript", "typescript"]);
  });

  it("returns union of languages from unrelated manifests", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "Cargo.toml"), "[package]");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual(["javascript", "rust", "typescript"]);
  });

  it("returns empty array for empty directory", async () => {
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual([]);
  });

  it("returns empty array for directory with no recognized manifests", async () => {
    await writeFile(join(tempDir, "README.md"), "# Hello");
    await writeFile(join(tempDir, "data.csv"), "a,b,c");
    const result = await detectLanguagesFromDir(tempDir);
    expect(result).toEqual([]);
  });

  it("returns sorted array", async () => {
    await writeFile(join(tempDir, "Cargo.toml"), "[package]");
    await writeFile(join(tempDir, "go.mod"), "module foo");
    await writeFile(join(tempDir, "pyproject.toml"), "[project]");
    const result = await detectLanguagesFromDir(tempDir);
    // Should be alphabetically sorted
    expect(result).toEqual(["go", "python", "rust"]);
    expect(result).toEqual([...result].sort());
  });
});
