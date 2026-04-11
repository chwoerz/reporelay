/**
 * Fastify application factory.
 *
 * Accepts injected dependencies (DB, optional pg-boss, optional embedder)
 * so tests can provide their own connections without starting a real server.
 *
 * Core business logic (resolve repo/ref, get file, get symbol, etc.) is
 * delegated to the shared service layer in src/services/.
 *
 * Routes are organized into three groups:
 *  - System routes (health, credentials, indexing status)
 *  - Repo management routes (CRUD, sync, delete)
 *  - Feature routes (search, browse, symbols, context)
 */
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import type { Db } from "../storage/index.js";
import {
  cancelIndexJob,
  cancelIndexJobsForRepo,
  enqueueIndexJob,
  RefFileRepository,
  RepoRefRepository,
  repoRefs,
  RepoRepository,
  repos,
} from "../storage/index.js";
import type { RepoSelect } from "../storage/schema/schema.js";
import type { PgBoss } from "pg-boss";
import type { Embedder } from "../indexer/embedder.js";
import type { Config } from "../core/config.js";
import { listGitRefs, syncMirror } from "../git/git-sync.js";
import { hasTokenConfigured, getConfiguredHosts } from "../git/git-credentials.js";
import {
  buildContext,
  cleanupOrphansBackground,
  findByPattern,
  findReferences,
  findRepo,
  getFileContent,
  getSymbol,
  listReposWithRefs,
  resolveRepoAndRef,
  searchCode,
} from "../services/index.js";
import type { ResolvedRepoRef } from "../services/index.js";
import {
  createRepoBodySchema,
  syncBodySchema,
  updateRepoBodySchema,
  contextBodySchema,
  apiPaths,
} from "../generated/index.js";
import pino from "pino";

// ── Dependencies ──

export interface AppDeps {
  db: Db;
  boss: PgBoss;
  embedder: Embedder;
  config: Config;
  logger: pino.Logger;
}

/** Shared state passed to each route group. */
interface RouteContext {
  deps: AppDeps;
  repoRepo: RepoRepository;
  refRepo: RepoRefRepository;
  rfRepo: RefFileRepository;
  mirrorStatus: Map<string, { status: "cloning" | "ready" | "error"; error?: string }>;
}

// ── Request helpers ──

/** Look up a repo by name or send a 404. Returns `null` if reply was sent. */
async function requireRepo(
  repoRepo: RepoRepository,
  name: string,
  reply: FastifyReply,
): Promise<RepoSelect | null> {
  const repo = await repoRepo.findByName(name);
  if (!repo) {
    reply.status(404).send({ error: "Repository not found." });
    return null;
  }
  return repo;
}

/** Resolve repo + ref or send a 404. Returns `null` if reply was sent. */
async function requireResolvedRef(
  db: Db,
  name: string,
  ref: string,
  reply: FastifyReply,
): Promise<ResolvedRepoRef | null> {
  const resolved = await resolveRepoAndRef(db, name, ref);
  if (typeof resolved === "string") {
    reply.status(404).send({ error: resolved });
    return null;
  }
  return resolved;
}

/** Mirror status reader — returns 'ready' when no entry is tracked. */
function getMirrorStatus(
  mirrorStatus: RouteContext["mirrorStatus"],
  name: string,
): "cloning" | "ready" | "error" {
  return mirrorStatus.get(name)?.status ?? "ready";
}

/** Mirror error reader — returns undefined when no error is tracked. */
function getMirrorError(
  mirrorStatus: RouteContext["mirrorStatus"],
  name: string,
): string | undefined {
  return mirrorStatus.get(name)?.error;
}

// ── System routes ──

function registerSystemRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, refRepo } = ctx;

  // ── GET /health ──
  app.get(apiPaths.getHealth, async (_req, reply) => {
    const embedderOk = deps.embedder.initError === null;
    return reply.send({
      status: embedderOk ? "ok" : "degraded",
      embedder: {
        status: embedderOk ? "ok" : "error",
        ...(deps.embedder.initError ? { error: deps.embedder.initError } : {}),
      },
    });
  });

  // ── GET /api/git-credentials/hosts ──
  app.get(apiPaths.getGitCredentialHosts, async (_req, reply) => {
    return reply.send(getConfiguredHosts());
  });

  // ── GET /api/indexing-status ──
  app.get(apiPaths.getAllIndexingStatus, async (_req, reply) => {
    const active = await refRepo.findActiveProgress();
    const entries = await Promise.all(
      active.map(async (ref) => {
        const repo = await new RepoRepository(deps.db).findById(ref.repoId);
        return {
          repo: repo?.name ?? "unknown",
          ref: ref.ref,
          stage: ref.stage,
          message: ref.stageMessage ?? "",
          filesTotal: ref.filesTotal,
          filesProcessed: ref.filesProcessed,
          chunksTotal: ref.chunksTotal,
          chunksEmbedded: ref.chunksEmbedded,
          startedAt: ref.indexingStartedAt?.toISOString() ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          error: ref.indexingError ?? undefined,
        };
      }),
    );
    return reply.send(entries);
  });

  // ── GET /api/indexing-status/:name/:ref ──
  app.get<{ Params: { name: string; ref: string } }>(
    apiPaths.getIndexingStatus,
    async (req, reply) => {
      const repo = await new RepoRepository(deps.db).findByName(req.params.name);
      if (!repo) {
        return reply.status(404).send({ error: "No active indexing tracked for this repo/ref." });
      }
      const ref = await refRepo.findByRepoAndRef(repo.id, req.params.ref);
      if (!ref || ref.stage === "ready" || ref.stage === "error") {
        return reply.status(404).send({ error: "No active indexing tracked for this repo/ref." });
      }
      return reply.send({
        repo: req.params.name,
        ref: ref.ref,
        stage: ref.stage,
        message: ref.stageMessage ?? "",
        filesTotal: ref.filesTotal,
        filesProcessed: ref.filesProcessed,
        chunksTotal: ref.chunksTotal,
        chunksEmbedded: ref.chunksEmbedded,
        startedAt: ref.indexingStartedAt?.toISOString() ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: ref.indexingError ?? undefined,
      });
    },
  );
}

// ── Repo management routes ──

function registerRepoRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, repoRepo, refRepo, mirrorStatus } = ctx;

  // ── POST /api/repos ──
  app.post(apiPaths.createRepo, async (req, reply) => {
    const parsed = createRepoBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]!.message });
    }
    const { name, localPath, remoteUrl } = parsed.data;

    const nameError = validateRepoName(name);
    if (nameError) {
      return reply.status(400).send({ error: nameError });
    }

    if (!localPath && !remoteUrl) {
      return reply
        .status(400)
        .send({ error: "At least one of localPath or remoteUrl is required." });
    }

    const existing = await repoRepo.findByName(name);
    if (existing) {
      return reply.status(409).send({ error: `Repository "${name}" already exists.` });
    }

    const repo = await repoRepo.insertOne({
      name,
      localPath: localPath ?? null,
      remoteUrl: remoteUrl ?? null,
      globPatterns: parsed.data.globPatterns ?? [],
    });

    // Fire mirror clone in the background — don't block the response.
    const source = localPath ?? remoteUrl;
    mirrorStatus.set(name, { status: "cloning" });

    syncMirror(source!, deps.config.GIT_MIRRORS_DIR, name)
      .then(() => {
        mirrorStatus.set(name, { status: "ready" });
        setTimeout(() => mirrorStatus.delete(name), 60_000);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        mirrorStatus.set(name, { status: "error", error: msg });
        setTimeout(() => mirrorStatus.delete(name), 60_000);
      });

    return reply.status(201).send({
      ...repo,
      mirrorStatus: getMirrorStatus(mirrorStatus, name),
      tokenConfigured: remoteUrl ? hasTokenConfigured(remoteUrl) : false,
    });
  });

  // ── GET /api/repos ──
  app.get(apiPaths.listRepos, async (_req, reply) => {
    const entries = await listReposWithRefs(deps.db);

    const result = entries.map(({ repo, refs }) => ({
      ...repo,
      mirrorStatus: getMirrorStatus(mirrorStatus, repo.name),
      mirrorError: getMirrorError(mirrorStatus, repo.name),
      tokenConfigured: repo.remoteUrl ? hasTokenConfigured(repo.remoteUrl) : false,
      refs: refs.map((r) => ({
        ref: r.ref,
        stage: r.stage,
        commitSha: r.commitSha,
        languageStats: r.languageStats,
        indexingError: r.indexingError ?? undefined,
      })),
    }));

    return reply.send(result);
  });

  // ── GET /api/repos/:name ──
  app.get<{ Params: { name: string } }>(apiPaths.getRepo, async (req, reply) => {
    const repo = await requireRepo(repoRepo, req.params.name, reply);
    if (!repo) return;

    const refs = await refRepo.findByRepoId(repo.id);

    return reply.send({
      ...repo,
      mirrorStatus: getMirrorStatus(mirrorStatus, repo.name),
      mirrorError: getMirrorError(mirrorStatus, repo.name),
      tokenConfigured: repo.remoteUrl ? hasTokenConfigured(repo.remoteUrl) : false,
      refs: refs.map((r) => ({
        ref: r.ref,
        stage: r.stage,
        commitSha: r.commitSha,
        languageStats: r.languageStats,
        indexingError: r.indexingError ?? undefined,
      })),
    });
  });

  // ── GET /api/repos/:name/git-refs ──
  app.get<{ Params: { name: string } }>(apiPaths.getGitRefs, async (req, reply) => {
    const repo = await requireRepo(repoRepo, req.params.name, reply);
    if (!repo) return;

    const mirrorPath = join(deps.config.GIT_MIRRORS_DIR, `${repo.name}.git`);
    const gitRefs = await listGitRefs(mirrorPath);
    return reply.send(gitRefs);
  });

  // ── POST /api/repos/:name/refresh-refs ──
  app.post<{ Params: { name: string } }>(apiPaths.refreshGitRefs, async (req, reply) => {
    const repo = await requireRepo(repoRepo, req.params.name, reply);
    if (!repo) return;

    const source = repo.localPath ?? repo.remoteUrl;
    if (!source) {
      return reply.status(500).send({ error: "Repository has no configured source." });
    }

    try {
      await syncMirror(source, deps.config.GIT_MIRRORS_DIR, repo.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ error: msg });
    }

    const mirrorPath = join(deps.config.GIT_MIRRORS_DIR, `${repo.name}.git`);
    const gitRefs = await listGitRefs(mirrorPath);
    return reply.send(gitRefs);
  });

  // ── POST /api/repos/:name/sync ──
  app.post<{ Params: { name: string } }>(apiPaths.syncRepo, async (req, reply) => {
    const parsed = syncBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "ref is required." });
    }

    const repo = await requireRepo(repoRepo, req.params.name, reply);
    if (!repo) return;

    // Create/reset the repo_ref row to "queued" so the UI can show
    // progress immediately — before the worker picks up the job.
    await refRepo.upsertQueued(repo.id, parsed.data.ref);

    const jobId = await enqueueIndexJob(deps.boss, {
      repo: repo.name,
      ref: parsed.data.ref,
    });
    return reply.status(202).send({ jobId, repo: repo.name, ref: parsed.data.ref });
  });

  // ── PATCH /api/repos/:name ──
  app.patch<{ Params: { name: string } }>(apiPaths.updateRepo, async (req, reply) => {
    const parsed = updateRepoBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]!.message });
    }

    const repo = await requireRepo(repoRepo, req.params.name, reply);
    if (!repo) return;

    const updated = await repoRepo.updateByName(repo.name, {
      globPatterns: parsed.data.globPatterns ?? repo.globPatterns,
    });

    const refs = await refRepo.findByRepoId(repo.id);
    return reply.send({
      ...updated,
      mirrorStatus: getMirrorStatus(mirrorStatus, repo.name),
      mirrorError: getMirrorError(mirrorStatus, repo.name),
      tokenConfigured: repo.remoteUrl ? hasTokenConfigured(repo.remoteUrl) : false,
      refs: refs.map((r) => ({
        ref: r.ref,
        stage: r.stage,
        commitSha: r.commitSha,
        languageStats: r.languageStats,
        indexingError: r.indexingError ?? undefined,
      })),
    });
  });

  // ── DELETE /api/repos/:name ──
  app.delete<{ Params: { name: string } }>(apiPaths.deleteRepo, async (req, reply) => {
    const repo = await requireRepo(repoRepo, req.params.name, reply);
    if (!repo) return;

    const refs = await refRepo.findByRepoId(repo.id);

    // Cancel any in-flight index jobs for all refs (fire-and-forget)
    if (refs.length > 0) {
      cancelIndexJobsForRepo(
        deps.boss,
        repo.name,
        refs.map((r) => r.ref),
      ).catch(() => {});
    }

    // Delete the repo (cascades to repo_refs -> ref_files).
    // This may wait for the worker's open transaction to finish.
    await repoRepo.deleteWhere(eq(repos.id, repo.id));

    // Clean up orphaned file_contents in the background.
    cleanupOrphansBackground(deps.db, deps.logger, `repo ${repo.name}`);

    return reply.status(204).send();
  });

  // ── DELETE /api/repos/:name/versions/:ref ──
  app.delete<{ Params: { name: string; ref: string } }>(
    apiPaths.deleteVersion,
    async (req, reply) => {
      const repo = await requireRepo(repoRepo, req.params.name, reply);
      if (!repo) return;

      const ref = await refRepo.findByRepoAndRef(repo.id, req.params.ref);
      if (!ref) {
        return reply.status(404).send({ error: "Ref not found." });
      }

      // Cancel any in-flight index job for this ref (fire-and-forget)
      cancelIndexJob(deps.boss, repo.name, req.params.ref).catch(() => {});

      // Delete the ref (cascades to ref_files).
      // This may wait for the worker's open transaction to finish.
      await refRepo.deleteWhere(eq(repoRefs.id, ref.id));

      // Clean up orphaned file_contents in the background.
      cleanupOrphansBackground(deps.db, deps.logger, `repo ${repo.name} ref ${ref.ref}`);

      return reply.status(204).send();
    },
  );
}

