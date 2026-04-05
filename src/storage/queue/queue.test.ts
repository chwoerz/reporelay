import { describe, expect, it, vi } from "vitest";
import { cancelIndexJob, cancelIndexJobsForRepo } from "./queue.js";
import type { PgBoss } from "pg-boss";

/**
 * Creates a minimal mock PgBoss with spies for findJobs, cancel, deleteJob.
 * `findJobsResult` controls what findJobs returns.
 */
function mockBoss(findJobsResult: { id: string; singletonKey?: string }[] = []) {
  return {
    findJobs: vi.fn().mockResolvedValue(findJobsResult),
    cancel: vi.fn().mockResolvedValue(undefined),
    deleteJob: vi.fn().mockResolvedValue(undefined),
  } as unknown as PgBoss & {
    findJobs: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    deleteJob: ReturnType<typeof vi.fn>;
  };
}

describe("cancelIndexJob", () => {
  it("finds jobs by singletonKey and cancels + deletes each one", async () => {
    const boss = mockBoss([{ id: "job-1" }, { id: "job-2" }]);

    await cancelIndexJob(boss, "my-repo", "v1.0.0");

    expect(boss.findJobs).toHaveBeenCalledWith("index-repo", { key: "my-repo:v1.0.0" });
    expect(boss.cancel).toHaveBeenCalledTimes(2);
    expect(boss.cancel).toHaveBeenCalledWith("index-repo", "job-1");
    expect(boss.cancel).toHaveBeenCalledWith("index-repo", "job-2");
    expect(boss.deleteJob).toHaveBeenCalledTimes(2);
    expect(boss.deleteJob).toHaveBeenCalledWith("index-repo", "job-1");
    expect(boss.deleteJob).toHaveBeenCalledWith("index-repo", "job-2");
  });

  it("does nothing when no jobs are found", async () => {
    const boss = mockBoss([]);

    await cancelIndexJob(boss, "my-repo", "v2.0.0");

    expect(boss.findJobs).toHaveBeenCalledOnce();
    expect(boss.cancel).not.toHaveBeenCalled();
    expect(boss.deleteJob).not.toHaveBeenCalled();
  });

  it("returns error result when cancel fails", async () => {
    const boss = mockBoss([{ id: "job-x", singletonKey: "r:ref" }]);
    boss.cancel.mockRejectedValue(new Error("already completed"));

    await expect(cancelIndexJob(boss, "r", "ref")).resolves.toEqual([
      {
        state: "error",
        message: "Cancellation of r:ref failed",
        reason: "Error: already completed",
      },
      {
        state: "success",
      },
    ]);
    expect(boss.deleteJob).toHaveBeenCalledWith("index-repo", "job-x");
  });

  it("returns error result when deleteJob fails", async () => {
    const boss = mockBoss([{ id: "job-y", singletonKey: "r:ref" }]);
    boss.deleteJob.mockRejectedValue(new Error("not found"));

    await expect(cancelIndexJob(boss, "r", "ref")).resolves.toEqual([
      {
        state: "success",
      },
      {
        state: "error",
        message: "Deletion of r:ref failed",
        reason: "Error: not found",
      },
    ]);
  });
});

describe("cancelIndexJobsForRepo", () => {
  it("cancels jobs for every ref", async () => {
    const boss = mockBoss([{ id: "j1" }]);

    await cancelIndexJobsForRepo(boss, "my-repo", ["v1.0.0", "v2.0.0", "main"]);

    expect(boss.findJobs).toHaveBeenCalledTimes(3);
    expect(boss.findJobs).toHaveBeenCalledWith("index-repo", { key: "my-repo:v1.0.0" });
    expect(boss.findJobs).toHaveBeenCalledWith("index-repo", { key: "my-repo:v2.0.0" });
    expect(boss.findJobs).toHaveBeenCalledWith("index-repo", { key: "my-repo:main" });
    // Each call finds 1 job → 3 cancels + 3 deletes
    expect(boss.cancel).toHaveBeenCalledTimes(3);
    expect(boss.deleteJob).toHaveBeenCalledTimes(3);
  });

  it("does nothing for empty refs list", async () => {
    const boss = mockBoss();

    await cancelIndexJobsForRepo(boss, "my-repo", []);

    expect(boss.findJobs).not.toHaveBeenCalled();
  });
});
