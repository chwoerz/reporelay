import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSql, startPostgres, stopPostgres } from "../../test/setup/postgres.js";
import { createDb, type Db, runMigrations } from "../storage/index.js";
import { type AppDeps, buildApp } from "./app.js";
import type { FastifyInstance } from "fastify";
import { createMockEmbedder } from "../../test/setup/mock-embedder.js";
import type { Config } from "../core/config.js";
import { RepoRepository } from "../storage/repositories/repo-repository.js";
import {
  RepoRefRepository,
  PENDING_COMMIT_SHA,
} from "../storage/repositories/repo-ref-repository.js";
import { syncMirror, listGitRefs } from "../git/git-sync.js";
import pino from "pino";

vi.mock("../git/git-sync.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../git/git-sync.js")>();
  return {
    ...original,
    syncMirror: vi.fn().mockResolvedValue("/tmp/reporelay-test-mirrors/test.git"),
    listGitRefs: vi.fn().mockResolvedValue({ branches: ["main"], tags: ["v1.0.0"] }),
  };
});

let db: Db;
let app: FastifyInstance;

/** Minimal mock config for testing (no real git mirrors needed). */
const mockConfig: Config = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  EMBEDDING_URL: "http://localhost:11434",
  EMBEDDING_MODEL: "nomic-embed-text",
  EMBEDDING_BATCH_SIZE: 64,
  MCP_SERVER_PORT: 3000,
  WEB_PORT: 3001,
  GIT_MIRRORS_DIR: "/tmp/reporelay-test-mirrors",
  GIT_WORKTREES_DIR: "/tmp/reporelay-test-worktrees",
  MCP_LANGUAGE_THRESHOLD: 10,
  LOG_LEVEL: "fatal",
};

