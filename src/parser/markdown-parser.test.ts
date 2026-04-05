import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./markdown-parser.js";
import { MARKDOWN_SAMPLE } from "../../test/fixtures/samples.js";

const md = () => parseMarkdown(MARKDOWN_SAMPLE, "README.md");

describe("Markdown Parser", () => {
  it("extracts heading hierarchy as symbols (# = top-level, ## = nested)", () => {
    const r = md();
    const names = r.symbols.map((s) => s.name);
    expect(names).toContain("Project Documentation");
    expect(names).toContain("Getting Started");
    expect(names).toContain("Installation");
    expect(names).toContain("API Reference");
    expect(names).toContain("Contributing");

    // All symbols have kind "heading"
    expect(r.symbols.every((s) => s.kind === "heading")).toBe(true);

    // Depth is encoded in the signature
    const top = r.symbols.find((s) => s.name === "Project Documentation")!;
    expect(top.signature).toBe("# Project Documentation");
    const sub = r.symbols.find((s) => s.name === "Installation")!;
    expect(sub.signature).toBe("### Installation");
  });

  it("extracts fenced code blocks with language tags", () => {
    const r = md();
    expect(r.codeBlocks.length).toBeGreaterThanOrEqual(2);
    const bash = r.codeBlocks.find((c) => c.language === "bash");
    expect(bash).toBeDefined();
    expect(bash!.content).toContain("npm install");
    const ts = r.codeBlocks.find((c) => c.language === "typescript");
    expect(ts).toBeDefined();
    expect(ts!.content).toContain("createClient");
  });

  it("extracts link references", () => {
    const r = md();
    const link = r.imports.find((i) => i.source === "./CONTRIBUTING.md");
    expect(link).toBeDefined();
    expect(link!.names).toContain("CONTRIBUTING.md");
  });

  it("returns full text content for FTS indexing", () => {
    const r = md();
    // The top-level heading should span the entire document
    const top = r.symbols.find((s) => s.name === "Project Documentation")!;
    expect(top.content).toContain("Getting Started");
    expect(top.content).toContain("API Reference");
    expect(top.content).toContain("Contributing");
  });

  it("handles frontmatter (YAML) blocks without crashing", () => {
    const content = "---\ntitle: Test\ndate: 2024-01-01\n---\n\n# Hello\n\nWorld\n";
    const r = parseMarkdown(content, "doc.md");
    // Should not throw; the # Hello heading is still found
    expect(r.symbols.length).toBeGreaterThanOrEqual(1);
    const hello = r.symbols.find((s) => s.name === "Hello");
    expect(hello).toBeDefined();
    expect(hello!.kind).toBe("heading");
  });

  it("handles empty markdown files", () => {
    const r = parseMarkdown("", "empty.md");
    expect(r.symbols).toEqual([]);
    expect(r.imports).toEqual([]);
    expect(r.codeBlocks).toEqual([]);
  });

  it("preserves heading line ranges for chunking", () => {
    const r = md();
    const install = r.symbols.find((s) => s.name === "Installation")!;
    expect(install.startLine).toBe(7);
    // Installation section ends before Configuration heading
    expect(install.endLine).toBeLessThan(13);

    const config = r.symbols.find((s) => s.name === "Configuration")!;
    expect(config.startLine).toBe(13);

    // All headings have startLine <= endLine
    for (const s of r.symbols) {
      expect(s.startLine).toBeLessThanOrEqual(s.endLine);
      expect(s.startLine).toBeGreaterThanOrEqual(1);
    }
  });
});
