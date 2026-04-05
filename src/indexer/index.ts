/**
 * Barrel export for the indexer module.
 */
export { chunkFile, estimateTokens, type ChunkOutput, type ChunkerOptions } from "./chunker.js";

export {
  type Embedder,
  DB_EMBEDDING_DIMENSIONS,
  OllamaEmbedder,
  embedInBatches,
  createEmbedder,
  truncateForEmbedding,
  MAX_EMBED_TOKENS,
} from "./embedder.js";

export {
  runPipeline,
  PipelineCancelledError,
  shouldSkipFile,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_AVG_LINE_LENGTH,
  type PipelineOptions,
  type PipelineInput,
  type PipelineProgressEvent,
  type PipelineProgressCallback,
  type FileSkipReason,
} from "./pipeline.js";
