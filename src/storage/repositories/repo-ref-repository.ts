/**
 * Repository for the `repo_refs` table.
 *
 * Provides stage transitions and progress tracking for indexing jobs.
 * Each repo_ref row holds the full indexing state: current stage, progress
 * counters (files/chunks), and any error message.
 */
import { eq, and, notInArray } from "drizzle-orm";
import { BaseRepository } from "./base-repository.js";
import { repoRefs, type RepoRefSelect } from "../schema/schema.js";
import type { IndexingStage } from "../../core/types.js";
import type { Db } from "../schema/db.js";

/** Fields that can be updated via `updateProgress`. */
export interface ProgressUpdate {
  stage?: IndexingStage;
  stageMessage?: string;
  filesTotal?: number;
  filesProcessed?: number;
  chunksTotal?: number;
  chunksEmbedded?: number;
  indexingError?: string | null;
}

/** Placeholder commit SHA used when a ref is first enqueued (before the worker resolves the real SHA). */
export const PENDING_COMMIT_SHA = "pending";

/** Terminal stages — refs in these stages are no longer actively indexing. */
const TERMINAL_STAGES: IndexingStage[] = ["ready", "error"];

export class RepoRefRepository extends BaseRepository<typeof repoRefs> {
  constructor(db: Db) {
    super(db, repoRefs);
  }

  async findByRepoAndRef(repoId: number, ref: string): Promise<RepoRefSelect | undefined> {
    return this.findOne(and(eq(repoRefs.repoId, repoId), eq(repoRefs.ref, ref))!);
  }

  async findByRepoId(repoId: number): Promise<RepoRefSelect[]> {
    return this.findAll(eq(repoRefs.repoId, repoId));
  }

  /** Transition a repo_ref to a new stage. */
  async updateStage(id: number, stage: IndexingStage): Promise<RepoRefSelect[]> {
    return this.updateWhere(eq(repoRefs.id, id), { stage });
  }

  /** Update progress counters and optionally the stage. */
  async updateProgress(id: number, update: ProgressUpdate): Promise<RepoRefSelect[]> {
    return this.updateWhere(eq(repoRefs.id, id), update);
  }

  /** Return all repo_refs that are actively indexing (non-terminal stage). */
  async findActiveProgress(): Promise<RepoRefSelect[]> {
    return this.findAll(notInArray(repoRefs.stage, TERMINAL_STAGES));
  }

  /**
   * Insert-or-update a repo_ref to "queued" stage.
   *
   * Called at enqueue time (sync endpoint) so the UI can show progress
   * immediately — before the worker picks up the job. Uses the unique
   * `(repoId, ref)` constraint for conflict resolution.
   */
  async upsertQueued(repoId: number, ref: string): Promise<RepoRefSelect> {
    const [row] = await this.db
      .insert(repoRefs)
      .values({
        repoId,
        ref,
        commitSha: PENDING_COMMIT_SHA,
        stage: "queued",
        stageMessage: "Waiting for worker…",
        indexingStartedAt: null,
        indexingError: null,
        filesTotal: 0,
        filesProcessed: 0,
        chunksTotal: 0,
        chunksEmbedded: 0,
      })
      .onConflictDoUpdate({
        target: [repoRefs.repoId, repoRefs.ref],
        set: {
          stage: "queued",
          stageMessage: "Waiting for worker…",
          commitSha: PENDING_COMMIT_SHA,
          indexingStartedAt: null,
          indexingError: null,
          filesTotal: 0,
          filesProcessed: 0,
          chunksTotal: 0,
          chunksEmbedded: 0,
        },
      })
      .returning();
    return row!;
  }
}
