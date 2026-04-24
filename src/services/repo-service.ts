/**
 * Shared service layer for repository operations.
 *
 * Contains the core business logic used by both the MCP tools and the
 * Fastify web API, eliminating duplication between those two surfaces.
 */
import { join } from "node:path";
import type { Db } from "../storage/index.js";
import {
  ChunkRepository,
  FileContentRepository,
  ImportRepository,
  RefFileRepository,
  RepoRefRepository,
  RepoRepository,
  SymbolRepository,
} from "../storage/index.js";
import type { Embedder } from "../indexer/embedder.js";
import {
  type HybridSearchOptions,
  resolveRef,
  searchHybrid,
} from "../retrieval/index.js";
import { readFileFromMirror } from "../git/git-sync.js";

import type { LanguageStats } from "../core/types.js";

export interface ResolvedRepoRef {
  repo: {
    id: number;
    name: string;
    localPath: string | null;
    remoteUrl: string | null;
  };
  ref: { id: number; commitSha: string; ref: string };
}

export interface FileResult {
  repo: string;
  ref: string;
  path: string;
  content: string;
  symbols?: {
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
    signature: string;
    documentation: string | null;
  }[];
}

export interface SymbolMatch {
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  documentation: string | null;
  fileContentId: number;
  source: string;
}

export interface ImportRef {
  filePath: string;
  source: string;
  isDefault: boolean;
}

export interface RepoWithRefs {
  repo: Awaited<ReturnType<RepoRepository["listAll"]>>[number];
  refs: Awaited<ReturnType<RepoRefRepository["findByRepoId"]>>;
}

/** Default minimum percentage for a language to count as a match. */
const DEFAULT_LANGUAGE_THRESHOLD = 10;

/**
 * Check whether a ref's language_stats contain at least one of the given
 * languages at or above the threshold percentage.
 */
function refMatchesLanguages(
  stats: LanguageStats | null | undefined,
  languages: string[],
  threshold: number,
): boolean {
  if (!stats) return false;
  return languages.some((lang) => (stats[lang as keyof LanguageStats] ?? 0) >= threshold);
}

/**
 * List all repos together with their refs, optionally filtered by language.
 *
 * When `languages` is provided and `threshold` is greater than 0, only repos
 * that have at least one ref whose `language_stats` contains a matching
 * language at or above `threshold`% are returned. Refs that don't meet
 * the threshold are still included on qualifying repos (so the caller
 * sees the full picture).
 *
 * When `threshold` is 0, language-based repo filtering is disabled and
 * all repos are returned regardless of `languages`.
 *
 * @param db        - Drizzle DB instance
 * @param languages - optional language filter (e.g. ["typescript", "javascript"])
 * @param threshold - minimum percentage in language_stats to qualify (default 10, 0 = disabled)
 */
export async function listReposWithRefs(
  db: Db,
  languages?: string[],
  threshold?: number,
): Promise<RepoWithRefs[]> {
  const repoRepo = new RepoRepository(db);
  const refRepo = new RepoRefRepository(db);
  const repos = await repoRepo.listAll();

  const entries = await Promise.all(
    repos.map(async (repo) => ({
      repo,
      refs: await refRepo.findByRepoId(repo.id),
    })),
  );

  const pct = threshold ?? DEFAULT_LANGUAGE_THRESHOLD;

  // Threshold 0 disables filtering — return everything
  if (pct === 0) return entries;

  // No language filter → return everything (existing behavior)
  if (!languages || languages.length === 0) return entries;

  return entries.filter(({ refs }) =>
    refs.some((r) => refMatchesLanguages(r.languageStats as LanguageStats | null, languages, pct)),
  );
}

/**
 * List all file paths in a resolved ref
 */
export async function listFilePaths(db: Db, refId: number): Promise<string[]> {
  const rfRepo = new RefFileRepository(db);
  return rfRepo.listPaths(refId, undefined);
}

