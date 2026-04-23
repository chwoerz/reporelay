/**
 * Barrel export for the indexer module.
 */
export { chunkFile, estimateTokens, type ChunkOutput, type ChunkerOptions } from "./chunker.js";

export {
  type Embedder,
  type EmbeddingFailure,
  type EmbedBatchResult,
  type EmbedderOptions,
  DB_EMBEDDING_DIMENSIONS,
  OllamaEmbedder,
  OpenaiEmbedder,
  embedInBatches,
  createEmbedder,
  truncateForEmbedding,
  MAX_EMBED_TOKENS,
  OLLAMA_MAX_INPUT_TOKENS,
  OPENAI_MAX_INPUT_TOKENS,
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
