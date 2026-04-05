/**
 * End-to-end integration test: index a repository with **real Ollama embeddings**
 * and verify that semantic vector search produces meaningful results.
 *
 * Flow exercised:
 *   1. Start testcontainers Postgres (ParadeDB) + ensure Ollama is reachable
 *   2. Create a test git repo with multi-language source files
 *   3. Run the full indexing pipeline with OllamaEmbedder (nomic-embed-text)
 *   4. Assert: files, symbols, chunks + real embedding vectors stored in DB
 *   5. Assert: hybrid search (BM25 + vector) returns semantically relevant results
 *   6. Assert: vector-only search ranks related code higher than unrelated code
 *   7. Assert: re-index of new ref updates embeddings correctly
 *   8. Assert: context builder works with real embeddings
 *
 * Requires:
 *   - Docker (for testcontainers ParadeDB)
 *   - `ollama serve` running locally with `nomic-embed-text` pulled
 *
 * Run:
 *   pnpm vitest run src/e2e/ollama-embedding.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { simpleGit } from "simple-git";

import { startPostgres, stopPostgres } from "../../test/setup/postgres.js";
import { addCommitToTestRepo, createTestRepo, type TestRepo } from "../../test/setup/test-repo.js";
import { allLanguageFiles, TYPESCRIPT_SAMPLE } from "../../test/fixtures/samples.js";

import { runMigrations } from "../storage/index.js";
import { createDb, type Db } from "../storage/index.js";
import { RepoRepository } from "../storage/index.js";
import { RepoRefRepository } from "../storage/index.js";
import { RefFileRepository } from "../storage/index.js";
import { SymbolRepository } from "../storage/index.js";
import { ChunkRepository } from "../storage/index.js";
import { OllamaEmbedder, DB_EMBEDDING_DIMENSIONS } from "../indexer/embedder.js";
import { runPipeline } from "../indexer/pipeline.js";
import { listFiles } from "../git/git-sync.js";
import { searchHybrid } from "../retrieval/index.js";
import { buildContextPack } from "../retrieval/index.js";

// ── Constants ──

const OLLAMA_URL = "http://localhost:11434";
const EMBEDDING_MODEL = "nomic-embed-text";

// ── Helpers ──

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return false;
    const body = (await res.json()) as { models: { name: string }[] };
    return body.models.some((m) => m.name.startsWith(EMBEDDING_MODEL));
  } catch {
    return false;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Suite ──

describe("E2E: Repository indexing with Ollama embeddings (integration)", () => {
  let ollamaAvailable: boolean;
  let db: Db;
  let embedder: OllamaEmbedder;
  let repo: TestRepo;
  let repoRow: { id: number };
  let refRow: { id: number };
  let commitSha: string;

  beforeAll(async () => {
    ollamaAvailable = await isOllamaAvailable();
    if (!ollamaAvailable) {
      console.warn(
        "⚠ Ollama not available or nomic-embed-text not pulled — skipping Ollama e2e tests",
      );
      return;
    }

    // 1. Start Postgres (testcontainers ParadeDB)
    const { sql } = await startPostgres();
    await runMigrations(sql);
    db = createDb(sql);

    // 2. Create Ollama embedder
    embedder = new OllamaEmbedder({
      url: OLLAMA_URL,
      model: EMBEDDING_MODEL,
    });

    // 3. Create a test git repo with all language samples
    repo = await createTestRepo(allLanguageFiles());
    const git = simpleGit(repo.path);
    commitSha = (await git.revparse(["HEAD"])).trim();

    // 4. Register repo + ref in DB
    const repoRepo = new RepoRepository(db);
    repoRow = await repoRepo.insertOne({
      name: repo.name,
      localPath: repo.path,
      defaultBranch: "main",
    });

    const refRepo = new RepoRefRepository(db);
    refRow = await refRepo.insertOne({
      repoId: repoRow.id,
      ref: "v1.0.0",
      commitSha,
      stage: "indexing",
    });

    // 5. Get all files and run pipeline with real Ollama embeddings
    const files = await listFiles(repo.path, commitSha, []);
    await runPipeline(
      { db, embedder, embeddingBatchSize: 16 },
      { worktreePath: repo.path, repoRefId: refRow.id, files },
    );
  }, 120_000);

  afterAll(async () => {
    await repo?.cleanup();
    await stopPostgres();
  });

  // ──────────────────────────────────────────────────────
  //  1. Storage integrity — files, symbols, chunks, embeddings
  // ──────────────────────────────────────────────────────

  describe("storage: all indexed data persisted correctly", () => {
    it("indexes all supported language files into ref_files", async () => {
      if (!ollamaAvailable) return;

      const rfRepo = new RefFileRepository(db);
      const refFileRows = await rfRepo.findByRepoRef(refRow.id);
      const paths = refFileRows.map((r) => r.path);

      // 9 supported-language files expected (TS, PY, GO, Java, Kotlin, Rust, C, C++, Markdown)
      expect(refFileRows.length).toBeGreaterThanOrEqual(9);
      expect(paths).toContain("src/service.ts");
      expect(paths).toContain("src/calculator.py");
      expect(paths).toContain("src/server.go");
      expect(paths).toContain("src/Task.java");
      expect(paths).toContain("src/model.kt");
      expect(paths).toContain("src/config.rs");
      expect(paths).toContain("src/server.h");
      expect(paths).toContain("src/logger.hpp");
      expect(paths).toContain("docs/README.md");
    });

    it("skips unsupported files (package.json, .png)", async () => {
      if (!ollamaAvailable) return;

      const rfRepo = new RefFileRepository(db);
      expect(await rfRepo.findByRepoRefAndPath(refRow.id, "package.json")).toBeUndefined();
      expect(await rfRepo.findByRepoRefAndPath(refRow.id, "assets/logo.png")).toBeUndefined();
    });

    it("extracts symbols from TypeScript file", async () => {
      if (!ollamaAvailable) return;

      const rfRepo = new RefFileRepository(db);
      const tsFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/service.ts");
      expect(tsFile).toBeDefined();

      const symRepo = new SymbolRepository(db);
      const symbols = await symRepo.findByFileContentId(tsFile!.fileContentId);
      // ServiceConfig, Status, Service, ServiceFactory, createService
      expect(symbols.length).toBeGreaterThanOrEqual(3);

      const names = symbols.map((s) => s.name);
      expect(names).toContain("Service");
    });

    it("sets repo_ref status to 'ready'", async () => {
      if (!ollamaAvailable) return;

      const refRepo = new RepoRefRepository(db);
      const ref = await refRepo.findById(refRow.id);
      expect(ref!.stage).toBe("ready");
      expect(ref!.indexedAt).toBeDefined();
    });

    it("all chunks have real (non-zero) embedding vectors of correct dimension", async () => {
      if (!ollamaAvailable) return;

      const chunkRepo = new ChunkRepository(db);
      const allChunks = await chunkRepo.findAll();

      expect(allChunks.length).toBeGreaterThan(0);

      const withEmbedding = allChunks.filter((c) => c.embedding != null);
      expect(withEmbedding.length).toBe(allChunks.length);

      // Sample a few embeddings and verify they are real (non-zero) vectors
      for (const chunk of withEmbedding.slice(0, 5)) {
        const vec = chunk.embedding as number[];
        expect(vec).toHaveLength(DB_EMBEDDING_DIMENSIONS);
        // Real Ollama embeddings should not be all zeros
        expect(vec.some((v) => v !== 0)).toBe(true);
        expect(vec.every((v) => Number.isFinite(v))).toBe(true);
      }
    });
  });

  // ──────────────────────────────────────────────────────
  //  2. Semantic search — real vector search works
  // ──────────────────────────────────────────────────────

  describe("semantic search: real embeddings produce meaningful results", () => {
    it("hybrid search for 'service lifecycle start stop' returns TypeScript service file", async () => {
      if (!ollamaAvailable) return;

      const results = await searchHybrid(db, embedder, {
        query: "service lifecycle start stop",
        repo: repo.name,
        ref: "v1.0.0",
      });

      expect(results.length).toBeGreaterThan(0);
      // The TypeScript Service class has start() and stop() methods
      const tsResults = results.filter((r) => r.filePath === "src/service.ts");
      expect(tsResults.length).toBeGreaterThan(0);
    });

    it("hybrid search for 'calculator math add multiply' returns Python calculator", async () => {
      if (!ollamaAvailable) return;

      const results = await searchHybrid(db, embedder, {
        query: "calculator math add multiply",
        repo: repo.name,
        ref: "v1.0.0",
      });

      expect(results.length).toBeGreaterThan(0);
      const pyResults = results.filter((r) => r.filePath === "src/calculator.py");
      expect(pyResults.length).toBeGreaterThan(0);
    });

    it("hybrid search for 'HTTP server configuration' returns Go server file", async () => {
      if (!ollamaAvailable) return;

      const results = await searchHybrid(db, embedder, {
        query: "HTTP server configuration",
        repo: repo.name,
        ref: "v1.0.0",
      });

      expect(results.length).toBeGreaterThan(0);
      const goResults = results.filter((r) => r.filePath === "src/server.go");
      expect(goResults.length).toBeGreaterThan(0);
    });

    it("hybrid search for 'memory safety traits error handling' returns Rust file", async () => {
      if (!ollamaAvailable) return;

      const results = await searchHybrid(db, embedder, {
        query: "memory safety traits error handling",
        repo: repo.name,
        ref: "v1.0.0",
      });

      expect(results.length).toBeGreaterThan(0);
      const rsResults = results.filter((r) => r.filePath === "src/config.rs");
      expect(rsResults.length).toBeGreaterThan(0);
    });

    it("semantic search ranks related code higher than unrelated code", async () => {
      if (!ollamaAvailable) return;

      // Query specifically about Python data classes / calculation
      const results = await searchHybrid(db, embedder, {
        query: "dataclass result calculation history tracking",
        repo: repo.name,
        ref: "v1.0.0",
        limit: 20,
      });

      expect(results.length).toBeGreaterThan(0);

      // The Python calculator file should appear in the top results
      const pyIndex = results.findIndex((r) => r.filePath === "src/calculator.py");
      expect(pyIndex).toBeGreaterThanOrEqual(0);

      // And it should rank higher (lower index) than, say, the C header
      const cIndex = results.findIndex((r) => r.filePath === "src/server.h");
      if (cIndex >= 0) {
        expect(pyIndex).toBeLessThan(cIndex);
      }
    });

    it("search with no matches returns empty", async () => {
      if (!ollamaAvailable) return;

      const results = await searchHybrid(db, embedder, {
        query: "quantum entanglement photon superposition",
        repo: "nonexistent-repo",
        ref: "v1.0.0",
      });
      expect(results).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────
  //  3. Vector quality — embeddings are semantically coherent
  // ──────────────────────────────────────────────────────

  describe("vector quality: stored embeddings are semantically coherent", () => {
    it("chunks from the same file have higher mutual similarity than cross-file chunks", async () => {
      if (!ollamaAvailable) return;

      const chunkRepo = new ChunkRepository(db);
      const rfRepo = new RefFileRepository(db);

      // Get chunks for the TypeScript service file
      const tsFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/service.ts");
      const tsChunks = await chunkRepo.findByFileContentId(tsFile!.fileContentId);
      expect(tsChunks.length).toBeGreaterThanOrEqual(2);

      // Get chunks for the Go server file
      const goFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/server.go");
      const goChunks = await chunkRepo.findByFileContentId(goFile!.fileContentId);
      expect(goChunks.length).toBeGreaterThanOrEqual(1);

      const tsVec0 = tsChunks[0]!.embedding as number[];
      const tsVec1 = tsChunks.length > 1 ? (tsChunks[1]!.embedding as number[]) : tsVec0;
      const goVec0 = goChunks[0]!.embedding as number[];

      // Same-file similarity should be higher than cross-file similarity
      const sameFileSim = cosine(tsVec0, tsVec1);
      const crossFileSim = cosine(tsVec0, goVec0);

      console.log(`Same-file similarity (TS[0] ↔ TS[1]):  ${sameFileSim.toFixed(4)}`);
      console.log(`Cross-file similarity (TS[0] ↔ GO[0]): ${crossFileSim.toFixed(4)}`);

      // Both should be valid embeddings
      expect(tsVec0.some((v) => v !== 0)).toBe(true);
      expect(goVec0.some((v) => v !== 0)).toBe(true);

      // Same-file chunks should generally be more similar
      // (may not always hold for very different symbol chunks, so we just log)
      if (tsChunks.length > 1) {
        expect(sameFileSim).toBeGreaterThan(crossFileSim);
      }
    });

    it("query embedding is close to the most relevant stored chunk", async () => {
      if (!ollamaAvailable) return;

      const chunkRepo = new ChunkRepository(db);
      const rfRepo = new RefFileRepository(db);

      // Embed a query about the Python calculator
      const [queryVec] = await embedder.embed(["add two numbers and store the result"]);

      // Get Python calculator chunks
      const pyFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/calculator.py");
      const pyChunks = await chunkRepo.findByFileContentId(pyFile!.fileContentId);

      // Get C header chunks (unrelated)
      const cFile = await rfRepo.findByRepoRefAndPath(refRow.id, "src/server.h");
      const cChunks = await chunkRepo.findByFileContentId(cFile!.fileContentId);

      // Find max similarity to Python chunks
      const pyMaxSim = Math.max(...pyChunks.map((c) => cosine(queryVec!, c.embedding as number[])));

      // Find max similarity to C chunks
      const cMaxSim = Math.max(...cChunks.map((c) => cosine(queryVec!, c.embedding as number[])));

      console.log(`Query→Python max sim: ${pyMaxSim.toFixed(4)}`);
      console.log(`Query→C max sim:      ${cMaxSim.toFixed(4)}`);

      // "add two numbers" should be closer to the Python calculator than the C header
      expect(pyMaxSim).toBeGreaterThan(cMaxSim);
    });
  });

  // ──────────────────────────────────────────────────────
  //  4. Incremental re-index with real embeddings
  // ──────────────────────────────────────────────────────

  describe("re-index: new/changed files get fresh embeddings", () => {
    let refRow2: { id: number };
    let newCommitSha: string;

    beforeAll(async () => {
      if (!ollamaAvailable) return;

      // Add a second commit: modify TS file, delete Python file, add new file
      newCommitSha = await addCommitToTestRepo(
        repo.path,
        {
          "src/service.ts": TYPESCRIPT_SAMPLE + "\n// v2: added logging support\n",
          "src/calculator.py": null, // delete
          "src/auth.ts": `
/**
 * Authentication module with JWT token management.
 */
