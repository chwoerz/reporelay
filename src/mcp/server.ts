/**
 * MCP server factory.
 *
 * Creates an McpServer, registers tools/resources/prompts, and connects
 * the appropriate transport (stdio or streamable HTTP).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
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
 * - `http`:   starts an HTTP server with streamable HTTP transport
 */
export async function startMcpServer(deps: McpDeps): Promise<void> {
  const server = createMcpServer(deps);

  if (deps.config.MCP_TRANSPORT === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  // Streamable HTTP mode
  const port = deps.config.MCP_SERVER_PORT;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (url.pathname === "/mcp") {
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  httpServer.listen(port);
}
