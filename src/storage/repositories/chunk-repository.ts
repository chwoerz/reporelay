/**
 * Repository for the `chunks` table.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { FileContentBaseRepository } from "./base-repository.js";
import { chunks } from "../schema/schema.js";
import type { Db } from "../schema/db.js";

/** A single embedding update — either a successful vector or an error. */
export interface EmbeddingUpdate {
  id: number;
  embedding: number[] | null;
  embeddingError?: string | null;
}

const HASH_LOOKUP_BATCH_SIZE = 1_000;

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }

  return batches;
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
   * Look up one embedding per unique `content_sha256` for cache reuse.
   *
   * Given a list of chunk-content hashes, returns `{hash → embedding}` for
   * hashes that already have an embedded chunk anywhere in the DB.
   *
   * Hashes are looked up in conservative batches to avoid Postgres / driver
   * limits around large generated expressions and bind parameter counts.
   *
   * `DISTINCT ON` keeps one row per hash at the DB level — without it, a hot
   * hash with thousands of chunks could stream thousands of large vectors into
   * memory just so we could drop all but the first.
   */
  async findEmbeddingsByContentSha256(hashes: string[]): Promise<Map<string, number[]>> {
    if (hashes.length === 0) return new Map();

    const uniqueHashes = [...new Set(hashes)];
    const result = new Map<string, number[]>();

    const hashBatches = chunkArray(uniqueHashes, HASH_LOOKUP_BATCH_SIZE);

    console.log(
      `Looking up embeddings for ${hashes.length} hashes ` +
        `(${uniqueHashes.length} unique) in ${hashBatches.length} batches...`,
    );

    for (const hashBatch of hashBatches) {
      const rows = await this.db
        .selectDistinctOn([chunks.contentSha256], {
          contentSha256: chunks.contentSha256,
          embedding: chunks.embedding,
        })
        .from(chunks)
        .where(and(inArray(chunks.contentSha256, hashBatch), isNotNull(chunks.embedding)))
        .orderBy(chunks.contentSha256, chunks.id);

      for (const row of rows) {
        if (row.contentSha256 && row.embedding) {
          result.set(row.contentSha256, row.embedding);
        }
      }
    }

    return result;
  }
}
