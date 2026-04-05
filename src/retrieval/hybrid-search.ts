/**
 * Hybrid search built from two independent retrieval strategies:
 *
 * 1. BM25 full-text search via ParadeDB / pg_search
 * 2. Vector similarity search via pgvector
 *
 * The two ranked result sets are fused with Reciprocal Rank Fusion (RRF).
 *
 * Why this design:
 * - BM25 is strong for exact words, symbols, and literal phrases
 * - vector search is strong for semantic similarity
 * - RRF combines both without relying on raw score normalization
 *
 * Important implementation choices:
 * - repo/ref filtering is applied inside each retrieval branch before top-k
 * - overlap dedup is done in JS after retrieval
 * - SQL is split into small builders so the main search function is readable
 */
import { sql } from "drizzle-orm";
import type { Db } from "../storage/index.js";
import type { Embedder } from "../indexer/embedder.js";
import type { SearchResult } from "../core/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tuning constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard RRF smoothing constant.
 *
 * Larger values reduce the extra reward given to very top-ranked items.
 * 60 is the commonly used default in the IR literature.
 */
const RRF_K = 60;

/** Default number of final results returned to callers. */
const DEFAULT_LIMIT = 20;

/** Hard upper bound to avoid accidental expensive searches. */
const MAX_LIMIT = 100;

/**
 * We intentionally over-fetch from each branch because overlapping chunks
 * will later be removed in JS. Without over-fetching, dedup could leave us
 * with too few final results.
 */
const OVERFETCH_MULTIPLIER = 3;

/** Absolute cap on branch-local retrieval volume. */
const MAX_FETCH = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query text after lightweight rewriting.
 *
 * We keep separate text for:
 * - BM25: often best with the literal user query
 * - embeddings: sometimes better with a lightly normalized form
 */
export interface RewrittenQuery {
  /** Text passed into ParadeDB / pg_search. */
  ftsText: string;

  /** Text passed to the embedder for semantic search. */
  embeddingText: string;
}

/**
 * User-facing hybrid search options.
 */
export interface HybridSearchOptions {
  /** Raw user query. */
  query: string;

  /** Optional repo filter. */
  repo?: string;

  /** Optional ref / branch filter. */
  ref?: string;

  /** Max final results to return after dedup. */
  limit?: number;

  /** Optional language filter — only return chunks from files in these languages. */
  languages?: string[];
}

/**
 * Raw row shape returned by the SQL query.
 *
 * The final SQL returns database-native column names, which are converted
 * into the application's SearchResult shape by mapSearchRow().
 */
type SearchRow = {
  chunk_id: number;
  file_path: string;
  repo: string;
  ref: string;
  content: string;
  start_line: number;
  end_line: number;
  score: number | string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Query preprocessing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split the raw user query into:
 * - FTS text for BM25
 * - embedding text for semantic retrieval
 *
 * Current behavior is intentionally conservative:
 * - preserve the original text for BM25
 * - remove quote wrappers for embedding input
 *
 * Returns null when the query is empty after trimming.
 */
export function rewriteQuery(raw: string): RewrittenQuery | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  return {
    ftsText: trimmed,
    embeddingText: trimmed.replace(/"([^"]+)"/g, "$1"),
  };
}

/**
 * Normalize BM25 query text before sending it to pg_search.
 *
 * This is intentionally not a full parser. It only removes control
 * characters and collapses whitespace.
 *
 * We avoid aggressive sanitization because over-sanitizing search queries
 * often hurts relevance more than it helps.
 */
