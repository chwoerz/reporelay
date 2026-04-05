import { describe, it, expect } from "vitest";
import { rewriteQuery, dedupOverlapping } from "./hybrid-search.js";
import type { SearchResult } from "../core/types.js";

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    filePath: "src/index.ts",
    repo: "test-repo",
    ref: "v1.0.0",
    content: "const x = 1;",
    startLine: 1,
    endLine: 1,
    score: 0.5,
    ...overrides,
  };
}

describe("Hybrid Search", () => {
  describe("rewriteQuery", () => {
    it("extracts quoted phrases as exact-match FTS terms", () => {
      const result = rewriteQuery('"error handling" in module');
      expect(result).not.toBeNull();
      expect(result!.ftsText).toBe('"error handling" in module');
      expect(result!.embeddingText).toBe("error handling in module");
    });

    it("passes unquoted text through as-is for both FTS and embedding", () => {
      const result = rewriteQuery("how to parse JSON");
      expect(result).not.toBeNull();
      expect(result!.ftsText).toBe("how to parse JSON");
      expect(result!.embeddingText).toBe("how to parse JSON");
    });

    it("returns null for blank/whitespace-only input", () => {
      expect(rewriteQuery("")).toBeNull();
      expect(rewriteQuery("   ")).toBeNull();
      expect(rewriteQuery("\n\t")).toBeNull();
    });
  });

  describe("dedupOverlapping", () => {
    it("keeps non-overlapping chunks from the same file", () => {
      const results = [
        makeResult({ score: 0.9, startLine: 1, endLine: 5 }),
        makeResult({ score: 0.7, startLine: 10, endLine: 15 }),
      ];
      expect(dedupOverlapping(results)).toHaveLength(2);
    });

    it("removes overlapping chunks from the same file, keeping the higher-scored one", () => {
      const results = [
        makeResult({ score: 0.9, startLine: 1, endLine: 10 }),
        makeResult({ score: 0.3, startLine: 5, endLine: 15 }),
      ];
      const deduped = dedupOverlapping(results);
      expect(deduped).toHaveLength(1);
      expect(deduped[0]!.score).toBeCloseTo(0.9);
    });

    it("allows overlapping ranges from different files", () => {
      const results = [
        makeResult({ score: 0.9, filePath: "a.ts", startLine: 1, endLine: 10 }),
        makeResult({ score: 0.7, filePath: "b.ts", startLine: 5, endLine: 15 }),
      ];
      expect(dedupOverlapping(results)).toHaveLength(2);
    });

    it("allows overlapping ranges from different repos", () => {
      const results = [
        makeResult({ score: 0.9, repo: "repo-a", startLine: 1, endLine: 10 }),
        makeResult({ score: 0.7, repo: "repo-b", startLine: 5, endLine: 15 }),
      ];
      expect(dedupOverlapping(results)).toHaveLength(2);
    });

    it("returns empty array for empty input", () => {
      expect(dedupOverlapping([])).toHaveLength(0);
    });
  });
});
