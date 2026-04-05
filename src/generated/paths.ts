// ⚠️  AUTO-GENERATED from openapi.yaml — do not edit manually.
// Regenerate with: pnpm generate:api

export const apiPaths = {
  buildContext: "/api/repos/:name/context",
  createRepo: "/api/repos",
  deleteRepo: "/api/repos/:name",
  deleteVersion: "/api/repos/:name/versions/:ref",
  find: "/api/repos/:name/refs/:ref/find",
  findReferences: "/api/repos/:name/refs/:ref/references/:symbolName",
  getAllIndexingStatus: "/api/indexing-status",
  getFile: "/api/repos/:name/refs/:ref/file",
  getFileTree: "/api/repos/:name/refs/:ref/tree",
  getGitCredentialHosts: "/api/git-credentials/hosts",
  getGitRefs: "/api/repos/:name/git-refs",
  getHealth: "/health",
  getIndexingStatus: "/api/indexing-status/:name/:ref",
  getRepo: "/api/repos/:name",
  getSymbol: "/api/repos/:name/refs/:ref/symbols/:symbolName",
  listRepos: "/api/repos",
  searchCode: "/api/search",
  syncRepo: "/api/repos/:name/sync",
  updateRepo: "/api/repos/:name",
} as const;

export type ApiPathKey = keyof typeof apiPaths;
