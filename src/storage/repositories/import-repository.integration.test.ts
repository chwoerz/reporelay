import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgres, stopPostgres, getSql } from "../../../test/setup/postgres.js";
import { runMigrations } from "../schema/migrate.js";
import { createDb, type Db } from "../schema/db.js";
import { RepoRepository } from "./repo-repository.js";
import { RepoRefRepository } from "./repo-ref-repository.js";
import { FileContentRepository } from "./file-repository.js";
import { RefFileRepository } from "./ref-file-repository.js";
import { ImportRepository } from "./import-repository.js";

let db: Db;

// Shared parent rows created once for the whole suite
let fileContentId1: number;
let fileContentId2: number;
let repoRefId: number;

describe("ImportRepository (integration)", () => {
  beforeAll(async () => {
    await startPostgres();
    await runMigrations(getSql());
    db = createDb(getSql());

    // Seed: repo → repo_ref → two file_contents → two ref_files
    const repoRepo = new RepoRepository(db);
    const repo = await repoRepo.insertOne({
      name: "import-repo-test",
    });

    const refRepo = new RepoRefRepository(db);
    const ref = await refRepo.insertOne({
      repoId: repo.id,
      ref: "v1.0.0",
      commitSha: "aaa111",
      stage: "ready",
    });
    repoRefId = ref.id;

    const fcRepo = new FileContentRepository(db);
    const fc1 = await fcRepo.insertOne({
      sha256: "import-test-sha-1",
      language: "typescript",
    });
    const fc2 = await fcRepo.insertOne({
      sha256: "import-test-sha-2",
      language: "typescript",
    });
    fileContentId1 = fc1.id;
    fileContentId2 = fc2.id;

    const rfRepo = new RefFileRepository(db);
    await rfRepo.insertOne({
      repoRefId: ref.id,
      fileContentId: fc1.id,
      path: "src/index.ts",
    });
    await rfRepo.insertOne({
      repoRefId: ref.id,
      fileContentId: fc2.id,
      path: "src/utils.ts",
    });
  });

  afterAll(async () => {
    await stopPostgres();
  });

  describe("insertOne / findById", () => {
    it("inserts an import row and retrieves it by id", async () => {
      const importRepo = new ImportRepository(db);
      const row = await importRepo.insertOne({
        fileContentId: fileContentId1,
        source: "./helpers",
        names: ["foo", "bar"],
        defaultName: null,
        isNamespace: 0,
      });

      expect(row.id).toBeTypeOf("number");
      expect(row.source).toBe("./helpers");
      expect(row.names).toEqual(["foo", "bar"]);
      expect(row.defaultName).toBeNull();
      expect(row.isNamespace).toBe(0);

      const found = await importRepo.findById(row.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(row.id);
      expect(found!.source).toBe("./helpers");
    });
  });

  describe("insertMany", () => {
    it("inserts multiple import rows in one call", async () => {
      const importRepo = new ImportRepository(db);
      const rows = await importRepo.insertMany([
        {
          fileContentId: fileContentId2,
          source: "lodash",
          names: ["merge", "cloneDeep"],
          defaultName: "_",
          isNamespace: 0,
        },
        {
          fileContentId: fileContentId2,
          source: "node:path",
          names: ["join", "resolve"],
          defaultName: null,
          isNamespace: 0,
        },
      ]);

      expect(rows).toHaveLength(2);
      expect(rows[0]!.source).toBe("lodash");
      expect(rows[1]!.source).toBe("node:path");
    });
  });

  describe("findByFileContentId", () => {
    it("returns all imports for a given file content id", async () => {
      const importRepo = new ImportRepository(db);

      // fileContentId2 has at least the 2 imports from insertMany above
      const results = await importRepo.findByFileContentId(fileContentId2);
      expect(results.length).toBeGreaterThanOrEqual(2);

      const sources = results.map((r) => r.source);
      expect(sources).toContain("lodash");
      expect(sources).toContain("node:path");
    });

    it("returns empty array when no imports exist for a file", async () => {
      const importRepo = new ImportRepository(db);
      const results = await importRepo.findByFileContentId(999_999);
      expect(results).toEqual([]);
    });
  });

  describe("findReferencesInRef", () => {
    beforeAll(async () => {
      // Seed additional imports to exercise named + default + namespace lookups
      const importRepo = new ImportRepository(db);
      await importRepo.insertMany([
        {
          fileContentId: fileContentId1,
          source: "./service",
          names: ["Service", "createService"],
          defaultName: "DefaultService",
          isNamespace: 0,
        },
        {
          fileContentId: fileContentId2,
          source: "./service",
          names: ["Service"],
          defaultName: null,
          isNamespace: 0,
        },
      ]);
    });

    it("finds references by named import", async () => {
      const importRepo = new ImportRepository(db);
      const refs = await importRepo.findReferencesInRef(repoRefId, "Service");

      // Both files import "Service" as a named import
      expect(refs.length).toBeGreaterThanOrEqual(2);

      const paths = refs.map((r) => r.filePath);
      expect(paths).toContain("src/index.ts");
      expect(paths).toContain("src/utils.ts");

      refs.forEach((r) => {
        expect(r.importedName).toBe("Service");
        expect(r.source).toBe("./service");
      });
    });

    it("finds references by default import and marks isDefault correctly", async () => {
      const importRepo = new ImportRepository(db);
      const refs = await importRepo.findReferencesInRef(repoRefId, "DefaultService");

      // Only fileContentId1 (src/index.ts) has DefaultService as a default import
      expect(refs.length).toBeGreaterThanOrEqual(1);

      const match = refs.find((r) => r.filePath === "src/index.ts");
      expect(match).toBeDefined();
      expect(match!.isDefault).toBe(true);
      expect(match!.importedName).toBe("DefaultService");
    });

    it("returns named import with isDefault false", async () => {
      const importRepo = new ImportRepository(db);
      const refs = await importRepo.findReferencesInRef(repoRefId, "createService");

      expect(refs.length).toBeGreaterThanOrEqual(1);
      const match = refs.find((r) => r.filePath === "src/index.ts");
      expect(match).toBeDefined();
      expect(match!.isDefault).toBe(false);
    });

    it("returns empty array when no file imports the given symbol", async () => {
      const importRepo = new ImportRepository(db);
      const refs = await importRepo.findReferencesInRef(repoRefId, "NonExistentSymbol");
      expect(refs).toEqual([]);
    });

    it("scopes results to the given repoRefId only", async () => {
      // Create a second ref with no ref_files → no imports should match
      const refRepo = new RepoRefRepository(db);
      const repoRepo = new RepoRepository(db);
      const repo = await repoRepo.findByName("import-repo-test");
      const ref2 = await refRepo.insertOne({
        repoId: repo!.id,
        ref: "v2.0.0",
        commitSha: "bbb222",
        stage: "ready",
      });

      const importRepo = new ImportRepository(db);
      const refs = await importRepo.findReferencesInRef(ref2.id, "Service");
      expect(refs).toEqual([]);
    });
  });

  describe("deleteWhere", () => {
    it("deletes imports by file content id", async () => {
      const importRepo = new ImportRepository(db);

      // Create a dedicated file_content + import to delete
      const fcRepo = new FileContentRepository(db);
      const fc = await fcRepo.insertOne({
        sha256: "import-delete-test-sha",
        language: "python",
      });
      await importRepo.insertOne({
        fileContentId: fc.id,
        source: "os",
        names: ["path"],
        defaultName: null,
        isNamespace: 0,
      });

      const before = await importRepo.findByFileContentId(fc.id);
      expect(before).toHaveLength(1);

      const { imports } = await import("../schema/schema.js");
      const { eq } = await import("drizzle-orm");
      await importRepo.deleteWhere(eq(imports.fileContentId, fc.id));

      const after = await importRepo.findByFileContentId(fc.id);
      expect(after).toHaveLength(0);
    });
  });

  describe("cascade delete from file_contents", () => {
    it("removes import rows when parent file_contents row is deleted", async () => {
      const importRepo = new ImportRepository(db);
      const fcRepo = new FileContentRepository(db);

      const fc = await fcRepo.insertOne({
        sha256: "import-cascade-test-sha",
        language: "go",
      });
      await importRepo.insertOne({
        fileContentId: fc.id,
        source: "fmt",
        names: ["Println"],
        defaultName: null,
        isNamespace: 0,
      });

      const before = await importRepo.findByFileContentId(fc.id);
      expect(before).toHaveLength(1);

      // Delete parent file_contents row → should cascade
      const { fileContents } = await import("../schema/schema.js");
      const { eq } = await import("drizzle-orm");
      await db.delete(fileContents).where(eq(fileContents.id, fc.id));

      const after = await importRepo.findByFileContentId(fc.id);
      expect(after).toHaveLength(0);
    });
  });
});
