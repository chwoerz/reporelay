/**
 * Shared mock embedder factory for tests.
 *
 * Returns a proper Vitest mock object that satisfies the `Embedder` interface
 * with zero-vector responses — no external dependencies required.
 */
import { vi } from "vitest";
import type { Embedder } from "../../src/indexer/embedder.js";
import { DB_EMBEDDING_DIMENSIONS, MAX_EMBED_TOKENS } from "../../src/indexer/embedder.js";

/** Create a mock `Embedder` with `vi.fn()` spies on both methods. */
export function createMockEmbedder(): Embedder {
  return {
    embed: vi.fn(async (texts: string[]) => {
      if (texts.length === 0) throw new Error("embed() requires at least one text");
      return texts.map(() => new Array(DB_EMBEDDING_DIMENSIONS).fill(0));
    }),
    init: vi.fn(async () => {}),
    initError: null,
    maxInputTokens: MAX_EMBED_TOKENS,
  };
}
