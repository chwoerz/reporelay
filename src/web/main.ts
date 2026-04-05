/**
 * Web server entrypoint.
 *
 * Bootstraps DB, creates embedder, starts pg-boss, then starts the
 * Fastify HTTP server. Migrations are handled by the worker.
 */
import { bootstrap, setupGracefulShutdown } from "../core/index.js";
import { createQueue } from "../storage/index.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const { config, logger, sql, db, embedder } = await bootstrap();

  logger.info("Starting web server…");

  // Start pg-boss — timeout after 15 s to surface hangs early
  logger.info("Starting pg-boss…");
  const boss = await Promise.race([
    createQueue(config.DATABASE_URL),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("pg-boss start timed out after 15s")), 15_000),
    ),
  ]);
  logger.info("pg-boss ready");

  // Build and start Fastify
  const app = buildApp({ db, boss, embedder, config, logger });
  await app.listen({ port: config.WEB_PORT, host: "0.0.0.0" });

  logger.info({ port: config.WEB_PORT }, "Web server listening");

  // Graceful shutdown
  setupGracefulShutdown(logger, "web server", [
    async () => app.close(),
    async () => boss.stop({ graceful: true }),
    async () => sql.end(),
  ]);
}

main().catch((err) => {
  console.error("Web server failed to start:", err);
  process.exit(1);
});
