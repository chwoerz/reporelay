import { describe, it, expect } from "vitest";
import ignore from "ignore";
import { classifyLanguage, filterIgnored } from "./file-classifier.js";

/** Patterns that are always ignored (mirroring the production ALWAYS_IGNORED list). */
const ALWAYS_IGNORED = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "__pycache__",
  ".DS_Store",
  "*.lock",
];

describe("File Classifier", () => {
  describe("language detection", () => {
    it("classifies .ts files as typescript", () => {
      expect(classifyLanguage("src/index.ts")).toBe("typescript");
      expect(classifyLanguage("deep/nested/file.ts")).toBe("typescript");
    });

    it("classifies .tsx files as typescript", () => {
      expect(classifyLanguage("App.tsx")).toBe("typescript");
    });

    it("classifies .js and .jsx files as javascript", () => {
      expect(classifyLanguage("index.js")).toBe("javascript");
      expect(classifyLanguage("Component.jsx")).toBe("javascript");
      expect(classifyLanguage("lib/utils.mjs")).toBe("javascript");
      expect(classifyLanguage("lib/utils.cjs")).toBe("javascript");
    });

    it("classifies .py files as python", () => {
      expect(classifyLanguage("main.py")).toBe("python");
      expect(classifyLanguage("stubs/types.pyi")).toBe("python");
    });

    it("classifies .go files as go", () => {
      expect(classifyLanguage("server.go")).toBe("go");
    });

    it("classifies .java files as java", () => {
      expect(classifyLanguage("Task.java")).toBe("java");
    });

    it("classifies .kt files as kotlin", () => {
      expect(classifyLanguage("Model.kt")).toBe("kotlin");
      expect(classifyLanguage("build.gradle.kts")).toBe("kotlin");
    });

    it("classifies .rs files as rust", () => {
      expect(classifyLanguage("main.rs")).toBe("rust");
    });

    it("classifies .c and .h files as c", () => {
      expect(classifyLanguage("server.c")).toBe("c");
      expect(classifyLanguage("server.h")).toBe("c");
    });

    it("classifies .cpp, .cc, .cxx, .hpp files as cpp", () => {
      expect(classifyLanguage("logger.cpp")).toBe("cpp");
      expect(classifyLanguage("logger.cc")).toBe("cpp");
      expect(classifyLanguage("logger.cxx")).toBe("cpp");
      expect(classifyLanguage("logger.hpp")).toBe("cpp");
      expect(classifyLanguage("logger.hxx")).toBe("cpp");
    });

    it("classifies .md files as markdown", () => {
      expect(classifyLanguage("README.md")).toBe("markdown");
      expect(classifyLanguage("docs/guide.mdx")).toBe("markdown");
    });

    it("returns null for unsupported extensions (.png, .lock, .woff)", () => {
      expect(classifyLanguage("logo.png")).toBeNull();
      expect(classifyLanguage("pnpm-lock.yaml")).toBeNull();
      expect(classifyLanguage("font.woff")).toBeNull();
      expect(classifyLanguage("font.woff2")).toBeNull();
      expect(classifyLanguage("data.json")).toBeNull();
      expect(classifyLanguage("Makefile")).toBeNull();
    });
  });

  describe("gitignore filtering", () => {
    it("respects .gitignore patterns", () => {
      const ig = ignore().add(ALWAYS_IGNORED).add("*.log\ncoverage/\n.env*");
      const files = [
        "src/index.ts",
        "debug.log",
        "coverage/lcov.info",
        ".env",
        ".env.local",
        "src/utils.ts",
      ];
      const result = filterIgnored(files, ig);
      expect(result).toEqual(["src/index.ts", "src/utils.ts"]);
    });

    it("always ignores node_modules, .git, dist, build", () => {
      const ig = ignore().add(ALWAYS_IGNORED); // no custom patterns
      const files = [
        "src/index.ts",
        "node_modules/foo/index.js",
        ".git/HEAD",
        "dist/bundle.js",
        "build/output.js",
        "README.md",
      ];
      const result = filterIgnored(files, ig);
      expect(result).toEqual(["src/index.ts", "README.md"]);
    });

    it("handles nested .gitignore files", () => {
      // Simulated by adding patterns with path prefixes
      const ig = ignore().add(ALWAYS_IGNORED);
      ig.add(["docs/generated/**"]);
      const files = [
        "src/index.ts",
        "docs/README.md",
        "docs/generated/api.md",
        "docs/generated/deep/file.md",
      ];
      const result = filterIgnored(files, ig);
      expect(result).toEqual(["src/index.ts", "docs/README.md"]);
    });
  });
});
