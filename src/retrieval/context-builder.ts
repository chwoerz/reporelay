/**
 * Assembles context packs for MCP prompts. Each strategy gathers chunks,
 * respects a token budget, and formats them ordered by file path then line.
 */
import type { Db } from "../storage/index.js";
import type { Embedder } from "../indexer/embedder.js";
import type { SearchResult, ContextStrategy } from "../core/types.js";
import { estimateTokens } from "../indexer/chunker.js";
import { searchHybrid } from "./hybrid-search.js";
import { RefFileRepository } from "../storage/index.js";
import { ChunkRepository } from "../storage/index.js";
import { resolveRef } from "./semver-resolver.js";

export interface ContextPackInput {
  repo: string;
  repoId: number;
  strategy: ContextStrategy;
  ref?: string;
  fromRef?: string;
  query?: string;
  paths?: string[];
  maxTokens?: number;
}

export interface ContextChunk {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  annotation?: string;
}

export interface ContextPack {
  strategy: ContextStrategy;
  repo: string;
  ref?: string;
  chunks: ContextChunk[];
  totalTokens: number;
}

function sortChunks(chunks: ContextChunk[]): ContextChunk[] {
  return [...chunks].sort((a, b) =>
    a.filePath !== b.filePath ? a.filePath.localeCompare(b.filePath) : a.startLine - b.startLine,
  );
}

function trimToBudget(chunks: ContextChunk[], maxTokens: number): ContextChunk[] {
  const result: ContextChunk[] = [];
  let used = 0;

  for (const chunk of chunks) {
    const headerCost = estimateTokens(
      `\n--- ${chunk.filePath} L${chunk.startLine}-${chunk.endLine} ---\n`,
    );
    const contentCost = estimateTokens(chunk.content);
    const cost = headerCost + contentCost;
    if (used + cost > maxTokens) break;
    result.push(chunk);
    used += cost;
  }

  return result;
}

export function formatContextPack(pack: ContextPack): string {
  const lines: string[] = [];
  let lastFile = "";

  for (const chunk of pack.chunks) {
    if (chunk.filePath !== lastFile) {
      lines.push(`\n--- ${chunk.filePath} L${chunk.startLine}-${chunk.endLine} ---`);
      lastFile = chunk.filePath;
    } else {
      lines.push(`\n--- L${chunk.startLine}-${chunk.endLine} ---`);
    }
    if (chunk.annotation) lines.push(`[${chunk.annotation}]`);
    lines.push(chunk.content);
  }

  return lines.join("\n").trim();
}

function searchResultsToChunks(results: SearchResult[]): ContextChunk[] {
  return results.map((r) => ({
    filePath: r.filePath,
    startLine: r.startLine,
    endLine: r.endLine,
    content: r.content,
  }));
}

/**
 * Resolves `input.ref` through semver first so constraints like `"^1.0.0"`
 * or `"1.0.0"` match stored tags like `"v1.0.0"`. Falls back to the repo
 * name when no query is supplied — weak signal, but neutral across
 * languages.
 */
async function gatherBySearch(
  db: Db,
  embedder: Embedder,
  input: ContextPackInput,
): Promise<ContextChunk[]> {
  const query = input.query ?? input.repo;

  let ref = input.ref;
  if (ref) {
    const resolved = await resolveRef(db, input.repoId, ref);
    if (resolved) ref = resolved.ref;
  }

  const results = await searchHybrid(db, embedder, {
    query,
    repo: input.repo,
    ref,
    paths: input.paths,
    limit: 30,
  });
  return searchResultsToChunks(results);
}

async function gatherRecentChanges(db: Db, input: ContextPackInput): Promise<ContextChunk[]> {
  const toResolved = input.ref ? await resolveRef(db, input.repoId, input.ref) : null;
  if (!toResolved) return [];

  const fromResolved = input.fromRef ? await resolveRef(db, input.repoId, input.fromRef) : null;
  if (!fromResolved) return [];

  const rfRepo = new RefFileRepository(db);
  const chunkRepo = new ChunkRepository(db);

  const changes = await rfRepo.findChangedBetweenRefs(fromResolved.id, toResolved.id);

  const withContent = changes.filter(
    (c): c is typeof c & { fileContentId: number } => c.fileContentId != null,
  );

  const chunkPromises = withContent.map(async (change) => {
    const fileChunks = await chunkRepo.findByFileContentId(change.fileContentId);
    return fileChunks.map((fc) => ({
      filePath: change.path,
      startLine: fc.startLine,
      endLine: fc.endLine,
      content: fc.content,
      annotation: change.changeType,
    }));
  });

  const nested = await Promise.all(chunkPromises);
  const chunks = nested.flat();

  // Deleted files have no content — surface them as annotation-only entries.
  const deletedAnnotations: ContextChunk[] = changes
    .filter((c) => c.changeType === "deleted")
    .map((c) => ({
      filePath: c.path,
      startLine: 0,
      endLine: 0,
      content: "(file deleted)",
      annotation: "deleted",
    }));

  return [...chunks, ...deletedAnnotations];
}

const STRATEGY_MAP: Record<
  ContextStrategy,
  (db: Db, embedder: Embedder, input: ContextPackInput) => Promise<ContextChunk[]>
> = {
  explain: gatherBySearch,
  implement: gatherBySearch,
  debug: gatherBySearch,
  "recent-changes": (db, _embedder, input) => gatherRecentChanges(db, input),
};

export async function buildContextPack(
  db: Db,
  embedder: Embedder,
  input: ContextPackInput,
): Promise<ContextPack> {
  const maxTokens = input.maxTokens ?? 8192;
  const gatherFn = STRATEGY_MAP[input.strategy];

  const rawChunks = await gatherFn(db, embedder, input);
  const sorted = sortChunks(rawChunks);
  const trimmed = trimToBudget(sorted, maxTokens);
  const totalTokens = trimmed.reduce((sum, c) => sum + estimateTokens(c.content), 0);

  return {
    strategy: input.strategy,
    repo: input.repo,
    ref: input.ref,
    chunks: trimmed,
    totalTokens,
  };
}
