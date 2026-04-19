/**
 * Repository for the `file_contents` table.
 */
import { eq, inArray, sql } from "drizzle-orm";
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

  async findManyBySha256(hashes: string[]): Promise<FileContentSelect[]> {
    if (hashes.length === 0) return [];
    return this.findAll(inArray(fileContents.sha256, hashes));
  }

  /**
   * Delete all file_contents rows that are no longer referenced by any ref_files.
   * Symbols, chunks, and imports cascade-delete automatically.
   * Returns the number of deleted rows.
   *
   * Uses a LEFT JOIN anti-pattern backed by idx_ref_files_file_content_id
   * (see migrate.ts). Each batch runs under a per-statement timeout so a
   * pathological plan can't block migrations/indexing for hours.
   */
  async deleteOrphans(): Promise<number> {
    const BATCH_SIZE = 1000;
    const BATCH_TIMEOUT_MS = 30_000;
    let totalDeleted = 0;

    for (;;) {
      const deleted = await this.db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${BATCH_TIMEOUT_MS}`));
        const result = await tx.execute(sql`
          DELETE FROM file_contents
          WHERE id IN (
            SELECT fc.id
            FROM   file_contents fc
            LEFT JOIN ref_files rf ON rf.file_content_id = fc.id
            WHERE  rf.file_content_id IS NULL
            LIMIT  ${BATCH_SIZE}
          )
        `);
        return Number((result as { rowCount?: number }).rowCount ?? 0);
      });

      totalDeleted += deleted;
      if (deleted < BATCH_SIZE) break;
    }

    return totalDeleted;
  }
}
