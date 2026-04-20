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
 *
 * **Safety-net guarantee:** {@link embedInBatches} never throws.
 * Texts that fail to embed produce a `null` entry with an
 * accompanying {@link EmbeddingFailure} so callers can persist the error.
 */
import { estimateTokens } from "./chunker.js";

export interface Embedder {
  /** Embed an array of texts, returning one vector per text. */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Startup hook — probes the model (e.g. embed a single token) and
   * verifies that the returned vector dimension matches the DB schema.
   * Called once from {@link bootstrap} before any real work begins.
   */
  init(): Promise<void>;

  /**
   * Non-null when the last {@link init} call failed.
   * Consumers (health endpoint, UI) can inspect this to surface the
   * error without crashing the server.
   */
  initError: string | null;
}

/**
 * Embedding dimension expected by the DB schema (`chunks.embedding`).
 *
 * Changing this requires a Drizzle migration — the pgvector column is
 * defined as `vector("embedding", { dimensions: 768 })` in schema.ts.
 */
export const DB_EMBEDDING_DIMENSIONS = 768;

/**
 * Records a single chunk that could not be embedded.
 * Stored alongside the `null` embedding so callers can persist the error
 * (e.g. in the `chunks.embedding_error` column).
 */
export interface EmbeddingFailure {
  /** Index in the original `texts` array passed to {@link embedInBatches}. */
  index: number;
  /** Human-readable error description. */
  error: string;
}

/**
 * Result of a batch embedding run.
 * `embeddings[i]` is `null` when the text at index `i` could not be
 * embedded — the matching entry in `failures` explains why.
 */
export interface EmbedBatchResult {
  embeddings: (number[] | null)[];
  failures: EmbeddingFailure[];
}

export interface OllamaEmbedderOptions {
  /** Ollama API URL. */
  url: string;
  /** Model name. */
  model: string;
}

interface OllamaEmbedResponse {
  embeddings: number[][];
}

/**
 * Shared init implementation: probe the model with a single token and
 * verify the returned vector width matches {@link DB_EMBEDDING_DIMENSIONS}.
 * Captures the error string or `null` if everything is fine.
 */