// ── Feature routes (search, browse, symbols, context) ──

function registerFeatureRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, rfRepo } = ctx;

  // ── GET /api/search ──
  app.get<{
    Querystring: { query: string; repo?: string; ref?: string; limit?: string };
  }>(apiPaths.searchCode, async (req, reply) => {
    const { query, repo, ref, limit } = req.query;
    if (!query) {
      return reply.status(400).send({ error: "query parameter is required." });
    }

    const results = await searchCode(deps.db, deps.embedder, {
      query,
      repo,
      ref,
      limit: limit ? Math.min(Math.max(parseInt(limit, 10), 1), MAX_SEARCH_LIMIT) : 20,
    });

    return reply.send(results);
  });

  // ── GET /api/repos/:name/refs/:ref/tree ──
  app.get<{
    Params: { name: string; ref: string };
    Querystring: { prefix?: string };
  }>(apiPaths.getFileTree, async (req, reply) => {
    const resolved = await requireResolvedRef(deps.db, req.params.name, req.params.ref, reply);
    if (!resolved) return;

    const paths = await rfRepo.listPaths(resolved.ref.id, req.query.prefix);
    return reply.send(paths);
  });

  // ── GET /api/repos/:name/refs/:ref/file ──
  app.get<{
    Params: { name: string; ref: string };
    Querystring: { path: string; includeSymbols?: string };
  }>(apiPaths.getFile, async (req, reply) => {
    const filePath = req.query.path;
    if (!filePath) {
      return reply.status(400).send({ error: "path query parameter is required." });
    }

    const resolved = await requireResolvedRef(deps.db, req.params.name, req.params.ref, reply);
    if (!resolved) return;

    const result = await getFileContent(deps.db, resolved, filePath, {
      mirrorsDir: deps.config.GIT_MIRRORS_DIR,
      includeSymbols: req.query.includeSymbols === "true",
    });

    if (typeof result === "string") {
      return reply.status(404).send({ error: result });
    }

    return reply.send(result);
  });

  // ── GET /api/repos/:name/refs/:ref/symbols/:symbolName ──
  app.get<{
    Params: { name: string; ref: string; symbolName: string };
    Querystring: { includeImports?: string };
  }>(apiPaths.getSymbol, async (req, reply) => {
    const resolved = await requireResolvedRef(deps.db, req.params.name, req.params.ref, reply);
    if (!resolved) return;

    const result = await getSymbol(deps.db, resolved, req.params.symbolName, {
      includeImports: req.query.includeImports === "true",
    });

    if (typeof result === "string") {
      return reply.status(404).send({ error: result });
    }

    return reply.send(result);
  });

  // ── GET /api/repos/:name/refs/:ref/find ──
  app.get<{
    Params: { name: string; ref: string };
    Querystring: { pattern: string; kind: "file" | "symbol" };
  }>(apiPaths.find, async (req, reply) => {
    const { pattern, kind } = req.query;
    if (!pattern || !kind) {
      return reply.status(400).send({ error: "pattern and kind parameters are required." });
    }

    const resolved = await requireResolvedRef(deps.db, req.params.name, req.params.ref, reply);
    if (!resolved) return;

    const result = await findByPattern(deps.db, resolved.ref.id, kind, pattern);

    if (result.kind === "file") {
      return reply.send(result.files);
    }

    return reply.send(
      result.symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        filePath: s.filePath,
        startLine: s.startLine,
        endLine: s.endLine,
        signature: s.signature,
      })),
    );
  });

  // ── GET /api/repos/:name/refs/:ref/references/:symbolName ──
  app.get<{
    Params: { name: string; ref: string; symbolName: string };
  }>(apiPaths.findReferences, async (req, reply) => {
    const resolved = await requireResolvedRef(deps.db, req.params.name, req.params.ref, reply);
    if (!resolved) return;

    const refs = await findReferences(deps.db, resolved.ref.id, req.params.symbolName);
    return reply.send(refs);
  });

  // ── POST /api/repos/:name/context ──
  app.post<{ Params: { name: string } }>(apiPaths.buildContext, async (req, reply) => {
    const parsed = contextBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]!.message });
    }

    const repo = await findRepo(deps.db, req.params.name);
    if (!repo) {
      return reply.status(404).send({ error: "Repository not found." });
    }

    const { pack, formatted } = await buildContext(deps.db, deps.embedder, {
      repo: repo.name,
      repoId: repo.id,
      strategy: parsed.data.strategy,
      ref: parsed.data.ref,
      fromRef: parsed.data.fromRef,
      query: parsed.data.query,
      paths: parsed.data.paths,
      maxTokens: parsed.data.maxTokens,
    });

    return reply.send({
      strategy: pack.strategy,
      repo: pack.repo,
      ref: pack.ref,
      totalTokens: pack.totalTokens,
      chunks: pack.chunks,
      formatted,
    });
  });
}

