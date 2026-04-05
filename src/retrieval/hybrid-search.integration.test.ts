import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, stopPostgres } from "../../test/setup/postgres.js";
import { addCommitToTestRepo, createTestRepo, type TestRepo } from "../../test/setup/test-repo.js";
import { allLanguageFiles, TYPESCRIPT_SAMPLE } from "../../test/fixtures/samples.js";
import { runMigrations } from "../storage/index.js";
import { createDb, type Db } from "../storage/index.js";
import { RepoRepository } from "../storage/index.js";
import { RepoRefRepository } from "../storage/index.js";
import type { Embedder } from "../indexer/embedder.js";
import { createMockEmbedder } from "../../test/setup/mock-embedder.js";
import { runPipeline } from "../indexer/pipeline.js";
import { listFiles } from "../git/git-sync.js";
import { searchHybrid } from "./hybrid-search.js";
import { resolveSemver } from "./semver-resolver.js";
import { simpleGit } from "simple-git";

describe("Hybrid Search (integration)", () => {
  let repo: TestRepo;
  let db: Db;
  let embedder: Embedder;
  let repoRow: { id: number };
  let refRow: { id: number };
  let refRow2: { id: number };
  let commitSha: string;
  let commitSha2: string;

  beforeAll(async () => {
    const { sql } = await startPostgres();
    await runMigrations(sql);
    db = createDb(sql);
    embedder = createMockEmbedder();

    // Create a test git repo
    repo = await createTestRepo(allLanguageFiles());
    const git = simpleGit(repo.path);
    commitSha = (await git.revparse(["HEAD"])).trim();

    // Create repo + ref v1.0.0 in DB
    const repoRepo = new RepoRepository(db);
    repoRow = await repoRepo.insertOne({
      name: "test-repo",
      localPath: repo.path,
      defaultBranch: "main",
    });

    const refRepo = new RepoRefRepository(db);
    refRow = await refRepo.insertOne({
      repoId: repoRow.id,
      ref: "v1.0.0",
      commitSha,
      stage: "indexing",
    });

    // Index v1.0.0
    const files = await listFiles(repo.path, commitSha, []);
    await runPipeline({ db, embedder }, { worktreePath: repo.path, repoRefId: refRow.id, files });

    // Add a second commit with changes and index as v2.0.0
    commitSha2 = await addCommitToTestRepo(
      repo.path,
      {
        "src/service.ts": TYPESCRIPT_SAMPLE + "\n// v2 update\n",
        "src/calculator.py": null, // delete
        "src/new-file.ts": 'export const NEW = "new";\n',
      },
      "v2 update",
    );

    refRow2 = await refRepo.insertOne({
      repoId: repoRow.id,
      ref: "v2.0.0",
      commitSha: commitSha2,
      stage: "indexing",
    });

    const files2 = await listFiles(repo.path, commitSha2, []);
    await runPipeline(
      { db, embedder },
      {
        worktreePath: repo.path,
        repoRefId: refRow2.id,
        files: files2,
      },
    );
  }, 120_000);

  afterAll(async () => {
    await repo?.cleanup();
    await stopPostgres();
  });

  it("returns results combining FTS and vector scores", async () => {
    const results = await searchHybrid(db, embedder, {
      query: "service",
      repo: "test-repo",
      ref: "v1.0.0",
    });
    expect(results.length).toBeGreaterThan(0);
    // FTS contributes positive scores; vector is 0 with mock embeddings
    const hasPositiveScore = results.some((r) => r.score > 0);
    expect(hasPositiveScore).toBe(true);
  });

  it("FTS-only fallback works when embeddings are mock/zero vectors", async () => {
    // Mock embeddings are all zeros, so vector scores will be ~0.
    // FTS should still return results.
    const results = await searchHybrid(db, embedder, {
      query: "EventEmitter",
      repo: "test-repo",
      ref: "v1.0.0",
    });
    expect(results.length).toBeGreaterThan(0);
  });

  it("filters by repo name", async () => {
    const results = await searchHybrid(db, embedder, {
      query: "service",
      repo: "nonexistent-repo",
    });
    expect(results).toHaveLength(0);
  });

  it("filters by ref (branch or tag)", async () => {
    const results = await searchHybrid(db, embedder, {
      query: "service",
      repo: "test-repo",
      ref: "v1.0.0",
    });
    results.forEach((r) => expect(r.ref).toBe("v1.0.0"));
  });

  it("resolves semver constraint to best matching indexed tag", () => {
    const tags = ["v1.0.0", "v2.0.0"];
    expect(resolveSemver("^1.0.0", tags)).toBe("v1.0.0");
    expect(resolveSemver("^2.0.0", tags)).toBe("v2.0.0");
    expect(resolveSemver(">=1.0.0", tags)).toBe("v2.0.0");
  });

  it("limits results to requested count", async () => {
    const results = await searchHybrid(db, embedder, {
      query: "function",
      repo: "test-repo",
      ref: "v1.0.0",
      limit: 2,
    });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("deduplicates overlapping chunks from the same file", async () => {
    const results = await searchHybrid(db, embedder, {
      query: "service config",
      repo: "test-repo",
      ref: "v1.0.0",
    });
    // No two results should overlap in the same file
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const a = results[i]!;
        const b = results[j]!;
        if (a.filePath === b.filePath && a.ref === b.ref) {
          const overlaps = a.startLine <= b.endLine && a.endLine >= b.startLine;
          expect(overlaps).toBe(false);
        }
      }
    }
  });

  it("returns file path, line range, content, and score per result", async () => {
    const results = await searchHybrid(db, embedder, {
      query: "service",
      repo: "test-repo",
      ref: "v1.0.0",
    });
    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => {
      expect(r.filePath).toBeTruthy();
      expect(r.startLine).toBeGreaterThanOrEqual(1);
      expect(r.endLine).toBeGreaterThanOrEqual(r.startLine);
      expect(r.content).toBeTruthy();
      expect(typeof r.score).toBe("number");
      expect(r.repo).toBe("test-repo");
      expect(r.ref).toBe("v1.0.0");
    });
  });
});