async function probeEmbedderDimension(
  embedder: Pick<Embedder, "embed">,
  model: string,
  fixHint: string,
): Promise<string | null> {
  try {
    const probe = await embedder.embed(["dim"]);
    const detected = probe[0]!.length;
    if (detected !== DB_EMBEDDING_DIMENSIONS) {
      return (
        `Embedding dimension mismatch: model "${model}" produces ${detected}-d vectors, ` +
        `but the DB schema expects ${DB_EMBEDDING_DIMENSIONS}. ` +
        `Either switch to a ${DB_EMBEDDING_DIMENSIONS}-d model${fixHint}, or run a migration.`
      );
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export class OllamaEmbedder implements Embedder {
  private readonly url: string;
  private readonly model: string;
  initError: string | null = null;

  constructor(options: OllamaEmbedderOptions) {
    this.url = options.url;
    this.model = options.model;
  }

  async init(): Promise<void> {
    this.initError = await probeEmbedderDimension(this, this.model, "");
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
      throw new Error(
        `Ollama embed failed (${response.status}): ${body} text: ${texts.join(", ")}`,
      );
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    return data.embeddings;
  }
}

export interface OpenaiEmbedderOptions {
  /** API key for the OpenAI-compatible provider. */
  apiKey: string;
  /** Model name (e.g. "text-embedding-3-small"). */
  model: string;
  /** Base URL — defaults to {@link OPENAI_DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /**
   * Number of dimensions to request from the API.
   * Only supported by text-embedding-3 and later models.
   * Omitted from the request when undefined (uses the model's default).
   */
  dimensions?: number;
}

interface OpenaiEmbedResponseItem {
  embedding: number[];
  index: number;
  object: string;
}

interface OpenaiEmbedResponse {
  data: OpenaiEmbedResponseItem[];
  model: string;
  object: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * Embedder for OpenAI-compatible embedding APIs.
 *
 * Works with any provider that implements the POST /embeddings endpoint
 * using the OpenAI request/response format (OpenAI, Azure OpenAI,
 * Together AI, Mistral, etc.).
 */
export class OpenaiEmbedder implements Embedder {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly dimensions: number | undefined;
  initError: string | null = null;

  constructor(options: OpenaiEmbedderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.dimensions = options.dimensions;
  }

  async init(): Promise<void> {
    this.initError = await probeEmbedderDimension(
      this,
      this.model,
      `, set EMBEDDING_DIMENSIONS=${DB_EMBEDDING_DIMENSIONS}`,
    );
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) throw new Error("embed() requires at least one text");

    const body: Record<string, unknown> = {
      model: this.model,
      input: texts,
      encoding_format: "float",
    };
    if (this.dimensions !== undefined) {
      body.dimensions = this.dimensions;
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI embed failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as OpenaiEmbedResponse;

    // Sort by index to guarantee order matches the input array
    return data.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}

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
 * **Safety-net guarantee:** this function **never throws**. Texts that
 * cannot be embedded are recorded in the returned
 * {@link EmbedBatchResult.failures} array with a `null` embedding,
 * so callers can persist the error (e.g. in the DB).
 *
 * **Resilience strategy:**
 * 1. Truncate all texts to the model's token budget.
 * 2. Try the full batch — fastest path for well-sized texts.
 * 3. If the batch fails, fall back to embedding each text individually.
 * 4. If a single text still fails, record it as a failure with a `null`
 *    embedding and continue with the remaining texts.
 *
 * @param embedder - The embedder provider to use
 * @param texts - All texts to embed
 * @param batchSize - Max texts per batch (default: 64)
 * @param concurrency - Max in-flight batches. Default 1 (sequential). Raise to
 *   dispatch multiple batches in parallel — bounded by the provider's parallel
 *   slot count (e.g. Ollama's OLLAMA_NUM_PARALLEL, default 4).
 * @param onWaveDone - Optional hook fired after each parallel wave completes.
 *   Receives `(completed, total)`. The promise is awaited before the next
 *   wave starts, so callers can use it for cancellation checks and progress.
 * @returns {@link EmbedBatchResult} — embeddings (or null) + failures
 */
export async function embedInBatches(
  embedder: Embedder,
  texts: string[],
  batchSize = 64,
  concurrency = 1,
  onWaveDone?: (completed: number, total: number) => Promise<void> | void,
): Promise<EmbedBatchResult> {
  if (texts.length === 0) return { embeddings: [], failures: [] };

  // Truncate any texts exceeding the model's context window
  const safeTexts = texts.map((t) => truncateForEmbedding(t));

  // Pre-allocate so parallel batches can write at their correct offsets
  // without having to coordinate on array order.
  const embeddings: (number[] | null)[] = new Array(safeTexts.length).fill(null);
  const failures: EmbeddingFailure[] = [];

  const runBatch = async (start: number): Promise<void> => {
    const batch = safeTexts.slice(start, start + batchSize);
    try {
      const batchEmbeddings = await embedder.embed(batch);
      for (let k = 0; k < batchEmbeddings.length; k++) {
        embeddings[start + k] = batchEmbeddings[k]!;
      }
    } catch {
      // Batch failed — fall back to embedding each text individually in parallel.
      const settled = await Promise.allSettled(batch.map((text) => embedder.embed([text])));
      for (const [j, result] of settled.entries()) {
        if (result.status === "fulfilled") {
          embeddings[start + j] = result.value[0]!;
        } else {
          const msg =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          embeddings[start + j] = null;
          failures.push({ index: start + j, error: msg });
        }
      }
    }
  };

  // Collect batch start offsets, then dispatch in waves of `concurrency`.
  const starts: number[] = [];
  for (let i = 0; i < safeTexts.length; i += batchSize) starts.push(i);
  for (let w = 0; w < starts.length; w += concurrency) {
    const wave = starts.slice(w, w + concurrency);
    await Promise.all(wave.map(runBatch));
    if (onWaveDone) {
      const completed = Math.min((w + wave.length) * batchSize, safeTexts.length);
      await onWaveDone(completed, safeTexts.length);
    }
  }

  return { embeddings, failures };
}

/** Discriminated union of options for all supported embedding providers. */
export type EmbedderOptions =
  | ({ provider: "ollama" } & OllamaEmbedderOptions)
  | ({ provider: "openai" } & OpenaiEmbedderOptions);

export function createEmbedder(options: EmbedderOptions): Embedder {
  if (options.provider === "openai") {
    return new OpenaiEmbedder(options);
  }
  return new OllamaEmbedder(options);
}
