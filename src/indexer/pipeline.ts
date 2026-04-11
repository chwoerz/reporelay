/**
 * Indexing pipeline orchestrator.
 *
 * Takes a checked-out worktree path + file list and produces stored
 * file_contents, ref_files, symbols, chunks with embeddings.
 *
 * Designed to be called by the pg-boss job handler.
 * Git sync / worktree checkout happen externally.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  ChunkRepository,
  Db,
  FileContentRepository,
  ImportRepository,
  RefFileRepository,
  RepoRefRepository,
  repoRefs,
  SymbolRepository,
} from "../storage/index.js";
import { buildIgnoreFilterFromRepo, classifyLanguage, filterIgnored } from "../git/index.js";
import { parse } from "../parser/index.js";
import { chunkFile, type ChunkOutput } from "./chunker.js";
import { type Embedder, type EmbedBatchResult, embedInBatches } from "./embedder.js";
import type { Language, LanguageStats, ParsedImport, ParsedSymbol } from "../core/types.js";

// ── Types ──

/** Thrown when the pipeline detects that the ref was deleted mid-run. */
export class PipelineCancelledError extends Error {
  constructor(repoRefId: number) {
    super(`Pipeline cancelled: repo_ref ${repoRefId} was deleted during indexing`);
    this.name = "PipelineCancelledError";
  }
}

/** Default maximum file size in bytes (1 MB). Files larger than this are skipped. */
export const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;

/** Default maximum average line length. Files above this are likely minified/generated. */
export const DEFAULT_MAX_AVG_LINE_LENGTH = 500;

export interface PipelineOptions {
  /** Drizzle DB instance */
  db: Db;
  /** Embedding provider */
  embedder: Embedder;
  /** Embedding batch size */
  embeddingBatchSize?: number;
  /** Chunker max tokens */
  maxTokensPerChunk?: number;
  /** Max file size in bytes. Files larger are skipped. Default: 1 MB */
  maxFileSize?: number;
  /** Max average line length (chars). Files above are treated as minified/generated and skipped. Default: 500 */
  maxAvgLineLength?: number;
}

export interface PipelineInput {
  /** Path to the checked-out worktree */
  worktreePath: string;
  /** Repo ref ID (already created in DB) */
  repoRefId: number;
  /** All file paths to index (from `git ls-tree`) */
  files: string[];
}

/** Progress events emitted during the pipeline run. */
export type PipelineProgressEvent =
  | { type: "file-done"; path: string; filesProcessed: number; filesTotal: number }
  | { type: "file-skipped"; path: string; reason: FileSkipReason }
  | { type: "file-error"; path: string; error: string }
  | { type: "embedding-start"; chunksTotal: number }
  | { type: "embedding-batch-done"; chunksEmbedded: number; chunksTotal: number }
  | { type: "embedding-failures"; failures: { chunkId: number; filePath: string; error: string }[] }
  | { type: "finalizing" };

export type PipelineProgressCallback = (event: PipelineProgressEvent) => void;

interface TxRepos {
  fc: FileContentRepository;
  rf: RefFileRepository;
  sym: SymbolRepository;
  chunk: ChunkRepository;
  ref: RepoRefRepository;
  imp: ImportRepository;
}

/** Reasons a file may be skipped during indexing. */
export type FileSkipReason = "too-large" | "minified-or-generated" | "read-error" | "parse-error";

interface NewChunkRow {
  chunkId: number;
  content: string;
  /** Source file path — carried through so embedding failures can report which file. */
  filePath: string;
}

// ── Helpers ──

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Check whether a file's content should be skipped.
 * Returns a skip reason or `null` if the file is OK to index.
 */
export function shouldSkipFile(
  content: string,
  maxFileSize: number,
  maxAvgLineLength: number,
): FileSkipReason | null {
  // Check byte size (Buffer.byteLength is accurate for UTF-8)
  if (Buffer.byteLength(content, "utf-8") > maxFileSize) {
    return "too-large";
  }
  // Check average line length to detect minified / generated files
  const lines = content.split("\n");
  if (lines.length > 0) {
    const avgLineLen = content.length / lines.length;
    if (avgLineLen > maxAvgLineLength && lines.length > 1) {
      return "minified-or-generated";
    }
  }
  return null;
}

function createTxRepos(tx: unknown): TxRepos {
  const db = tx as unknown as Db;
  return {
    fc: new FileContentRepository(db),
    rf: new RefFileRepository(db),
    sym: new SymbolRepository(db),
    chunk: new ChunkRepository(db),
    ref: new RepoRefRepository(db),
    imp: new ImportRepository(db),
  };
}

