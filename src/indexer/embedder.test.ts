import { describe, it, expect, vi, afterEach } from "vitest";
import {
  OllamaEmbedder,
  DB_EMBEDDING_DIMENSIONS,
  embedInBatches,
  truncateForEmbedding,
  MAX_EMBED_TOKENS,
  type Embedder,
} from "./embedder.js";
import { estimateTokens } from "./chunker.js";
import { createMockEmbedder } from "../../test/setup/mock-embedder.js";

describe("Embedder", () => {
  describe("mock provider", () => {
    it("returns zero vectors of the standard dimension", async () => {
      const embedder = createMockEmbedder();
      const results = await embedder.embed(["hello"]);

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(DB_EMBEDDING_DIMENSIONS);
      expect(results[0]!.every((v: number) => v === 0)).toBe(true);
    });

    it("handles batch embedding of multiple chunks", async () => {
      const embedder = createMockEmbedder();
      const texts = ["chunk one", "chunk two", "chunk three"];
      const results = await embedder.embed(texts);

      expect(results).toHaveLength(3);
      results.forEach((vec: number[]) => {
        expect(vec).toHaveLength(DB_EMBEDDING_DIMENSIONS);
        expect(vec.every((v: number) => v === 0)).toBe(true);
      });
    });
  });

  describe("provider interface", () => {
    it("embed() accepts a string array and returns number[][] of correct dimensions", async () => {
      const embedder = createMockEmbedder();
      const results = await embedder.embed(["text a", "text b"]);

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveLength(DB_EMBEDDING_DIMENSIONS);
      expect(results[1]).toHaveLength(DB_EMBEDDING_DIMENSIONS);
    });

    it("throws on empty input array", async () => {
      const embedder = createMockEmbedder();
      await expect(embedder.embed([])).rejects.toThrow("embed() requires at least one text");
    });
  });

  describe("batching", () => {
    it("splits large chunk lists into batches of configurable size", async () => {
      const spy = vi.fn<Embedder["embed"]>(async (texts) =>
        texts.map(() => new Array(DB_EMBEDDING_DIMENSIONS).fill(0)),
      );
      const embedder: Embedder = { embed: spy, init: async () => {} };

      const texts = Array.from({ length: 10 }, (_, i) => `text-${i}`);
      await embedInBatches(embedder, texts, 3);

      // 10 texts / batch size 3 → 4 calls (3 + 3 + 3 + 1)
      expect(spy).toHaveBeenCalledTimes(4);
      expect(spy.mock.calls[0]![0]).toHaveLength(3);
      expect(spy.mock.calls[1]![0]).toHaveLength(3);
      expect(spy.mock.calls[2]![0]).toHaveLength(3);
      expect(spy.mock.calls[3]![0]).toHaveLength(1);
    });

    it("reassembles results in original order after batch processing", async () => {
      let callIdx = 0;
      const spy = vi.fn<Embedder["embed"]>(async (texts) => {
        const batchNum = callIdx++;
        return texts.map((_, i) => {
          const vec = new Array(DB_EMBEDDING_DIMENSIONS).fill(0);
          vec[0] = batchNum * 100 + i;
          return vec;
        });
      });

      const embedder: Embedder = { embed: spy, init: async () => {} };
      const texts = Array.from({ length: 5 }, (_, i) => `text-${i}`);
      const results = await embedInBatches(embedder, texts, 2);

      expect(results).toHaveLength(5);
      // Batch 0: texts 0,1 → markers 0,1
      expect(results[0]![0]).toBe(0);
      expect(results[1]![0]).toBe(1);
      // Batch 1: texts 2,3 → markers 100,101
      expect(results[2]![0]).toBe(100);
      expect(results[3]![0]).toBe(101);
      // Batch 2: text 4 → marker 200
      expect(results[4]![0]).toBe(200);
    });

    it("truncates oversized texts before embedding", async () => {
      const spy = vi.fn<Embedder["embed"]>(async (texts) =>
        texts.map(() => new Array(DB_EMBEDDING_DIMENSIONS).fill(0)),
      );
      const embedder: Embedder = { embed: spy, init: async () => {} };

      // Create text that exceeds the token budget (dense numeric content)
      const longText = "0.123 ".repeat(MAX_EMBED_TOKENS + 500);
      await embedInBatches(embedder, [longText, "short"], 64);

      // The first text should have been truncated
      expect(spy).toHaveBeenCalledTimes(1);
      const sentTexts = spy.mock.calls[0]![0];
      expect(estimateTokens(sentTexts[0]!)).toBeLessThanOrEqual(MAX_EMBED_TOKENS);
      expect(sentTexts[1]).toBe("short");
    });
  });

  describe("truncateForEmbedding", () => {
    it("returns text unchanged when under the token limit", () => {
      const text = "hello world\nline 2\n";
      expect(truncateForEmbedding(text)).toBe(text);
    });

    it("truncates text exceeding the token limit at a line boundary", () => {
      const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}: ${"x".repeat(20)}`);
      const text = lines.join("\n");
      const result = truncateForEmbedding(text, 100);
      expect(estimateTokens(result)).toBeLessThanOrEqual(100);
      // Result should be a subset of complete lines from the beginning
      expect(result.length).toBeLessThan(text.length);
      expect(result.length).toBeGreaterThan(0);
    });

    it("handles dense numeric content (SVG paths) correctly", () => {
      // SVG path data: ~1.5 chars/token, much denser than normal code
      const svgPath = "M100.23 200.45L300.67 400.89C500.12 600.34 700.56 800.78 900.9 100.23Z ";
      const text = svgPath.repeat(100);
      const result = truncateForEmbedding(text, 512);
      expect(estimateTokens(result)).toBeLessThanOrEqual(512);
      // Should be much shorter than 512 * 4 = 2048 chars because SVG is dense
      expect(result.length).toBeLessThan(2000);
    });

    it("hard-truncates if even a single line exceeds the token budget", () => {
      // Single very long line of numbers
      const text = "1.234 ".repeat(5000);
      const result = truncateForEmbedding(text, 100);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(text.length);
    });
  });

  // ── OllamaEmbedder.init() dimension validation ──

  describe("OllamaEmbedder.init()", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    afterEach(() => {
      fetchSpy.mockReset();
    });

    it("succeeds when probe returns vectors matching DB_EMBEDDING_DIMENSIONS", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ embeddings: [new Array(DB_EMBEDDING_DIMENSIONS).fill(0.1)] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const embedder = new OllamaEmbedder({ url: "http://fake:11434", model: "nomic-embed-text" });
      await expect(embedder.init()).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("throws with a clear message when model dimension differs from DB schema", async () => {
      const wrongDimension = 1024;
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ embeddings: [new Array(wrongDimension).fill(0.1)] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const embedder = new OllamaEmbedder({ url: "http://fake:11434", model: "bge-large" });
      await expect(embedder.init()).rejects.toThrow(
        `Embedding dimension mismatch: model "bge-large" produces ${wrongDimension}-d vectors`,
      );
    });

    it("propagates fetch errors when Ollama is unreachable", async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));

      const embedder = new OllamaEmbedder({
        url: "http://unreachable:11434",
        model: "nomic-embed-text",
      });
      await expect(embedder.init()).rejects.toThrow("fetch failed");
    });

    it("propagates HTTP error from Ollama", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("model not found", { status: 404 }));

      const embedder = new OllamaEmbedder({ url: "http://fake:11434", model: "nonexistent" });
      await expect(embedder.init()).rejects.toThrow("Ollama embed failed (404)");
    });
  });
});
