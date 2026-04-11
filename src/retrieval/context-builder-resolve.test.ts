/**
 * Unit tests for context-builder semver resolution in gatherBySearch.
 *
 * Verifies that buildContextPack resolves the `ref` parameter through
 * semver before passing it to searchHybrid, so constraints like
 * `"1.0.0"` or `"^1.0.0"` match stored tags like `"v1.0.0"`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SearchResult } from "../core/types.js";


const mockSearchHybrid = vi.fn();
const mockResolveRef = vi.fn();

vi.mock("./hybrid-search.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hybrid-search.js")>();
  return {
    ...actual,
    searchHybrid: (...args: unknown[]) => mockSearchHybrid(...args),
  };
});

vi.mock("./semver-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./semver-resolver.js")>();
  return {
    ...actual,
    resolveRef: (...args: unknown[]) => mockResolveRef(...args),
  };
});

// Import after mocks
import { buildContextPack } from "./context-builder.js";
import type { Db } from "../storage/index.js";
import type { Embedder } from "../indexer/embedder.js";


const fakeDb = {} as Db;
const fakeEmbedder = {} as Embedder;

function fakeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    filePath: "src/lib.rs",
    repo: "my-crate",
    ref: "v1.0.0",
    content: "fn main() {}",
    startLine: 1,
    endLine: 1,
    score: 0.9,
    ...overrides,
  };
}

describe("context-builder semver resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchHybrid.mockResolvedValue([]);
  });

  it("resolves ref through semver for explain strategy", async () => {
    mockResolveRef.mockResolvedValue({ id: 10, ref: "v1.0.0", commitSha: "abc" });
    mockSearchHybrid.mockResolvedValue([fakeSearchResult()]);

    await buildContextPack(fakeDb, fakeEmbedder, {
      repo: "my-crate",
      repoId: 1,
      strategy: "explain",
      ref: "1.0.0",
    });

    expect(mockResolveRef).toHaveBeenCalledWith(fakeDb, 1, "1.0.0");
    expect(mockSearchHybrid).toHaveBeenCalledWith(
      fakeDb,
      fakeEmbedder,
      expect.objectContaining({ ref: "v1.0.0" }),
    );
  });

  it("resolves caret range for implement strategy", async () => {
    mockResolveRef.mockResolvedValue({ id: 11, ref: "v1.2.3", commitSha: "def" });

    await buildContextPack(fakeDb, fakeEmbedder, {
      repo: "my-crate",
      repoId: 1,
      strategy: "implement",
      ref: "^1.0.0",
    });

    expect(mockResolveRef).toHaveBeenCalledWith(fakeDb, 1, "^1.0.0");
    expect(mockSearchHybrid).toHaveBeenCalledWith(
      fakeDb,
      fakeEmbedder,
      expect.objectContaining({ ref: "v1.2.3" }),
    );
  });

  it("passes ref through as-is when resolveRef returns null", async () => {
    mockResolveRef.mockResolvedValue(null);

    await buildContextPack(fakeDb, fakeEmbedder, {
      repo: "my-crate",
      repoId: 1,
      strategy: "debug",
      ref: "^9.0.0",
    });

    expect(mockSearchHybrid).toHaveBeenCalledWith(
      fakeDb,
      fakeEmbedder,
      expect.objectContaining({ ref: "^9.0.0" }),
    );
  });

  it("skips resolution when ref is not provided", async () => {
    await buildContextPack(fakeDb, fakeEmbedder, {
      repo: "my-crate",
      repoId: 1,
      strategy: "explain",
    });

    expect(mockResolveRef).not.toHaveBeenCalled();
    expect(mockSearchHybrid).toHaveBeenCalledWith(
      fakeDb,
      fakeEmbedder,
      expect.objectContaining({ ref: undefined }),
    );
  });
});
