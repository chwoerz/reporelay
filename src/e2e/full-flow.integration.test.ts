/**
 * End-to-end integration tests for the main indexing flow shown in the
 * mermaid diagram:
 *
 *   Web API / MCP trigger
 *     → enqueue pg-boss job
 *       → worker picks up job
 *         → git sync → upsert repo_ref → checkout worktree
 *           → list files → parse → chunk → embed → store
 *             → status = ready ✅ → cleanup worktree
 *
 * These tests wire together: testcontainers Postgres, Fastify (buildApp),
 * real pg-boss queue, worker handler (handleIndexJob), indexing pipeline,
 * and mock embedder — verifying the whole chain via HTTP API assertions.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";
import { simpleGit } from "simple-git";

import { startPostgres, stopPostgres, getConnectionString } from "../../test/setup/postgres.js";
import { createTestRepo, addCommitToTestRepo, type TestRepo } from "../../test/setup/test-repo.js";
import { allLanguageFiles, TYPESCRIPT_SAMPLE } from "../../test/fixtures/samples.js";

import { runMigrations } from "../storage/index.js";
import { createDb, type Db } from "../storage/index.js";
import { createQueue, registerIndexHandler, stopQueue } from "../storage/index.js";
import { buildApp, type AppDeps } from "../web/app.js";
import { handleIndexJob, type WorkerDeps } from "../worker/handler.js";
import type { Embedder } from "../indexer/embedder.js";
import { RepoRepository } from "../storage/index.js";
import { RepoRefRepository } from "../storage/index.js";
import { RefFileRepository } from "../storage/index.js";
import { ChunkRepository } from "../storage/index.js";
import { searchHybrid } from "../retrieval/index.js";
import type { Config } from "../core/config.js";
import { createMockEmbedder } from "../../test/setup/mock-embedder.js";
import type { FastifyInstance } from "fastify";
import type { PgBoss } from "pg-boss";

// ── Helpers ──

const silentLogger = pino({ level: "silent" });

/**
 * Wait until a ref reaches the expected status using vi.waitUntil.
 */
async function pollRefStatus(
  app: FastifyInstance,
  repoName: string,
  ref: string,
  expectedStatus: string,
  maxMs = 30_000,
): Promise<Record<string, unknown>> {
  let found: Record<string, unknown> | undefined;
  await vi.waitUntil(
    async () => {
      const res = await app.inject({ method: "GET", url: `/api/repos/${repoName}` });
      const body = res.json();
      found = (body.refs as Array<Record<string, unknown>>)?.find(
        (r) => r.ref === ref && r.stage === expectedStatus,
      );
      return found !== undefined;
    },
    { timeout: maxMs, interval: 500 },
  );
  return found!;
}

// ── Suite ──

