/**
 * Barrel export for the retrieval module.
 */
export { resolveSemver, resolveRef, type ResolvedRef } from "./semver-resolver.js";

export {
  rewriteQuery,
  dedupOverlapping,
  searchHybrid,
  type HybridSearchOptions,
  type RewrittenQuery,
} from "./hybrid-search.js";
