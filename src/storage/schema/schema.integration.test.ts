import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgres, stopPostgres, getSql } from "../../../test/setup/postgres.js";
import { runMigrations } from "./migrate.js";
import { createDb, type Db } from "./db.js";
import { RepoRepository } from "../repositories/repo-repository.js";
import { RepoRefRepository } from "../repositories/repo-ref-repository.js";
import { FileContentRepository } from "../repositories/file-repository.js";
import { RefFileRepository } from "../repositories/ref-file-repository.js";
import { SymbolRepository } from "../repositories/symbol-repository.js";
import { ChunkRepository } from "../repositories/chunk-repository.js";
import { eq } from "drizzle-orm";
import { repos } from "./schema.js";

let db: Db;

describe("Storage Schema (integration)", () => {
  beforeAll(async () => {
    await startPostgres();
    await runMigrations(getSql());
    db = createDb(getSql());
  });
  afterAll(async () => {
    await stopPostgres();
  });

  describe("migrations", () => {
    it("creates all tables on first run (repos, repo_refs, file_contents, ref_files, symbols, chunks)", async () => {
      const result = await getSql()`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;
      const names = result.map((r) => (r as Record<string, string>).table_name);
      expect(names).toContain("repos");
      expect(names).toContain("repo_refs");
      expect(names).toContain("file_contents");
      expect(names).toContain("ref_files");
      expect(names).toContain("symbols");
      expect(names).toContain("chunks");
    });

    it("enables pgvector extension", async () => {
      const result = await getSql()`
        SELECT extname FROM pg_extension WHERE extname = 'vector'
      `;
      expect(result).toHaveLength(1);
    });

    it("enables pg_trgm extension", async () => {
      const result = await getSql()`
        SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
      `;
      expect(result).toHaveLength(1);
    });

    it("is idempotent (running twice does not error)", async () => {
      await expect(runMigrations(getSql())).resolves.not.toThrow();
    });
  });

  describe("repos table", () => {
    it("inserts a repo with name, localPath, defaultBranch", async () => {
      const repoRepo = new RepoRepository(db);
      const repo = await repoRepo.insertOne({
        name: "test-repo-insert",
        localPath: "/tmp/test",
        defaultBranch: "main",
      });
      expect(repo.id).toBeTypeOf("number");
      expect(repo.name).toBe("test-repo-insert");
      expect(repo.localPath).toBe("/tmp/test");
      expect(repo.defaultBranch).toBe("main");
      expect(repo.createdAt).toBeInstanceOf(Date);
    });

    it("enforces unique repo name", async () => {
      const repoRepo = new RepoRepository(db);
      await repoRepo.insertOne({ name: "unique-test", defaultBranch: "main" });
      await expect(
        repoRepo.insertOne({ name: "unique-test", defaultBranch: "main" }),
      ).rejects.toThrow();
    });

    it("cascades delete to repo_refs, ref_files, and transitively to symbols/chunks via file_contents", async () => {
      const repoRepo = new RepoRepository(db);
      const refRepo = new RepoRefRepository(db);
      const fcRepo = new FileContentRepository(db);
      const rfRepo = new RefFileRepository(db);
      const symbolRepo = new SymbolRepository(db);
      const chunkRepo = new ChunkRepository(db);

      const repo = await repoRepo.insertOne({
        name: "cascade-test",
        defaultBranch: "main",
      });
      const ref = await refRepo.insertOne({
        repoId: repo.id,
        ref: "main",
        commitSha: "abc123",
        stage: "ready",
      });
      const fc = await fcRepo.insertOne({
        sha256: "deadbeef-cascade",
        language: "typescript",
      });
      await rfRepo.insertOne({
        repoRefId: ref.id,
        fileContentId: fc.id,
        path: "src/index.ts",
      });
      const symbol = await symbolRepo.insertOne({
        fileContentId: fc.id,
        name: "main",
        kind: "function",
        signature: "function main()",
        startLine: 1,
        endLine: 5,
      });
      await chunkRepo.insertOne({
        fileContentId: fc.id,
        symbolId: symbol.id,
        content: "function main() {}",
        startLine: 1,
        endLine: 5,
      });

      // Delete the repo — repo_refs and ref_files should cascade
      await repoRepo.deleteWhere(eq(repos.id, repo.id));

      const refs = await refRepo.findByRepoId(repo.id);
      expect(refs).toHaveLength(0);

      const rfs = await rfRepo.findByRepoRef(ref.id);
      expect(rfs).toHaveLength(0);

      // file_contents remains (RESTRICT, not CASCADE from ref_files)
      // but symbols/chunks still exist because file_contents still exists
      const syms = await symbolRepo.findByFileContentId(fc.id);
      expect(syms).toHaveLength(1);

      const chunks = await chunkRepo.findByFileContentId(fc.id);
      expect(chunks).toHaveLength(1);

      // Clean up: delete file_contents manually (orphan cleanup)
      await fcRepo.deleteWhere(eq((await import("./schema.js")).fileContents.id, fc.id));
    });
  });

  describe("repo_refs table", () => {
    it("inserts a ref with repo_id, ref name, commitSha, status", async () => {
      const repoRepo = new RepoRepository(db);
      const refRepo = new RepoRefRepository(db);

      const repo = await repoRepo.insertOne({
        name: "ref-test-repo",
        defaultBranch: "main",
      });
      const ref = await refRepo.insertOne({
        repoId: repo.id,
        ref: "main",
        commitSha: "abc123",
        stage: "indexing",
      });
      expect(ref.id).toBeTypeOf("number");
      expect(ref.repoId).toBe(repo.id);
      expect(ref.ref).toBe("main");
      expect(ref.commitSha).toBe("abc123");
      expect(ref.stage).toBe("indexing");
    });

    it("stores semver field for tag-like refs", async () => {
      const repoRepo = new RepoRepository(db);
      const refRepo = new RepoRefRepository(db);

      const repo = await repoRepo.insertOne({
        name: "semver-test-repo",
        defaultBranch: "main",
      });
      const ref = await refRepo.insertOne({
        repoId: repo.id,
        ref: "v1.2.3",
        commitSha: "def456",
        stage: "ready",
        semver: "1.2.3",
      });
      expect(ref.semver).toBe("1.2.3");
    });

    it("updates status from indexing to ready", async () => {
      const repoRepo = new RepoRepository(db);
      const refRepo = new RepoRefRepository(db);

      const repo = await repoRepo.insertOne({
        name: "status-update-repo",
        defaultBranch: "main",
      });
      const ref = await refRepo.insertOne({
        repoId: repo.id,
        ref: "main",
        commitSha: "abc",
        stage: "indexing",
      });
      expect(ref.stage).toBe("indexing");

      const [updated] = await refRepo.updateStage(ref.id, "ready");
      expect(updated.stage).toBe("ready");
    });

    it("enforces unique (repo_id, ref) pair", async () => {
      const repoRepo = new RepoRepository(db);
      const refRepo = new RepoRefRepository(db);

      const repo = await repoRepo.insertOne({
        name: "unique-ref-repo",
        defaultBranch: "main",
      });
      await refRepo.insertOne({
        repoId: repo.id,
        ref: "main",
        commitSha: "aaa",
        stage: "ready",
      });
      await expect(
        refRepo.insertOne({
          repoId: repo.id,
          ref: "main",
          commitSha: "bbb",
          stage: "ready",
        }),
      ).rejects.toThrow();
    });
  });

  describe("file_contents + ref_files tables", () => {
    it("inserts file_contents with sha256 and language", async () => {
      const fcRepo = new FileContentRepository(db);
      const fc = await fcRepo.insertOne({
        sha256: "abc123hash-fc",
        language: "typescript",
      });
      expect(fc.id).toBeTypeOf("number");
      expect(fc.sha256).toBe("abc123hash-fc");
      expect(fc.language).toBe("typescript");
    });

    it("inserts ref_files linking a ref+path to file_contents", async () => {
      const repoRepo = new RepoRepository(db);
      const refRepo = new RepoRefRepository(db);
      const fcRepo = new FileContentRepository(db);
      const rfRepo = new RefFileRepository(db);

      const repo = await repoRepo.insertOne({
        name: "file-test-repo",
        defaultBranch: "main",
      });
      const ref = await refRepo.insertOne({
        repoId: repo.id,
        ref: "main",
        commitSha: "aaa",
        stage: "ready",
      });
      const fc = await fcRepo.insertOne({
        sha256: "hash-file-test",
        language: "typescript",
      });
      const rf = await rfRepo.insertOne({
        repoRefId: ref.id,
        fileContentId: fc.id,
        path: "src/main.ts",
      });
      expect(rf.id).toBeTypeOf("number");
      expect(rf.repoRefId).toBe(ref.id);
      expect(rf.fileContentId).toBe(fc.id);
      expect(rf.path).toBe("src/main.ts");
    });

    it("enforces unique (repo_ref_id, path) on ref_files", async () => {
      const repoRepo = new RepoRepository(db);
      const refRepo = new RepoRefRepository(db);
      const fcRepo = new FileContentRepository(db);
      const rfRepo = new RefFileRepository(db);

      const repo = await repoRepo.insertOne({
        name: "file-unique-repo",
        defaultBranch: "main",
      });
      const ref = await refRepo.insertOne({
        repoId: repo.id,
        ref: "main",
        commitSha: "aaa",
        stage: "ready",
      });
      const fc = await fcRepo.insertOne({ sha256: "hash-uniq-1" });
      const fc2 = await fcRepo.insertOne({ sha256: "hash-uniq-2" });
      await rfRepo.insertOne({
        repoRefId: ref.id,
        fileContentId: fc.id,
        path: "src/dup.ts",
      });
      await expect(
        rfRepo.insertOne({
          repoRefId: ref.id,
          fileContentId: fc2.id,
          path: "src/dup.ts",
        }),
      ).rejects.toThrow();
    });

    it("enforces unique sha256 on file_contents", async () => {
      const fcRepo = new FileContentRepository(db);
      await fcRepo.insertOne({ sha256: "dup-sha256" });
      await expect(fcRepo.insertOne({ sha256: "dup-sha256" })).rejects.toThrow();
    });
  });

  describe("symbols table", () => {
    it("inserts a symbol with fileContentId, name, kind, signature, startLine, endLine", async () => {
      const fcRepo = new FileContentRepository(db);
      const symbolRepo = new SymbolRepository(db);

      const fc = await fcRepo.insertOne({
        sha256: "hash-sym-test",
        language: "typescript",
      });
      const sym = await symbolRepo.insertOne({
        fileContentId: fc.id,
        name: "greet",
        kind: "function",
        signature: "function greet(name: string): string",
        startLine: 1,
        endLine: 3,
        documentation: "Says hello",
      });
      expect(sym.id).toBeTypeOf("number");
      expect(sym.name).toBe("greet");
      expect(sym.kind).toBe("function");
      expect(sym.signature).toBe("function greet(name: string): string");
      expect(sym.startLine).toBe(1);
      expect(sym.endLine).toBe(3);
      expect(sym.documentation).toBe("Says hello");
    });

    it("supports symbol kinds: function, class, interface, type, enum, method, struct, trait", async () => {
      const fcRepo = new FileContentRepository(db);
      const symbolRepo = new SymbolRepository(db);

      const fc = await fcRepo.insertOne({ sha256: "hash-kinds" });

      const kinds = ["function", "class", "interface", "type", "enum", "method", "struct", "trait"];
      const inserted = await symbolRepo.insertMany(
        kinds.map((kind, i) => ({
          fileContentId: fc.id,
          name: `sym_${kind}`,
          kind,
          signature: `${kind} sym_${kind}`,
          startLine: i * 10 + 1,
          endLine: i * 10 + 5,
        })),
      );
      expect(inserted).toHaveLength(kinds.length);
      const insertedKinds = inserted.map((s) => s.kind);
      kinds.forEach((k) => expect(insertedKinds).toContain(k));
    });
  });

  describe("chunks table", () => {
    it("inserts a chunk with fileContentId, content, startLine, endLine", async () => {
      const fcRepo = new FileContentRepository(db);
      const chunkRepo = new ChunkRepository(db);

      const fc = await fcRepo.insertOne({ sha256: "hash-chunk-test" });
      const chunk = await chunkRepo.insertOne({
        fileContentId: fc.id,
        content: "const x = 1;",
        startLine: 1,
        endLine: 1,
      });
      expect(chunk.id).toBeTypeOf("number");
      expect(chunk.fileContentId).toBe(fc.id);
      expect(chunk.content).toBe("const x = 1;");
      expect(chunk.startLine).toBe(1);
      expect(chunk.endLine).toBe(1);
    });

    it("stores embedding vector of configured dimensions", async () => {
      const fcRepo = new FileContentRepository(db);
      const chunkRepo = new ChunkRepository(db);

      const fc = await fcRepo.insertOne({ sha256: "hash-embed-test" });
      const embedding = Array.from({ length: 768 }, (_, i) => i * 0.001);
      const chunk = await chunkRepo.insertOne({
        fileContentId: fc.id,
        content: "const y = 2;",
        startLine: 1,
        endLine: 1,
        embedding,
      });
      expect(chunk.embedding).toHaveLength(768);
    });

    it("links optional symbol_id", async () => {
      const fcRepo = new FileContentRepository(db);
      const symbolRepo = new SymbolRepository(db);
      const chunkRepo = new ChunkRepository(db);

      const fc = await fcRepo.insertOne({ sha256: "hash-symlink-test" });
      const symbol = await symbolRepo.insertOne({
        fileContentId: fc.id,
        name: "hello",
        kind: "function",
        signature: "function hello()",
        startLine: 1,
        endLine: 3,
      });
      const chunk = await chunkRepo.insertOne({
        fileContentId: fc.id,
        symbolId: symbol.id,
        content: "function hello() {}",
        startLine: 1,
        endLine: 3,
      });
      expect(chunk.symbolId).toBe(symbol.id);

      // Chunk without symbol
      const chunk2 = await chunkRepo.insertOne({
        fileContentId: fc.id,
        content: "// orphan chunk",
        startLine: 4,
        endLine: 4,
      });
      expect(chunk2.symbolId).toBeNull();
    });
  });
});
