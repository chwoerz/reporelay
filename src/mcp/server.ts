/**
 * MCP server factory.
 *
 * Creates an McpServer, registers tools/resources/prompts, and connects
 * the appropriate transport (stdio or streamable HTTP).
 *
 * HTTP mode is **stateless**: each incoming request gets a fresh McpServer
 * and StreamableHTTPServerTransport (`sessionIdGenerator: undefined`).
 * This avoids session tracking, works with any MCP client (OpenCode,
 * Claude Desktop, etc.), and allows horizontal scaling without sticky sessions.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Db } from "../storage/index.js";
import type { Embedder } from "../indexer/embedder.js";
import type { Config } from "../core/config.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

// ── Dependencies ──

export interface McpDeps {
  db: Db;
  embedder: Embedder;
  config: Config;
  /** When set, only results in these languages are returned by MCP tools. */
  languages?: string[];
  /**
   * Minimum language_stats percentage (0–100) for a repo ref to be included
   * when filtering by language. Defaults to 10 if not provided.
   * Set to 0 to disable language-based repo filtering entirely.
   */
  languageThreshold?: number;
}

// ── Factory ──

/**
 * Create and configure the McpServer with all tools, resources, and prompts.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: "reporelay", version: "1.0.0" },
    { capabilities: { logging: {} } },
  );

  registerTools(server, deps);
  registerResources(server, deps);
  registerPrompts(server, deps);

  return server;
}

/**
 * Start the MCP server with the configured transport.
 *
 * - `stdio`:  connects via stdin/stdout (for local MCP clients)
 * - `http`:   starts a stateless HTTP server — each request creates a fresh
 *             McpServer + StreamableHTTPServerTransport pair (no sessions)
 */
export async function startMcpServer(deps: McpDeps): Promise<void> {
  if (deps.config.MCP_TRANSPORT === "stdio") {
    const server = createMcpServer(deps);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  // Stateless Streamable HTTP mode
  const port = deps.config.MCP_SERVER_PORT;

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (url.pathname === "/mcp") {
      // Stateless: fresh server + transport per request
      const server = createMcpServer(deps);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  httpServer.listen(port);
}
