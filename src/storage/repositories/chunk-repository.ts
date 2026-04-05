/**
 * Repository for the `chunks` table.
 */
import { eq } from "drizzle-orm";
import { FileContentBaseRepository } from "./base-repository.js";
import { chunks } from "../schema/schema.js";
import type { Db } from "../schema/db.js";

export class ChunkRepository extends FileContentBaseRepository<typeof chunks> {
  constructor(db: Db) {
    super(db, chunks);
  }

  /**
   * Bulk-update embeddings for multiple chunks.
   * Accepts an array of { id, embedding } pairs.
   */
  async updateEmbeddingsBatch(updates: { id: number; embedding: number[] }[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await Promise.all(
        updates.map(({ id, embedding }) =>
          tx.update(chunks).set({ embedding }).where(eq(chunks.id, id)),
        ),
      );
    });
  }
}
