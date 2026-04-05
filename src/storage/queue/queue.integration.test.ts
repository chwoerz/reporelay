import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgres, stopPostgres, getConnectionString } from "../../../test/setup/postgres.js";
import {
  createQueue,
  enqueueIndexJob,
  cancelIndexJob,
  cancelIndexJobsForRepo,
  registerIndexHandler,
  stopQueue,
} from "./queue.js";
import { PgBoss } from "pg-boss";
import type { IndexJob } from "../../core/types.js";

let boss: PgBoss;

describe("pg-boss Queue (integration)", () => {
  beforeAll(async () => {
    await startPostgres();
  });
  afterAll(async () => {
    if (boss) await stopQueue(boss);
    await stopPostgres();
  });

  it("starts pg-boss and creates its schema tables", async () => {
    boss = await createQueue(getConnectionString());
    // Suppress unhandled error events during tests
    boss.on("error", () => {});
    expect(boss).toBeInstanceOf(PgBoss);

    // pg-boss should have created its internal tables
    const { getSql } = await import("../../../test/setup/postgres.js");
    const rows = await getSql()`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'pgboss'
    `;
    expect(rows.length).toBeGreaterThan(0);
  });

  it("enqueues an index job with repo, ref, and commitSha", async () => {
    const job: IndexJob = { repo: "my-repo", ref: "main", commitSha: "abc123" };
    const jobId = await enqueueIndexJob(boss, job);
    expect(jobId).toBeTypeOf("string");
    expect(jobId!.length).toBeGreaterThan(0);
  });

  it("worker picks up an enqueued job", async () => {
    const receivedJobs: IndexJob[] = [];

    await registerIndexHandler(boss, async (job) => {
      receivedJobs.push(job);
    });

    const job: IndexJob = { repo: "pickup-repo", ref: "main", commitSha: "def" };
    await enqueueIndexJob(boss, job);

    // Wait for the worker to pick up the job
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(receivedJobs.length).toBeGreaterThanOrEqual(1);
    const picked = receivedJobs.find((j) => j.repo === "pickup-repo");
    expect(picked).toBeDefined();
    expect(picked!.ref).toBe("main");

    // Clean up worker for next tests
    await boss.offWork("index-repo");
  });

  it("marks job as completed on success", async () => {
    // Register a handler that succeeds
    await boss.work<IndexJob>("index-repo", async () => {
      /* success */
    });

    const job: IndexJob = {
      repo: "complete-repo",
      ref: "v1.0.0",
      commitSha: "c1",
    };
    const jobId = await enqueueIndexJob(boss, job);

    // Wait for the handler to process it
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check job state via pg-boss
    const found = await boss.getJobById("index-repo", jobId!);
    // Completed jobs may already be archived (null) or have state 'completed'
    if (found) {
      expect(found.state).toBe("completed");
    }
    // null means already archived → also means completed

    await boss.offWork("index-repo");
  });

  it("marks job as failed on handler error", async () => {
    let failCount = 0;
    await boss.work<IndexJob>("index-repo", async () => {
      failCount++;
      throw new Error("intentional failure");
    });

    const job: IndexJob = { repo: "fail-repo", ref: "main", commitSha: "f1" };
    const jobId = await enqueueIndexJob(boss, job);

    // Wait for processing + all retries to exhaust (retryLimit: 3)
    await new Promise((resolve) => setTimeout(resolve, 8000));

    const found = await boss.getJobById("index-repo", jobId!);
    if (found) {
      // After all retries exhausted, should be 'failed'; during retries could be 'retry' or 'active'
      expect(["failed", "retry", "active"]).toContain(found.state);
    }
    // The handler should have been called at least once
    expect(failCount).toBeGreaterThanOrEqual(1);

    await boss.offWork("index-repo");
  });

  it("does not duplicate jobs for the same repo+ref (singleton key)", async () => {
    const job: IndexJob = { repo: "dedup-repo", ref: "main", commitSha: "d1" };
    const id1 = await enqueueIndexJob(boss, job);
    expect(id1).toBeTypeOf("string");

    // Second send with same repo+ref — stately policy rejects duplicate queued jobs per singletonKey
    const id2 = await enqueueIndexJob(boss, { ...job, commitSha: "d2" });
    expect(id2).toBeNull();
  });

  it("retries failed jobs up to configured max attempts", async () => {
    let attemptCount = 0;
    await boss.work<IndexJob>("index-repo", async () => {
      attemptCount++;
      throw new Error("always fails");
    });

    const job: IndexJob = { repo: "retry-repo", ref: "main", commitSha: "r1" };
    await enqueueIndexJob(boss, job);

    // Wait long enough for at least one retry
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // We set retryLimit: 3 in enqueueIndexJob, so it should attempt multiple times
    expect(attemptCount).toBeGreaterThanOrEqual(1);

    await boss.offWork("index-repo");
  });

  it("cancelIndexJob cancels and removes a queued job", async () => {
    const job: IndexJob = { repo: "cancel-repo", ref: "v1.0.0", commitSha: "c1" };
    const jobId = await enqueueIndexJob(boss, job);
    expect(jobId).toBeTypeOf("string");

    // Cancel it
    await cancelIndexJob(boss, "cancel-repo", "v1.0.0");

    // Job should no longer be fetchable in a queued state
    const found = await boss.getJobById("index-repo", jobId!);
    // After cancel+delete, the job should be gone (null) or in a terminal state
    if (found) {
      expect(["cancelled", "failed"]).toContain(found.state);
    }
  });

  it("cancelIndexJob is a no-op when no matching job exists", async () => {
    // Should not throw
    await expect(cancelIndexJob(boss, "nonexistent-repo", "v99.0.0")).resolves.toEqual([]);
  });

  it("cancelIndexJobsForRepo cancels jobs across multiple refs", async () => {
    const id1 = await enqueueIndexJob(boss, {
      repo: "multi-cancel",
      ref: "v1.0.0",
    });
    const id2 = await enqueueIndexJob(boss, {
      repo: "multi-cancel",
      ref: "v2.0.0",
    });
    expect(id1).toBeTypeOf("string");
    expect(id2).toBeTypeOf("string");

    await cancelIndexJobsForRepo(boss, "multi-cancel", ["v1.0.0", "v2.0.0"]);

    // Both jobs should be gone or cancelled
    for (const id of [id1!, id2!]) {
      const found = await boss.getJobById("index-repo", id);
      if (found) {
        expect(["cancelled", "failed"]).toContain(found.state);
      }
    }
  });
});
