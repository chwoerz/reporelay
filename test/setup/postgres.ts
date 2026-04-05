import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import postgres from "postgres";

let container: StartedTestContainer;
let sql: postgres.Sql;

/**
 * Starts a ParadeDB container and returns a postgres.js client.
 * Enables pgvector, pg_trgm, and pg_search (BM25) extensions automatically.
 */
export async function startPostgres() {
  container = await new GenericContainer("paradedb/paradedb:latest")
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_DB: "reporelay_test",
      POSTGRES_USER: "reporelay",
      POSTGRES_PASSWORD: "reporelay",
    })
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

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
