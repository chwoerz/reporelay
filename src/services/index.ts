/**
 * Barrel export for the services module.
 */
export {
  findRepo,
  resolveRepoAndRef,
  getFileContent,
  getSymbol,
  findByPattern,
  findReferences,
  searchCode,
  listReposWithRefs,
  listFilePaths,
  cleanupOrphansBackground,
  type ResolvedRepoRef,
  type FileResult,
  type SymbolMatch,
  type ImportRef,
  type RepoWithRefs,
} from "./repo-service.js";
