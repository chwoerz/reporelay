/**
 * Repository for the `chunks` table.
 */
import { and, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { FileContentBaseRepository } from "./base-repository.js";
import { chunks } from "../schema/schema.js";
import type { Db } from "../schema/db.js";
import { IN_LIST_BATCH_SIZE, computeInsertBatchSize, inBatches } from "../batching.js";

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
   *
   * Issues a single `UPDATE … FROM (VALUES …)` per batch instead of one
   * statement per row — one round-trip replaces N, which matters a lot when
   * each row carries a 768-dim vector payload.
   */
  async updateEmbeddingsBatch(updates: EmbeddingUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    const batchSize = computeInsertBatchSize(
      updates as unknown as readonly Record<string, unknown>[],
    );

    await this.db.transaction(async (tx) => {
      await inBatches(updates, batchSize, async (batch) => {
        const rows = batch.map(({ id, embedding, embeddingError }) => {
          const emb = embedding === null ? null : `[${embedding.join(",")}]`;
          return sql`(${id}::int, ${emb}::text, ${embeddingError ?? null}::text)`;
        });
        await tx.execute(sql`
          UPDATE chunks
          SET embedding = v.embedding::vector,
              embedding_error = v.embedding_error
          FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(id, embedding, embedding_error)
          WHERE chunks.id = v.id
        `);
      });
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
    const batchCount = Math.ceil(uniqueHashes.length / IN_LIST_BATCH_SIZE);

    console.log(
      `Looking up embeddings for ${hashes.length} hashes ` +
        `(${uniqueHashes.length} unique) in ${batchCount} batches...`,
    );

    await inBatches(uniqueHashes, IN_LIST_BATCH_SIZE, async (hashBatch) => {
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
    });

    return result;
  }
}
