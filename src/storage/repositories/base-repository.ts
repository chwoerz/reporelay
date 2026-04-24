/**
 * Generic base repository providing shared CRUD operations.
 *
 * All entity repositories extend this class, inheriting insert, find, update,
 * and delete methods. Entity-specific queries are added in subclasses.
 */
import { eq, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "../schema/db.js";
import { computeInsertBatchSize, inBatches } from "../batching.js";

/**
 * Constraint: every table managed by BaseRepository must have an `id` serial column.
 */
type TableWithId = PgTable & { id: any };

/**
 * Constraint: tables that also have a `fileContentId` foreign key column.
 */
type TableWithFileContentId = TableWithId & { fileContentId: any };

export abstract class BaseRepository<T extends TableWithId> {
  constructor(
    protected readonly db: Db,
    protected readonly table: T,
  ) {}

  /**
   * Insert a single row and return it (with generated id, defaults, etc.).
   */
  async insertOne(data: T["$inferInsert"]): Promise<T["$inferSelect"]> {
    const [row] = await this.db
      .insert(this.table)
      .values(data as any)
      .returning();
    return row as T["$inferSelect"];
  }

  /**
   * Insert multiple rows and return them.
   *
   * Large multi-row INSERT statements can exceed Postgres / driver limits
   * because the number of generated bind parameters is roughly:
   *
   *   rows * inserted columns
   *
   * Batching also avoids very wide generated row expressions.
   */
  async insertMany(data: T["$inferInsert"][]): Promise<T["$inferSelect"][]> {
    if (data.length === 0) return [];

    const batchSize = computeInsertBatchSize(
      data as unknown as readonly Record<string, unknown>[],
    );

    const insertedRows: T["$inferSelect"][] = [];

    await this.db.transaction(async (tx) => {
      await inBatches(data, batchSize, async (batch) => {
        const rows = await tx
          .insert(this.table)
          .values(batch as any)
          .returning();
        insertedRows.push(...(rows as T["$inferSelect"][]));
      });
    });

    return insertedRows;
  }

  /**
   * Find all rows, optionally filtered by a WHERE clause.
   */
  async findAll(where?: SQL): Promise<T["$inferSelect"][]> {
    const q = this.db.select().from(this.table);
    if (where) {
      return (await q.where(where)) as T["$inferSelect"][];
    }
    return (await q) as T["$inferSelect"][];
  }

  /**
   * Find the first matching row, or undefined.
   */
  async findOne(where: SQL): Promise<T["$inferSelect"] | undefined> {
    const rows = await this.db.select().from(this.table).where(where).limit(1);
    return rows[0] as T["$inferSelect"] | undefined;
  }

  /**
   * Find a single row by its primary key `id`.
   */
  async findById(id: number): Promise<T["$inferSelect"] | undefined> {
    return this.findOne(eq(this.table.id, id));
  }

  /**
   * Delete rows matching the WHERE clause.
   */
  async deleteWhere(where: SQL): Promise<void> {
    await this.db.delete(this.table).where(where);
  }

  /**
   * Update rows matching the WHERE clause and return the updated rows.
   */
  async updateWhere(where: SQL, data: Partial<T["$inferInsert"]>): Promise<T["$inferSelect"][]> {
    const rows = await this.db
      .update(this.table)
      .set(data as any)
      .where(where)
      .returning();
    return rows as T["$inferSelect"][];
  }
}

/**
 * Extended base for tables that have a `file_content_id` FK column.
 * Provides the shared `findByFileContentId` query.
 */
export abstract class FileContentBaseRepository<
  T extends TableWithFileContentId,
> extends BaseRepository<T> {
  async findByFileContentId(fileContentId: number): Promise<T["$inferSelect"][]> {
    return this.findAll(eq(this.table.fileContentId, fileContentId));
  }
}