function makeMockBoss() {
  return {
    send: vi.fn().mockResolvedValue("mock-job-id"),
    findJobs: vi.fn().mockResolvedValue([]),
    cancel: vi.fn().mockResolvedValue(undefined),
    deleteJob: vi.fn().mockResolvedValue(undefined),
    deleteStoredJobs: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Web API (integration)", () => {
  const mainBoss = makeMockBoss();

  beforeAll(async () => {
    await startPostgres();
    await runMigrations(getSql());
    db = createDb(getSql());

    const deps: AppDeps = {
      db,
      boss: mainBoss as any,
      embedder: createMockEmbedder(),
      config: mockConfig,
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      } as any,
    };
    app = buildApp(deps);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await stopPostgres();
  });

  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    });
  });

  describe("POST /api/repos", () => {
    it("creates a repo and returns 201", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { name: "test-repo", localPath: "/tmp/test" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe("test-repo");
      expect(body.id).toBeTypeOf("number");
    });

    it("returns 400 when name is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { localPath: "/tmp/x" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when neither localPath nor remoteUrl is provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { name: "bad-repo" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 409 when repo name already exists", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { name: "test-repo", localPath: "/tmp/dup" },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("GET /api/repos", () => {
    it("returns list of repos with refs", async () => {
      const res = await app.inject({ method: "GET", url: "/api/repos" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.some((r: any) => r.name === "test-repo")).toBe(true);
    });
  });

  describe("GET /api/repos/:name", () => {
    it("returns repo details with indexed refs", async () => {
      const res = await app.inject({ method: "GET", url: "/api/repos/test-repo" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe("test-repo");
      expect(Array.isArray(body.refs)).toBe(true);
    });

    it("returns 404 for non-existent repo", async () => {
      const res = await app.inject({ method: "GET", url: "/api/repos/nope" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/repos/:name/sync", () => {
    it("enqueues an index job and returns 202", async () => {
      mainBoss.send.mockClear();
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/test-repo/sync",
        payload: { ref: "v1.0.0" },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.jobId).toBe("mock-job-id");
      expect(body.repo).toBe("test-repo");
      expect(body.ref).toBe("v1.0.0");
    });

    it("creates a queued repo_ref row immediately", async () => {
      const repo = await new RepoRepository(db).findByName("test-repo");

      const res = await app.inject({
        method: "POST",
        url: "/api/repos/test-repo/sync",
        payload: { ref: "v2.0.0" },
      });
      expect(res.statusCode).toBe(202);

      const ref = await new RepoRefRepository(db).findByRepoAndRef(repo!.id, "v2.0.0");
      expect(ref).toBeDefined();
      expect(ref!.stage).toBe("queued");
      expect(ref!.commitSha).toBe(PENDING_COMMIT_SHA);
      expect(ref!.stageMessage).toBe("Waiting for worker…");
    });

    it("resets an existing ref to queued on re-sync", async () => {
      const repo = await new RepoRepository(db).findByName("test-repo");
      const refRepo = new RepoRefRepository(db);

      // Seed a "ready" ref via upsertQueued + manual update
      await refRepo.upsertQueued(repo!.id, "v3.0.0");
      const queued = await refRepo.findByRepoAndRef(repo!.id, "v3.0.0");
      await refRepo.updateProgress(queued!.id, { stage: "ready" });

      // Re-sync should reset to queued
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/test-repo/sync",
        payload: { ref: "v3.0.0" },
      });
      expect(res.statusCode).toBe(202);

      const ref = await refRepo.findByRepoAndRef(repo!.id, "v3.0.0");
      expect(ref!.stage).toBe("queued");
      expect(ref!.commitSha).toBe(PENDING_COMMIT_SHA);
    });

    it("returns 404 for non-existent repo", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/nope/sync",
        payload: { ref: "v1.0.0" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when ref is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/test-repo/sync",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/repos/:name/refresh-refs", () => {
    it("fetches the mirror and returns updated git refs", async () => {
      const mockedSyncMirror = vi.mocked(syncMirror);
      const mockedListGitRefs = vi.mocked(listGitRefs);
      mockedSyncMirror.mockResolvedValue("/tmp/reporelay-test-mirrors/test-repo.git");
      mockedListGitRefs.mockResolvedValue({
        branches: ["main", "develop"],
        tags: ["v1.0.0", "v2.0.0"],
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/repos/test-repo/refresh-refs",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.branches).toEqual(["main", "develop"]);
      expect(body.tags).toEqual(["v1.0.0", "v2.0.0"]);
      expect(mockedSyncMirror).toHaveBeenCalledWith(
        "/tmp/test",
        mockConfig.GIT_MIRRORS_DIR,
        "test-repo",
      );
    });

    it("returns 404 for non-existent repo", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos/nope/refresh-refs",
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 500 when mirror sync fails", async () => {
      vi.mocked(syncMirror).mockRejectedValueOnce(new Error("Network unreachable"));

      const res = await app.inject({
        method: "POST",
        url: "/api/repos/test-repo/refresh-refs",
      });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toContain("Network unreachable");
    });
  });

  describe("DELETE /api/repos/:name/versions/:ref", () => {
    it("deletes a specific indexed version, returns 204", async () => {
      // Seed a ref to delete
      const repo = await new RepoRepository(db).findByName("test-repo");
      await new RepoRefRepository(db).insertOne({
        repoId: repo!.id,
        ref: "v0.1.0",
        commitSha: "aaa111",
        stage: "ready",
      });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/repos/test-repo/versions/v0.1.0",
      });
      expect(res.statusCode).toBe(204);

      const check = await new RepoRefRepository(db).findByRepoAndRef(repo!.id, "v0.1.0");
      expect(check).toBeUndefined();
    });

    it("returns 404 for non-existent repo or ref", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/repos/test-repo/versions/v99.99.99",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /api/repos/:name", () => {
    it("deletes repo and all associated data, returns 204", async () => {
      // Create a disposable repo for this test
      await app.inject({
        method: "POST",
        url: "/api/repos",
        payload: { name: "to-delete", remoteUrl: "https://example.com/repo.git" },
      });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/repos/to-delete",
      });
      expect(res.statusCode).toBe(204);

      const check = await app.inject({ method: "GET", url: "/api/repos/to-delete" });
      expect(check.statusCode).toBe(404);
    });

    it("returns 404 for non-existent repo", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/repos/nope",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE cancels index jobs", () => {
    let cancelApp: FastifyInstance;
    const cancelBoss = makeMockBoss();

    beforeAll(async () => {
      const deps: AppDeps = {
        db,
        boss: cancelBoss as any,
        embedder: createMockEmbedder(),
        config: mockConfig,
        logger: {
          info: vi.fn(),
          error: vi.fn(),
        } as unknown as pino.Logger,
      };
      cancelApp = buildApp(deps);
      await cancelApp.ready();
    });

    afterAll(async () => {
      await cancelApp?.close();
    });

    it("DELETE /api/repos/:name cancels jobs for all refs", async () => {
      // Seed a repo with two refs
      const repoRepo = new RepoRepository(db);
      const repo = await repoRepo.insertOne({
        name: "cancel-test-repo",
        localPath: "/tmp/cancel-test",
        defaultBranch: "main",
      });
      const refRepo = new RepoRefRepository(db);
      await refRepo.insertOne({
        repoId: repo.id,
        ref: "v1.0.0",
        commitSha: "aaa",
        stage: "syncing",
      });
      await refRepo.insertOne({
        repoId: repo.id,
        ref: "v2.0.0",
        commitSha: "bbb",
        stage: "syncing",
      });

      // Mock boss finds one job per ref
      cancelBoss.findJobs.mockClear();
      cancelBoss.cancel.mockClear();
      cancelBoss.deleteJob.mockClear();
      cancelBoss.findJobs.mockResolvedValue([{ id: "mock-job-id" }]);

      const res = await cancelApp.inject({
        method: "DELETE",
        url: "/api/repos/cancel-test-repo",
      });
      expect(res.statusCode).toBe(204);

      const deletedRepo = await repoRepo.findByName("cancel-test-repo");
      expect(deletedRepo).toBeUndefined();

      // Boss should have been called to cancel jobs for both refs
      expect(cancelBoss.findJobs).toHaveBeenCalledTimes(2);
      expect(cancelBoss.cancel).toHaveBeenCalledTimes(2);
      expect(cancelBoss.deleteJob).toHaveBeenCalledTimes(2);
    });

    it("DELETE /api/repos/:name/versions/:ref cancels the job for that ref", async () => {
      // Seed a repo with a ref
      const repoRepo = new RepoRepository(db);
      const repo = await repoRepo.insertOne({
        name: "cancel-ref-test",
        localPath: "/tmp/cancel-ref",
        defaultBranch: "main",
      });
      const refRepo = new RepoRefRepository(db);
      await refRepo.insertOne({
        repoId: repo.id,
        ref: "v3.0.0",
        commitSha: "ccc",
        stage: "syncing",
      });

      cancelBoss.findJobs.mockClear();
      cancelBoss.cancel.mockClear();
      cancelBoss.deleteJob.mockClear();
      cancelBoss.findJobs.mockResolvedValue([{ id: "ref-job-id" }]);

      const res = await cancelApp.inject({
        method: "DELETE",
        url: "/api/repos/cancel-ref-test/versions/v3.0.0",
      });
      expect(res.statusCode).toBe(204);

      const deletedRef = await refRepo.findByRepoAndRef(repo.id, "v3.0.0");
      expect(deletedRef).toBeUndefined();

      // Boss should have been called to cancel the job for v3.0.0
      expect(cancelBoss.findJobs).toHaveBeenCalledWith("index-repo", {
        key: "cancel-ref-test:v3.0.0",
      });
      expect(cancelBoss.cancel).toHaveBeenCalledWith("index-repo", "ref-job-id");
      expect(cancelBoss.deleteJob).toHaveBeenCalledWith("index-repo", "ref-job-id");
    });
  });
});
