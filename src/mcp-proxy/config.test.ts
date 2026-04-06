/**
 * Unit tests for MCP proxy config parsing.
 */
import { describe, it, expect } from "vitest";
import { loadProxyConfig, parseLanguageFilter } from "./config.js";

describe("loadProxyConfig", () => {
  it("uses defaults when env is empty", () => {
    const config = loadProxyConfig({});
    expect(config.REPORELAY_URL).toBeUndefined();
    expect(config.MCP_LANGUAGE_THRESHOLD).toBe(10);
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("reads REPORELAY_URL from env", () => {
    const config = loadProxyConfig({ REPORELAY_URL: "http://localhost:3000/mcp" });
    expect(config.REPORELAY_URL).toBe("http://localhost:3000/mcp");
  });

  it("CLI --server overrides env REPORELAY_URL", () => {
    const config = loadProxyConfig({ REPORELAY_URL: "http://env-url/mcp" }, "http://cli-url/mcp");
    expect(config.REPORELAY_URL).toBe("http://cli-url/mcp");
  });

  it("reads MCP_LANGUAGE_THRESHOLD from env", () => {
    const config = loadProxyConfig({ MCP_LANGUAGE_THRESHOLD: "25" });
    expect(config.MCP_LANGUAGE_THRESHOLD).toBe(25);
  });

  it("coerces MCP_LANGUAGE_THRESHOLD to number", () => {
    const config = loadProxyConfig({ MCP_LANGUAGE_THRESHOLD: "0" });
    expect(config.MCP_LANGUAGE_THRESHOLD).toBe(0);
  });
});

describe("parseLanguageFilter", () => {
  it("returns undefined for empty input", () => {
    expect(parseLanguageFilter(undefined)).toBeUndefined();
    expect(parseLanguageFilter("")).toBeUndefined();
    expect(parseLanguageFilter("  ")).toBeUndefined();
  });

  it("parses comma-separated languages", () => {
    expect(parseLanguageFilter("typescript,python")).toEqual(["typescript", "python"]);
  });

  it("trims whitespace and lowercases", () => {
    expect(parseLanguageFilter(" TypeScript , Python ")).toEqual(["typescript", "python"]);
  });

  it("filters out invalid language names", () => {
    expect(parseLanguageFilter("typescript,invalid,python")).toEqual(["typescript", "python"]);
  });

  it("returns undefined when all names are invalid", () => {
    expect(parseLanguageFilter("invalid,nope")).toBeUndefined();
  });
});
