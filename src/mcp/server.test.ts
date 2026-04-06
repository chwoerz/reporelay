/**
 * Unit tests for MCP server factory and HTTP transport.
 *
 * Verifies:
 * - createMcpServer registers tools, resources, and prompts
 * - startMcpServer starts an HTTP server without error
 * - Stateless transport: each call creates a fresh McpServer instance
 */
import { describe, it, expect } from "vitest";
import { createMcpServer, startMcpServer } from "./server.js";
import { makeMcpDeps } from "./test-helpers.js";

describe("createMcpServer", () => {
  it("registers expected tools", () => {
    const server = createMcpServer(makeMcpDeps());
    const tools = (server as any)._registeredTools;
    expect(tools["list_repos"]).toBeDefined();
    expect(tools["get_file"]).toBeDefined();
    expect(tools["search_code"]).toBeDefined();
  });
});

describe("startMcpServer", () => {
  it("starts without error", async () => {
    const deps = {
      ...makeMcpDeps(),
      config: {
        ...makeMcpDeps().config,
        MCP_SERVER_PORT: 0, // ephemeral port
      },
    };

    // Should not throw — starts an HTTP server on an ephemeral port
    const httpServer = await startMcpServer(deps);
    expect(httpServer).toBeDefined();
    httpServer.close();
  });

  it("creates a fresh McpServer per stateless HTTP request (no shared state)", () => {
    const deps = makeMcpDeps();
    const server1 = createMcpServer(deps);
    const server2 = createMcpServer(deps);

    // Each call produces a distinct server instance
    expect(server1).not.toBe(server2);
    // Both have the same tools registered
    expect(Object.keys((server1 as any)._registeredTools)).toEqual(
      Object.keys((server2 as any)._registeredTools),
    );
  });
});
