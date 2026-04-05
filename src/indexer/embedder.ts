/**
 * Embedder interface + implementations (Mock, Ollama).
 *
 * Each provider accepts string arrays and returns number[][] embeddings.
 * Batching logic splits large inputs into configurable batch sizes and
 * reassembles results in order.
 *
 * At startup the {@link Embedder.init} hook probes the model to
 * detect its native embedding dimension and validates it against the DB
 * schema's fixed column width ({@link DB_EMBEDDING_DIMENSIONS}).
 */
import { type EmbeddingProvider } from "../core/types.js";
import { estimateTokens } from "./chunker.js";

// ── Interface ──

export interface Embedder {
  /** Embed an array of texts, returning one vector per text. */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Startup hook — probes the model (e.g. embed a single token) and
   * verifies that the returned vector dimension matches the DB schema.
   * Called once from {@link bootstrap} before any real work begins.
   */
  init(): Promise<void>;
}

/**
 * Embedding dimension expected by the DB schema (`chunks.embedding`).
 *
 * Changing this requires a Drizzle migration — the pgvector column is
 * defined as `vector("embedding", { dimensions: 768 })` in schema.ts.
 */
export const DB_EMBEDDING_DIMENSIONS = 768;

// ── Ollama Provider ──

export interface OllamaEmbedderOptions {
  /** Ollama API URL. */
  url: string;
  /** Model name. */
  model: string;
}

interface OllamaEmbedResponse {
  embeddings: number[][];
}

export class OllamaEmbedder implements Embedder {
  private readonly url: string;
  private readonly model: string;

  constructor(options: OllamaEmbedderOptions) {
    this.url = options.url;
    this.model = options.model;
  }

  /**
   * Probe the model by embedding a single token, then verify that the
   * returned vector width matches {@link DB_EMBEDDING_DIMENSIONS}.
   *
   * Throws immediately if Ollama is unreachable or the model produces
   * a different dimension — no point starting the worker/web server
   * with an incompatible model.
   */
  async init(): Promise<void> {
    const probe = await this.embed(["dim"]);
    const detected = probe[0]!.length;

    if (detected !== DB_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimension mismatch: model "${this.model}" produces ${detected}-d vectors, ` +
          `but the DB schema expects ${DB_EMBEDDING_DIMENSIONS}. ` +
          `Either switch to a ${DB_EMBEDDING_DIMENSIONS}-d model or run a migration.`,
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) throw new Error("embed() requires at least one text");

    const response = await fetch(`${this.url}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        truncate: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama embed failed (${response.status}): ${body} : [${texts.join(", ")}]`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    return data.embeddings;
  }
}

// ── Batching utility ──

/**
 * Maximum tokens allowed per embedding input.
 *
 * nomic-embed-text has a hard architecture limit of 2048 tokens
 * (the `num_ctx: 8192` in Ollama's model params does NOT override this
 * for embedding models). We use a small safety margin.
 */
export const MAX_EMBED_TOKENS = 1900;

/**
 * Truncate a text to fit within the embedding model's token budget.
 *
 * Uses the same density-aware {@link estimateTokens} heuristic as the
 * chunker so SVG paths, numeric arrays, and other dense content is
 * handled correctly.  Prefers cutting at a newline boundary.
 */
export function truncateForEmbedding(text: string, maxTokens = MAX_EMBED_TOKENS): string {
  if (estimateTokens(text) <= maxTokens) return text;

  // Binary-ish search: shrink by line until we're under budget
  const lines = text.split("\n");
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = lines.slice(0, mid).join("\n");
    if (estimateTokens(candidate) <= maxTokens) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  if (lo > 0) {
    return lines.slice(0, lo).join("\n");
  }

  // Edge case: even the first line is too long — hard-truncate by chars
  // Use a conservative 1.5 chars/token ratio for dense content
  const maxChars = maxTokens * 1.5;
  return text.slice(0, maxChars);
}

/**
 * Embed texts in batches, reassembling results in the original order.
 * Automatically truncates texts that exceed the model's context window.
 *
 * @param embedder - The embedder provider to use
 * @param texts - All texts to embed
 * @param batchSize - Max texts per batch (default: 64)
 * @returns Embeddings in the same order as `texts`
 */
export async function embedInBatches(
  embedder: Embedder,
  texts: string[],
  batchSize = 64,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Truncate any texts exceeding the model's context window
  const safeTexts = texts.map((t) => truncateForEmbedding(t));

  const results: number[][] = [];

  for (let i = 0; i < safeTexts.length; i += batchSize) {
    const batch = safeTexts.slice(i, i + batchSize);
    const embeddings = await embedder.embed(batch);
    results.push(...embeddings);
  }

  return results;
}

// ── Factory ──

export function createEmbedder(
  provider: EmbeddingProvider,
  options: OllamaEmbedderOptions,
): Embedder {
  switch (provider) {
    case "ollama":
      return new OllamaEmbedder(options);
    default:
      throw new Error(`Unknown embedder provider: ${provider}`);
  }
}
