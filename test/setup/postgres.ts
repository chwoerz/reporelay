import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import postgres from "postgres";

let container: StartedTestContainer;
let sql: postgres.Sql;

const MAX_RETRIES = 5;

/**
 * Attempts to start the ParadeDB container once.
 *
 * Uses a composite wait strategy (log message + listening ports) to ensure both
 * the Postgres process and its host port binding are fully ready before returning.
 */
async function tryStartContainer(): Promise<StartedTestContainer> {
  return new GenericContainer("paradedb/paradedb:latest")
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_DB: "reporelay_test",
      POSTGRES_USER: "reporelay",
      POSTGRES_PASSWORD: "reporelay",
    })
    .withWaitStrategy(
      Wait.forAll([
        Wait.forListeningPorts(),
        Wait.forLogMessage(/database system is ready to accept connections/, 2),
      ]).withDeadline(120_000),
    )
    .start();
}

/**
 * Starts a ParadeDB container and returns a postgres.js client.
 * Enables pgvector, pg_trgm, and pg_search (BM25) extensions automatically.
 *
 * Retries container startup up to {@link MAX_RETRIES} times to work around
 * transient Docker Desktop port-binding race conditions where the host port
 * is not immediately available after `docker start`.
 */
export async function startPostgres() {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      container = await tryStartContainer();
      break;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        console.warn(
          `[test-setup] Container startup attempt ${attempt}/${MAX_RETRIES} failed, retrying...`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  if (!container) {
    throw lastError ?? new Error("Failed to start ParadeDB container");
  }

  const port = container.getMappedPort(5432);
  const host = container.getHost();

  sql = postgres({
    host,
    port,
    database: "reporelay_test",
    username: "reporelay",
    password: "reporelay",
  });

  // Enable extensions needed by the app
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`CREATE EXTENSION IF NOT EXISTS pg_search`;

  return { sql, host, port };
}

export async function stopPostgres() {
  if (sql) await sql.end();
  if (container) await container.stop();
}

export function getSql() {
  return sql;
}

export function getConnectionString() {
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return `postgresql://reporelay:reporelay@${host}:${port}/reporelay_test`;
}
