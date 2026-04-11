/**
 * Drizzle ORM table definitions for the RepoRelay database.
 *
 * Tables: repos, repoRefs, fileContents, refFiles, symbols, chunks.
 * Custom column types: vector(768) via drizzle built-in.
 * Full-text search: ParadeDB BM25 index on chunks.content (applied in migrate.ts
 * after Drizzle file-based migrations, since ParadeDB syntax is not expressible
 * in the Drizzle schema).
 *
 * Content-addressable design: `fileContents` stores unique file content
 * (keyed by sha256). `refFiles` is a junction table mapping a ref+path
 * to a `fileContents` row. Symbols and chunks reference `fileContents`,
 * so identical files across refs share parsed data and embeddings.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  unique,
  index,
  vector,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const repos = pgTable("repos", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  localPath: text("local_path"),
  remoteUrl: text("remote_url"),
  globPatterns: text("glob_patterns").array().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const repoRefs = pgTable(
  "repo_refs",
  {
    id: serial("id").primaryKey(),
    repoId: integer("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    commitSha: text("commit_sha").notNull(),
    /** Current indexing stage (see IndexingStage enum). */
    stage: text("stage").notNull().default("queued"),
    /** Human-readable description of what the current stage is doing. */
    stageMessage: text("stage_message"),
    semver: text("semver"),
    indexedAt: timestamp("indexed_at"),
    indexingStartedAt: timestamp("indexing_started_at"),
    /** Per-language file count percentages, e.g. { "typescript": 45.2, "java": 54.8 } */
    languageStats: jsonb("language_stats").$type<Record<string, number>>(),
    filesTotal: integer("files_total").notNull().default(0),
    filesProcessed: integer("files_processed").notNull().default(0),
    chunksTotal: integer("chunks_total").notNull().default(0),
    chunksEmbedded: integer("chunks_embedded").notNull().default(0),
    /** Error message when stage is "error". */
    indexingError: text("indexing_error"),
  },
  (t) => [unique("uq_repo_refs_repo_ref").on(t.repoId, t.ref)],
);

export const fileContents = pgTable("file_contents", {
  id: serial("id").primaryKey(),
  sha256: text("sha256").notNull().unique(),
  language: text("language"),
});

export const refFiles = pgTable(
  "ref_files",
  {
    id: serial("id").primaryKey(),
    repoRefId: integer("repo_ref_id")
      .notNull()
      .references(() => repoRefs.id, { onDelete: "cascade" }),
    fileContentId: integer("file_content_id")
      .notNull()
      .references(() => fileContents.id, { onDelete: "restrict" }),
    path: text("path").notNull(),
  },
  (t) => [unique("uq_ref_files_ref_path").on(t.repoRefId, t.path)],
);

export const symbols = pgTable("symbols", {
  id: serial("id").primaryKey(),
  fileContentId: integer("file_content_id")
    .notNull()
    .references(() => fileContents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  signature: text("signature").notNull(),
  startLine: integer("start_line").notNull(),
  endLine: integer("end_line").notNull(),
  documentation: text("documentation"),
});

export const chunks = pgTable(
  "chunks",
  {
    id: serial("id").primaryKey(),
    fileContentId: integer("file_content_id")
      .notNull()
      .references(() => fileContents.id, { onDelete: "cascade" }),
    symbolId: integer("symbol_id").references(() => symbols.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
    /** Error message when embedding failed for this chunk (Ollama timeout, token overflow, etc.). */
    embeddingError: text("embedding_error"),
  },
  (t) => [index("idx_chunks_embedding").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

export const imports = pgTable("imports", {
  id: serial("id").primaryKey(),
  fileContentId: integer("file_content_id")
    .notNull()
    .references(() => fileContents.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  names: text("names").array().notNull().default([]),
  defaultName: text("default_name"),
  isNamespace: integer("is_namespace").notNull().default(0),
});

relations(repos, ({ many }) => ({
  refs: many(repoRefs),
}));

relations(repoRefs, ({ one, many }) => ({
  repo: one(repos, { fields: [repoRefs.repoId], references: [repos.id] }),
  refFiles: many(refFiles),
}));

relations(fileContents, ({ many }) => ({
  refFiles: many(refFiles),
  symbols: many(symbols),
  chunks: many(chunks),
  imports: many(imports),
}));

relations(refFiles, ({ one }) => ({
  repoRef: one(repoRefs, {
    fields: [refFiles.repoRefId],
    references: [repoRefs.id],
  }),
  fileContent: one(fileContents, {
    fields: [refFiles.fileContentId],
    references: [fileContents.id],
  }),
}));

relations(symbols, ({ one, many }) => ({
  fileContent: one(fileContents, {
    fields: [symbols.fileContentId],
    references: [fileContents.id],
  }),
  chunks: many(chunks),
}));

relations(chunks, ({ one }) => ({
  fileContent: one(fileContents, {
    fields: [chunks.fileContentId],
    references: [fileContents.id],
  }),
  symbol: one(symbols, {
    fields: [chunks.symbolId],
    references: [symbols.id],
  }),
}));

relations(imports, ({ one }) => ({
  fileContent: one(fileContents, {
    fields: [imports.fileContentId],
    references: [fileContents.id],
  }),
}));

export type RepoSelect = typeof repos.$inferSelect;

export type RepoRefSelect = typeof repoRefs.$inferSelect;

export type FileContentSelect = typeof fileContents.$inferSelect;

export type RefFileSelect = typeof refFiles.$inferSelect;

export type SymbolSelect = typeof symbols.$inferSelect;

export type ChunkSelect = typeof chunks.$inferSelect;

export type ImportSelect = typeof imports.$inferSelect;