describe("End-to-end: API → pg-boss → worker → pipeline (integration)", () => {
  let db: Db;
  let boss: PgBoss;
  let app: FastifyInstance;
  let repo: TestRepo;
  let mirrorsDir: string;
  let worktreesDir: string;
  let embedder: Embedder;

  beforeAll(async () => {
    // 1. Start Postgres (testcontainers)
    const { sql } = await startPostgres();
    await runMigrations(sql);
    db = createDb(sql);

    // 2. Start pg-boss
    boss = await createQueue(getConnectionString());
    boss.on("error", () => {}); // suppress unhandled in tests

    // 3. Create temp dirs for git mirrors/worktrees
    mirrorsDir = await mkdtemp(join(tmpdir(), "reporelay-e2e-mirrors-"));
    worktreesDir = await mkdtemp(join(tmpdir(), "reporelay-e2e-wt-"));

    // 4. Create embedder + config
    embedder = createMockEmbedder();
    const config: Config = {
      DATABASE_URL: getConnectionString(),
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

    // 5. Register real worker handler with pg-boss
    const workerDeps: WorkerDeps = { db, embedder, config, logger: silentLogger };
    await registerIndexHandler(boss, (job) => handleIndexJob(job, workerDeps));

    // 6. Build Fastify app with real pg-boss + config (mirror sync needs GIT_MIRRORS_DIR)
    const appDeps: AppDeps = { db, boss, embedder, config, logger: silentLogger };
    app = buildApp(appDeps);
    await app.ready();

    // 7. Create a test git repo with all language files + v1.0.0 tag
    repo = await createTestRepo(allLanguageFiles());
  }, 120_000);

  afterAll(async () => {
    await boss?.offWork("index-repo").catch(() => {});
    await app?.close();
    await stopQueue(boss).catch(() => {});
    await repo?.cleanup();
    await rm(mirrorsDir, { recursive: true, force: true }).catch(() => {});
    await rm(worktreesDir, { recursive: true, force: true }).catch(() => {});
    await stopPostgres();
  });

  // ────────────────────────────────────────────────────────────
  // Flow 1: Full index via API → queue → worker → ready
  // ────────────────────────────────────────────────────────────

  describe("full index: API → queue → worker → pipeline → ready", () => {
    it("registers a repo via POST /api/repos (returns immediately, mirror clones async)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: {
          name: repo.name,
          localPath: repo.path,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe(repo.name);
      expect(body.mirrorStatus).toBe("cloning");
    });

    it("git-refs are available after the async mirror clone finishes", async () => {
      // Wait until mirror is ready (local clone should be very fast)
      await vi.waitUntil(
        async () => {
          const repoRes = await app.inject({
            method: "GET",
            url: `/api/repos/${repo.name}`,
          });
          const repoBody = repoRes.json();
          return repoBody.mirrorStatus === "ready" || !repoBody.mirrorStatus;
        },
        { timeout: 15_000, interval: 500 },
      );

      const res = await app.inject({
        method: "GET",
        url: `/api/repos/${repo.name}/git-refs`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.branches).toContain("main");
      expect(body.tags).toContain("v1.0.0");
    });

    it("enqueues a sync job via POST /api/repos/:name/sync and returns 202", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/repos/${repo.name}/sync`,
        payload: { ref: "v1.0.0" },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.jobId).toBeTypeOf("string");
      expect(body.ref).toBe("v1.0.0");
    });

    it("worker processes the job and ref reaches status 'ready'", async () => {
      const ref = await pollRefStatus(app, repo.name, "v1.0.0", "ready");
      expect(ref.stage).toBe("ready");
      expect(ref.commitSha).toBeTypeOf("string");
      expect((ref.commitSha as string).length).toBeGreaterThanOrEqual(7);
    });

    it("indexed data is stored in DB (files, symbols, chunks with embeddings)", async () => {
      const repoRow = await new RepoRepository(db).findByName(repo.name);
      const repoRef = await new RepoRefRepository(db).findByRepoAndRef(repoRow!.id, "v1.0.0");
      expect(repoRef).toBeDefined();
      expect(repoRef!.stage).toBe("ready");

      const rfRepo = new RefFileRepository(db);
      const refFileRows = await rfRepo.findByRepoRef(repoRef!.id);

      // Should have indexed the supported language files
      expect(refFileRows.length).toBeGreaterThanOrEqual(9);
      const paths = refFileRows.map((r) => r.path);
      expect(paths).toContain("src/service.ts");
      expect(paths).toContain("src/calculator.py");
      expect(paths).toContain("docs/README.md");

      // Chunks should have embeddings (status = "ready" guarantees this)
      const chunkRepo = new ChunkRepository(db);

      const allChunks = await chunkRepo.findAll();
      expect(allChunks.length).toBeGreaterThan(0);
      const withEmbedding = allChunks.filter((c) => c.embedding != null);
      expect(withEmbedding.length).toBe(allChunks.length);
    });

    it("search returns results for the indexed version", async () => {
      const results = await searchHybrid(db, embedder, {
        query: "service",
        repo: repo.name,
        ref: "v1.0.0",
      });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((r) => {
        expect(r.repo).toBe(repo.name);
        expect(r.ref).toBe("v1.0.0");
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // Flow 2: Re-index same ref (branch) after new commits
  //         → commitSha updates
  // ────────────────────────────────────────────────────────────

  describe("re-index same ref: commitSha updates after new commits", () => {
    let originalSha: string;

    it("indexes 'main' branch for the first time", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/repos/${repo.name}/sync`,
        payload: { ref: "main" },
      });
      expect(res.statusCode).toBe(202);
      await pollRefStatus(app, repo.name, "main", "ready");
    });

    it("captures the original commitSha for main", async () => {
      const res = await app.inject({ method: "GET", url: `/api/repos/${repo.name}` });
      const body = res.json();
      const ref = body.refs.find((r: any) => r.ref === "main");
      originalSha = ref.commitSha;
      expect(originalSha).toBeTypeOf("string");
    });

    it("adds a new commit to the repo", async () => {
      await addCommitToTestRepo(
        repo.path,
        { "src/service.ts": TYPESCRIPT_SAMPLE + "\n// re-index update\n" },
        "update for re-index",
      );
    });

    it("re-syncs 'main' via API", async () => {
      // Allow pg-boss to fully settle previous job state transitions
      await new Promise((r) => setTimeout(r, 2000));

      const res = await app.inject({
        method: "POST",
        url: `/api/repos/${repo.name}/sync`,
        payload: { ref: "main" },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.jobId).not.toBeNull();
    });

    it("worker re-indexes and commitSha is updated", { timeout: 90_000 }, async () => {
      // Wait until main is ready again with a new commitSha
      let updatedRef: Record<string, unknown> | undefined;
      await vi.waitUntil(
        async () => {
          const res = await app.inject({ method: "GET", url: `/api/repos/${repo.name}` });
          const body = res.json();
          updatedRef = (body.refs as Array<Record<string, unknown>>)?.find(
            (r) => r.ref === "main" && r.stage === "ready" && r.commitSha !== originalSha,
          );
          return updatedRef !== undefined;
        },
        { timeout: 60_000, interval: 500 },
      );
      expect(updatedRef!.commitSha).not.toBe(originalSha);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Flow 3: Multiple versions coexist (v1.0.0 + v2.0.0)
  // ────────────────────────────────────────────────────────────

  describe("multiple versions: v1.0.0 + v2.0.0 coexist", () => {
    it("adds a v2.0.0 commit with changes and tags it", async () => {
      await addCommitToTestRepo(
        repo.path,
        {
          "src/calculator.py": null, // delete
          "src/new-feature.ts": 'export const FEATURE = "v2";\n',
        },
        "v2 feature",
      );
      const git = simpleGit(repo.path);
      await git.addTag("v2.0.0");
    });

    it("syncs v2.0.0 via API", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/repos/${repo.name}/sync`,
        payload: { ref: "v2.0.0" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("worker indexes v2.0.0 to ready", async () => {
      await pollRefStatus(app, repo.name, "v2.0.0", "ready");
    });

    it("GET /api/repos/:name returns both v1.0.0 and v2.0.0 as ready", async () => {
      const res = await app.inject({ method: "GET", url: `/api/repos/${repo.name}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const refs = body.refs as Array<Record<string, unknown>>;

      const v1 = refs.find((r) => r.ref === "v1.0.0");
      const v2 = refs.find((r) => r.ref === "v2.0.0");

      expect(v1).toBeDefined();
      expect(v1!.stage).toBe("ready");

      expect(v2).toBeDefined();
      expect(v2!.stage).toBe("ready");

      // They should have different commitShas
      expect(v1!.commitSha).not.toBe(v2!.commitSha);
    });

    it("search scoped to v1.0.0 returns v1 content", async () => {
      const results = await searchHybrid(db, embedder, {
        query: "service",
        repo: repo.name,
        ref: "v1.0.0",
      });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((r) => expect(r.ref).toBe("v1.0.0"));
    });

    it("search scoped to v2.0.0 returns v2 content", async () => {
      const results = await searchHybrid(db, embedder, {
        query: "FEATURE",
        repo: repo.name,
        ref: "v2.0.0",
      });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((r) => expect(r.ref).toBe("v2.0.0"));
    });
  });

  // ────────────────────────────────────────────────────────────
  // Flow 4: Worker error handling — invalid repo path
  // ────────────────────────────────────────────────────────────

  describe("error handling: invalid localPath", () => {
    const badRepoName = "bad-repo";

    it("registers a repo with a non-existent localPath (mirror sync fails gracefully)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: {
          name: badRepoName,
          localPath: "/nonexistent/path/to/repo",
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.mirrorStatus).toBe("cloning");

      // Wait for the async mirror clone to fail
      await vi.waitUntil(
        async () => {
          const repoRes = await app.inject({
            method: "GET",
            url: `/api/repos/${badRepoName}`,
          });
          const repoBody = repoRes.json();
          if (repoBody.mirrorStatus === "error") {
            expect(repoBody.mirrorError).toBeTypeOf("string");
            return true;
          }
          return false;
        },
        { timeout: 10_000, interval: 500 },
      );
    });

    it("syncs the bad repo — job is accepted (202)", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/repos/${badRepoName}/sync`,
        payload: { ref: "main" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("worker fails and marks the ref as error (mirror sync fails after enqueue)", async () => {
      // The sync endpoint creates a "queued" repo_ref row before enqueuing.
      // The handler finds this row, then fails at syncMirror (invalid path).
      // The catch block writes stage: "error" to the existing row.
      await new Promise((r) => setTimeout(r, 5_000));

      const res = await app.inject({ method: "GET", url: `/api/repos/${badRepoName}` });
      const body = res.json();
      // The queued row should now be marked as error
      expect(body.refs).toHaveLength(1);
      expect(body.refs[0].ref).toBe("main");
      expect(body.refs[0].stage).toBe("error");
    });
  });

  // ────────────────────────────────────────────────────────────
  // Flow 5: Delete a version and verify cleanup
  // ────────────────────────────────────────────────────────────

  describe("delete version: removes ref and data", () => {
    it("DELETE /api/repos/:name/versions/:ref removes v2.0.0", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/repos/${repo.name}/versions/v2.0.0`,
      });
      expect(res.statusCode).toBe(204);
      // DELETE now awaits completion before responding, no polling needed.
    });

    it("v2.0.0 no longer appears in the repo refs", async () => {
      const res = await app.inject({ method: "GET", url: `/api/repos/${repo.name}` });
      const body = res.json();
      const refs = body.refs as Array<Record<string, unknown>>;
      const v2 = refs.find((r) => r.ref === "v2.0.0");
      expect(v2).toBeUndefined();
    });

    it("v1.0.0 still exists after deleting v2.0.0", async () => {
      const res = await app.inject({ method: "GET", url: `/api/repos/${repo.name}` });
      const body = res.json();
      const refs = body.refs as Array<Record<string, unknown>>;
      const v1 = refs.find((r) => r.ref === "v1.0.0");
      expect(v1).toBeDefined();
      expect(v1!.stage).toBe("ready");
    });
  });
});
