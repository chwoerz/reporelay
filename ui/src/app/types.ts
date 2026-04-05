/**
 * Re-export API types from the generated OpenAPI spec.
 *
 * The generated types live in src/generated/types/ and are produced
 * by `pnpm generate:api` (Kubb + openapi-typescript).  The @api/*
 * path alias is configured in ui/tsconfig.json.
 */

export type { RepoRef } from '@api/RepoRef';
export type { Repo } from '@api/Repo';
export type { SearchResult } from '@api/SearchResult';
export type { FileContent } from '@api/FileContent';
export type { SymbolInfo } from '@api/SymbolInfo';
export type { SymbolDetail } from '@api/SymbolDetail';
export type { SymbolLookup } from '@api/SymbolLookup';
export type { FindResult } from '@api/FindResult';
export type { ImportReference } from '@api/ImportReference';
export type { ContextChunk } from '@api/ContextChunk';
export type { ContextPackResult } from '@api/ContextPackResult';
export type { GitRefs } from '@api/GitRefs';
export type { IndexingProgress } from '@api/IndexingProgress';
export type { IndexingStage } from '@api/IndexingStage';
export { indexingStageEnum } from '@api/IndexingStage';
