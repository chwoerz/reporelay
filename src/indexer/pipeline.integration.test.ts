import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgres, stopPostgres, getSql } from "../../test/setup/postgres.js";
import { createTestRepo, addCommitToTestRepo, type TestRepo } from "../../test/setup/test-repo.js";
import { allLanguageFiles, TYPESCRIPT_SAMPLE } from "../../test/fixtures/samples.js";
import { runMigrations } from "../storage/index.js";
import { createDb, type Db } from "../storage/index.js";
import { RepoRepository } from "../storage/index.js";
import { RepoRefRepository } from "../storage/index.js";
import { RefFileRepository } from "../storage/index.js";
import { SymbolRepository } from "../storage/index.js";
import { ChunkRepository } from "../storage/index.js";
import { createMockEmbedder } from "../../test/setup/mock-embedder.js";
import { runPipeline } from "./pipeline.js";
import { listFiles } from "../git/git-sync.js";
import { simpleGit } from "simple-git";

describe("Indexing Pipeline (integration)", () => {
  let repo: TestRepo;
  let db: Db;
  let repoRow: { id: number };
  let refRow: { id: number };
  let refRow2: { id: number };
  let commitSha: string;

  beforeAll(async () => {
    const { sql } = await startPostgres();
    await runMigrations(sql);
    db = createDb(sql);

    // Create a test git repo with all supported languages
    repo = await createTestRepo(allLanguageFiles());

    // Get commit SHA
    const git = simpleGit(repo.path);
    commitSha = (await git.revparse(["HEAD"])).trim();

    // Create repo + ref in DB
    const repoRepo = new RepoRepository(db);
    repoRow = await repoRepo.insertOne({
      name: repo.name,
      localPath: repo.path,
    });

    const refRepo = new RepoRefRepository(db);
    refRow = await refRepo.insertOne({
      repoId: repoRow.id,
      ref: "v1.0.0",
      commitSha,
      stage: "indexing",
    });

    // Get all files (full index via git ls-tree)
    const files = await listFiles(repo.path, commitSha, []);

    // Run the pipeline
    const embedder = createMockEmbedder();
    await runPipeline({ db, embedder }, { worktreePath: repo.path, repoRefId: refRow.id, files });
  }, 120_000);

  afterAll(async () => {
    await repo?.cleanup();
    await stopPostgres();
  });

  describe("full index", () => {
    it("clones repo, parses all files, stores files/symbols/chunks in DB", async () => {
      const rfRepo = new RefFileRepository(db);
      const refFileRows = await rfRepo.findByRepoRef(refRow.id);

      // Should have indexed the supported language files (TS, PY, GO, Java, Kotlin, Rust, C, C++, Markdown)
      // package.json and logo.png should be skipped (unsupported)
      expect(refFileRows.length).toBeGreaterThanOrEqual(9);

      // Verify some expected paths are present
      const paths = refFileRows.map((r) => r.path);
      expect(paths).toContain("src/service.ts");
      expect(paths).toContain("src/calculator.py");
      expect(paths).toContain("src/server.go");
      expect(paths).toContain("docs/README.md");
    });

    it("sets repo_ref status to 'ready' after completion", async () => {
      const refRepo = new RepoRefRepository(db);
      const ref = await refRepo.findById(refRow.id);
      expect(ref).toBeDefined();
      expect(ref!.stage).toBe("ready");
    });

    it("stores language stats on repo_ref after completion", async () => {
      const refRepo = new RepoRefRepository(db);
      const ref = await refRepo.findById(refRow.id);
      expect(ref).toBeDefined();
      expect(ref!.languageStats).toBeDefined();
      const stats = ref!.languageStats as Record<string, number>;
      // Should contain at least typescript (from service.ts) and python (from calculator.py)
      expect(stats).toHaveProperty("typescript");
      expect(stats).toHaveProperty("python");
      // Percentages should sum to ~100
      const total = Object.values(stats).reduce((sum, pct) => sum + pct, 0);
      expect(total).toBeGreaterThan(99);
      expect(total).toBeLessThanOrEqual(100.1);
    });

    it("creates BM25-searchable entries for all chunks", async () => {
      // The ParadeDB BM25 index auto-indexes content on INSERT
      const sql = getSql();
      const rows = await sql`
        SELECT id FROM chunks WHERE content @@@ 'function'
      `;
      expect(rows.length).toBeGreaterThan(0);
    });

    it("creates embedding vectors (mock) for all chunks", async () => {
      const chunkRepo = new ChunkRepository(db);
      const allChunks = await chunkRepo.findAll();

      expect(allChunks.length).toBeGreaterThan(0);
      const withEmbedding = allChunks.filter((c) => c.embedding != null);
      // All chunks should have embeddings after pipeline runs
      expect(withEmbedding.length).toBe(allChunks.length);
    });

    it("stores correct symbol count per file", async () => {
      // Check that the TypeScript sample file has symbols stored
      const rfRepo = new RefFileRepository(db);
      const tsFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/service.ts");
      expect(tsFile).toBeDefined();

      const symRepo = new SymbolRepository(db);
      const tsSymbols = await symRepo.findByFileContentId(tsFile!.fileContentId);

      // TypeScript sample has: ServiceConfig interface, Status enum, Service class, ServiceFactory type, createService variable
      expect(tsSymbols.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("second ref (full index after changes)", () => {
    let newCommitSha: string;

    beforeAll(async () => {
      // Add a new commit: modify one file, delete one file, add a new one
      newCommitSha = await addCommitToTestRepo(
        repo.path,
        {
          "src/service.ts": TYPESCRIPT_SAMPLE + "\n// updated\n",
          "src/calculator.py": null, // delete
          "src/new-file.ts": 'export const NEW = "new";\n',
        },
        "incremental update",
      );

      // Create a new ref for the second commit
      const refRepo = new RepoRefRepository(db);
      refRow2 = await refRepo.insertOne({
        repoId: repoRow.id,
        ref: "v2.0.0",
        commitSha: newCommitSha,
        stage: "indexing",
      });

      // Full index — list all files at new commit
      const files = await listFiles(repo.path, newCommitSha, []);

      const embedder = createMockEmbedder();
      await runPipeline(
        { db, embedder },
        { worktreePath: repo.path, repoRefId: refRow2.id, files },
      );
    });

    it("v2 ref has a complete file set (all unchanged + changed, minus deleted)", async () => {
      const rfRepo = new RefFileRepository(db);
      const ref1Files = await rfRepo.findByRepoRef(refRow.id);
      const ref2Files = await rfRepo.findByRepoRef(refRow2.id);

      const ref1Paths = new Set(ref1Files.map((r) => r.path));
      const ref2Paths = new Set(ref2Files.map((r) => r.path));

      // Every file in ref1 except deleted ones should be in ref2
      for (const path of ref1Paths) {
        if (path === "src/calculator.py") {
          expect(ref2Paths.has(path)).toBe(false);
        } else {
          expect(ref2Paths.has(path)).toBe(true);
        }
      }

      // New file should be present
      expect(ref2Paths.has("src/new-file.ts")).toBe(true);

      // Explicit check: calculator.py was deleted in the new commit, absent from ref2
      const deleted = await rfRepo.findByRepoRefAndPath(refRow2.id, "src/calculator.py");
      expect(deleted).toBeUndefined();

      // SHA-256 dedup: unchanged files should share file_content_id across refs
      const goV1 = ref1Files.find((r) => r.path === "src/server.go");
      const goV2 = ref2Files.find((r) => r.path === "src/server.go");
      expect(goV2!.fileContentId).toBe(goV1!.fileContentId);
    });

    it("updates commitSha on repo_ref after full index", async () => {
      const refRepo = new RepoRefRepository(db);
      const ref = await refRepo.findById(refRow2.id);
      expect(ref).toBeDefined();
      expect(ref!.commitSha).toBe(newCommitSha);
      expect(ref!.stage).toBe("ready");
    });
  });

  describe("dedup (SHA-256 donor)", () => {
    let refRow3: { id: number };

    beforeAll(async () => {
      // Checkout the original commit so working directory matches v1.0.0
      const git = simpleGit(repo.path);
      await git.checkout(commitSha);

      // Create another ref pointing to the same initial commit
      // This means all files are identical to v1.0.0
      const refRepo = new RepoRefRepository(db);
      refRow3 = await refRepo.insertOne({
        repoId: repoRow.id,
        ref: "v1.0.0-copy",
        commitSha,
        stage: "indexing",
      });

      const files = await listFiles(repo.path, commitSha, []);
      const embedder = createMockEmbedder();
      await runPipeline(
        { db, embedder },
        { worktreePath: repo.path, repoRefId: refRow3.id, files },
      );
    });

    it("when two refs contain identical files, reuses file_contents from donor ref", async () => {
      const rfRepo = new RefFileRepository(db);
      const ref1Files = await rfRepo.findByRepoRef(refRow.id);
      const ref3Files = await rfRepo.findByRepoRef(refRow3.id);

      // For each path in ref1, find the matching path in ref3 and verify they share the same fileContentId
      for (const rf1 of ref1Files) {
        const rf3 = ref3Files.find((r) => r.path === rf1.path);
        if (rf3) {
          expect(rf3.fileContentId).toBe(rf1.fileContentId);
        }
      }
    });

    it("cloned ref_files have correct repoRefId (not the donor's)", async () => {
      const rfRepo = new RefFileRepository(db);
      const ref3Files = await rfRepo.findByRepoRef(refRow3.id);

      expect(ref3Files.length).toBeGreaterThan(0);
      ref3Files.forEach((rf) => {
        expect(rf.repoRefId).toBe(refRow3.id);
      });
    });
  });

    // At this point v1.0.0 and v2.0.0 are already indexed.
  // v2.0.0 has: service.ts (modified), new-file.ts (added), calculator.py (deleted).
  // We now create v1.1.0 branching from the v1.0.0 commit — a minor update that
  // adds src/utils.ts and tweaks service.ts, but keeps calculator.py.
  // Because v2.0.0 was indexed first, this tests that full-index (ls-tree) is
  // immune to indexing order — v1.1.0 must get exactly the files that exist at
  // its commit, regardless of what other refs have been indexed.

  describe("out-of-order indexing (v1.1 after v2.0)", () => {
    let refRow11: { id: number };
    let commitSha11: string;

    beforeAll(async () => {
      // Branch from the v1.0.0 commit to create a v1.1.0 history line
      const git = simpleGit(repo.path);
      await git.checkout(commitSha);

      // Minor update: tweak service.ts, add utils.ts, keep everything else
      await addCommitToTestRepo(
        repo.path,
        {
          "src/service.ts": TYPESCRIPT_SAMPLE + "\n// v1.1 patch\n",
          "src/utils.ts":
            "export function clamp(n: number, lo: number, hi: number): number {\n  return Math.min(hi, Math.max(lo, n));\n}\n",
        },
        "v1.1.0 patch release",
      );
      // In detached HEAD state simple-git's commit().commit may include "HEAD",
      // so resolve the SHA cleanly via rev-parse.
      commitSha11 = (await git.revparse(["HEAD"])).trim();

      const refRepo = new RepoRefRepository(db);
      refRow11 = await refRepo.insertOne({
        repoId: repoRow.id,
        ref: "v1.1.0",
        commitSha: commitSha11,
        stage: "indexing",
      });

      const files = await listFiles(repo.path, commitSha11, []);
      const embedder = createMockEmbedder();
      await runPipeline(
        { db, embedder },
        { worktreePath: repo.path, repoRefId: refRow11.id, files },
      );
    });

    it("v1.1 has all v1.0 files plus newly added utils.ts", async () => {
      const rfRepo = new RefFileRepository(db);
      const v11Files = await rfRepo.findByRepoRef(refRow11.id);
      const v11Paths = new Set(v11Files.map((r) => r.path));

      // All original v1.0 files should still be present
      expect(v11Paths.has("src/service.ts")).toBe(true);
      expect(v11Paths.has("src/calculator.py")).toBe(true);
      expect(v11Paths.has("src/server.go")).toBe(true);
      expect(v11Paths.has("src/Task.java")).toBe(true);
      expect(v11Paths.has("src/model.kt")).toBe(true);
      expect(v11Paths.has("src/config.rs")).toBe(true);
      expect(v11Paths.has("src/server.h")).toBe(true);
      expect(v11Paths.has("src/logger.hpp")).toBe(true);
      expect(v11Paths.has("docs/README.md")).toBe(true);

      // New file added in v1.1
      expect(v11Paths.has("src/utils.ts")).toBe(true);

      // new-file.ts was added in v2.0.0, not in v1.1.0 — must be absent
      expect(v11Paths.has("src/new-file.ts")).toBe(false);
    });

    it("v1.1 dedup: changed files get new content, unchanged files reuse existing", async () => {
      const rfRepo = new RefFileRepository(db);

      // Changed file: service.ts has different content in all three refs
      const tsV10 = await rfRepo.findByRepoRefAndPath(refRow.id, "src/service.ts");
      const tsV11 = await rfRepo.findByRepoRefAndPath(refRow11.id, "src/service.ts");
      const tsV20 = await rfRepo.findByRepoRefAndPath(refRow2.id, "src/service.ts");

      expect(tsV10).toBeDefined();
      expect(tsV11).toBeDefined();
      expect(tsV20).toBeDefined();

      // All three versions have different content → different SHA-256 → different file_content_id
      expect(tsV11!.fileContentId).not.toBe(tsV10!.fileContentId);
      expect(tsV11!.fileContentId).not.toBe(tsV20!.fileContentId);

      // Unchanged file: server.go is identical in v1.0 and v1.1 — should share file_content_id
      const goV10 = await rfRepo.findByRepoRefAndPath(refRow.id, "src/server.go");
      const goV11 = await rfRepo.findByRepoRefAndPath(refRow11.id, "src/server.go");
      expect(goV11!.fileContentId).toBe(goV10!.fileContentId);

      // Unchanged file: calculator.py is identical in v1.0 and v1.1 — should share file_content_id
      const pyV10 = await rfRepo.findByRepoRefAndPath(refRow.id, "src/calculator.py");
      const pyV11 = await rfRepo.findByRepoRefAndPath(refRow11.id, "src/calculator.py");
      expect(pyV11!.fileContentId).toBe(pyV10!.fileContentId);
    });

    it("indexing v1.1 does not corrupt v2.0's file set", async () => {
      const rfRepo = new RefFileRepository(db);
      const v20Files = await rfRepo.findByRepoRef(refRow2.id);
      const v20Paths = new Set(v20Files.map((r) => r.path));

      // v2.0 should still have its own files, unaffected by v1.1 being indexed after
      expect(v20Paths.has("src/service.ts")).toBe(true);
      expect(v20Paths.has("src/new-file.ts")).toBe(true);

      // v2.0 deleted calculator.py — it should still be absent
      expect(v20Paths.has("src/calculator.py")).toBe(false);

      // v1.1's utils.ts should NOT leak into v2.0
      expect(v20Paths.has("src/utils.ts")).toBe(false);
    });

    it("indexing v1.1 does not corrupt v1.0's file set", async () => {
      const rfRepo = new RefFileRepository(db);
      const v10Files = await rfRepo.findByRepoRef(refRow.id);
      const v10Paths = new Set(v10Files.map((r) => r.path));

      // v1.0 should still have its original files
      expect(v10Paths.has("src/service.ts")).toBe(true);
      expect(v10Paths.has("src/calculator.py")).toBe(true);
      expect(v10Paths.has("src/server.go")).toBe(true);

      // v1.1's utils.ts should NOT leak into v1.0
      expect(v10Paths.has("src/utils.ts")).toBe(false);

      // v2.0's new-file.ts should NOT leak into v1.0
      expect(v10Paths.has("src/new-file.ts")).toBe(false);
    });
  });

  describe("multi-language", () => {
    it("indexes TypeScript files via tree-sitter", async () => {
      const rfRepo = new RefFileRepository(db);
      const tsFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/service.ts");
      expect(tsFile).toBeDefined();

      const chunkRepo = new ChunkRepository(db);
      const tsChunks = await chunkRepo.findByFileContentId(tsFile!.fileContentId);
      expect(tsChunks.length).toBeGreaterThan(0);
    });

    it("indexes Python files via tree-sitter", async () => {
      const rfRepo = new RefFileRepository(db);
      const pyFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/calculator.py");
      expect(pyFile).toBeDefined();

      const symRepo = new SymbolRepository(db);
      const pySymbols = await symRepo.findByFileContentId(pyFile!.fileContentId);
      expect(pySymbols.length).toBeGreaterThan(0);
    });

    it("indexes Go files via tree-sitter", async () => {
      const rfRepo = new RefFileRepository(db);
      const goFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/server.go");
      expect(goFile).toBeDefined();

      const symRepo = new SymbolRepository(db);
      const goSymbols = await symRepo.findByFileContentId(goFile!.fileContentId);
      expect(goSymbols.length).toBeGreaterThan(0);
    });

    it("indexes Rust files via tree-sitter", async () => {
      const rfRepo = new RefFileRepository(db);
      const rsFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/config.rs");
      expect(rsFile).toBeDefined();

      const symRepo = new SymbolRepository(db);
      const rsSymbols = await symRepo.findByFileContentId(rsFile!.fileContentId);
      expect(rsSymbols.length).toBeGreaterThan(0);
    });

    it("indexes C/C++ files via tree-sitter", async () => {
      const rfRepo = new RefFileRepository(db);
      const cFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/server.h");
      expect(cFile).toBeDefined();

      const cppFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/logger.hpp");
      expect(cppFile).toBeDefined();

      const symRepo = new SymbolRepository(db);
      const cSymbols = await symRepo.findByFileContentId(cFile!.fileContentId);
      expect(cSymbols.length).toBeGreaterThan(0);
    });

    it("indexes Markdown files via markdown parser", async () => {
      const rfRepo = new RefFileRepository(db);
      const mdFile = await rfRepo.findByRepoRefAndPath(refRow.id, "docs/README.md");
      expect(mdFile).toBeDefined();

      const chunkRepo = new ChunkRepository(db);
      const mdChunks = await chunkRepo.findByFileContentId(mdFile!.fileContentId);
      expect(mdChunks.length).toBeGreaterThan(0);
    });

    it("skips unsupported file types (.png, .lock, etc.)", async () => {
      const rfRepo = new RefFileRepository(db);

      // package.json is not a supported language
      const jsonFile = await rfRepo.findByRepoRefAndPath(refRow.id, "package.json");
      expect(jsonFile).toBeUndefined();

      // logo.png is not a supported language
      const pngFile = await rfRepo.findByRepoRefAndPath(refRow.id, "assets/logo.png");
      expect(pngFile).toBeUndefined();
    });
  });
});