/**
 * Resolve a repo name → DB row, returning null when not found.
 */
export async function findRepo(db: Db, repoName: string) {
  return new RepoRepository(db).findByName(repoName);
}

/**
 * Resolve repo + optional ref string → fully-resolved repo & ref rows.
 * Returns a descriptive error string on failure.
 */
export async function resolveRepoAndRef(
  db: Db,
  repoName: string,
  refStr?: string,
): Promise<ResolvedRepoRef | string> {
  const repo = await findRepo(db, repoName);
  if (!repo) return `Repository "${repoName}" not found.`;

  if (!refStr) {
    const refs = await new RepoRefRepository(db).findByRepoId(repo.id);
    const ready = refs.filter((r) => r.stage === "ready").sort((a, b) => b.id - a.id);
    if (ready.length === 0) return `No indexed refs found for "${repoName}".`;
    const r = ready[0]!;
    return { repo, ref: { id: r.id, commitSha: r.commitSha, ref: r.ref } };
  }

  const resolved = await resolveRef(db, repo.id, refStr);
  if (!resolved) return `Ref "${refStr}" not found for "${repoName}".`;
  return {
    repo,
    ref: { id: resolved.id, commitSha: resolved.commitSha, ref: resolved.ref },
  };
}

/**
 * Get file content: tries raw file from git mirror first, falls back to
 * indexed chunks. Optionally includes the symbol list.
 */
export async function getFileContent(
  db: Db,
  resolved: ResolvedRepoRef,
  filePath: string,
  opts: { mirrorsDir?: string; includeSymbols?: boolean } = {},
): Promise<FileResult | string> {
  // Try raw file from mirror
  let content: string | null = null;
  if (opts.mirrorsDir) {
    const mirrorPath = join(opts.mirrorsDir, `${resolved.repo.name}.git`);
    content = await readFileFromMirror(
      mirrorPath,
      resolved.ref.commitSha,
      filePath,
      resolved.repo.remoteUrl ?? undefined,
    );
  }

  // Fall back to indexed chunks
  if (content === null) {
    const rfRepo = new RefFileRepository(db);
    const refFile = await rfRepo.findByRepoRefAndPath(resolved.ref.id, filePath);
    if (!refFile) {
      return `File "${filePath}" not found in ${resolved.repo.name}@${resolved.ref.ref}.`;
    }
    const chunkRepo = new ChunkRepository(db);
    const chunks = await chunkRepo.findByFileContentId(refFile.fileContentId);
    chunks.sort((a, b) => a.startLine - b.startLine);
    content = chunks.map((c) => c.content).join("\n");
  }

  const result: FileResult = {
    repo: resolved.repo.name,
    ref: resolved.ref.ref,
    path: filePath,
    content,
  };

  if (opts.includeSymbols) {
    const rfRepo = new RefFileRepository(db);
    const refFile = await rfRepo.findByRepoRefAndPath(resolved.ref.id, filePath);
    if (refFile) {
      const symRepo = new SymbolRepository(db);
      result.symbols = await symRepo.findByFileContentId(refFile.fileContentId);
    }
  }

  return result;
}

/**
 * Get a symbol by name, including its source from chunks and optionally imports.
 * When `languages` is provided, only symbols in files of those languages are returned.
 */
