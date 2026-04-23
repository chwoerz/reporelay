/**
 * Unit tests for the embedder module — providers, batching, safety nets.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  OllamaEmbedder,
  OpenaiEmbedder,
  DB_EMBEDDING_DIMENSIONS,
  embedInBatches,
  truncateForEmbedding,
  MAX_EMBED_TOKENS,
  createEmbedder,
  type Embedder,
} from "./embedder.js";
import { estimateTokens } from "./chunker.js";
import { createMockEmbedder } from "../../test/setup/mock-embedder.js";

describe("Embedder", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  afterEach(() => {
    fetchSpy.mockReset();
  });

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
      const embedder: Embedder = {
        embed: spy,
        init: async () => {},
        initError: null,
        maxInputTokens: MAX_EMBED_TOKENS,
      };

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

      const embedder: Embedder = {
        embed: spy,
        init: async () => {},
        initError: null,
        maxInputTokens: MAX_EMBED_TOKENS,
      };
      const texts = Array.from({ length: 5 }, (_, i) => `text-${i}`);
      const result = await embedInBatches(embedder, texts, 2);

      expect(result.embeddings).toHaveLength(5);
      // Batch 0: texts 0,1 → markers 0,1
      expect(result.embeddings[0]![0]).toBe(0);
      expect(result.embeddings[1]![0]).toBe(1);
      // Batch 1: texts 2,3 → markers 100,101
      expect(result.embeddings[2]![0]).toBe(100);
      expect(result.embeddings[3]![0]).toBe(101);
      // Batch 2: text 4 → marker 200
      expect(result.embeddings[4]![0]).toBe(200);
      expect(result.failures).toHaveLength(0);
    });

    it("truncates oversized texts before embedding", async () => {
      const spy = vi.fn<Embedder["embed"]>(async (texts) =>
        texts.map(() => new Array(DB_EMBEDDING_DIMENSIONS).fill(0)),
      );
      const embedder: Embedder = {
        embed: spy,
        init: async () => {},
        initError: null,
        maxInputTokens: MAX_EMBED_TOKENS,
      };

      // Create text that exceeds the token budget (dense numeric content)
      const longText = "0.123 ".repeat(MAX_EMBED_TOKENS + 500);
      await embedInBatches(embedder, [longText, "short"], 64);

      // The first text should have been truncated
      expect(spy).toHaveBeenCalledTimes(1);
      const sentTexts = spy.mock.calls[0]![0];
      expect(estimateTokens(sentTexts[0]!)).toBeLessThanOrEqual(MAX_EMBED_TOKENS);
      expect(sentTexts[1]).toBe("short");
    });

    it("returns EmbedBatchResult with failures list for empty input", async () => {
      const embedder = createMockEmbedder();
      const result = await embedInBatches(embedder, []);
      expect(result.embeddings).toHaveLength(0);
      expect(result.failures).toHaveLength(0);
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

  describe("batch fallback on error", () => {
    it("falls back to individual embedding when batch fails", async () => {
      let callCount = 0;
      const spy = vi.fn<Embedder["embed"]>(async (texts) => {
        callCount++;
        // First call (the batch) fails
        if (callCount === 1 && texts.length > 1) throw new Error("batch too large");
        return texts.map(() => new Array(DB_EMBEDDING_DIMENSIONS).fill(0));
      });
      const embedder: Embedder = {
        embed: spy,
        init: async () => {},
        initError: null,
        maxInputTokens: MAX_EMBED_TOKENS,
      };

      const result = await embedInBatches(embedder, ["text1", "text2", "text3"], 64);

      expect(result.embeddings).toHaveLength(3);
      expect(result.failures).toHaveLength(0);
      // First call was the batch (failed), then 3 individual calls
      expect(spy).toHaveBeenCalledTimes(4);
    });

    it("handles mixed success: only problematic texts fail individually", async () => {
      const spy = vi.fn<Embedder["embed"]>(async (texts) => {
        // Fail on batch, succeed on individual texts
        if (texts.length > 1) throw new Error("batch error");
        return texts.map(() => new Array(DB_EMBEDDING_DIMENSIONS).fill(0));
      });
      const embedder: Embedder = {
        embed: spy,
        init: async () => {},
        initError: null,
        maxInputTokens: MAX_EMBED_TOKENS,
      };

      const result = await embedInBatches(embedder, ["a", "b"], 64);

      expect(result.embeddings).toHaveLength(2);
      result.embeddings.forEach((vec) => expect(vec).toHaveLength(DB_EMBEDDING_DIMENSIONS));
      expect(result.failures).toHaveLength(0);
    });

    it("records failures for texts that cannot be embedded at all", async () => {
      const embedder: Embedder = {
        embed: vi.fn(async () => {
          throw new Error("Ollama embed failed (500): model crashed");
        }),
        init: async () => {},
        initError: null,
        maxInputTokens: MAX_EMBED_TOKENS,
      };

      const result = await embedInBatches(embedder, ["good-text", "bad-text"], 64);

      // Both texts fail since the mock always throws
      expect(result.embeddings).toHaveLength(2);
      expect(result.embeddings[0]).toBeNull();
      expect(result.embeddings[1]).toBeNull();
      expect(result.failures).toHaveLength(2);
      expect(result.failures[0]!.index).toBe(0);
      expect(result.failures[0]!.error).toContain("Ollama embed failed");
      expect(result.failures[1]!.index).toBe(1);
    });

    it("never throws even when the provider is completely broken", async () => {
      const embedder: Embedder = {
        embed: vi.fn(async () => {
          throw new Error("connection refused");
        }),
        init: async () => {},
        initError: null,
        maxInputTokens: MAX_EMBED_TOKENS,
      };

      // Must not throw — the safety-net guarantee
      const result = await embedInBatches(embedder, ["a", "b", "c"], 2);

      expect(result.embeddings).toHaveLength(3);
      expect(result.embeddings.every((e) => e === null)).toBe(true);
      expect(result.failures).toHaveLength(3);
      result.failures.forEach((f) => {
        expect(f.error).toContain("connection refused");
      });
    });

    it("mixes successful and failed embeddings correctly", async () => {
      const embedder: Embedder = {
        embed: vi.fn(async (texts) => {
          // Batch call fails
          if (texts.length > 1) throw new Error("batch error");
          // Individual: "good" succeeds, "bad" fails
          if (texts[0] === "good") {
            return [new Array(DB_EMBEDDING_DIMENSIONS).fill(1)];
          }
          throw new Error("Ollama embed failed (400): bad input");
        }),
        init: async () => {},
        initError: null,
        maxInputTokens: MAX_EMBED_TOKENS,
      };

      const result = await embedInBatches(embedder, ["good", "bad"], 64);

      expect(result.embeddings).toHaveLength(2);
      // "good" succeeded
      expect(result.embeddings[0]).toHaveLength(DB_EMBEDDING_DIMENSIONS);
      // "bad" failed
      expect(result.embeddings[1]).toBeNull();
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]!.index).toBe(1);
      expect(result.failures[0]!.error).toContain("Ollama embed failed");
    });
  });

  describe("OllamaEmbedder.init()", () => {
    it("succeeds when probe returns vectors matching DB_EMBEDDING_DIMENSIONS", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ embeddings: [new Array(DB_EMBEDDING_DIMENSIONS).fill(0.1)] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const embedder = new OllamaEmbedder({ url: "http://fake:11434", model: "nomic-embed-text" });
      await expect(embedder.init()).resolves.toBeUndefined();
      expect(embedder.initError).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("captures dimension mismatch in initError instead of throwing", async () => {
      const wrongDimension = 1024;
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ embeddings: [new Array(wrongDimension).fill(0.1)] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const embedder = new OllamaEmbedder({ url: "http://fake:11434", model: "bge-large" });
      await embedder.init();
      expect(embedder.initError).toContain(
        `Embedding dimension mismatch: model "bge-large" produces ${wrongDimension}-d vectors`,
      );
    });

    it("captures fetch errors in initError when Ollama is unreachable", async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));

      const embedder = new OllamaEmbedder({
        url: "http://unreachable:11434",
        model: "nomic-embed-text",
      });
      await embedder.init();
      expect(embedder.initError).toBe("fetch failed");
    });

    it("captures HTTP errors in initError", async () => {
      fetchSpy.mockResolvedValueOnce(new Response("model not found", { status: 404 }));

      const embedder = new OllamaEmbedder({ url: "http://fake:11434", model: "nonexistent" });
      await embedder.init();
      expect(embedder.initError).toContain("Ollama embed failed (404)");
    });

    it("clears initError on successful retry after previous failure", async () => {
      // First call: unreachable
      fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
      const embedder = new OllamaEmbedder({ url: "http://fake:11434", model: "nomic-embed-text" });
      await embedder.init();
      expect(embedder.initError).toBe("fetch failed");

      // Second call: success
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ embeddings: [new Array(DB_EMBEDDING_DIMENSIONS).fill(0.1)] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await embedder.init();
      expect(embedder.initError).toBeNull();
    });
  });

  describe("OpenaiEmbedder", () => {
    /** Helper: build a valid OpenAI embeddings API response. */
    function openaiResponse(embeddings: number[][]): Response {
      const data = embeddings.map((embedding, index) => ({
        embedding,
        index,
        object: "embedding",
      }));
      return new Response(
        JSON.stringify({
          data,
          model: "text-embedding-3-small",
          object: "list",
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    it("embed() sends correct request with Authorization header", async () => {
      fetchSpy.mockResolvedValueOnce(
        openaiResponse([new Array(DB_EMBEDDING_DIMENSIONS).fill(0.1)]),
      );

      const embedder = new OpenaiEmbedder({
        apiKey: "sk-test-key",
        model: "text-embedding-3-small",
        dimensions: 768,
      });
      await embedder.embed(["hello"]);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/embeddings");
      expect((init as RequestInit).headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test-key",
      });

      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe("text-embedding-3-small");
      expect(body.input).toEqual(["hello"]);
      expect(body.encoding_format).toBe("float");
      expect(body.dimensions).toBe(768);
    });

    it("embed() omits dimensions when not configured", async () => {
      fetchSpy.mockResolvedValueOnce(
        openaiResponse([new Array(DB_EMBEDDING_DIMENSIONS).fill(0.1)]),
      );

      const embedder = new OpenaiEmbedder({
        apiKey: "sk-test-key",
        model: "text-embedding-ada-002",
      });
      await embedder.embed(["hello"]);

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.dimensions).toBeUndefined();
    });

    it("embed() uses custom baseUrl", async () => {
      fetchSpy.mockResolvedValueOnce(
        openaiResponse([new Array(DB_EMBEDDING_DIMENSIONS).fill(0.1)]),
      );

      const embedder = new OpenaiEmbedder({
        apiKey: "sk-test-key",
        model: "text-embedding-3-small",
        baseUrl: "https://my-proxy.example.com/v1/",
      });
      await embedder.embed(["hello"]);

      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toBe("https://my-proxy.example.com/v1/embeddings");
    });

    it("embed() sorts response by index to guarantee order", async () => {
      // Return items in reversed index order
      const response = new Response(
        JSON.stringify({
          data: [
            {
              embedding: new Array(DB_EMBEDDING_DIMENSIONS).fill(0.2),
              index: 1,
              object: "embedding",
            },
            {
              embedding: new Array(DB_EMBEDDING_DIMENSIONS).fill(0.1),
              index: 0,
              object: "embedding",
            },
          ],
          model: "text-embedding-3-small",
          object: "list",
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
      fetchSpy.mockResolvedValueOnce(response);

      const embedder = new OpenaiEmbedder({
        apiKey: "sk-test-key",
        model: "text-embedding-3-small",
      });
      const results = await embedder.embed(["first", "second"]);

      // index=0 should come first (filled with 0.1), index=1 second (filled with 0.2)
      expect(results[0]![0]).toBe(0.1);
      expect(results[1]![0]).toBe(0.2);
    });

    it("embed() throws on empty input array", async () => {
      const embedder = new OpenaiEmbedder({
        apiKey: "sk-test-key",
        model: "text-embedding-3-small",
      });
      await expect(embedder.embed([])).rejects.toThrow("embed() requires at least one text");
    });

    it("embed() throws on HTTP error", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }),
      );

      const embedder = new OpenaiEmbedder({
        apiKey: "bad-key",
        model: "text-embedding-3-small",
      });
      await expect(embedder.embed(["hello"])).rejects.toThrow("OpenAI embed failed (401)");
    });

    it("init() succeeds when probe returns vectors matching DB_EMBEDDING_DIMENSIONS", async () => {
      fetchSpy.mockResolvedValueOnce(
        openaiResponse([new Array(DB_EMBEDDING_DIMENSIONS).fill(0.1)]),
      );

      const embedder = new OpenaiEmbedder({
        apiKey: "sk-test-key",
        model: "text-embedding-3-small",
        dimensions: 768,
      });
      await expect(embedder.init()).resolves.toBeUndefined();
      expect(embedder.initError).toBeNull();
    });

    it("init() captures dimension mismatch in initError", async () => {
      const wrongDimension = 1536;
      fetchSpy.mockResolvedValueOnce(openaiResponse([new Array(wrongDimension).fill(0.1)]));

      const embedder = new OpenaiEmbedder({
        apiKey: "sk-test-key",
        model: "text-embedding-3-small",
      });
      await embedder.init();
      expect(embedder.initError).toContain(
        `Embedding dimension mismatch: model "text-embedding-3-small" produces ${wrongDimension}-d vectors`,
      );
      expect(embedder.initError).toContain("EMBEDDING_DIMENSIONS");
    });

    it("init() captures fetch errors when API is unreachable", async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));

      const embedder = new OpenaiEmbedder({
        apiKey: "sk-test-key",
        model: "text-embedding-3-small",
      });
      await embedder.init();
      expect(embedder.initError).toBe("fetch failed");
    });

    it("init() captures HTTP errors (e.g. 401 unauthorized)", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }),
      );

      const embedder = new OpenaiEmbedder({
        apiKey: "bad-key",
        model: "text-embedding-3-small",
      });
      await embedder.init();
      expect(embedder.initError).toContain("OpenAI embed failed (401)");
    });

    it("init() clears initError on successful retry after previous failure", async () => {
      // First call: unreachable
      fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
      const embedder = new OpenaiEmbedder({
        apiKey: "sk-test-key",
        model: "text-embedding-3-small",
      });
      await embedder.init();
      expect(embedder.initError).toBe("fetch failed");

      // Second call: success
      fetchSpy.mockResolvedValueOnce(
        openaiResponse([new Array(DB_EMBEDDING_DIMENSIONS).fill(0.1)]),
      );
      await embedder.init();
      expect(embedder.initError).toBeNull();
    });
  });

  describe("createEmbedder factory", () => {
    it("returns OllamaEmbedder for provider=ollama", () => {
      const embedder = createEmbedder({
        provider: "ollama",
        url: "http://localhost:11434",
        model: "nomic-embed-text",
      });
      expect(embedder).toBeInstanceOf(OllamaEmbedder);
    });

    it("returns OpenaiEmbedder for provider=openai", () => {
      const embedder = createEmbedder({
        provider: "openai",
        apiKey: "sk-test-key",
        model: "text-embedding-3-small",
      });
      expect(embedder).toBeInstanceOf(OpenaiEmbedder);
    });
  });
});
