/**
 * Barrel export for the storage module.
 */

// Schema + types
export * from "./schema/schema.js";

// Database connection
export { createDb, type Db } from "./schema/db.js";

// Migrations
export { runMigrations } from "./schema/migrate.js";

// Base repository
export { BaseRepository, FileContentBaseRepository } from "./repositories/base-repository.js";

// Entity repositories
export { RepoRepository } from "./repositories/repo-repository.js";
export {
  RepoRefRepository,
  type ProgressUpdate,
  PENDING_COMMIT_SHA,
} from "./repositories/repo-ref-repository.js";
export { FileContentRepository } from "./repositories/file-repository.js";
export { RefFileRepository } from "./repositories/ref-file-repository.js";
export { SymbolRepository } from "./repositories/symbol-repository.js";
export { ChunkRepository } from "./repositories/chunk-repository.js";
export { ImportRepository } from "./repositories/import-repository.js";

// Queue
export {
  createQueue,
  enqueueIndexJob,
  cancelIndexJob,
  cancelIndexJobsForRepo,
  registerIndexHandler,
  stopQueue,
} from "./queue/queue.js";
