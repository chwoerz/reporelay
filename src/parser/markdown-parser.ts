/**
 * Markdown parser using mdast (fromMarkdown).
 * Extracts heading hierarchy as symbols, links as imports, and code blocks.
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import type { Heading, Code, Link } from "mdast";
import type { ParseResult, ParsedSymbol, ParsedImport } from "../core/types.js";


interface CodeBlock {
  language: string | null;
  content: string;
  startLine: number;
  endLine: number;
}

interface MarkdownParseResult extends ParseResult {
  codeBlocks: CodeBlock[];
}


/**
 * Parse a markdown document and extract headings, links, and code blocks.
 */
export function parseMarkdown(content: string, _filePath: string): MarkdownParseResult {
  if (!content.trim()) {
    return { symbols: [], imports: [], codeBlocks: [] };
  }

  const tree = fromMarkdown(content);
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Collect raw heading info
  const rawHeadings: {
    text: string;
    depth: number;
    startLine: number;
  }[] = [];

  const codeBlocks: CodeBlock[] = [];
  const imports: ParsedImport[] = [];

  visit(tree, "heading", (node: Heading) => {
    rawHeadings.push({
      text: toString(node),
      depth: node.depth,
      startLine: node.position?.start.line ?? 1,
    });
  });

  visit(tree, "code", (node: Code) => {
    codeBlocks.push({
      language: node.lang ?? null,
      content: node.value,
      startLine: node.position?.start.line ?? 1,
      endLine: node.position?.end.line ?? 1,
    });
  });

  visit(tree, "link", (node: Link) => {
    imports.push({
      source: node.url,
      names: [toString(node)],
    });
  });

  // Compute heading end-lines: each heading extends until the next heading
  // of the same or higher level (lower depth number), or end of file.
  const symbols: ParsedSymbol[] = rawHeadings.map((h, i) => {
    let endLine = totalLines;
    for (let j = i + 1; j < rawHeadings.length; j++) {
      if (rawHeadings[j].depth <= h.depth) {
        // End just before the next same-or-higher heading's line
        endLine = rawHeadings[j].startLine - 1;
        // Trim trailing blank lines
        while (endLine > h.startLine && lines[endLine - 1].trim() === "") {
          endLine--;
        }
        break;
      }
    }

    const sectionContent = lines.slice(h.startLine - 1, endLine).join("\n");

    return {
      name: h.text,
      kind: "heading" as const,
      signature: "#".repeat(h.depth) + " " + h.text,
      startLine: h.startLine,
      endLine,
      content: sectionContent,
    };
  });

  return { symbols, imports, codeBlocks };
}
