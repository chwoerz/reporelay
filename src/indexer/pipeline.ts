/**
 * Takes a checked-out worktree + file list, produces file_contents,
 * ref_files, symbols, and embedded chunks. Git sync / worktree checkout
 * happen externally — this runs from the pg-boss job handler.
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
import { type Embedder, embedInBatches } from "./embedder.js";
import type { Language, LanguageStats, ParsedImport, ParsedSymbol } from "../core/types.js";

/** Thrown when the pipeline detects that the ref was deleted mid-run. */
export class PipelineCancelledError extends Error {
  constructor(repoRefId: number) {
    super(`Pipeline cancelled: repo_ref ${repoRefId} was deleted during indexing`);
    this.name = "PipelineCancelledError";
  }
}

/**
 * Cost scales linearly — the worker holds several copies of a file in
 * memory at once during parse+chunk+embed. Raise carefully.
 */
export const DEFAULT_MAX_FILE_SIZE = 3 * 1024 * 1024;

/** Above this, files are treated as minified/generated and skipped. */
export const DEFAULT_MAX_AVG_LINE_LENGTH = 500;

export interface PipelineOptions {
  db: Db;
  embedder: Embedder;
  embeddingBatchSize?: number;
  embeddingConcurrency?: number;
  maxTokensPerChunk?: number;
  maxFileSize?: number;
  maxAvgLineLength?: number;
}

export interface PipelineInput {
  worktreePath: string;
  repoRefId: number;
  /** From `git ls-tree`. */
  files: string[];
}

/** Progress events emitted during the pipeline run. */
export type PipelineProgressEvent =
  | { type: "file-done"; path: string; filesProcessed: number; filesTotal: number }
  | { type: "file-skipped"; path: string; reason: FileSkipReason }
  | { type: "file-error"; path: string; error: string }
  /**
   * After persistence, before embedding. `chunksRepair` covers pre-existing
   * chunks with NULL embedding (prior crashed/incomplete run).
   */
  | {
      type: "dedup-summary";
      filesNew: number;
      filesReused: number;
      chunksNew: number;
      chunksRepair: number;
    }
  | { type: "embedding-start"; chunksTotal: number }
  | { type: "embedding-batch-done"; chunksEmbedded: number; chunksTotal: number }
  | { type: "embedding-failures"; failures: { chunkId: number; filePath: string; error: string }[] }
  /** Chunks reused from the content-sha256 cache vs. what still needs the embedder. */
  | { type: "chunk-cache"; chunksReused: number; chunksToEmbed: number }
  /** Writing fully-embedded chunks back to the DB — may take several seconds for large batches. */
  | { type: "persisting-embeddings"; chunksTotal: number }
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

export type FileSkipReason = "too-large" | "minified-or-generated" | "read-error" | "parse-error";

