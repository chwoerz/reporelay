/**
 * Drizzle database connection factory.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * Create a typed Drizzle instance from an existing postgres.js `Sql` client.
 * Use this in both production and tests.
 */
export function createDb(sql: Sql): Db {
  return drizzle(sql, { schema });
}
