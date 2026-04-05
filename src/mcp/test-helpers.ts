/**
 * Shared test helpers for MCP unit tests.
 * Provides a minimal mock McpDeps object that satisfies type requirements
 * without needing a real database connection.
 */
import type { McpDeps } from "./server.js";
import type { Config } from "../core/config.js";
import { createMockEmbedder } from "../../test/setup/mock-embedder.js";

/** Minimal mock deps for testing MCP registration (no real DB). */
export function makeMcpDeps(): McpDeps {
  return {
    db: {} as McpDeps["db"],
    embedder: createMockEmbedder(),
    config: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      EMBEDDING_PROVIDER: "ollama",
      EMBEDDING_URL: "http://localhost:11434",
      EMBEDDING_MODEL: "nomic-embed-text",
      EMBEDDING_BATCH_SIZE: 64,
      MCP_TRANSPORT: "stdio",
      MCP_SERVER_PORT: 3000,
      WEB_PORT: 3001,
      GIT_MIRRORS_DIR: ".reporelay/mirrors",
      GIT_WORKTREES_DIR: ".reporelay/worktrees",
      LOG_LEVEL: "info",
    } as Config,
  };
}
