/**
 * Schema migration runner.
 *
 * 1. Creates required Postgres extensions (pgvector, pg_trgm, pg_search).
 * 2. Runs Drizzle file-based migrations from the `drizzle/` folder.
 * 3. Creates the ParadeDB BM25 full-text search index (not expressible
 *    in the Drizzle schema).
 *
 * All statements are idempotent — safe to call on every startup.
 * Only the worker entrypoint should invoke this; the web and MCP servers
 * assume the schema is already up-to-date.
 *
 * The `drizzle/` folder is the single source of truth for DDL, generated
 * by `pnpm db:generate` from `schema.ts`.  The migration SQL files have
 * been made idempotent (`IF NOT EXISTS`, `DO $$ ... EXCEPTION ...`) so
 * they are safe to apply on both fresh and existing databases.
 */
import type { Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/** Relative to CWD — all entrypoints (worker, tests) run from the project root. */
const MIGRATIONS_FOLDER = "drizzle";

/**
 * Run extensions, Drizzle migrations, and custom indexes against the
 * given postgres.js client.
 *
 * @param sql - A postgres.js `Sql` instance.
 */
export async function runMigrations(sql: Sql): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`CREATE EXTENSION IF NOT EXISTS pg_search`;

  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  //    expressible in the Drizzle schema, so managed here) ──
  await sql`
    CREATE INDEX IF NOT EXISTS idx_chunks_bm25 ON chunks
    USING bm25 (id, (content::pdb.source_code))
    WITH (key_field='id')
  `;

  // Index on the FK column used by the orphan-cleanup anti-join
  // (DELETE FROM file_contents WHERE NOT EXISTS ...). Postgres does not
  // auto-index child-side FK columns; without this, the cleanup does a
  // sequential scan of ref_files per batch and can run for hours.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ref_files_file_content_id
    ON ref_files (file_content_id)
  `;
}
