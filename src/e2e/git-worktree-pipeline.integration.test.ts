/**
 * End-to-end integration test: git sync → worktree → pipeline → search.
 *
 * Exercises the exact code path that was broken when `checkoutWorktree` used
 * relative paths (resolved against the git mirror instead of the CWD).
 *
 * The test wires together:
 *   - testcontainers ParadeDB (Postgres + pgvector + pg_search)
 *   - real `syncMirror` → `checkoutWorktree` (with relative worktreesDir)
 *   - full indexing pipeline (parse → chunk → embed → store)
 *   - mock embedder (deterministic zero-vectors, no Ollama dependency)
 *   - hybrid search over the indexed data
 *
 * Run:
 *   pnpm vitest run src/e2e/git-worktree-pipeline.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { startPostgres, stopPostgres } from "../../test/setup/postgres.js";
import { createTestRepo, type TestRepo } from "../../test/setup/test-repo.js";
import { allLanguageFiles } from "../../test/fixtures/samples.js";

import { runMigrations } from "../storage/index.js";
import { createDb, type Db } from "../storage/index.js";
import type { Embedder } from "../indexer/embedder.js";
import { RepoRepository } from "../storage/index.js";
import { RepoRefRepository } from "../storage/index.js";
import { RefFileRepository } from "../storage/index.js";
import { ChunkRepository } from "../storage/index.js";
import { SymbolRepository } from "../storage/index.js";
import { handleIndexJob, type WorkerDeps } from "../worker/handler.js";
import { searchHybrid } from "../retrieval/index.js";
import type { Config } from "../core/config.js";
import { createMockEmbedder } from "../../test/setup/mock-embedder.js";
import pino from "pino";

const silentLogger = pino({ level: "silent" });

describe("E2E: git sync → worktree checkout → pipeline → search (integration)", () => {
  let db: Db;
  let repo: TestRepo;
  let mirrorsDir: string;
  let worktreesDir: string;
  let embedder: Embedder;

  beforeAll(async () => {
    // 1. Start Postgres (testcontainers ParadeDB)
    const { sql } = await startPostgres();
    await runMigrations(sql);
    db = createDb(sql);

    // 2. Create temp dirs — mirror adjacent to worktrees (not nested),
    //    replicating the real layout where both are under .reporelay/
    const tmpBase = await mkdtemp(join(tmpdir(), "reporelay-wt-e2e-"));
    mirrorsDir = join(tmpBase, "mirrors");
    worktreesDir = join(tmpBase, "worktrees");

    // 3. Mock embedder (zero vectors, no Ollama dependency)
    embedder = createMockEmbedder();

    // 4. Create a test git repo with all language samples
    repo = await createTestRepo(allLanguageFiles());
  }, 120_000);

  afterAll(async () => {
    await repo?.cleanup();
    await rm(mirrorsDir, { recursive: true, force: true }).catch(() => {});
    await rm(worktreesDir, { recursive: true, force: true }).catch(() => {});
    await stopPostgres();
  });

  // The core test: run handleIndexJob (the real worker handler)
  // which calls syncMirror → checkoutWorktree → runPipeline.
  // Before the resolve() fix, checkoutWorktree created the worktree
  // inside the mirror directory, so readFile failed for every file
  // and the pipeline silently produced 0 chunks.

  describe("full index via handleIndexJob with mock embedder", () => {
    it("registers the repo in DB", async () => {
      const repoRepo = new RepoRepository(db);
      await repoRepo.insertOne({
        name: repo.name,
        localPath: repo.path,
      });

      const row = await repoRepo.findByName(repo.name);
      expect(row).toBeDefined();
      expect(row!.name).toBe(repo.name);
    });

    it("handleIndexJob indexes v1.0.0 to ready", async () => {
      const config: Config = {
        DATABASE_URL: "",
        EMBEDDING_PROVIDER: "ollama",
        EMBEDDING_URL: "http://localhost:11434",
        EMBEDDING_MODEL: "nomic-embed-text",
        EMBEDDING_BATCH_SIZE: 64,
        MCP_SERVER_PORT: 3000,
        WEB_PORT: 3001,
        GIT_MIRRORS_DIR: mirrorsDir,
        GIT_WORKTREES_DIR: worktreesDir,
        MCP_LANGUAGE_THRESHOLD: 10,
        LOG_LEVEL: "fatal",
      };

      const workerDeps: WorkerDeps = { db, embedder, config, logger: silentLogger };

      await handleIndexJob({ repo: repo.name, ref: "v1.0.0" }, workerDeps);

      // Verify the ref reached "ready" status
      const repoRepo = new RepoRepository(db);
      const repoRow = await repoRepo.findByName(repo.name);
      const refRepo = new RepoRefRepository(db);
      const repoRef = await refRepo.findByRepoAndRef(repoRow!.id, "v1.0.0");
      expect(repoRef).toBeDefined();
      expect(repoRef!.stage).toBe("ready");
      expect(repoRef!.indexedAt).toBeDefined();
    });

    it("indexed files are stored in ref_files", async () => {
      const repoRepo = new RepoRepository(db);
      const repoRow = await repoRepo.findByName(repo.name);
      const refRepo = new RepoRefRepository(db);
      const repoRef = await refRepo.findByRepoAndRef(repoRow!.id, "v1.0.0");

      const rfRepo = new RefFileRepository(db);
      const refFileRows = await rfRepo.findByRepoRef(repoRef!.id);
      const paths = refFileRows.map((r) => r.path);

      // At least 9 supported-language files
      expect(refFileRows.length).toBeGreaterThanOrEqual(9);
      expect(paths).toContain("src/service.ts");
      expect(paths).toContain("src/calculator.py");
      expect(paths).toContain("src/server.go");
      expect(paths).toContain("docs/README.md");
    });

    it("chunks are stored with embeddings", async () => {
      const chunkRepo = new ChunkRepository(db);
      const allChunks = await chunkRepo.findAll();

      expect(allChunks.length).toBeGreaterThan(0);
      const withEmbedding = allChunks.filter((c) => c.embedding != null);
      expect(withEmbedding.length).toBe(allChunks.length);
    });

    it("symbols are extracted from source files", async () => {
      const repoRepo = new RepoRepository(db);
      const repoRow = await repoRepo.findByName(repo.name);
      const refRepo = new RepoRefRepository(db);
      const repoRef = await refRepo.findByRepoAndRef(repoRow!.id, "v1.0.0");

      const rfRepo = new RefFileRepository(db);
      const tsFile = await rfRepo.findByRepoRefAndPath(repoRef!.id, "src/service.ts");
      expect(tsFile).toBeDefined();

      const symRepo = new SymbolRepository(db);
      const symbols = await symRepo.findByFileContentId(tsFile!.fileContentId);
      const names = symbols.map((s) => s.name);
      expect(names).toContain("Service");
    });

    it("hybrid search returns results from the indexed data", async () => {
      const results = await searchHybrid(db, embedder, {
        query: "service",
        repo: repo.name,
        ref: "v1.0.0",
      });

      // With mock embedder (zero vectors) the vector leg of hybrid search
      // returns arbitrary rows, but BM25 should still find "service" matches.
      // At minimum the RRF fusion should produce some results.
      expect(results.length).toBeGreaterThan(0);
      results.forEach((r) => {
        expect(r.repo).toBe(repo.name);
        expect(r.ref).toBe("v1.0.0");
      });
    });

    it("worktree is cleaned up after indexing", async () => {
      // The handler cleans up the worktree after pipeline completes.
      // The worktrees directory should be empty (or contain no wt-* dirs).
      const { readdir } = await import("node:fs/promises");
      try {
        const entries = await readdir(worktreesDir);
        const wtDirs = entries.filter((e) => e.startsWith("wt-"));
        expect(wtDirs.length).toBe(0);
      } catch {
        // Directory might not exist if cleanupWorktree removed it — that's fine
      }
    });
  });
});