export function sanitizeBm25Query(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clamp the user-provided limit into a safe range.
 */
function clampLimit(limit?: number): number {
  const n = limit ?? DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL predicate / fragment builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the repo/ref/language predicate used by both retrieval branches.
 *
 * Important:
 * - this returns only a boolean predicate
 * - it never includes the WHERE keyword
 *
 * That makes it composable with different branch-specific conditions.
 */
function buildMetadataPredicate(repo?: string, ref?: string, languages?: string[]) {
  const parts: ReturnType<typeof sql>[] = [];

  if (repo) parts.push(sql`r.name = ${repo}`);
  if (ref) parts.push(sql`rr.ref = ${ref}`);
  if (languages && languages.length > 0) {
    parts.push(
      sql`fc.language IN (${sql.join(
        languages.map((l) => sql`${l}`),
        sql`, `,
      )})`,
    );
  }

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return parts.reduce((acc, part) => sql`${acc} AND ${part}`);
}

/**
 * Shared join block that resolves chunk metadata:
 * - file path
 * - repo
 * - ref
 *
 * Both BM25 and vector retrieval need the same joins, so we keep them in one
 * place to reduce drift between branches.
 */
function buildRepoJoins() {
  return sql`
    FROM chunks c
    JOIN file_contents fc ON fc.id = c.file_content_id
    JOIN ref_files rf ON rf.file_content_id = fc.id
    JOIN repo_refs rr ON rr.id = rf.repo_ref_id
    JOIN repos r ON r.id = rr.repo_id
  `;
}

/**
 * Build the BM25 retrieval subquery.
 *
 * This branch:
 * - uses ParadeDB / pg_search full-text search
 * - applies repo/ref filters before top-k truncation
 * - ranks by pdb.score(c.id)
 *
 * We query directly against the base table column `c.content`, because
 * pg_search / ParadeDB operators are safest and clearest when applied to
 * real indexed table columns rather than CTE aliases.
 */
function buildBm25HitsCte(args: {
  bm25Query: string;
  metadataPredicate: ReturnType<typeof buildMetadataPredicate>;
  fetchLimit: number;
}) {
  const { bm25Query, metadataPredicate, fetchLimit } = args;
  const repoJoins = buildRepoJoins();

  const whereClause = metadataPredicate
    ? sql`WHERE ${metadataPredicate} AND c.content @@@ ${bm25Query}`
    : sql`WHERE c.content @@@ ${bm25Query}`;

  return sql`
    SELECT
      c.id AS chunk_id,
      c.file_content_id,
      c.content,
      c.start_line,
      c.end_line,
      rf.path AS file_path,
      r.name AS repo,
      rr.ref AS ref,
      ROW_NUMBER() OVER (
        ORDER BY pdb.score(c.id) DESC, c.id ASC
      ) AS bm25_rank
    ${repoJoins}
    ${whereClause}
    ORDER BY pdb.score(c.id) DESC, c.id ASC
    LIMIT ${fetchLimit}
  `;
}

/**
 * Empty BM25 subquery used when the text query becomes empty.
 *
 * This preserves the CTE shape so the surrounding SQL stays simple while
 * effectively disabling the BM25 branch.
 */
function buildEmptyBm25HitsCte() {
  return sql`
    SELECT
      NULL::bigint AS chunk_id,
      NULL::bigint AS file_content_id,
      NULL::text AS content,
      NULL::integer AS start_line,
      NULL::integer AS end_line,
      NULL::text AS file_path,
      NULL::text AS repo,
      NULL::text AS ref,
      NULL::bigint AS bm25_rank
    WHERE false
  `;
}

/**
 * Build the vector retrieval subquery.
 *
 * This branch:
 * - filters to rows with non-null embeddings
 * - applies repo/ref filters before top-k truncation
 * - ranks by pgvector distance
 *
 * Lower distance means higher similarity, so ordering is ascending.
 */
function buildVectorHitsCte(args: {
  metadataPredicate: ReturnType<typeof buildMetadataPredicate>;
  vectorParam: string;
  fetchLimit: number;
}) {
  const { metadataPredicate, vectorParam, fetchLimit } = args;
  const repoJoins = buildRepoJoins();

  const whereClause = metadataPredicate
    ? sql`WHERE ${metadataPredicate} AND c.embedding IS NOT NULL`
    : sql`WHERE c.embedding IS NOT NULL`;

  return sql`
    SELECT
      c.id AS chunk_id,
      c.file_content_id,
      c.content,
      c.start_line,
      c.end_line,
      rf.path AS file_path,
      r.name AS repo,
      rr.ref AS ref,
      ROW_NUMBER() OVER (
        ORDER BY (c.embedding <=> ${vectorParam}::vector) ASC, c.id ASC
      ) AS vector_rank
    ${repoJoins}
    ${whereClause}
    ORDER BY (c.embedding <=> ${vectorParam}::vector) ASC, c.id ASC
    LIMIT ${fetchLimit}
  `;
}

/**
 * Build the fusion subquery.
 *
 * RRF operates on ranks, not raw scores:
 *   1 / (k + rank_bm25) + 1 / (k + rank_vector)
 *
 * Why this is useful:
 * - BM25 scores and vector distances live on very different scales
 * - rank-based fusion avoids score normalization issues
 *
 * We join on chunk identity plus metadata identity so the same chunk appearing
 * under different repo/ref/path contexts does not get collapsed incorrectly.
 */
function buildFusedCte() {
  return sql`
    SELECT
      COALESCE(b.chunk_id, v.chunk_id) AS chunk_id,
      COALESCE(b.content, v.content) AS content,
      COALESCE(b.start_line, v.start_line) AS start_line,
      COALESCE(b.end_line, v.end_line) AS end_line,
      COALESCE(b.file_path, v.file_path) AS file_path,
      COALESCE(b.repo, v.repo) AS repo,
      COALESCE(b.ref, v.ref) AS ref,
      COALESCE(1.0 / (${RRF_K} + b.bm25_rank), 0.0) +
      COALESCE(1.0 / (${RRF_K} + v.vector_rank), 0.0) AS score
    FROM bm25_hits b
    FULL OUTER JOIN vector_hits v
      ON b.chunk_id = v.chunk_id
     AND b.repo = v.repo
     AND b.ref = v.ref
     AND b.file_path = v.file_path
  `;
}

/**
 * Final result projection after fusion.
 *
 * We keep ordering deterministic by adding chunk_id as a secondary sort key.
 */
function buildFinalSelect(fetchLimit: number) {
  return sql`
    SELECT
      chunk_id,
      file_path,
      repo,
      ref,
      content,
      start_line,
      end_line,
      score
    FROM fused
    ORDER BY score DESC, chunk_id ASC
    LIMIT ${fetchLimit}
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove overlapping chunks from the same repo/ref/file.
 *
 * Assumption:
 * - higher-scored results should win
 *
 * So we sort by descending score first, then keep the first chunk whose
 * line range does not overlap an already-kept chunk in the same file context.
 *
 * This stays in JS because:
 * - the result set is already small after top-k retrieval
 * - SQL overlap suppression would be harder to understand and maintain
 */
export function dedupOverlapping(results: SearchResult[]): SearchResult[] {
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const kept: SearchResult[] = [];
  const byFile = new Map<string, SearchResult[]>();

  for (const r of sorted) {
    const key = `${r.repo}\u0000${r.ref}\u0000${r.filePath}`;
    const existing = byFile.get(key) ?? [];

    const overlaps = existing.some((k) => k.startLine <= r.endLine && k.endLine >= r.startLine);

    if (!overlaps) {
      kept.push(r);
      existing.push(r);
      byFile.set(key, existing);
    }
  }

  return kept;
}

/**
 * Convert a database row into the public SearchResult shape.
 */
export function mapSearchRow(row: SearchRow): SearchResult {
  return {
    filePath: row.file_path,
    repo: row.repo,
    ref: row.ref,
    content: row.content,
    startLine: row.start_line,
    endLine: row.end_line,
    score: typeof row.score === "string" ? Number(row.score) : row.score,
    symbolName: undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main search entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run hybrid retrieval for a user query.
 *
 * High-level flow:
 * 1. rewrite and normalize the raw query
 * 2. embed the semantic version of the query
 * 3. build BM25 and vector retrieval subqueries
 * 4. fuse both ranked result sets with RRF
 * 5. deduplicate overlapping chunks
 * 6. return the top final results
 */
export async function searchHybrid(
  db: Db,
  embedder: Embedder,
  options: HybridSearchOptions,
): Promise<SearchResult[]> {
  const { query: raw, repo, ref, languages } = options;

  // Reject empty or whitespace-only queries early.
  const rewritten = rewriteQuery(raw);
  if (!rewritten) return [];

  // Prepare BM25-safe text.
  const bm25Query = sanitizeBm25Query(rewritten.ftsText);

  // Clamp user-provided limits and compute branch-local over-fetch.
  const limit = clampLimit(options.limit);
  const fetchLimit = Math.min(limit * OVERFETCH_MULTIPLIER, MAX_FETCH);

  // Build shared repo/ref/language filter predicate used by both branches.
  const metadataPredicate = buildMetadataPredicate(repo, ref, languages);

  // Compute the vector embedding for semantic retrieval.
  const [queryEmbedding] = await embedder.embed([rewritten.embeddingText]);
  if (!queryEmbedding.length) {
    throw new Error("Failed to generate query embedding");
  }

  /**
   * pgvector accepts text input cast to vector, e.g. '[1,2,3]'::vector.
   * We keep this serialization local so the rest of the function works with
   * normal JS arrays.
   */
  const vectorParam = `[${queryEmbedding.join(",")}]`;

  // Build the BM25 retrieval branch. If BM25 text is empty, disable that branch.
  const bm25HitsCte = bm25Query
    ? buildBm25HitsCte({
        bm25Query,
        metadataPredicate,
        fetchLimit,
      })
    : buildEmptyBm25HitsCte();

  // Build the vector retrieval branch.
  const vectorHitsCte = buildVectorHitsCte({
    metadataPredicate,
    vectorParam,
    fetchLimit,
  });

  // Build rank fusion and final result projection.
  const fusedCte = buildFusedCte();
  const finalSelect = buildFinalSelect(fetchLimit);

  // Execute the combined query.
  const rows = await db.execute<SearchRow>(sql`
    WITH
    bm25_hits AS (
      ${bm25HitsCte}
    ),
    vector_hits AS (
      ${vectorHitsCte}
    ),
    fused AS (
      ${fusedCte}
    )
    ${finalSelect}
  `);

  // Remove overlapping chunks and enforce the final caller-visible limit.
  return dedupOverlapping(rows.map(mapSearchRow)).slice(0, limit);
}
