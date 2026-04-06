import { describe, it, expect } from "vitest";
import { loadConfig, parseLanguageFilter } from "./config.js";

describe("Config", () => {
  it("loads defaults when no .env is present", () => {
    const config = loadConfig({});
    expect(config.DATABASE_URL).toBe("postgresql://reporelay:reporelay@localhost:5432/reporelay");
    expect(config.MCP_SERVER_PORT).toBe(3000);
    expect(config.WEB_PORT).toBe(3001);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.GIT_MIRRORS_DIR).toBe(".reporelay/mirrors");
    expect(config.GIT_WORKTREES_DIR).toBe(".reporelay/worktrees");
  });

  it("overrides defaults with environment variables", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://other:pass@db:5433/mydb",
      WEB_PORT: "9090",
      LOG_LEVEL: "debug",
      GIT_MIRRORS_DIR: "/tmp/mirrors",
    });
    expect(config.DATABASE_URL).toBe("postgresql://other:pass@db:5433/mydb");
    expect(config.WEB_PORT).toBe(9090);
    expect(config.LOG_LEVEL).toBe("debug");
    expect(config.GIT_MIRRORS_DIR).toBe("/tmp/mirrors");
    // non-overridden values keep defaults
  });

  it("validates required fields and throws on invalid config", () => {
    expect(() => loadConfig({ MCP_SERVER_PORT: "-1" })).toThrow();

    expect(() => loadConfig({ LOG_LEVEL: "banana" })).toThrow();
  });

  it("defaults MCP_SERVER_PORT to 3000", () => {
    expect(loadConfig({}).MCP_SERVER_PORT).toBe(3000);
    expect(loadConfig({ MCP_SERVER_PORT: "4000" }).MCP_SERVER_PORT).toBe(4000);
  });

  it("MCP_LANGUAGES defaults to undefined", () => {
    const config = loadConfig({});
    expect(config.MCP_LANGUAGES).toBeUndefined();
  });

  it("MCP_LANGUAGES stores raw comma-separated string", () => {
    const config = loadConfig({ MCP_LANGUAGES: "java,kotlin" });
    expect(config.MCP_LANGUAGES).toBe("java,kotlin");
  });
});

describe("parseLanguageFilter", () => {
  it("returns undefined for empty/undefined input", () => {
    expect(parseLanguageFilter()).toBeUndefined();
    expect(parseLanguageFilter("")).toBeUndefined();
    expect(parseLanguageFilter("  ")).toBeUndefined();
  });

  it("parses comma-separated languages", () => {
    expect(parseLanguageFilter("java,kotlin")).toEqual(["java", "kotlin"]);
  });

  it("trims whitespace and lowercases", () => {
    expect(parseLanguageFilter(" Java , Kotlin ")).toEqual(["java", "kotlin"]);
  });

  it("filters out unsupported languages", () => {
    expect(parseLanguageFilter("java,ruby,kotlin")).toEqual(["java", "kotlin"]);
  });

  it("returns undefined when all languages are unsupported", () => {
    expect(parseLanguageFilter("ruby,swift,csharp")).toBeUndefined();
  });

  it("accepts all supported languages", () => {
    const all = "typescript,javascript,python,go,java,kotlin,rust,c,cpp,markdown";
    const result = parseLanguageFilter(all);
    expect(result).toHaveLength(10);
    expect(result).toContain("typescript");
    expect(result).toContain("markdown");
  });
});
