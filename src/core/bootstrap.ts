/**
 * Shared bootstrap and graceful-shutdown utilities for all entrypoints
 * (MCP server, web server, worker).
 *
 * Centralises the repeated config → logger → postgres → db → embedder
 * sequence and the SIGTERM/SIGINT shutdown handler.
 *
 * Only the worker runs migrations — the web and MCP servers assume the
 * schema is already up-to-date.
 */
import postgres, { type Sql } from "postgres";
import { asyncExitHook, gracefulExit } from "exit-hook";
import { loadConfig, type Config } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { createDb, type Db } from "../storage/index.js";
import { runMigrations } from "../storage/index.js";
import { createEmbedder, type Embedder } from "../indexer/embedder.js";

// ── Bootstrap options ──

export interface BootstrapOptions {
  /** When true, run Drizzle migrations before returning. Only the worker should set this. */
  migrate?: boolean;
}

// ── Bootstrap result ──

export interface BootstrapResult {
  config: Config;
  logger: Logger;
  sql: Sql;
  db: Db;
  embedder: Embedder;
}

/**
 * Shared startup sequence used by all three entrypoints:
 *
 * 1. Load + validate config from env
 * 2. Create Pino logger
 * 3. Open Postgres connection
 * 4. Run Drizzle migrations (only when `opts.migrate` is true)
 * 5. Create Drizzle DB instance
 * 6. Create embedding provider
 */
export async function bootstrap(opts: BootstrapOptions = {}): Promise<BootstrapResult> {
  const config = loadConfig();
  const logger = createLogger(config);
  const sql = postgres(config.DATABASE_URL);

  if (opts.migrate) {
    await runMigrations(sql);
  }

  const db = createDb(sql);
  const embedder = createEmbedder(config.EMBEDDING_PROVIDER, {
    url: config.EMBEDDING_URL,
    model: config.EMBEDDING_MODEL,
  });

  await embedder.init();

  return { config, logger, sql, db, embedder };
}

// ── Graceful shutdown ──

/**
 * Register async cleanup functions that run on SIGTERM/SIGINT via `exit-hook`.
 * Uses `asyncExitHook` so cleanup can be awaited, then exits cleanly.
 */
export function setupGracefulShutdown(
  logger: Logger,
  label: string,
  cleanupFns: Array<() => Promise<void>>,
): void {
  asyncExitHook(
    async () => {
      logger.info(`Shutting down ${label}…`);

      for (const fn of cleanupFns) {
        await fn().catch((err) => logger.error({ err }, `Cleanup error in ${label}`));
      }

      logger.info(`${label} stopped`);
    },
    { wait: 10_000 },
  );
}
