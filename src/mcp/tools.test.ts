import { describe, it, expect, beforeEach } from "vitest";
import { createMcpServer } from "./server.js";
import { makeMcpDeps } from "./test-helpers.js";

describe("MCP Tool Definitions", () => {
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(() => {
    server = createMcpServer(makeMcpDeps());
  });

  function getTools(): Record<string, unknown> {
    return (server as any)._registeredTools;
  }

  describe("search_code", () => {
    it("is registered", () => {
      expect(getTools()["search_code"]).toBeDefined();
    });
  });

  describe("get_file", () => {
    it("is registered", () => {
      expect(getTools()["get_file"]).toBeDefined();
    });
  });

  describe("get_symbol", () => {
    it("is registered", () => {
      expect(getTools()["get_symbol"]).toBeDefined();
    });
  });

  describe("find", () => {
    it("is registered", () => {
      expect(getTools()["find"]).toBeDefined();
    });
  });

  describe("find_references", () => {
    it("is registered", () => {
      expect(getTools()["find_references"]).toBeDefined();
    });
  });

  describe("list_repos", () => {
    it("is registered", () => {
      expect(getTools()["list_repos"]).toBeDefined();
    });
  });

  describe("all tools", () => {
    it("server has exactly 6 tools registered", () => {
      expect(Object.keys(getTools()).length).toBe(6);
    });

    it("all 6 tool names are present", () => {
      const names = Object.keys(getTools()).sort();
      expect(names).toEqual([
        "find",
        "find_references",
        "get_file",
        "get_symbol",
        "list_repos",
        "search_code",
      ]);
    });
  });
});
