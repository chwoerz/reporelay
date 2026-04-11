/**
 * MCP server factory.
 *
 * Creates an McpServer, registers tools/resources/prompts, and starts
 * a stateless HTTP transport.  Each incoming request gets a fresh
 * McpServer + StreamableHTTPServerTransport pair (no sessions).
 *
 * Clients never connect to this server directly — the local MCP proxy
 * (`src/mcp-proxy/`) bridges between the IDE (stdio) and this HTTP server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Db } from "../storage/index.js";
import type { Embedder } from "../indexer/embedder.js";
import type { Config } from "../core/config.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

export interface McpDeps {
  db: Db;
  embedder: Embedder;
  config: Config;

  /**
   * Minimum language_stats percentage (0–100) for a repo ref to be included
   * when filtering by language. Defaults to 10 if not provided.
   * Set to 0 to disable language-based repo filtering entirely.
   */
  languageThreshold?: number;
}

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
 * Start the MCP server as a stateless HTTP service.
 *
 * Each request to `/mcp` creates a fresh McpServer +
 * StreamableHTTPServerTransport pair (no session tracking).
 * `/health` returns a simple status check.
 *
 * Returns the underlying `http.Server` so callers can shut it down.
 */
export async function startMcpServer(deps: McpDeps): Promise<import("node:http").Server> {
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

  httpServer.listen(port, "0.0.0.0");
  return httpServer;
}
