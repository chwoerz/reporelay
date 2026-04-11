/**
 * Tests for OllamaEmbedder against a real Ollama instance.
 *
 * Requires: `ollama serve` running locally with `nomic-embed-text` pulled.
 * Run with: pnpm vitest run src/indexer/embedder-ollama.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { OllamaEmbedder, embedInBatches, createEmbedder } from "./embedder.js";

const OLLAMA_URL = "http://localhost:11434";

/**
 * Check if Ollama is reachable before running the suite.
 */
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

describe("OllamaEmbedder (live)", () => {
  let available: boolean;

  beforeAll(async () => {
    available = await isOllamaAvailable();
    if (!available) {
      console.warn("⚠ Ollama not available — skipping live embedding tests");
    }
  });

  it("embeds a single text and returns a vector of correct dimensions", async () => {
    if (!available) return;

    const embedder = new OllamaEmbedder({
      url: OLLAMA_URL,
      model: "nomic-embed-text",
    });

    const results = await embedder.embed(["Hello, world!"]);

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveLength(768);
    // Vector should contain real non-zero values
    expect(results[0]!.some((v) => v !== 0)).toBe(true);
    // Every element should be a finite number
    expect(results[0]!.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("embeds multiple texts in a single call", async () => {
    if (!available) return;

    const embedder = new OllamaEmbedder({
      url: OLLAMA_URL,
      model: "nomic-embed-text",
    });

    const texts = [
      "TypeScript is a typed superset of JavaScript",
      "Python is great for data science",
      "Rust guarantees memory safety without garbage collection",
    ];

    const results = await embedder.embed(texts);

    expect(results).toHaveLength(3);
    results.forEach((vec) => {
      expect(vec).toHaveLength(768);
      expect(vec.some((v) => v !== 0)).toBe(true);
    });
  });

  it("produces more similar embeddings for semantically related texts", async () => {
    if (!available) return;

    const embedder = new OllamaEmbedder({
      url: OLLAMA_URL,
      model: "nomic-embed-text",
    });

    const [vecs] = await Promise.all([
      embedder.embed([
        "function that sorts an array of numbers", // [0] code concept
        "algorithm to order a list of integers", // [1] similar to [0]
        "how to bake a chocolate cake", // [2] unrelated
      ]),
    ]);

    const cosine = (a: number[], b: number[]): number => {
      let dot = 0,
        normA = 0,
        normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
      }
      return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    };

    const simRelated = cosine(vecs[0]!, vecs[1]!);
    const simUnrelated = cosine(vecs[0]!, vecs[2]!);

    console.log(`Similarity (related):   ${simRelated.toFixed(4)}`);
    console.log(`Similarity (unrelated): ${simUnrelated.toFixed(4)}`);

    // Semantically related texts should have higher cosine similarity
    expect(simRelated).toBeGreaterThan(simUnrelated);
    // Related texts should have a reasonable similarity (> 0.5)
    expect(simRelated).toBeGreaterThan(0.5);
  });

  it("embedInBatches produces correct results with small batch size", async () => {
    if (!available) return;

    const embedder = new OllamaEmbedder({
      url: OLLAMA_URL,
      model: "nomic-embed-text",
    });

    const texts = [
      "const x = 42;",
      "def hello(): pass",
      "fn main() {}",
      "public class Foo {}",
      "package main",
    ];

    // Force small batch size to exercise batching logic
    const results = await embedInBatches(embedder, texts, 2);

    expect(results.embeddings).toHaveLength(5);
    expect(results.failures).toHaveLength(0);
    results.embeddings.forEach((vec) => {
      expect(vec).toHaveLength(768);
      expect(vec!.some((v) => v !== 0)).toBe(true);
    });
  });

  it("createEmbedder returns a working OllamaEmbedder", async () => {
    if (!available) return;

    const embedder = createEmbedder({
      provider: "ollama",
      url: OLLAMA_URL,
      model: "nomic-embed-text",
    });

    expect(embedder).toBeInstanceOf(OllamaEmbedder);

    const results = await embedder.embed(["test via factory"]);
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveLength(768);
    expect(results[0]!.some((v) => v !== 0)).toBe(true);
  });

  it("throws on empty input", async () => {
    if (!available) return;

    const embedder = new OllamaEmbedder({ url: OLLAMA_URL, model: "nomic-embed-text" });
    await expect(embedder.embed([])).rejects.toThrow("embed() requires at least one text");
  });

  it("throws on invalid URL", async () => {
    const embedder = new OllamaEmbedder({
      url: "http://localhost:99999",
      model: "nomic-embed-text",
    });

    await expect(embedder.embed(["hello"])).rejects.toThrow();
  });

  it("embeds real code snippets and produces distinct vectors", async () => {
    if (!available) return;

    const embedder = new OllamaEmbedder({
      url: OLLAMA_URL,
      model: "nomic-embed-text",
    });

    const codeSnippets = [
      // TypeScript function
      `export function parseConfig(raw: string): Config {
  const parsed = JSON.parse(raw);
  return configSchema.parse(parsed);
}`,
      // Python class
      `class DatabaseConnection:
    def __init__(self, url: str):
        self.url = url
        self.pool = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(self.url)`,
      // Go struct
      `type Server struct {
    addr   string
    router *mux.Router
    db     *sql.DB
}

func NewServer(addr string) *Server {
    return &Server{addr: addr}
}`,
    ];

    const results = await embedder.embed(codeSnippets);

    expect(results).toHaveLength(3);
    results.forEach((vec, i) => {
      expect(vec).toHaveLength(768);
      // Each embedding should be unique (not identical)
      if (i > 0) {
        const prev = results[i - 1]!;
        const same = vec.every((v, j) => v === prev[j]);
        expect(same).toBe(false);
      }
    });
  });

  it("init() succeeds when model dimensions match DB schema", async () => {
    if (!available) return;

    const embedder = new OllamaEmbedder({
      url: OLLAMA_URL,
      model: "nomic-embed-text",
    });

    // Should complete without throwing — nomic-embed-text produces 768-d vectors
    await expect(embedder.init()).resolves.toBeUndefined();
  });
});
