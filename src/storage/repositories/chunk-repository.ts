/**
 * Repository for the `chunks` table.
 */
import { eq, inArray, isNull, isNotNull, and } from "drizzle-orm";
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
   * Find chunks without embeddings across a set of file_contents in one query.
   * Used by the pipeline to resurrect chunks from a previous crashed run.
   */
  async findUnembeddedByFileContentIds(
    fileContentIds: number[],
  ): Promise<(typeof chunks.$inferSelect)[]> {
    if (fileContentIds.length === 0) return [];
    return this.findAll(
      and(inArray(chunks.fileContentId, fileContentIds), isNull(chunks.embedding))!,
    );
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

  /**
   * Look up one embedding per unique `content_sha256` for cache reuse.
   *
   * Given a list of chunk-content hashes, returns `{hash → embedding}` for
   * hashes that already have an embedded chunk anywhere in the DB. The
   * partial index `idx_chunks_content_sha256` is filtered by
   * `embedding IS NOT NULL`, so this is a fast index-only scan.
   *
   * Used by the pipeline to skip re-embedding byte-identical chunks — the
   * common case when a file's file-level sha changes but most of its
   * chunks (e.g. individual functions) are unchanged.
   */
  async findEmbeddingsByContentSha256(hashes: string[]): Promise<Map<string, number[]>> {
    if (hashes.length === 0) return new Map();
    const unique = [...new Set(hashes)];
    const rows = await this.db
      .select({ contentSha256: chunks.contentSha256, embedding: chunks.embedding })
      .from(chunks)
      .where(and(inArray(chunks.contentSha256, unique), isNotNull(chunks.embedding)));

    // There may be many rows per hash; keep the first embedding seen.
    const result = new Map<string, number[]>();
    for (const row of rows) {
      if (row.contentSha256 && row.embedding && !result.has(row.contentSha256)) {
        result.set(row.contentSha256, row.embedding);
      }
    }
    return result;
  }
}