interface NewChunkRow {
  chunkId: number;
  content: string;
  contentSha256: string;
  filePath: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export function shouldSkipFile(
  content: string,
  maxFileSize: number,
  maxAvgLineLength: number,
): FileSkipReason | null {
  if (Buffer.byteLength(content, "utf-8") > maxFileSize) {
    return "too-large";
  }
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

async function readFileContent(worktreePath: string, filePath: string): Promise<string | null> {
  try {
    return sanitizeUtf8BufferForPostgres(await readFile(join(worktreePath, filePath)));
  } catch {
    return null;
  }
}

// Postgres text columns reject NUL bytes even in otherwise-valid UTF-8.
function sanitizeUtf8BufferForPostgres(buf: Buffer): string {
  if (buf.indexOf(0x00) === -1) {
    return buf.toString("utf8");
  }

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

// For chunks split off the primary symbol window — match on name only.
function findSymbolIdByName(map: Map<string, number>, name: string): number | undefined {
  for (const [key, id] of map) {
    if (key.startsWith(`${name}:`)) return id;
  }
  return undefined;
}

function resolveSymbolId(symbolIdMap: Map<string, number>, co: ChunkOutput): number | null {
  if (!co.symbolName) return null;
  return (
    symbolIdMap.get(`${co.symbolName}:${co.startLine}`) ??
    findSymbolIdByName(symbolIdMap, co.symbolName) ??
    null
  );
}

/** All CPU/IO work producing this runs outside the DB transaction. */
interface PreparedFile {
  file: { path: string; language: Language };
  hash: string;
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  chunkOutputs: ChunkOutput[];
}

type PrepareOutcome =
  | { kind: "prepared"; prepared: PreparedFile }
  | { kind: "skipped"; path: string; reason: FileSkipReason }
  | { kind: "error"; path: string; error: string };

async function prepareFile(
  worktreePath: string,
  file: { path: string; language: Language },
  maxFileSize: number,
  maxAvgLineLength: number,
  maxTokens: number | undefined,
): Promise<PrepareOutcome> {
  const content = await readFileContent(worktreePath, file.path);
  if (content === null) return { kind: "skipped", path: file.path, reason: "read-error" };

  const skipReason = shouldSkipFile(content, maxFileSize, maxAvgLineLength);
  if (skipReason) return { kind: "skipped", path: file.path, reason: skipReason };

  try {
    const hash = sha256(content);
    const { symbols, imports } = parse(content, file.language, file.path);
    const chunkOutputs = chunkFile(content, symbols, imports, {
      maxTokens,
      language: file.language,
    });
    return { kind: "prepared", prepared: { file, hash, symbols, imports, chunkOutputs } };
  } catch (err) {
    return {
      kind: "error",
      path: file.path,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface PersistBatchResult {
  chunks: NewChunkRow[];
  filesNew: number;
  filesReused: number;
  chunksNew: number;
  chunksRepair: number;
}

async function persistBatch(
  repos: TxRepos,
  prepared: PreparedFile[],
  repoRefId: number,
): Promise<PersistBatchResult> {
  if (prepared.length === 0)
    return { chunks: [], filesNew: 0, filesReused: 0, chunksNew: 0, chunksRepair: 0 };

  // 1. Look up which hashes already have file_contents rows.
  const uniqueHashes = [...new Set(prepared.map((p) => p.hash))];
  const existing = await repos.fc.findManyBySha256(uniqueHashes);
  const fcIdByHash = new Map<string, number>(existing.map((fc) => [fc.sha256, fc.id]));

  // 2. Bulk-insert file_contents for hashes not already present.
  //    Dedup by hash within the batch so two identical files share one FC row.
  const toInsertFCs: { sha256: string; language: Language }[] = [];
  const seenNewHashes = new Set<string>();
  for (const p of prepared) {
    if (fcIdByHash.has(p.hash) || seenNewHashes.has(p.hash)) continue;
    seenNewHashes.add(p.hash);
    toInsertFCs.push({ sha256: p.hash, language: p.file.language });
  }
  const insertedFCs = await repos.fc.insertMany(toInsertFCs);
  for (const fc of insertedFCs) fcIdByHash.set(fc.sha256, fc.id);

  // 3. Bulk-upsert ref_files for every prepared file.
  //    Dedupe by path within the batch (last-write-wins, matches prior per-row semantics).
  const refFileRowsByPath = new Map<
    string,
    { repoRefId: number; fileContentId: number; path: string }
  >();
  for (const p of prepared) {
    const fcId = fcIdByHash.get(p.hash)!;
    refFileRowsByPath.set(p.file.path, { repoRefId, fileContentId: fcId, path: p.file.path });
  }
  await repos.rf.upsertManyByRefAndPath([...refFileRowsByPath.values()]);

  // 4. Partition prepared files: those whose FC was newly inserted need
  //    symbols/imports/chunks written; existing FCs only need a check for
  //    unembedded chunks (self-repair for crashed runs).
  const newFcIds = new Set(insertedFCs.map((fc) => fc.id));
  const newFiles: PreparedFile[] = [];
  const existingFcIds = new Set<number>();
  const filePathByFcId = new Map<number, string>();
  for (const p of prepared) {
    const fcId = fcIdByHash.get(p.hash)!;
    filePathByFcId.set(fcId, p.file.path);
    if (newFcIds.has(fcId)) {
      // Only write symbols/chunks once per unique new FC (first prepared file wins).
      if (!newFiles.some((n) => fcIdByHash.get(n.hash) === fcId)) newFiles.push(p);
    } else {
      existingFcIds.add(fcId);
    }
  }

  // 5. Bulk-insert symbols for all new files, then build per-FC name→id lookup.
  const allSymbolRows = newFiles.flatMap((p) => {
    const fcId = fcIdByHash.get(p.hash)!;
    return p.symbols.map((sym) => ({
      fileContentId: fcId,
      name: sym.name,
      kind: sym.kind,
      signature: sym.signature,
      startLine: sym.startLine,
      endLine: sym.endLine,
      documentation: sym.documentation,
    }));
  });
  const insertedSymbols = await repos.sym.insertMany(allSymbolRows);
  const symbolIdMapByFcId = new Map<number, Map<string, number>>();
  for (const s of insertedSymbols) {
    let m = symbolIdMapByFcId.get(s.fileContentId);
    if (!m) {
      m = new Map();
      symbolIdMapByFcId.set(s.fileContentId, m);
    }
    m.set(`${s.name}:${s.startLine}`, s.id);
  }

  // 6. Bulk-insert imports for all new files.
  const allImportRows = newFiles.flatMap((p) => {
    const fcId = fcIdByHash.get(p.hash)!;
    return p.imports.map((imp) => ({
      fileContentId: fcId,
      source: imp.source,
      names: imp.names,
      defaultName: imp.defaultName,
      isNamespace: imp.isNamespace ? 1 : 0,
    }));
  });
  if (allImportRows.length > 0) await repos.imp.insertMany(allImportRows);

  // 7. Bulk-insert chunks for all new files, carrying through the content + path
  //    so embedding failures can be attributed later. `content_sha256` enables
  //    chunk-level embedding reuse across files/refs (see embedNewChunks).
  const chunkInsertPayload: {
    fileContentId: number;
    symbolId: number | null;
    content: string;
    contentSha256: string;
    startLine: number;
    endLine: number;
  }[] = [];
  const chunkMeta: { filePath: string }[] = [];
  for (const p of newFiles) {
    const fcId = fcIdByHash.get(p.hash)!;
    const symMap = symbolIdMapByFcId.get(fcId) ?? new Map<string, number>();
    for (const co of p.chunkOutputs) {
      chunkInsertPayload.push({
        fileContentId: fcId,
        symbolId: resolveSymbolId(symMap, co),
        content: co.content,
        contentSha256: sha256(co.content),
        startLine: co.startLine,
        endLine: co.endLine,
      });
      chunkMeta.push({ filePath: p.file.path });
    }
  }
  const insertedChunks = await repos.chunk.insertMany(chunkInsertPayload);
  const newChunks: NewChunkRow[] = insertedChunks.map((c, i) => ({
    chunkId: c.id,
    content: c.content,
    contentSha256: c.contentSha256!,
    filePath: chunkMeta[i]!.filePath,
  }));
  const chunksNew = newChunks.length;
  let chunksRepair = 0;

  // 8. Self-repair: for existing FCs, re-embed any chunks missing an embedding.
  //    These rows already have content_sha256 (backfill on startup); fall back
  //    to hashing on-the-fly for rows predating the backfill.
  if (existingFcIds.size > 0) {
    const unembedded = await repos.chunk.findUnembeddedByFileContentIds([...existingFcIds]);
    chunksRepair = unembedded.length;
    for (const c of unembedded) {
      newChunks.push({
        chunkId: c.id,
        content: c.content,
        contentSha256: c.contentSha256 ?? sha256(c.content),
        filePath: filePathByFcId.get(c.fileContentId) ?? "",
      });
    }
  }

  return {
    chunks: newChunks,
    filesNew: newFcIds.size,
    filesReused: existingFcIds.size,
    chunksNew,
    chunksRepair,
  };
}

/**
 * Chunk-level embedding cache: for any chunk whose `content_sha256` already
 * exists (with an embedding) on another chunk, copy the vector in-place and
 * drop the chunk from the list passed to the embedding provider.
 *
 * This is the hot path when bumping a ref across versions — most functions
 * don't change even when a file's overall sha does, so we avoid re-embedding
 * the unchanged bulk. Returns the chunks that still need embedding.
 */
async function applyChunkEmbeddingCache(
  chunkRepo: ChunkRepository,
  newChunkRows: NewChunkRow[],
  onProgress?: PipelineProgressCallback,
): Promise<NewChunkRow[]> {
  if (newChunkRows.length === 0) return newChunkRows;

  const hashes = newChunkRows.map((r) => r.contentSha256);
  const cache = await chunkRepo.findEmbeddingsByContentSha256(hashes);

  const copies: { id: number; embedding: number[] }[] = [];
  const remaining: NewChunkRow[] = [];
  for (const row of newChunkRows) {
    const hit = cache.get(row.contentSha256);
    if (hit) {
      copies.push({ id: row.chunkId, embedding: hit });
    } else {
      remaining.push(row);
    }
  }

  if (copies.length > 0) {
    await chunkRepo.updateEmbeddingsBatch(
      copies.map(({ id, embedding }) => ({ id, embedding, embeddingError: null })),
    );
  }

  onProgress?.({
    type: "chunk-cache",
    chunksReused: copies.length,
    chunksToEmbed: remaining.length,
  });

  return remaining;
}

async function embedNewChunks(opts: {
  embedder: Embedder;
  chunkRepo: ChunkRepository;
  newChunkRows: NewChunkRow[];
  batchSize: number;
  concurrency: number;
  onProgress?: PipelineProgressCallback;
  repoRefId: number;
  db: Db;
}): Promise<void> {
  const { embedder, chunkRepo, newChunkRows, batchSize, concurrency, onProgress, repoRefId, db } =
    opts;
  if (newChunkRows.length === 0) return;

  onProgress?.({ type: "embedding-start", chunksTotal: newChunkRows.length });

  const texts = newChunkRows.map((r) => r.content);
  // onWaveDone checks cancellation between waves so we don't duplicate the wave loop here.
  const results = await embedInBatches(
    embedder,
    texts,
    batchSize,
    concurrency,
    async (completed, total) => {
      await assertRefExists(db, repoRefId);
      onProgress?.({ type: "embedding-batch-done", chunksEmbedded: completed, chunksTotal: total });
    },
  );

  const updates = newChunkRows.map((r, i) => {
    const failure = results.failures.find((f) => f.index === i);
    return {
      id: r.chunkId,
      embedding: results.embeddings[i] ?? null,
      embeddingError: failure?.error ?? null,
    };
  });
  onProgress?.({ type: "persisting-embeddings", chunksTotal: updates.length });
  await chunkRepo.updateEmbeddingsBatch(updates);

  if (results.failures.length > 0) {
    const failedChunks = results.failures.map((f) => ({
      chunkId: newChunkRows[f.index]!.chunkId,
      filePath: newChunkRows[f.index]!.filePath,
      error: f.error,
    }));
    onProgress?.({ type: "embedding-failures", failures: failedChunks });
  }
}

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

const FILE_BATCH_SIZE = 50;

/** Throws PipelineCancelledError if the ref was deleted mid-run. */
async function assertRefExists(db: Db, repoRefId: number): Promise<void> {
  const refRepo = new RepoRefRepository(db);
  const rows = await refRepo.findAll(eq(repoRefs.id, repoRefId));
  if (rows.length === 0) {
    throw new PipelineCancelledError(repoRefId);
  }
}

/** Returns the set of files that reached persistence. */
export async function runPipeline(
  opts: PipelineOptions,
  input: PipelineInput,
  onProgress?: PipelineProgressCallback,
): Promise<Set<string>> {
  const {
    db,
    embedder,
    embeddingBatchSize = 64,
    embeddingConcurrency = 1,
    maxTokensPerChunk,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxAvgLineLength = DEFAULT_MAX_AVG_LINE_LENGTH,
  } = opts;
  const { worktreePath, repoRefId, files } = input;

  const filesToProcess = await filterSupportedFiles(worktreePath, files);
  const filePaths = filesToProcess.map((f) => f.path);
  const newChunkRows: NewChunkRow[] = [];
  let processed = 0;
  let totalFilesNew = 0;
  let totalFilesReused = 0;
  let totalChunksNew = 0;
  let totalChunksRepair = 0;

  // Small batches so transactions stay short and locks aren't held while we parse/chunk.
  for (let i = 0; i < filesToProcess.length; i += FILE_BATCH_SIZE) {
    if (i > 0) await assertRefExists(db, repoRefId);

    const batch = filesToProcess.slice(i, i + FILE_BATCH_SIZE);

    const outcomes = await Promise.all(
      batch.map((file) =>
        prepareFile(worktreePath, file, maxFileSize, maxAvgLineLength, maxTokensPerChunk),
      ),
    );

    const prepared: PreparedFile[] = [];
    for (const o of outcomes) {
      if (o.kind === "prepared") prepared.push(o.prepared);
      else if (o.kind === "skipped") {
        onProgress?.({ type: "file-skipped", path: o.path, reason: o.reason });
      } else {
        onProgress?.({ type: "file-error", path: o.path, error: o.error });
      }
    }

    const batchResult = await db.transaction(async (tx) => {
      const repos = createTxRepos(tx);
      return persistBatch(repos, prepared, repoRefId);
    });
    newChunkRows.push(...batchResult.chunks);
    totalFilesNew += batchResult.filesNew;
    totalFilesReused += batchResult.filesReused;
    totalChunksNew += batchResult.chunksNew;
    totalChunksRepair += batchResult.chunksRepair;

    for (const file of batch) {
      processed++;
      onProgress?.({
        type: "file-done",
        path: file.path,
        filesProcessed: processed,
        filesTotal: filesToProcess.length,
      });
    }
  }

  // Bail out early if the ref was deleted before embedding.
  await assertRefExists(db, repoRefId);

  onProgress?.({
    type: "dedup-summary",
    filesNew: totalFilesNew,
    filesReused: totalFilesReused,
    chunksNew: totalChunksNew,
    chunksRepair: totalChunksRepair,
  });

  const chunkRepo = new ChunkRepository(db);
  const toEmbed = await applyChunkEmbeddingCache(chunkRepo, newChunkRows, onProgress);

  await embedNewChunks({
    embedder,
    chunkRepo,
    newChunkRows: toEmbed,
    batchSize: embeddingBatchSize,
    concurrency: embeddingConcurrency,
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
  return new Set(filePaths);
}
