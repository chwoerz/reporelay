/**
 * Programmatic migration runner.
 *
 * 1. Creates required Postgres extensions (pgvector, pg_trgm, pg_search).
 * 2. Runs Drizzle generated migrations from the `drizzle/` folder.
 * 3. Creates the ParadeDB BM25 index on chunks.content for full-text search.
 *
 * All statements are idempotent — safe to call on every startup.
 * Only the worker entrypoint should invoke this; the web and MCP servers
 * assume the schema is already up-to-date.
 */
import type { Sql } from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./db.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve the drizzle migrations folder relative to project root. */
function getMigrationsFolder(): string {
  // From src/storage/schema/migrate.ts  → ../../../drizzle  (3 levels to project root)
  // From dist/src/storage/schema/migrate.js → ../../../../drizzle (4 levels to project root)
  const levels = __dirname.includes(path.join("dist", "src")) ? 4 : 3;
  const segments = Array.from<string>({ length: levels }).fill("..");
  return path.resolve(__dirname, ...segments, "drizzle");
}

/**
 * Run all migrations against the given postgres.js client.
 *
 * @param sql - A postgres.js `Sql` instance.
 */
export async function runMigrations(sql: Sql): Promise<void> {
  // 1. Enable required extensions
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await sql`CREATE EXTENSION IF NOT EXISTS pg_search`;

  // 2. Run Drizzle generated migrations
  const db = createDb(sql);
  await migrate(db, { migrationsFolder: getMigrationsFolder() });

  // 3. Create ParadeDB BM25 index on chunks.content (idempotent via IF NOT EXISTS)
  //    Uses the source_code tokenizer for camelCase/snake_case splitting.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_chunks_bm25 ON chunks
    USING bm25 (id, (content::pdb.source_code))
    WITH (key_field='id')
  `;
}
