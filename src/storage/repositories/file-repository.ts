/**
 * Repository for the `file_contents` table.
 */
import { eq, sql } from "drizzle-orm";
import { BaseRepository } from "./base-repository.js";
import { fileContents, type FileContentSelect } from "../schema/schema.js";
import type { Db } from "../schema/db.js";

export class FileContentRepository extends BaseRepository<typeof fileContents> {
  constructor(db: Db) {
    super(db, fileContents);
  }

  async findBySha256(sha256: string): Promise<FileContentSelect | undefined> {
    return this.findOne(eq(fileContents.sha256, sha256));
  }

  /**
   * Delete all file_contents rows that are no longer referenced by any ref_files.
   * Symbols, chunks, and imports cascade-delete automatically.
   * Returns the number of deleted rows.
   *
   * Uses NOT EXISTS (efficient anti-join) instead of NOT IN, and processes
   * in batches to keep lock windows short and avoid blocking concurrent
   * indexing operations.
   */
  async deleteOrphans(): Promise<number> {
    const BATCH_SIZE = 1000;
    let totalDeleted = 0;

    for (;;) {
      const result = await this.db.execute(sql`
        DELETE FROM file_contents
        WHERE id IN (
          SELECT fc.id
          FROM   file_contents fc
          WHERE  NOT EXISTS (
            SELECT 1 FROM ref_files rf WHERE rf.file_content_id = fc.id
          )
          LIMIT ${BATCH_SIZE}
        )
      `);

      const deleted = Number((result as any).rowCount ?? 0);
      totalDeleted += deleted;
      if (deleted < BATCH_SIZE) break;
    }

    return totalDeleted;
  }
}
