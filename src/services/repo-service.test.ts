/**
 * Unit tests for repo-service searchCode semver resolution.
 *
 * Verifies that searchCode resolves the `ref` parameter through semver
 * before passing it to searchHybrid, so constraints like `"1.0.0"` or
 * `"^1.0.0"` match stored tags like `"v1.0.0"`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

const mockFindByName = vi.fn();
const mockSearchHybrid = vi.fn().mockResolvedValue([]);
const mockResolveRef = vi.fn();

vi.mock("../storage/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/index.js")>();
  return {
    ...actual,
    RepoRepository: vi.fn().mockImplementation(() => ({
      findByName: mockFindByName,
    })),
  };
});

vi.mock("../retrieval/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../retrieval/index.js")>();
  return {
    ...actual,
    searchHybrid: (...args: unknown[]) => mockSearchHybrid(...args),
    resolveRef: (...args: unknown[]) => mockResolveRef(...args),
  };
});

// Import after mocks are set up
import { searchCode } from "./repo-service.js";
import type { Db } from "../storage/index.js";
import type { Embedder } from "../indexer/embedder.js";

// ── Helpers ──

const fakeDb = {} as Db;
const fakeEmbedder = {} as Embedder;

const REPO_ROW = {
  id: 1,
  name: "my-lib",
  remoteUrl: "https://github.com/org/my-lib",
  localPath: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("searchCode semver resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves bare version '1.0.0' to stored 'v1.0.0' tag", async () => {
    mockFindByName.mockResolvedValue(REPO_ROW);
    mockResolveRef.mockResolvedValue({ id: 10, ref: "v1.0.0", commitSha: "abc" });

    await searchCode(fakeDb, fakeEmbedder, {
      query: "some function",
      repo: "my-lib",
      ref: "1.0.0",
    });

    expect(mockResolveRef).toHaveBeenCalledWith(fakeDb, 1, "1.0.0");
    expect(mockSearchHybrid).toHaveBeenCalledWith(
      fakeDb,
      fakeEmbedder,
      expect.objectContaining({ ref: "v1.0.0" }),
    );
  });

  it("resolves caret range '^1.0.0' through semver", async () => {
    mockFindByName.mockResolvedValue(REPO_ROW);
    mockResolveRef.mockResolvedValue({ id: 11, ref: "v1.2.3", commitSha: "def" });

    await searchCode(fakeDb, fakeEmbedder, {
      query: "error handling",
      repo: "my-lib",
      ref: "^1.0.0",
    });

    expect(mockResolveRef).toHaveBeenCalledWith(fakeDb, 1, "^1.0.0");
    expect(mockSearchHybrid).toHaveBeenCalledWith(
      fakeDb,
      fakeEmbedder,
      expect.objectContaining({ ref: "v1.2.3" }),
    );
  });

  it("passes ref through as-is when repo is not provided", async () => {
    await searchCode(fakeDb, fakeEmbedder, {
      query: "something",
      ref: "1.0.0",
    });

    expect(mockFindByName).not.toHaveBeenCalled();
    expect(mockResolveRef).not.toHaveBeenCalled();
    expect(mockSearchHybrid).toHaveBeenCalledWith(
      fakeDb,
      fakeEmbedder,
      expect.objectContaining({ ref: "1.0.0" }),
    );
  });

  it("passes ref through as-is when repo is not found in DB", async () => {
    mockFindByName.mockResolvedValue(undefined);

    await searchCode(fakeDb, fakeEmbedder, {
      query: "something",
      repo: "unknown-repo",
      ref: "1.0.0",
    });

    expect(mockResolveRef).not.toHaveBeenCalled();
    expect(mockSearchHybrid).toHaveBeenCalledWith(
      fakeDb,
      fakeEmbedder,
      expect.objectContaining({ ref: "1.0.0" }),
    );
  });

  it("passes ref through as-is when resolveRef returns null", async () => {
    mockFindByName.mockResolvedValue(REPO_ROW);
    mockResolveRef.mockResolvedValue(null);

    await searchCode(fakeDb, fakeEmbedder, {
      query: "something",
      repo: "my-lib",
      ref: "^9.0.0",
    });

    expect(mockSearchHybrid).toHaveBeenCalledWith(
      fakeDb,
      fakeEmbedder,
      expect.objectContaining({ ref: "^9.0.0" }),
    );
  });

  it("skips resolution when ref is not provided", async () => {
    await searchCode(fakeDb, fakeEmbedder, {
      query: "something",
      repo: "my-lib",
    });

    expect(mockFindByName).not.toHaveBeenCalled();
    expect(mockResolveRef).not.toHaveBeenCalled();
    // ref is absent from the options — searchHybrid gets the original opts unmodified
    const passedOpts = mockSearchHybrid.mock.calls[0]![2] as Record<string, unknown>;
    expect(passedOpts.repo).toBe("my-lib");
    expect(passedOpts).not.toHaveProperty("ref");
  });

  it("preserves other search options (limit, languages) through resolution", async () => {
    mockFindByName.mockResolvedValue(REPO_ROW);
    mockResolveRef.mockResolvedValue({ id: 10, ref: "v1.0.0", commitSha: "abc" });

    await searchCode(fakeDb, fakeEmbedder, {
      query: "parse",
      repo: "my-lib",
      ref: "1.0.0",
      limit: 50,
      languages: ["rust"],
    });

    expect(mockSearchHybrid).toHaveBeenCalledWith(fakeDb, fakeEmbedder, {
      query: "parse",
      repo: "my-lib",
      ref: "v1.0.0",
      limit: 50,
      languages: ["rust"],
    });
  });
});
