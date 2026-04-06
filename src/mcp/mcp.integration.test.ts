import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgres, stopPostgres, getSql } from "../../test/setup/postgres.js";
import { createTestRepo, type TestRepo } from "../../test/setup/test-repo.js";
import { allLanguageFiles } from "../../test/fixtures/samples.js";
import { runMigrations } from "../storage/index.js";
import { createDb, type Db } from "../storage/index.js";
import { createMcpServer, type McpDeps } from "./server.js";
import { createMockEmbedder } from "../../test/setup/mock-embedder.js";
import type { Config } from "../core/config.js";
import { RepoRepository } from "../storage/index.js";
import { RepoRefRepository } from "../storage/index.js";
import { FileContentRepository } from "../storage/index.js";
import { RefFileRepository } from "../storage/index.js";
import { SymbolRepository } from "../storage/index.js";
import { ChunkRepository } from "../storage/index.js";
import { ImportRepository } from "../storage/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let db: Db;
let repo: TestRepo;
let deps: McpDeps;
let client: Client;
let repoId: number;
let repoRefId: number;

describe("MCP Server (integration)", () => {
  beforeAll(async () => {
    await startPostgres();
    await runMigrations(getSql());
    db = createDb(getSql());

    repo = await createTestRepo(allLanguageFiles());

    deps = {
      db,
      embedder: createMockEmbedder(),
      config: {
        DATABASE_URL: "",
        EMBEDDING_URL: "http://localhost:11434",
        EMBEDDING_MODEL: "nomic-embed-text",
        EMBEDDING_BATCH_SIZE: 64,
        MCP_SERVER_PORT: 3000,
        WEB_PORT: 3001,
        GIT_MIRRORS_DIR: repo.path,
        GIT_WORKTREES_DIR: "/tmp/reporelay-wt",
        LOG_LEVEL: "info",
      } as Config,
    };

    // Seed DB: repo → ref → file_contents → ref_files → symbols → chunks → imports
    const repoRepo = new RepoRepository(db);
    const repoRow = await repoRepo.insertOne({
      name: "mcp-test-repo",
      localPath: repo.path,
      defaultBranch: "main",
    });
    repoId = repoRow.id;

    const refRepo = new RepoRefRepository(db);
    const refRow = await refRepo.insertOne({
      repoId: repoRow.id,
      ref: "v1.0.0",
      commitSha: "abc123",
      stage: "ready",
    });
    repoRefId = refRow.id;

    const fcRepo = new FileContentRepository(db);
    const fc1 = await fcRepo.insertOne({ sha256: "mcp-test-sha-ts", language: "typescript" });
    const fc2 = await fcRepo.insertOne({ sha256: "mcp-test-sha-py", language: "python" });

    const rfRepo = new RefFileRepository(db);
    await rfRepo.insertOne({ repoRefId: refRow.id, fileContentId: fc1.id, path: "src/service.ts" });
    await rfRepo.insertOne({
      repoRefId: refRow.id,
      fileContentId: fc2.id,
      path: "src/calculator.py",
    });

    const symRepo = new SymbolRepository(db);
    await symRepo.insertOne({
      fileContentId: fc1.id,
      name: "UserService",
      kind: "class",
      signature: "export class UserService",
      startLine: 1,
      endLine: 20,
    });
    await symRepo.insertOne({
      fileContentId: fc1.id,
      name: "getUser",
      kind: "method",
      signature: "getUser(id: string): User",
      startLine: 5,
      endLine: 10,
    });

    const chunkRepo = new ChunkRepository(db);
    await chunkRepo.insertOne({
      fileContentId: fc1.id,
      content:
        "export class UserService {\n  getUser(id: string): User {\n    return db.find(id);\n  }\n}",
      startLine: 1,
      endLine: 20,
    });
    await chunkRepo.insertOne({
      fileContentId: fc2.id,
      content: "def calculate(a, b):\n    return a + b",
      startLine: 1,
      endLine: 2,
    });

    const importRepo = new ImportRepository(db);
    await importRepo.insertOne({
      fileContentId: fc2.id,
      source: "./service",
      names: ["UserService"],
      defaultName: null,
      isNamespace: 0,
    });

    // Connect MCP client ↔ server in-memory
    const server = createMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client?.close();
    await repo?.cleanup();
    await stopPostgres();
  });

  describe("list_repos tool", () => {
    it("lists registered repos with their refs", async () => {
      const result = await client.callTool({ name: "list_repos", arguments: {} });
      const text = (result.content as any)[0].text as string;
      expect(text).toContain("mcp-test-repo");
      expect(text).toContain("v1.0.0");
      expect(text).toContain("ready");
    });
  });

  describe("get_file tool", () => {
    it("returns file content for valid path (falls back to chunks)", async () => {
      const result = await client.callTool({
        name: "get_file",
        arguments: { repo: "mcp-test-repo", path: "src/service.ts" },
      });
      const text = (result.content as any)[0].text as string;
      expect(text).toContain("UserService");
      expect(text).toContain("mcp-test-repo@v1.0.0");
    });

    it("returns symbols when includeSymbols is true", async () => {
      const result = await client.callTool({
        name: "get_file",
        arguments: { repo: "mcp-test-repo", path: "src/service.ts", includeSymbols: true },
      });
      const text = (result.content as any)[0].text as string;
      expect(text).toContain("Symbols");
      expect(text).toContain("UserService");
      expect(text).toContain("getUser");
    });

    it("returns error for non-existent path", async () => {
      const result = await client.callTool({
        name: "get_file",
        arguments: { repo: "mcp-test-repo", path: "no/such/file.ts" },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("get_symbol tool", () => {
    it("returns symbol source code and metadata", async () => {
      const result = await client.callTool({
        name: "get_symbol",
        arguments: { repo: "mcp-test-repo", symbolName: "UserService" },
      });
      const text = (result.content as any)[0].text as string;
      expect(text).toContain("class");
      expect(text).toContain("export class UserService");
    });

    it("returns imports when includeImports is true", async () => {
      const result = await client.callTool({
        name: "get_symbol",
        arguments: { repo: "mcp-test-repo", symbolName: "UserService", includeImports: true },
      });
      const text = (result.content as any)[0].text as string;
      expect(text).toContain("Imported by");
      expect(text).toContain("src/calculator.py");
    });

    it("returns error for non-existent symbol", async () => {
      const result = await client.callTool({
        name: "get_symbol",
        arguments: { repo: "mcp-test-repo", symbolName: "NonExistent" },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe("find tool", () => {
    it("finds files by path pattern (kind: file)", async () => {
      const result = await client.callTool({
        name: "find",
        arguments: { repo: "mcp-test-repo", pattern: "service", kind: "file" },
      });
      const text = (result.content as any)[0].text as string;
      expect(text).toContain("src/service.ts");
    });

    it("finds symbols by name pattern (kind: symbol)", async () => {
      const result = await client.callTool({
        name: "find",
        arguments: { repo: "mcp-test-repo", pattern: "User", kind: "symbol" },
      });
      const text = (result.content as any)[0].text as string;
      expect(text).toContain("UserService");
    });
  });

  describe("find_references tool", () => {
    it("returns files that import a given symbol", async () => {
      const result = await client.callTool({
        name: "find_references",
        arguments: { repo: "mcp-test-repo", symbolName: "UserService" },
      });
      const text = (result.content as any)[0].text as string;
      expect(text).toContain("src/calculator.py");
      expect(text).toContain("./service");
    });

    it("returns no results for unknown symbol", async () => {
      const result = await client.callTool({
        name: "find_references",
        arguments: { repo: "mcp-test-repo", symbolName: "DoesNotExist" },
      });
      const text = (result.content as any)[0].text as string;
      expect(text).toContain("No references");
    });
  });

  describe("error handling", () => {
    it("returns error for non-existent repo", async () => {
      const result = await client.callTool({
        name: "get_file",
        arguments: { repo: "no-such-repo", path: "file.ts" },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as any)[0].text as string;
      expect(text).toContain("not found");
    });
  });
});
