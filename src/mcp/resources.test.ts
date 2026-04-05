import { describe, it, expect, beforeEach } from "vitest";
import { createMcpServer } from "./server.js";
import { makeMcpDeps } from "./test-helpers.js";

describe("MCP Resources", () => {
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(() => {
    server = createMcpServer(makeMcpDeps());
  });

  function getResourceTemplates(): Record<string, any> {
    return (server as any)._registeredResourceTemplates;
  }

  describe("resource template registration", () => {
    it("registers file-content resource template", () => {
      expect(getResourceTemplates()["file-content"]).toBeDefined();
    });

    it("registers directory-tree resource template", () => {
      expect(getResourceTemplates()["directory-tree"]).toBeDefined();
    });

    it("registers exactly 2 resource templates", () => {
      expect(Object.keys(getResourceTemplates()).length).toBe(2);
    });
  });

  describe("URI parsing", () => {
    it("file-content template has a resourceTemplate", () => {
      const fileContent = getResourceTemplates()["file-content"];
      expect(fileContent).toBeDefined();
      expect(fileContent.resourceTemplate).toBeDefined();
    });

    it("directory-tree template has a resourceTemplate", () => {
      const dirTree = getResourceTemplates()["directory-tree"];
      expect(dirTree).toBeDefined();
      expect(dirTree.resourceTemplate).toBeDefined();
    });
  });
});