// ── Helpers ──

/**
 * Parse the CORS_ORIGIN config string into a Fastify CORS origin value.
 *
 * - undefined / empty → `false` (cross-origin requests are blocked)
 * - `"*"`            → `true`  (allow all origins — dev only)
 * - comma-separated  → string array of allowed origins
 */
export function parseCorsOrigin(raw?: string): boolean | string[] {
  if (!raw || !raw.trim()) return false;
  if (raw.trim() === "*") return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Maximum allowed value for the search `limit` query parameter. */
const MAX_SEARCH_LIMIT = 100;

/**
 * Validate a repository name to prevent path-traversal and filesystem issues.
 * Returns an error string if invalid, or `null` if acceptable.
 */
export function validateRepoName(name: string): string | null {
  if (name.length > 255) return "Repository name must be 255 characters or fewer.";
  if (/[/\\]/.test(name)) return "Repository name must not contain path separators.";
  if (name === "." || name === "..") {
    return "Repository name must not be '.' or '..'.";
  }
  if (/[\x00-\x1f]/.test(name)) return "Repository name must not contain control characters.";
  return null;
}

// ── Factory ──

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576, // 1 MB
    requestTimeout: 120_000, // 2 minutes
  });

  const ctx: RouteContext = {
    deps,
    repoRepo: new RepoRepository(deps.db),
    refRepo: new RepoRefRepository(deps.db),
    rfRepo: new RefFileRepository(deps.db),
    mirrorStatus: new Map(),
  };

  app.register(cors, {
    origin: parseCorsOrigin(deps.config.CORS_ORIGIN),
  });

  // Serve OpenAPI spec + Swagger UI at /docs
  const specDir = new URL("../../", import.meta.url).pathname;
  app.register(swagger, {
    mode: "static",
    specification: {
      path: "./openapi.yaml",
      baseDir: specDir,
    },
  });
  app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  registerSystemRoutes(app, ctx);
  registerRepoRoutes(app, ctx);
  registerFeatureRoutes(app, ctx);

  return app;
}
