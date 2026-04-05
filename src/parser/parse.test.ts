import { describe, it, expect } from "vitest";
import { parse } from "./index.js";
import { TYPESCRIPT_SAMPLE, MARKDOWN_SAMPLE } from "../../test/fixtures/samples.js";

describe("parse() registry", () => {
  it("routes TypeScript to tree-sitter parser", () => {
    const r = parse(TYPESCRIPT_SAMPLE, "typescript", "service.ts");
    expect(r.symbols.length).toBeGreaterThan(0);
    expect(r.symbols.find((s) => s.name === "Service")).toBeDefined();
  });

  it("routes JavaScript to tree-sitter parser", () => {
    const r = parse("function foo() {}\n", "javascript", "lib.js");
    expect(r.symbols.find((s) => s.name === "foo")?.kind).toBe("function");
  });

  it("routes markdown to markdown parser", () => {
    const r = parse(MARKDOWN_SAMPLE, "markdown", "README.md");
    expect(r.symbols.length).toBeGreaterThan(0);
    expect(r.symbols[0].kind).toBe("heading");
  });

  it("returns empty result for empty content", () => {
    const r = parse("", "typescript", "empty.ts");
    expect(r.symbols).toEqual([]);
    expect(r.imports).toEqual([]);
  });
});