/** Filter changed paths through gitignore and classify to supported languages. */
async function filterSupportedFiles(
  worktreePath: string,
  changed: string[],
): Promise<{ path: string; language: Language }[]> {
  const ig = await buildIgnoreFilterFromRepo(worktreePath);
  const filtered = filterIgnored(changed, ig);
  return filtered
    .map((p) => ({ path: p, language: classifyLanguage(p) }))
    .filter((f): f is { path: string; language: Language } => f.language != null);
}

/** Read a file's content, returning null if unreadable (binary, missing). */
async function readFileContent(worktreePath: string, filePath: string): Promise<string | null> {
  try {
    return sanitizeUtf8BufferForPostgres(await readFile(join(worktreePath, filePath)));
  } catch {
    return null;
  }
}

function sanitizeUtf8BufferForPostgres(buf: Buffer): string {
  // Fast path: no NUL byte, decode once and return
  if (buf.indexOf(0x00) === -1) {
    return buf.toString("utf8");
  }

  // Slow path: allocate only when needed
  const out = Buffer.allocUnsafe(buf.length);
  let j = 0;

  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b !== 0x00) {
      out[j++] = b;
    }
  }

  return out.subarray(0, j).toString("utf8");
}

/** Find a symbol ID by name (ignoring startLine, for split chunks). */
function findSymbolIdByName(map: Map<string, number>, name: string): number | undefined {
  for (const [key, id] of map) {
    if (key.startsWith(`${name}:`)) return id;
  }
  return undefined;
}

/** Resolve the best-matching symbol ID for a chunk. */
function resolveSymbolId(symbolIdMap: Map<string, number>, co: ChunkOutput): number | null {
  if (!co.symbolName) return null;
  return (
    symbolIdMap.get(`${co.symbolName}:${co.startLine}`) ??
    findSymbolIdByName(symbolIdMap, co.symbolName) ??
    null
  );
}

// ── Storage helpers ──

/** Store parsed symbols and return a name:startLine → id lookup map. */
async function storeSymbols(
  repo: SymbolRepository,
  fileContentId: number,
  symbols: ParsedSymbol[],
): Promise<Map<string, number>> {
  const entries = await Promise.all(
    symbols.map(async (sym) => {
      const stored = await repo.insertOne({
        fileContentId,
        name: sym.name,
        kind: sym.kind,
        signature: sym.signature,
        startLine: sym.startLine,
        endLine: sym.endLine,
        documentation: sym.documentation,
      });
      return [`${sym.name}:${sym.startLine}`, stored.id] as const;
    }),
  );
  return new Map(entries);
}

/** Store chunks and collect rows that need embedding. */
async function storeChunks(
  repo: ChunkRepository,
  fileContentId: number,
  chunkOutputs: ChunkOutput[],
  symbolIdMap: Map<string, number>,
  filePath: string,
): Promise<NewChunkRow[]> {
  return Promise.all(
    chunkOutputs.map(async (co) => {
      const stored = await repo.insertOne({
        fileContentId,
        symbolId: resolveSymbolId(symbolIdMap, co),
        content: co.content,
        startLine: co.startLine,
        endLine: co.endLine,
      });
      return { chunkId: stored.id, content: co.content, filePath };
    }),
  );
}

/** Store parsed imports for a file. */
async function storeImports(
  repo: ImportRepository,
  fileContentId: number,
  parsedImports: ParsedImport[],
): Promise<void> {
  if (parsedImports.length === 0) return;
  await Promise.all(
    parsedImports.map((imp) =>
      repo.insertOne({
        fileContentId,
        source: imp.source,
        names: imp.names,
        defaultName: imp.defaultName,
        isNamespace: imp.isNamespace ? 1 : 0,
      }),
    ),
  );
}

/** Parse, chunk, and store a brand-new file. Returns chunks needing embedding. */
async function indexNewFile(
  repos: TxRepos,
  opts: {
    content: string;
    hash: string;
    file: { path: string; language: Language };
    repoRefId: number;
    maxTokens?: number;
  },
): Promise<NewChunkRow[]> {
  const { content, hash, file, repoRefId, maxTokens } = opts;
  const fc = await repos.fc.insertOne({ sha256: hash, language: file.language });
  await repos.rf.upsertByRefAndPath({ repoRefId, fileContentId: fc.id, path: file.path });

  const { symbols, imports } = parse(content, file.language, file.path);
  const [symbolIdMap] = await Promise.all([
    storeSymbols(repos.sym, fc.id, symbols),
    storeImports(repos.imp, fc.id, imports),
  ]);
  const chunkOutputs = chunkFile(content, symbols, imports, { maxTokens });
  return storeChunks(repos.chunk, fc.id, chunkOutputs, symbolIdMap, file.path);
}

