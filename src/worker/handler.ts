/**
 * Index job handler — orchestrates git sync → pipeline → cleanup.
 *
 * Called by pg-boss for each queued index job. Progress is tracked
 * directly in the `repo_refs` table (stage, counters, error).
 *
 * Error strategy:
 * - Pre-upsert failures (repo not found, no source) → permanent, logged only
 *   (no repoRefId exists to update).
 * - Post-upsert failures → permanent, caught and marked as "error" stage in DB.
 *   pg-boss sees the job as completed (no retry).
 */
import * as semver from "semver";
import { eq } from "drizzle-orm";
import type { Db } from "../storage/index.js";
import { repoRefs } from "../storage/index.js";
import { RepoRepository } from "../storage/index.js";
import { RepoRefRepository, type ProgressUpdate } from "../storage/index.js";
import {
  checkoutWorktree,
  cleanupWorktree,
  listFiles,
  resolveCommitSha,
  syncMirror,
} from "../git/git-sync.js";
import { runPipeline, PipelineCancelledError } from "../indexer/pipeline.js";
import type { Embedder } from "../indexer/embedder.js";
import type { IndexJob } from "../core/types.js";
import type { Config } from "../core/config.js";
import type { Logger } from "../core/logger.js";

// ── Types ──

export interface WorkerDeps {
  db: Db;
  embedder: Embedder;
  config: Config;
  logger: Logger;
}

interface ResolvedRepo {
  id: number;
  name: string;
  source: string;
  localPath: string | null;
  remoteUrl: string | null;
  defaultBranch: string;
  globPatterns: string[];
}

interface SyncResult {
  mirrorPath: string;
  commitSha: string;
  semver: string | undefined;
}

// ── Helpers ──

/**
 * Try to extract a clean semver string from a ref name.
 * e.g. "v1.2.3" → "1.2.3", "main" → undefined.
 */
export function parseSemver(ref: string): string | undefined {
  return semver.clean(ref) ?? undefined;
}

// ── Step functions ──

/** Look up the repo by name and determine its git source. Returns null on failure. */
async function resolveRepoSource(
  db: Db,
  repoName: string,
  logger: Logger,
): Promise<ResolvedRepo | null> {
  const repo = await new RepoRepository(db).findByName(repoName);
  if (!repo) {
    logger.error({ repo: repoName }, "Repo not found, skipping job");
    return null;
  }

  const source = repo.localPath ?? repo.remoteUrl;
  if (!source) {
    logger.error({ repo: repoName }, "No localPath or remoteUrl configured, skipping job");
    return null;
  }

  return { ...repo, source };
}

/** Sync the bare mirror, resolve commit SHA and semver. */
async function syncAndResolve(opts: {
  job: IndexJob;
  source: string;
  repoName: string;
  config: Config;
  logger: Logger;
}): Promise<SyncResult> {
  const { job, source, repoName, config, logger } = opts;
  logger.info({ repo: repoName, ref: job.ref }, "Syncing mirror");
  const mirrorPath = await syncMirror(source, config.GIT_MIRRORS_DIR, repoName);

  const commitSha = job.commitSha ?? (await resolveCommitSha(mirrorPath, job.ref));

  return { mirrorPath, commitSha, semver: parseSemver(job.ref) };
}

/** Upsert the repo_ref row, returning its id. Sets stage to "syncing" and records start time. */
async function upsertRepoRef(
  refRepo: RepoRefRepository,
  opts: {
    existingRef: { id: number } | undefined;
    repoId: number;
    ref: string;
    commitSha: string;
    semver: string | undefined;
  },
): Promise<number> {
  if (opts.existingRef) {
    await refRepo.updateWhere(eq(repoRefs.id, opts.existingRef.id), {
      commitSha: opts.commitSha,
      stage: "syncing",
      stageMessage: "Starting indexing…",
      semver: opts.semver ?? null,
      indexingStartedAt: new Date(),
      indexingError: null,
      filesTotal: 0,
      filesProcessed: 0,
      chunksTotal: 0,
      chunksEmbedded: 0,
    });
    return opts.existingRef.id;
  }

  const newRef = await refRepo.insertOne({
    repoId: opts.repoId,
    ref: opts.ref,
    commitSha: opts.commitSha,
    stage: "syncing",
    stageMessage: "Starting indexing…",
    semver: opts.semver ?? null,
    indexingStartedAt: new Date(),
  });
  return newRef.id;
}

/** Checkout a worktree and list all files at this commit. */
async function checkoutAndListFiles(opts: {
  refRepo: RepoRefRepository;
  repoRefId: number;
  job: IndexJob;
  globPatterns: string[];
  mirrorPath: string;
  commitSha: string;
  config: Config;
  logger: Logger;
}): Promise<{ worktreePath: string; files: string[] }> {
  const { refRepo, repoRefId, job, globPatterns, mirrorPath, commitSha, config, logger } = opts;
  logger.info({ repo: job.repo, ref: job.ref, commitSha }, "Checking out worktree");
  await refRepo.updateProgress(repoRefId, {
    stage: "checking-out",
    stageMessage: "Checking out worktree…",
  });
  const worktreePath = await checkoutWorktree(mirrorPath, config.GIT_WORKTREES_DIR, commitSha);

  await refRepo.updateProgress(repoRefId, {
    stage: "diffing",
    stageMessage: "Listing files…",
  });
  const files = await listFiles(mirrorPath, commitSha, globPatterns);
  logger.info({ repo: job.repo, ref: job.ref, files: files.length }, "File listing complete");

  return { worktreePath, files };
}

