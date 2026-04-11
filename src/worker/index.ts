/**
 * Worker entrypoint — pg-boss job handler for background indexing.
 *
 * Bootstraps DB, runs migrations, starts pg-boss, registers the index
 * job handler, cleans up stale worktrees, and handles graceful shutdown
 * on SIGTERM/SIGINT.
 *
 * The worker is the sole migration owner — web and MCP servers do not
 * run migrations.
 */
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { bootstrap, setupGracefulShutdown } from "../core/index.js";
import type { Logger } from "../core/logger.js";
import { createQueue, registerIndexHandler, stopQueue } from "../storage/index.js";
import { handleIndexJob, type WorkerDeps } from "./handler.js";

/**
 * Remove leftover worktree directories (`wt-*`) from a previous crash.
 * Safe to call when the directory doesn't exist yet.
 */
export async function cleanupStaleWorktrees(worktreesDir: string, logger: Logger): Promise<void> {
  try {
    const entries = await readdir(worktreesDir);
    const stale = entries.filter((e) => e.startsWith("wt-"));
    if (stale.length === 0) return;

    await Promise.all(
      stale.map((e) => rm(join(worktreesDir, e), { recursive: true, force: true })),
    );
    logger.info({ count: stale.length }, "Cleaned up stale worktrees");
  } catch {
    // Directory doesn't exist yet — nothing to clean
  }
}

async function main(): Promise<void> {
  const { config, logger, sql, db, embedder } = await bootstrap({ migrate: true });

  logger.info("Starting worker…");

  // Clean up stale worktrees from a previous crash
  await cleanupStaleWorktrees(config.GIT_WORKTREES_DIR, logger);

  // Start pg-boss queue
  const boss = await createQueue(config.DATABASE_URL);
  logger.info("pg-boss queue started");

  // Register the index job handler
  const deps: WorkerDeps = { db, embedder, config, logger };
  await registerIndexHandler(boss, (job) => handleIndexJob(job, deps));

  logger.info("Worker ready, listening for index jobs");

  // Graceful shutdown
  setupGracefulShutdown(logger, "worker", [async () => stopQueue(boss), async () => sql.end()]);
}

// Only run when this module is the entrypoint (not when imported by tests)
const isEntrypoint =
  process.argv[1]?.endsWith("worker/index.ts") || process.argv[1]?.endsWith("worker/index.js");

if (isEntrypoint) {
  main().catch((err) => {
    console.error("Worker failed to start:", err);
    process.exit(1);
  });
}