/** Process a single file: dedup by SHA-256 or index as new. */
async function processFile(
  repos: TxRepos,
  opts: {
    worktreePath: string;
    file: { path: string; language: Language };
    repoRefId: number;
    maxTokens?: number;
    maxFileSize?: number;
    maxAvgLineLength?: number;
  },
): Promise<{ chunks: NewChunkRow[]; skipped?: { path: string; reason: FileSkipReason } }> {
  const {
    worktreePath,
    file,
    repoRefId,
    maxTokens,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxAvgLineLength = DEFAULT_MAX_AVG_LINE_LENGTH,
  } = opts;
  const content = await readFileContent(worktreePath, file.path);
  if (content === null) return { chunks: [], skipped: { path: file.path, reason: "read-error" } };

  const skipReason = shouldSkipFile(content, maxFileSize, maxAvgLineLength);
  if (skipReason) {
    return { chunks: [], skipped: { path: file.path, reason: skipReason } };
  }

  const hash = sha256(content);
  const existing = await repos.fc.findBySha256(hash);

  if (existing) {
    await repos.rf.upsertByRefAndPath({ repoRefId, fileContentId: existing.id, path: file.path });
    // Check if chunks from a previous (possibly failed) run are missing embeddings.
    // If so, collect them for re-embedding so a crashed run can self-repair.
    const existingChunks = await repos.chunk.findByFileContentId(existing.id);
    const unembedded = existingChunks
      .filter((c) => c.embedding == null)
      .map((c) => ({ chunkId: c.id, content: c.content, filePath: file.path }));
    return { chunks: unembedded };
  }
  const chunks = await indexNewFile(repos, { content, hash, file, repoRefId, maxTokens });
  return { chunks };
}

/** Embed all new chunks and persist the vectors (or record failures). */
async function embedNewChunks(opts: {
  embedder: Embedder;
  chunkRepo: ChunkRepository;
  newChunkRows: NewChunkRow[];
  batchSize: number;
  onProgress?: PipelineProgressCallback;
  /** Repo ref ID — used for cancellation checks between batches. */
  repoRefId: number;
  /** DB instance — used for cancellation checks. */
  db: Db;
}): Promise<void> {
  const { embedder, chunkRepo, newChunkRows, batchSize, onProgress, repoRefId, db } = opts;
  if (newChunkRows.length === 0) return;

  onProgress?.({ type: "embedding-start", chunksTotal: newChunkRows.length });

  const texts = newChunkRows.map((r) => r.content);
  // Embed in batches and report progress per batch
  let embedded = 0;
  const allResults: EmbedBatchResult = { embeddings: [], failures: [] };
  for (let i = 0; i < texts.length; i += batchSize) {
    // Check for cancellation between embedding batches
    if (i > 0) await assertRefExists(db, repoRefId);

    const batch = texts.slice(i, i + batchSize);
    const batchResult = await embedInBatches(embedder, batch, batchSize);

    // Re-map failure indices from batch-local to global
    const globalFailures = batchResult.failures.map((f) => ({
      index: f.index + i,
      error: f.error,
    }));
    allResults.embeddings.push(...batchResult.embeddings);
    allResults.failures.push(...globalFailures);

    embedded += batch.length;
    onProgress?.({
      type: "embedding-batch-done",
      chunksEmbedded: embedded,
      chunksTotal: newChunkRows.length,
    });
  }

  // Build update list — `null` embeddings keep the column NULL and get an error reason
  const updates = newChunkRows.map((r, i) => {
    const failure = allResults.failures.find((f) => f.index === i);
    return {
      id: r.chunkId,
      embedding: allResults.embeddings[i] ?? null,
      embeddingError: failure?.error ?? null,
    };
  });
  await chunkRepo.updateEmbeddingsBatch(updates);

  // Notify callers about failures so they can log / surface them
  if (allResults.failures.length > 0) {
    const failedChunks = allResults.failures.map((f) => ({
      chunkId: newChunkRows[f.index]!.chunkId,
      filePath: newChunkRows[f.index]!.filePath,
      error: f.error,
    }));
    onProgress?.({ type: "embedding-failures", failures: failedChunks });
  }
}

