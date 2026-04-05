import { describe, it, expect, beforeEach } from "vitest";
import { createMcpServer } from "./server.js";
import { makeMcpDeps } from "./test-helpers.js";

describe("MCP Prompts", () => {
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(() => {
    server = createMcpServer(makeMcpDeps());
  });

  function getPrompts(): Record<string, any> {
    return (server as any)._registeredPrompts;
  }

  describe("explain-library", () => {
    it("is registered", () => {
      expect(getPrompts()["explain-library"]).toBeDefined();
    });
  });

  describe("implement-feature", () => {
    it("is registered", () => {
      expect(getPrompts()["implement-feature"]).toBeDefined();
    });
  });

  describe("debug-issue", () => {
    it("is registered", () => {
      expect(getPrompts()["debug-issue"]).toBeDefined();
    });
  });

  describe("all prompts", () => {
    it("registers exactly 3 prompts", () => {
      expect(Object.keys(getPrompts()).length).toBe(3);
    });

    it("all 3 prompt names are present", () => {
      const names = Object.keys(getPrompts()).sort();
      expect(names).toEqual(["debug-issue", "explain-library", "implement-feature"]);
    });
  });
});
