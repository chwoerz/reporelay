/**
 * Unit tests for the MCP proxy server.
 *
 * Tests `enrichToolArgs` (the pure function) and the full proxy wiring
 * using InMemoryTransport to connect a test client ↔ proxy ↔ mock upstream.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod/v4";
import { enrichToolArgs, LANGUAGE_AWARE_TOOLS, startProxy } from "./proxy-server.js";
import pino from "pino";

describe("enrichToolArgs", () => {
  it("injects languages for a language-aware tool when none provided", () => {
    const result = enrichToolArgs("search_code", { query: "hello" }, ["typescript"], undefined);
    expect(result).toEqual({ query: "hello", languages: ["typescript"] });
  });

  it("does not inject for non-language-aware tools", () => {
    const result = enrichToolArgs("get_file", { repo: "test" }, ["typescript"], undefined);
    expect(result).toEqual({ repo: "test" });
    expect(result).not.toHaveProperty("languages");
  });

  it("does not override when caller already provides languages", () => {
    const result = enrichToolArgs(
      "search_code",
      { query: "hi", languages: ["python"] },
      ["typescript"],
      undefined,
    );
    expect(result.languages).toEqual(["python"]);
  });

  it("does not inject when detected languages is undefined", () => {
    const result = enrichToolArgs("search_code", { query: "hi" }, undefined, undefined);
    expect(result).not.toHaveProperty("languages");
  });

  it("does not inject when detected languages is empty", () => {
    const result = enrichToolArgs("search_code", { query: "hi" }, [], undefined);
    expect(result).not.toHaveProperty("languages");
  });

  it("handles undefined args gracefully", () => {
    const result = enrichToolArgs("search_code", undefined, ["typescript"], undefined);
    expect(result).toEqual({ languages: ["typescript"] });
  });

  it("injects for all language-aware tools", () => {
    for (const tool of LANGUAGE_AWARE_TOOLS) {
      const result = enrichToolArgs(tool, {}, ["go"], 2);
      expect(result.languages).toEqual(["go"]);
      expect(result.languageThreshold).toEqual(2);
    }
  });
});

describe("proxy wiring (in-memory)", () => {
  let testClient: Client;
  let mockUpstream: McpServer;
  /** Captured arguments from the last tool call to the mock upstream. */
  let lastCallArgs: Record<string, unknown> | undefined;

  const logger = pino({ level: "silent" });

  beforeAll(async () => {
    // A minimal McpServer that records the arguments it receives.
    mockUpstream = new McpServer(
      { name: "mock-upstream", version: "1.0.0" },
      { capabilities: { logging: {} } },
    );

    // Register a language-aware tool
    mockUpstream.registerTool(
      "search_code",
      {
        description: "Mock search",
        inputSchema: z.object({
          query: z.string(),
          languages: z.array(z.string()).optional(),
        }),
      },
      async (args) => {
        lastCallArgs = args as Record<string, unknown>;
        return { content: [{ type: "text", text: "search result" }] };
      },
    );

    // Register a non-language-aware tool
    mockUpstream.registerTool(
      "get_file",
      {
        description: "Mock get_file",
        inputSchema: z.object({
          repo: z.string(),
          path: z.string(),
        }),
      },
      async (args) => {
        lastCallArgs = args as Record<string, unknown>;
        return { content: [{ type: "text", text: "file content" }] };
      },
    );

    const [proxyClientTransport, upstreamServerTransport] = InMemoryTransport.createLinkedPair();
    await mockUpstream.connect(upstreamServerTransport);

    const [testClientTransport, proxyServerTransport] = InMemoryTransport.createLinkedPair();

    await startProxy(
      {
        upstreamUrl: "http://unused.test/mcp",
        languages: ["typescript", "javascript"],
        logger,
      },
      proxyClientTransport,
      proxyServerTransport,
    );

    testClient = new Client({ name: "test-client", version: "1.0.0" });
    await testClient.connect(testClientTransport);
  });

  afterAll(async () => {
    await testClient?.close();
  });

  it("forwards tools/list from upstream", async () => {
    const result = await testClient.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_file", "search_code"]);
  });

  it("injects languages into language-aware tool calls", async () => {
    lastCallArgs = undefined;
    await testClient.callTool({
      name: "search_code",
      arguments: { query: "hello" },
    });
    expect(lastCallArgs).toBeDefined();
    expect(lastCallArgs!.query).toBe("hello");
    expect(lastCallArgs!.languages).toEqual(["typescript", "javascript"]);
  });

  it("does not inject languages into non-language-aware tool calls", async () => {
    lastCallArgs = undefined;
    await testClient.callTool({
      name: "get_file",
      arguments: { repo: "test", path: "foo.ts" },
    });
    expect(lastCallArgs).toBeDefined();
    expect(lastCallArgs).not.toHaveProperty("languages");
  });

  it("preserves caller-provided languages (no override)", async () => {
    lastCallArgs = undefined;
    await testClient.callTool({
      name: "search_code",
      arguments: { query: "hello", languages: ["python"] },
    });
    expect(lastCallArgs).toBeDefined();
    expect(lastCallArgs!.languages).toEqual(["python"]);
  });

  it("returns tool results from upstream", async () => {
    const result = await testClient.callTool({
      name: "search_code",
      arguments: { query: "test" },
    });
    expect(result.content).toBeDefined();
    const content = result.content as { type: string; text: string }[];
    expect(content[0]!.text).toBe("search result");
  });
});