/**
 * Compute language percentage breakdown from a list of files with languages.
 * Returns a map of language → percentage (0–100, rounded to 1 decimal).
 */
function computeLanguageStats(files: { language: Language }[]): LanguageStats {
  if (files.length === 0) return {};

  const counts = new Map<Language, number>();
  for (const f of files) {
    counts.set(f.language, (counts.get(f.language) ?? 0) + 1);
  }

  const total = files.length;
  const stats: LanguageStats = {};
  for (const [lang, count] of counts) {
    stats[lang] = Math.round((count / total) * 1000) / 10; // 1 decimal place
  }
  return stats;
}

/** Default file batch size for per-transaction commits. */
const FILE_BATCH_SIZE = 50;

/**
 * Check if the repo_ref row still exists in the DB.
 * Throws PipelineCancelledError if it was deleted (e.g. by a DELETE endpoint).
 */
async function assertRefExists(db: Db, repoRefId: number): Promise<void> {
  const refRepo = new RepoRefRepository(db);
  const rows = await refRepo.findAll(eq(repoRefs.id, repoRefId));
  if (rows.length === 0) {
    throw new PipelineCancelledError(repoRefId);
  }
}

// ── Pipeline ──

/**
 * Run the indexing pipeline for a single ref.
 *
 * Flow:
 * 1. Filter files (gitignore, language support)
 * 2. For each batch of files: read → hash → dedup or parse → chunk → store
 *    (each batch runs in its own short transaction to avoid long-held locks)
 * 3. Embed all new chunks (outside transaction — can be slow)
 * 4. Update ref status to "ready" with language stats (only after embeddings are persisted)
 */
export async function runPipeline(
  opts: PipelineOptions,
  input: PipelineInput,
  onProgress?: PipelineProgressCallback,
): Promise<void> {
  const {
    db,
    embedder,
    embeddingBatchSize = 64,
    maxTokensPerChunk,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxAvgLineLength = DEFAULT_MAX_AVG_LINE_LENGTH,
  } = opts;
  const { worktreePath, repoRefId, files } = input;

  const filesToProcess = await filterSupportedFiles(worktreePath, files);
  const newChunkRows: NewChunkRow[] = [];
  let processed = 0;

  // Process files in small batches — each batch gets its own short
  // transaction so locks are released quickly between batches.
  for (let i = 0; i < filesToProcess.length; i += FILE_BATCH_SIZE) {
    // Between batches, verify the ref wasn't deleted (e.g. by DELETE endpoint).
    if (i > 0) await assertRefExists(db, repoRefId);

    const batch = filesToProcess.slice(i, i + FILE_BATCH_SIZE);

    await db.transaction(async (tx) => {
      const repos = createTxRepos(tx);
      for (const file of batch) {
        try {
          const result = await processFile(repos, {
            worktreePath,
            file,
            repoRefId,
            maxTokens: maxTokensPerChunk,
            maxFileSize,
            maxAvgLineLength,
          });
          if (result.skipped) {
            onProgress?.({
              type: "file-skipped",
              path: result.skipped.path,
              reason: result.skipped.reason,
            });
          }
          newChunkRows.push(...result.chunks);
        } catch (err) {
          if (err instanceof PipelineCancelledError) throw err;
          // Per-file error handling: log and continue with remaining files
          const errorMsg = err instanceof Error ? err.message : String(err);
          onProgress?.({ type: "file-error", path: file.path, error: errorMsg });
        }
        processed++;
        onProgress?.({
          type: "file-done",
          path: file.path,
          filesProcessed: processed,
          filesTotal: filesToProcess.length,
        });
      }
    });
  }

  // Bail out early if the ref was deleted before embedding.
  await assertRefExists(db, repoRefId);

  await embedNewChunks({
    embedder,
    chunkRepo: new ChunkRepository(db),
    newChunkRows,
    batchSize: embeddingBatchSize,
    onProgress,
    repoRefId,
    db,
  });

  // Verify the ref still exists before marking as ready — avoid
  // resurrecting a deleted ref with an INSERT-on-conflict.
  await assertRefExists(db, repoRefId);

  // Compute language breakdown from all files that were candidates for processing
  const languageStats = computeLanguageStats(filesToProcess);

  // Stage flips to "ready" only after embeddings are persisted, so
  // clients polling for "ready" are guaranteed complete data.
  onProgress?.({ type: "finalizing" });
  const refRepo = new RepoRefRepository(db);
  await refRepo.updateWhere(eq(repoRefs.id, repoRefId), {
    stage: "ready",
    indexedAt: new Date(),
    languageStats,
  });
}
