import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSemver, handleIndexJob, type WorkerDeps } from "./handler.js";
import { cleanupStaleWorktrees } from "./index.js";
import { PipelineCancelledError } from "../indexer/pipeline.js";
import type { IndexJob } from "../core/types.js";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";

// ── Mocks for handleIndexJob ──

const mockUpdateProgress = vi.fn().mockResolvedValue(undefined);
const mockFindByName = vi.fn();
const mockFindByRepoAndRef = vi.fn();
const mockInsertOne = vi.fn().mockResolvedValue({ id: 42 });
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);

vi.mock("../storage/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/index.js")>();
  return {
    ...actual,
    RepoRepository: vi.fn().mockImplementation(() => ({
      findByName: mockFindByName,
    })),
    RepoRefRepository: vi.fn().mockImplementation(() => ({
      findByRepoAndRef: mockFindByRepoAndRef,
      insertOne: mockInsertOne,
      updateWhere: mockUpdateWhere,
      updateProgress: mockUpdateProgress,
    })),
  };
});

vi.mock("../git/git-sync.js", () => ({
  syncMirror: vi.fn().mockResolvedValue("/tmp/mirror"),
  resolveCommitSha: vi.fn().mockResolvedValue("abc123"),
  checkoutWorktree: vi.fn().mockResolvedValue("/tmp/worktree"),
  cleanupWorktree: vi.fn().mockResolvedValue(undefined),
  listFiles: vi.fn().mockResolvedValue([]),
}));

const mockRunPipeline = vi.fn().mockResolvedValue(undefined);

vi.mock("../indexer/pipeline.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../indexer/pipeline.js")>();
  return {
    ...actual,
    runPipeline: (...args: unknown[]) => mockRunPipeline(...args),
  };
});

const silentLogger = pino({ level: "silent" });

describe("parseSemver", () => {
  it("extracts clean semver from v-prefixed tag", () => {
    expect(parseSemver("v1.2.3")).toBe("1.2.3");
  });

  it("extracts clean semver from plain tag", () => {
    expect(parseSemver("1.0.0")).toBe("1.0.0");
  });

  it("handles prerelease tags", () => {
    expect(parseSemver("v2.0.0-beta.1")).toBe("2.0.0-beta.1");
  });

  it("returns undefined for branch names", () => {
    expect(parseSemver("main")).toBeUndefined();
  });

  it("returns undefined for non-semver strings", () => {
    expect(parseSemver("release/2025-03")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseSemver("")).toBeUndefined();
  });
});

describe("cleanupStaleWorktrees", () => {
  it("removes directories matching wt-* pattern", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reporelay-wt-test-"));
    await mkdir(join(dir, "wt-abc123"), { recursive: true });
    await mkdir(join(dir, "wt-def456"), { recursive: true });
    await writeFile(join(dir, "wt-abc123", "file.txt"), "data");

    await cleanupStaleWorktrees(dir, silentLogger);

    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it("leaves non-worktree entries untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reporelay-wt-test-"));
    await mkdir(join(dir, "wt-stale"), { recursive: true });
    await mkdir(join(dir, "other-dir"), { recursive: true });

    await cleanupStaleWorktrees(dir, silentLogger);

    const remaining = await readdir(dir);
    expect(remaining).toEqual(["other-dir"]);
  });

  it("does nothing when directory is empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reporelay-wt-test-"));

    await cleanupStaleWorktrees(dir, silentLogger);

    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(0);
  });

  it("does not throw when directory does not exist", async () => {
    await expect(
      cleanupStaleWorktrees("/tmp/reporelay-nonexistent-dir-xyz", silentLogger),
    ).resolves.not.toThrow();
  });
});

// ── handleIndexJob ──

describe("handleIndexJob", () => {
  const job: IndexJob = { repo: "test-repo", ref: "main" };
  const fakeDeps: WorkerDeps = {
    db: {} as WorkerDeps["db"],
    embedder: { embed: vi.fn() } as unknown as WorkerDeps["embedder"],
    config: {
      GIT_MIRRORS_DIR: "/tmp/mirrors",
      GIT_WORKTREES_DIR: "/tmp/worktrees",
      EMBEDDING_BATCH_SIZE: 50,
    } as unknown as WorkerDeps["config"],
    logger: silentLogger,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks: repo found, ref exists in "queued" state
    mockFindByName.mockResolvedValue({
      id: 1,
      name: "test-repo",
      localPath: "/tmp/repo",
      remoteUrl: null,
      globPatterns: [],
    });
    mockFindByRepoAndRef.mockResolvedValue({
      id: 42,
      ref: "main",
      stage: "queued",
      commitSha: "old-sha",
    });
  });

  it("does not mark stage as error when PipelineCancelledError is thrown", async () => {
    mockRunPipeline.mockRejectedValueOnce(new PipelineCancelledError(42));

    await handleIndexJob(job, fakeDeps);

    // updateProgress is called for checkout/diff/processing stages, but never with "error"
    const errorCalls = mockUpdateProgress.mock.calls.filter(
      (args: unknown[]) => (args[1] as { stage?: string }).stage === "error",
    );
    expect(errorCalls).toHaveLength(0);
  });

  it("marks stage as error when a regular error is thrown", async () => {
    mockRunPipeline.mockRejectedValueOnce(new Error("embedding service unavailable"));

    await handleIndexJob(job, fakeDeps);

    const errorCalls = mockUpdateProgress.mock.calls.filter(
      (args: unknown[]) => (args[1] as { stage?: string }).stage === "error",
    );
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0]![1]).toMatchObject({
      stage: "error",
      indexingError: "embedding service unavailable",
    });
  });

  it("does not throw on PipelineCancelledError (handler swallows it)", async () => {
    mockRunPipeline.mockRejectedValueOnce(new PipelineCancelledError(42));

    await expect(handleIndexJob(job, fakeDeps)).resolves.not.toThrow();
  });

  it("skips processing when repo is not found", async () => {
    mockFindByName.mockResolvedValue(null);

    await handleIndexJob(job, fakeDeps);

    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("transitions to syncing with descriptive message before mirror clone", async () => {
    await handleIndexJob(job, fakeDeps);

    // The very first updateProgress call should be the syncing transition
    // that happens before syncMirror is invoked.
    expect(mockUpdateProgress).toHaveBeenCalled();
    const firstCall = mockUpdateProgress.mock.calls[0]!;
    expect(firstCall[1]).toMatchObject({
      stage: "syncing",
      stageMessage: expect.stringContaining("Cloning/fetching mirror"),
    });
  });
});
