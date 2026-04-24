/** Zero-vector mock Embedder for tests — no external dependencies. */
import { vi } from "vitest";
import type { Embedder } from "../../src/indexer/embedder.js";
import { DB_EMBEDDING_DIMENSIONS, MAX_EMBED_TOKENS } from "../../src/indexer/embedder.js";

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
