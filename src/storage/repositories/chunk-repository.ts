/**
 * Repository for the `chunks` table.
 */
import { eq, isNull, isNotNull, and } from "drizzle-orm";
import { FileContentBaseRepository } from "./base-repository.js";
import { chunks } from "../schema/schema.js";
import type { Db } from "../schema/db.js";

/** A single embedding update — either a successful vector or an error. */
export interface EmbeddingUpdate {
  id: number;
  embedding: number[] | null;
  embeddingError?: string | null;
}

export class ChunkRepository extends FileContentBaseRepository<typeof chunks> {
  constructor(db: Db) {
    super(db, chunks);
  }

  /**
   * Bulk-update embeddings for multiple chunks.
   * Accepts an array of {@link EmbeddingUpdate} objects. When `embedding`
   * is `null` the chunk is marked with its `embeddingError` reason so we
   * can report which content failed to embed.
   */
  async updateEmbeddingsBatch(updates: EmbeddingUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    await this.db.transaction(async (tx) => {
      await Promise.all(
        updates.map(({ id, embedding, embeddingError }) =>
          tx
            .update(chunks)
            .set({
              embedding,
              embeddingError: embeddingError ?? null,
            })
            .where(eq(chunks.id, id)),
        ),
      );
    });
  }

  /**
   * Find all chunks that have a non-null `embeddingError` for a given
   * file content. Useful for diagnostics / the admin dashboard.
   */
  async findFailedByFileContentId(fileContentId: number): Promise<(typeof chunks.$inferSelect)[]> {
    return this.findAll(
      and(eq(chunks.fileContentId, fileContentId), isNotNull(chunks.embeddingError)),
    );
  }

  /**
   * Count chunks missing embeddings (either never embedded or failed).
   */
  async countUnembedded(): Promise<number> {
    const rows = await this.findAll(isNull(chunks.embedding));
    return rows.length;
  }
}