export interface AuthToken {
  userId: string;
  expiresAt: Date;
  scopes: string[];
}

export class AuthService {
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  /** Verify a JWT token and return the decoded payload. */
  async verify(token: string): Promise<AuthToken> {
    // verification logic
    return { userId: "user-1", expiresAt: new Date(), scopes: ["read"] };
  }

  /** Issue a new token for the given user. */
  async issue(userId: string, scopes: string[]): Promise<string> {
    return "jwt-token";
  }
}
`.trimStart(),
        },
        "v2: auth module + TS update",
      );

      const refRepo = new RepoRefRepository(db);
      refRow2 = await refRepo.insertOne({
        repoId: repoRow.id,
        ref: "v2.0.0",
        commitSha: newCommitSha,
        stage: "indexing",
      });

      const files = await listFiles(repo.path, newCommitSha, []);
      await runPipeline(
        { db, embedder, embeddingBatchSize: 16 },
        { worktreePath: repo.path, repoRefId: refRow2.id, files },
      );
    }, 120_000);

    it("v2.0.0 ref reaches status 'ready'", async () => {
      if (!ollamaAvailable) return;

      const refRepo = new RepoRefRepository(db);
      const ref = await refRepo.findById(refRow2.id);
      expect(ref!.stage).toBe("ready");
    });

    it("new auth.ts file has chunks with real embeddings", async () => {
      if (!ollamaAvailable) return;

      const rfRepo = new RefFileRepository(db);
      const authFile = await rfRepo.findByRepoRefAndPath(refRow2.id, "src/auth.ts");
      expect(authFile).toBeDefined();

      const chunkRepo = new ChunkRepository(db);
      const authChunks = await chunkRepo.findByFileContentId(authFile!.fileContentId);
      expect(authChunks.length).toBeGreaterThan(0);

      for (const chunk of authChunks) {
        const vec = chunk.embedding as number[];
        expect(vec).toHaveLength(DB_EMBEDDING_DIMENSIONS);
        expect(vec.some((v) => v !== 0)).toBe(true);
      }
    });

    it("deleted calculator.py is not in v2 ref_files", async () => {
      if (!ollamaAvailable) return;

      const rfRepo = new RefFileRepository(db);
      const deleted = await rfRepo.findByRepoRefAndPath(refRow2.id, "src/calculator.py");
      expect(deleted).toBeUndefined();
    });

    it("search for 'authentication JWT token verify' finds new auth.ts in v2", async () => {
      if (!ollamaAvailable) return;

      const results = await searchHybrid(db, embedder, {
        query: "authentication JWT token verify",
        repo: repo.name,
        ref: "v2.0.0",
      });

      expect(results.length).toBeGreaterThan(0);
      const authResults = results.filter((r) => r.filePath === "src/auth.ts");
      expect(authResults.length).toBeGreaterThan(0);
    });

    it("search for 'calculator' in v2 returns no Python results (deleted)", async () => {
      if (!ollamaAvailable) return;

      const results = await searchHybrid(db, embedder, {
        query: "calculator add multiply",
        repo: repo.name,
        ref: "v2.0.0",
      });

      const pyResults = results.filter((r) => r.filePath === "src/calculator.py");
      expect(pyResults).toHaveLength(0);
    });

    it("v1.0.0 search still works independently of v2", async () => {
      if (!ollamaAvailable) return;

      const results = await searchHybrid(db, embedder, {
        query: "calculator add multiply",
        repo: repo.name,
        ref: "v1.0.0",
      });

      expect(results.length).toBeGreaterThan(0);
      const pyResults = results.filter((r) => r.filePath === "src/calculator.py");
      expect(pyResults.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────
  //  5. Context builder with real embeddings
  // ──────────────────────────────────────────────────────

  describe("context builder: assembles context packs with real embeddings", () => {
    it("builds an 'explain' context pack with semantically relevant chunks", async () => {
      if (!ollamaAvailable) return;

      const pack = await buildContextPack(db, embedder, {
        repo: repo.name,
        repoId: repoRow.id,
        strategy: "explain",
        ref: "v1.0.0",
        query: "How does the service start and stop?",
        maxTokens: 4000,
      });

      expect(pack.strategy).toBe("explain");
      expect(pack.chunks.length).toBeGreaterThan(0);
      expect(pack.totalTokens).toBeGreaterThan(0);
      expect(pack.totalTokens).toBeLessThanOrEqual(4000);

      // Should include content from the TypeScript service file
      const tsChunks = pack.chunks.filter((c) => c.filePath === "src/service.ts");
      expect(tsChunks.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────
  //  6. BM25 + Vector fusion — both contribute to results
  // ──────────────────────────────────────────────────────

  describe("RRF fusion: BM25 and vector scores both contribute", () => {
    it("FTS-heavy query (exact symbol name) returns relevant results", async () => {
      if (!ollamaAvailable) return;

      const results = await searchHybrid(db, embedder, {
        query: "EventEmitter",
        repo: repo.name,
        ref: "v1.0.0",
      });

      expect(results.length).toBeGreaterThan(0);
      // BM25 should pick up the exact text match in service.ts
      const tsResults = results.filter((r) => r.filePath === "src/service.ts");
      expect(tsResults.length).toBeGreaterThan(0);
    });

    it("semantic-heavy query (no exact keyword match) still returns results via vector", async () => {
      if (!ollamaAvailable) return;

      // "compute arithmetic operations" doesn't appear verbatim but is semantically close to calculator.py
      const results = await searchHybrid(db, embedder, {
        query: "compute arithmetic operations on numbers",
        repo: repo.name,
        ref: "v1.0.0",
      });

      expect(results.length).toBeGreaterThan(0);
      // Vector search should find the Python calculator
      const pyResults = results.filter((r) => r.filePath === "src/calculator.py");
      expect(pyResults.length).toBeGreaterThan(0);
    });

    it("all result fields are populated", async () => {
      if (!ollamaAvailable) return;

      const results = await searchHybrid(db, embedder, {
        query: "server configuration",
        repo: repo.name,
        ref: "v1.0.0",
      });

      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.filePath).toBeTruthy();
        expect(r.repo).toBe(repo.name);
        expect(r.ref).toBe("v1.0.0");
        expect(r.content).toBeTruthy();
        expect(r.startLine).toBeGreaterThanOrEqual(1);
        expect(r.endLine).toBeGreaterThanOrEqual(r.startLine);
        expect(typeof r.score).toBe("number");
        expect(r.score).toBeGreaterThan(0);
      }
    });
  });
});
