/**
 * MCP proxy server.
 *
 * Sits between a local MCP client (IDE/agent, via stdio) and a remote
 * RepoRelay MCP server (via HTTP).  At startup it connects to the
 * upstream, then forwards every MCP request — injecting the locally
 * detected `languages` into tools that support language filtering.
 *
 * This architecture lets the language auto-detection logic run where
 * the project files actually live (the developer's machine) while the
 * heavy indexing / search engine runs on a remote server.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "../core/logger.js";

// ── Constants ──

/** Tool names that accept an optional `languages` input parameter. */
export const LANGUAGE_AWARE_TOOLS = new Set(["search_code", "get_symbol", "find", "list_repos"]);

// ── Types ──

export interface ProxyDeps {
  /** URL of the remote RepoRelay MCP endpoint. */
  upstreamUrl: string;
  /** Languages auto-detected from the local working directory (or explicit config). */
  languages?: string[];
  logger: Logger;
}

// ── Helpers ──

/**
 * Enrich tool call arguments with detected languages when applicable.
 *
 * Only injects if:
 *   - the tool is in `LANGUAGE_AWARE_TOOLS`
 *   - the caller did not already provide a `languages` value
 *   - there are detected languages to inject
 */
export function enrichToolArgs(
  toolName: string,
  args: Record<string, unknown> | undefined,
  languages: string[] | undefined,
): Record<string, unknown> {
  const enriched = { ...args };
  if (
    LANGUAGE_AWARE_TOOLS.has(toolName) &&
    !enriched.languages &&
    languages &&
    languages.length > 0
  ) {
    enriched.languages = languages;
  }
  return enriched;
}

// ── Proxy wiring ──

/**
 * Wire a local `Server` to an upstream `Client`, forwarding all MCP
 * requests and injecting detected languages into tool calls.
 *
 * Extracted from `startProxy` so tests can supply in-memory transports.
 */
export function wireProxy(server: Server, client: Client, languages: string[] | undefined): void {
  // ── tools/list → forward upstream response ──
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return client.listTools(request.params);
  });

  // ── tools/call → inject languages, forward to upstream ──
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const enrichedArgs = enrichToolArgs(name, args, languages);

    const result = await client.callTool({ name, arguments: enrichedArgs });

    // Normalise — the Client may return `{ toolResult }` instead of
    // the standard `{ content, isError }` shape.
    if ("toolResult" in result) {
      return { content: [{ type: "text" as const, text: String(result.toolResult) }] };
    }

    return result;
  });

  // ── prompts/list → forward ──
  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    return client.listPrompts(request.params);
  });

  // ── prompts/get → forward ──
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return client.getPrompt(request.params);
  });

  // ── resources/list → forward ──
  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    return client.listResources(request.params);
  });

  // ── resources/templates/list → forward ──
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
    return client.listResourceTemplates(request.params);
  });

  // ── resources/read → forward ──
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return client.readResource(request.params);
  });
}

// ── Public API ──

/**
 * Create the local Server and upstream Client, wire them together,
 * and connect both to their respective transports.
 *
 * @param deps.upstreamUrl  Remote RepoRelay MCP endpoint URL.
 * @param deps.languages    Languages detected from local CWD (or explicit config).
 * @param deps.logger       Pino logger.
 * @param clientTransport   Override for testing (defaults to StreamableHTTPClientTransport).
 * @param serverTransport   Override for testing (defaults to StdioServerTransport).
 */
export async function startProxy(
  deps: ProxyDeps,
  clientTransport?: Transport,
  serverTransport?: Transport,
): Promise<{ server: Server; client: Client }> {
  const { upstreamUrl, languages, logger } = deps;

  // ── Upstream client ──
  const client = new Client({ name: "reporelay-proxy", version: "1.0.0" });
  const cTransport = clientTransport ?? new StreamableHTTPClientTransport(new URL(upstreamUrl));
  await client.connect(cTransport);
  logger.info({ url: upstreamUrl }, "Connected to upstream RepoRelay server");

  // ── Local server ──
  const server = new Server(
    { name: "reporelay-proxy", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} } },
  );

  wireProxy(server, client, languages);

  // ── Connect local server ──
  const sTransport = serverTransport ?? new StdioServerTransport();
  await server.connect(sTransport);
  logger.info("MCP proxy ready (stdio)");

  // ── Graceful shutdown (only for real transports, not tests) ──
  if (!serverTransport) {
    const shutdown = async () => {
      logger.info("Shutting down proxy…");
      await server.close();
      await client.close();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  return { server, client };
}
