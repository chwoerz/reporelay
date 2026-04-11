/**
 * Shared bootstrap and graceful-shutdown utilities for all entrypoints
 * (MCP server, web server, worker).
 *
 * Centralises the repeated config → logger → postgres → db → embedder
 * sequence and the SIGTERM/SIGINT shutdown handler.
 *
 * Only the worker runs migrations (Drizzle file-based from `drizzle/`) —
 * the web and MCP servers assume the schema is already up-to-date.
 */
import postgres, { type Sql } from "postgres";
import { asyncExitHook, gracefulExit } from "exit-hook";
import { loadConfig, type Config } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { createDb, type Db } from "../storage/index.js";
import { runMigrations } from "../storage/index.js";
import { createEmbedder, OPENAI_DEFAULT_BASE_URL, type Embedder, type EmbedderOptions } from "../indexer/embedder.js";


const OLLAMA_DEFAULT_URL = "http://localhost:11434";


/** Keys whose values must be redacted in log output. */
const SECRET_KEYS = ["DATABASE_URL", "OPENAI_API_KEY"];
const SECRET_PATTERN = /^GIT_TOKEN_/;

/**
 * Return a shallow copy of the config with secrets replaced by a
 * `"****<last4>"` placeholder (or `"(unset)"` when undefined).
 */
export function redactConfig(config: Config): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => {
      if (SECRET_KEYS.includes(key) || SECRET_PATTERN.test(key)) {
        return [key, typeof value === "string" && value.length > 4 ? `****${value.slice(-4)}` : "****"];
      }
      return [key, value];
    }),
  );
}


export interface BootstrapOptions {
  /** When true, run Drizzle migrations before returning. Only the worker should set this. */
  migrate?: boolean;
}


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

  logger.info({ config: redactConfig(config) }, "Configuration loaded");

  const sql = postgres(config.DATABASE_URL);

  if (opts.migrate) {
    await runMigrations(sql);
  }

  const db = createDb(sql);

  const embedderOptions: EmbedderOptions =
    config.EMBEDDING_PROVIDER === "openai"
      ? {
          provider: "openai",
          apiKey: config.OPENAI_API_KEY!,
          model: config.EMBEDDING_MODEL,
          baseUrl: config.EMBEDDING_URL ?? OPENAI_DEFAULT_BASE_URL,
          dimensions: config.EMBEDDING_DIMENSIONS,
        }
      : {
          provider: "ollama",
          url: config.EMBEDDING_URL ?? OLLAMA_DEFAULT_URL,
          model: config.EMBEDDING_MODEL,
        };

  const embedder = createEmbedder(embedderOptions);

  await embedder.init();

  if (embedder.initError) {
    logger.warn(
      {
        error: embedder.initError,
        provider: config.EMBEDDING_PROVIDER,
        model: config.EMBEDDING_MODEL,
      },
      "Embedder probe failed — search and embedding features will be unavailable until the embedding provider is reachable",
    );
  }

  return { config, logger, sql, db, embedder };
}


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