/** Build a progress callback adapter for the pipeline. */
function pipelineProgressCallback(
  refRepo: RepoRefRepository,
  repoRefId: number,
  logger: Logger,
  job: IndexJob,
) {
  return (event: Parameters<NonNullable<Parameters<typeof runPipeline>[2]>>[0]) => {
    // Fire-and-forget DB updates — pipeline shouldn't block on progress writes.
    const update = (progress: ProgressUpdate): void => {
      refRepo.updateProgress(repoRefId, progress).catch(() => {});
    };

    switch (event.type) {
      case "file-done":
        update({
          filesProcessed: event.filesProcessed,
          filesTotal: event.filesTotal,
          stageMessage: `Processed ${event.filesProcessed}/${event.filesTotal} file(s)… · ${event.path}`,
        });
        break;
      case "file-skipped":
        logger.warn(
          { repo: job.repo, ref: job.ref, path: event.path, reason: event.reason },
          "File skipped",
        );
        break;
      case "file-error":
        logger.error(
          { repo: job.repo, ref: job.ref, path: event.path, error: event.error },
          "File processing error (continuing)",
        );
        break;
      case "embedding-start":
        update({
          stage: "embedding",
          chunksTotal: event.chunksTotal,
          chunksEmbedded: 0,
          stageMessage: `Embedding ${event.chunksTotal} chunk(s)…`,
        });
        break;
      case "embedding-batch-done":
        update({
          chunksEmbedded: event.chunksEmbedded,
          stageMessage: `Embedded ${event.chunksEmbedded}/${event.chunksTotal} chunk(s)…`,
        });
        break;
      case "finalizing":
        // Do NOT set stage here — the pipeline's own updateWhere (pipeline.ts)
        // sets stage to "ready" immediately after this callback fires.
        // A fire-and-forget "finalizing" write could race and overwrite "ready".
        update({
          stageMessage: "Persisting embeddings and marking ref as ready…",
        });
        break;
    }
  };
}

// ── Main handler ──

/**
 * Handle a single index job end-to-end.
 *
 * On error: sets repo_ref stage to "error", cleans up worktree,
 * and swallows the error (pg-boss sees success, no retry).
 */
export async function handleIndexJob(job: IndexJob, deps: WorkerDeps): Promise<void> {
  const { db, embedder, config, logger } = deps;
  const refRepo = new RepoRefRepository(db);

  let mirrorPath: string | undefined;
  let worktreePath: string | undefined;
  let repoRefId: number | undefined;

  try {
    // 1. Resolve repo & source
    const repo = await resolveRepoSource(db, job.repo, logger);
    if (!repo) return;

    // Look up the pre-created "queued" row so we can report errors from
    // this point on (the sync endpoint creates it before enqueuing).
    const queuedRef = await refRepo.findByRepoAndRef(repo.id, job.ref);
    if (queuedRef) repoRefId = queuedRef.id;

    // 2. Sync mirror & resolve commit
    const sync = await syncAndResolve({
      job,
      source: repo.source,
      repoName: repo.name,
      config,
      logger,
    });
    mirrorPath = sync.mirrorPath;

    // 3. Skip if already indexed at the same commit
    const existingRef = queuedRef ?? (await refRepo.findByRepoAndRef(repo.id, job.ref));
    if (existingRef && existingRef.stage === "ready" && existingRef.commitSha === sync.commitSha) {
      logger.info({ repo: job.repo, ref: job.ref }, "Ref already indexed at this commit, skipping");
      return;
    }

    // 4. Upsert repo_ref → "syncing" (from here on, progress goes to DB)
    repoRefId = await upsertRepoRef(refRepo, {
      existingRef,
      repoId: repo.id,
      ref: job.ref,
      commitSha: sync.commitSha,
      semver: sync.semver,
    });

    // 5. Checkout worktree & list files
    const { worktreePath: wt, files } = await checkoutAndListFiles({
      refRepo,
      repoRefId,
      job,
      globPatterns: repo.globPatterns,
      mirrorPath: sync.mirrorPath,
      commitSha: sync.commitSha,
      config,
      logger,
    });
    worktreePath = wt;

    // 6. Run indexing pipeline
    await refRepo.updateProgress(repoRefId, {
      stage: "processing-files",
      stageMessage: `Processing ${files.length} file(s)…`,
      filesTotal: files.length,
    });

    await runPipeline(
      { db, embedder, embeddingBatchSize: config.EMBEDDING_BATCH_SIZE },
      { worktreePath, repoRefId, files },
      pipelineProgressCallback(refRepo, repoRefId, logger, job),
    );

    // Pipeline's finalizing step already sets stage to "ready" in the DB
    // (via refRepo.updateWhere in pipeline.ts), so just log success.
    logger.info({ repo: job.repo, ref: job.ref, commitSha: sync.commitSha }, "Indexing complete");
  } catch (err) {
    // If the ref was deleted mid-pipeline (e.g. user clicked "Delete"),
    // the row is already gone — don't attempt to mark it as "error".
    if (err instanceof PipelineCancelledError) {
      logger.info({ repo: job.repo, ref: job.ref }, "Indexing cancelled (ref deleted)");
    } else {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (repoRefId) {
        await refRepo
          .updateProgress(repoRefId, {
            stage: "error",
            stageMessage: `Indexing failed: ${errorMsg}`,
            indexingError: errorMsg,
          })
          .catch(() => {});
      }
      logger.error({ repo: job.repo, ref: job.ref, err }, "Indexing failed");
    }
  } finally {
    if (mirrorPath && worktreePath) {
      await cleanupWorktree(mirrorPath, worktreePath).catch(() => {});
    }
  }
}
