/**
 * pg-boss job queue wrapper for index jobs.
 */
import { type Job, JobWithMetadata, PgBoss } from "pg-boss";
import type { IndexJob } from "../../core/types.js";

const INDEX_QUEUE = "index-repo";

/**
 * Create and start a pg-boss instance.
 * Also creates the index-repo queue if it doesn't exist yet.
 */
export async function createQueue(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss(connectionString);
  await boss.start();

  // Ensure the queues exist (pg-boss v12 requires explicit queue creation)
  // Policy "stately" keeps completed jobs so singletonKey dedupes against
  // all states. enqueueIndexJob() handles purging completed jobs to allow
  // re-index of the same repo:ref after a prior run finishes.
  const existing = await boss.getQueue(INDEX_QUEUE);
  if (!existing) {
    await boss.createQueue(INDEX_QUEUE, { policy: "stately" });
  }

  return boss;
}

/**
 * Enqueue an index job with singleton-key dedup (repo:ref).
 *
 * With the "stately" queue policy, completed jobs persist and block
 * singletonKey re-sends. When send() returns null we purge stored
 * jobs for this specific singletonKey and retry — this allows
 * re-indexing the same repo:ref while still preventing duplicates
 * for in-flight jobs.
 */
export async function enqueueIndexJob(boss: PgBoss, job: IndexJob): Promise<string | null> {
  const singletonKey = `${job.repo}:${job.ref}`;
  const opts = {
    singletonKey,
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 1_800,
  };

  const id = await boss.send(INDEX_QUEUE, job, opts);

  if (id === null) {
    // A completed (or failed) job with this singletonKey likely blocks
    // the send. Delete only terminal-state jobs (not active/queued ones).
    const stored = await boss.findJobs(INDEX_QUEUE, { key: singletonKey });
    const terminalStates = new Set(["completed", "cancelled", "failed"]);
    const toDelete = stored.filter((j) => terminalStates.has(j.state));

    // If no terminal jobs to purge, a queued/active job is blocking — true dedup.
    if (toDelete.length === 0) return null;

    for (const j of toDelete) {
      await boss.deleteJob(INDEX_QUEUE, j.id).catch(() => {});
    }
    return await boss.send(INDEX_QUEUE, job, opts);
  }

  return id;
}

/**
 * Register a handler for index jobs.
 * The handler receives the job data and should throw on failure.
 */
export async function registerIndexHandler(
  boss: PgBoss,
  handler: (job: IndexJob) => Promise<void>,
): Promise<string> {
  return boss.work<IndexJob>(INDEX_QUEUE, async (jobs: Job<IndexJob>[]) => {
    for (const job of jobs) {
      await handler(job.data);
    }
  });
}

/**
 * Gracefully stop pg-boss (finish active jobs, then close).
 */
export async function stopQueue(boss: PgBoss): Promise<void> {
  await boss.stop({ graceful: true });
}

export type JobAbortResult = { state: "error" | "success"; reason?: string; message?: string };

/**
 * Cancel any queued/active index job for a specific repo:ref.
 * Finds jobs by singletonKey and cancels + deletes them.
 */
export async function cancelIndexJob(
  boss: PgBoss,
  repo: string,
  ref: string,
): Promise<JobAbortResult[]> {
  const key = `${repo}:${ref}`;
  const jobs = await boss.findJobs(INDEX_QUEUE, { key });
  const jobResults: JobAbortResult[] = [];

  for (const job of jobs) {
    const cancelResponse = await wrapJobResult("Cancellation", job, () =>
      boss.cancel(INDEX_QUEUE, job.id),
    );

    jobResults.push(cancelResponse);
    const deleteResponse = await wrapJobResult("Deletion", job, () =>
      boss.deleteJob(INDEX_QUEUE, job.id),
    );
    jobResults.push(deleteResponse);
  }
  return jobResults;
}

function wrapJobResult(
  type: "Cancellation" | "Deletion",
  job: JobWithMetadata<any>,
  fn: () => Promise<any>,
): Promise<JobAbortResult> {
  return fn().then(
    () => ({ state: "success" as const }),
    (e) => ({
      state: "error" as const,
      message: type + " of " + job.singletonKey + " failed",
      reason: String(e),
    }),
  );
}

/**
 * Cancel all queued/active index jobs for every ref of a repo.
 * Accepts the list of ref strings to build singletonKeys.
 */
export async function cancelIndexJobsForRepo(
  boss: PgBoss,
  repo: string,
  refs: string[],
): Promise<void> {
  for (const ref of refs) {
    await cancelIndexJob(boss, repo, ref);
  }
}