export async function getSymbol(
  db: Db,
  resolved: ResolvedRepoRef,
  symbolName: string,
  opts: { includeImports?: boolean; languages?: string[] } = {},
): Promise<{ symbols: SymbolMatch[]; imports?: ImportRef[] } | string> {
  const symRepo = new SymbolRepository(db);
  const matches = await symRepo.findByNameInRef(resolved.ref.id, symbolName, opts.languages);

  if (matches.length === 0) {
    return `Symbol "${symbolName}" not found in ${resolved.repo.name}@${resolved.ref.ref}.`;
  }

  const chunkRepo = new ChunkRepository(db);
  const symbols: SymbolMatch[] = await Promise.all(
    matches.map(async (sym) => {
      const chunks = await chunkRepo.findByFileContentId(sym.fileContentId);
      const symbolChunks = chunks
        .filter((c) => c.startLine >= sym.startLine && c.endLine <= sym.endLine)
        .sort((a, b) => a.startLine - b.startLine);

      return {
        name: sym.name,
        kind: sym.kind,
        filePath: sym.filePath,
        startLine: sym.startLine,
        endLine: sym.endLine,
        signature: sym.signature,
        documentation: sym.documentation,
        fileContentId: sym.fileContentId,
        source: symbolChunks.map((c) => c.content).join("\n"),
      };
    }),
  );

  let imports: ImportRef[] | undefined;
  if (opts.includeImports) {
    const importRepo = new ImportRepository(db);
    imports = await importRepo.findReferencesInRef(resolved.ref.id, symbolName);
  }

  return { symbols, imports };
}

/**
 * Find files or symbols by name/path pattern.
 * When `languages` is provided, results are filtered to only those languages.
 */
export async function findByPattern(
  db: Db,
  refId: number,
  kind: "file" | "symbol",
  pattern: string,
  languages?: string[],
) {
  if (kind === "file") {
    const rfRepo = new RefFileRepository(db);
    const files = await rfRepo.findByPathPattern(refId, pattern, languages);
    return { kind: "file" as const, files: files.map((f) => ({ path: f.path })) };
  }

  const symRepo = new SymbolRepository(db);
  const symbols = await symRepo.findByPatternInRef(refId, pattern, languages);
  return {
    kind: "symbol" as const,
    symbols: symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      filePath: s.filePath,
      startLine: s.startLine,
      endLine: s.endLine,
      signature: s.signature,
    })),
  };
}

/**
 * Find files that import a given symbol name.
 */
export async function findReferences(
  db: Db,
  refId: number,
  symbolName: string,
): Promise<ImportRef[]> {
  const importRepo = new ImportRepository(db);
  return importRepo.findReferencesInRef(refId, symbolName);
}

/**
 * Search code (hybrid lexical + vector).
 *
 * When both `repo` and `ref` are provided, resolves the ref through
 * semver resolution before searching.  This means callers can pass
 * constraints like `"^1.0.0"` or bare versions like `"1.0.0"` (which
 * correctly match a stored `"v1.0.0"` tag).
 *
 * When only `ref` is given without `repo`, resolution is not possible
 * and the value is passed through as-is (exact string match).
 */
export async function searchCode(db: Db, embedder: Embedder, opts: HybridSearchOptions) {
  const resolvedOpts = await resolveSearchRef(db, opts);
  return searchHybrid(db, embedder, resolvedOpts);
}

/**
 * Resolve the `ref` field in search options through semver when a
 * `repo` context is available.  Returns a copy with the resolved ref
 * name substituted in, or the original options unchanged.
 */
async function resolveSearchRef(db: Db, opts: HybridSearchOptions): Promise<HybridSearchOptions> {
  if (!opts.ref || !opts.repo) return opts;

  const repo = await findRepo(db, opts.repo);
  if (!repo) return opts;

  const resolved = await resolveRef(db, repo.id, opts.ref);
  if (!resolved) return opts;

  return { ...opts, ref: resolved.ref };
}

/**
 * Delete orphaned file_contents rows in the background.
 *
 * Fire-and-forget — logs success/failure but never rejects.
 * Use after deleting repos or refs to reclaim space.
 */
export function cleanupOrphansBackground(
  db: Db,
  logger: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void },
  context: string,
): void {
  logger.info(`Background orphan cleanup started for ${context}`);
  new FileContentRepository(db)
    .deleteOrphans()
    .then(() => logger.info(`Background orphan cleanup done for ${context}`))
    .catch((err) => logger.error(`Background orphan cleanup failed for ${context}:`, err));
}
