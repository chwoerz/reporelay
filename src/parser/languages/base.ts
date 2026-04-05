/**
 * Shared interface and helper utilities for all tree-sitter language extractors.
 */
import Parser from "tree-sitter";
import type { ParseResult, ParsedSymbol, ParsedImport, SymbolKind } from "../../core/types.js";

export type SyntaxNode = Parser.SyntaxNode;
export type { ParseResult, ParsedSymbol, ParsedImport, SymbolKind };

// ── Extractor interface ───────────────────────────────────

export interface LanguageExtractor {
  extract(root: SyntaxNode): ParseResult;
}

// ── Node helpers ──────────────────────────────────────────

/** 1-based start line. */
export function sLine(node: SyntaxNode): number {
  return node.startPosition.row + 1;
}

/** 1-based end line. */
export function eLine(node: SyntaxNode): number {
  return node.endPosition.row + 1;
}

/** First line of source text, trailing `{` stripped — used as a signature. */
export function sig(node: SyntaxNode): string {
  return node.text
    .split("\n")[0]
    .trimEnd()
    .replace(/\s*\{$/, "");
}

/** Build a `ParsedSymbol` from a tree-sitter node. */
export function sym(name: string, kind: SymbolKind, node: SyntaxNode, doc?: string): ParsedSymbol {
  return {
    name,
    kind,
    signature: sig(node),
    startLine: sLine(node),
    endLine: eLine(node),
    documentation: doc,
    content: node.text,
  };
}

/** Get the text of a named field child. */
export function field(node: SyntaxNode, name: string): string | null {
  return node.childForFieldName(name)?.text ?? null;
}

/** Shorthand: `field(node, "name")` with `"(anonymous)"` fallback. */
export function name(node: SyntaxNode): string {
  return field(node, "name") ?? "(anonymous)";
}

/** Find the first named child matching `type`. */
export function child(node: SyntaxNode, type: string): SyntaxNode | undefined {
  return node.namedChildren.find((c) => c.type === type);
}

/** Find all named children matching `type`. */
export function children(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.namedChildren.filter((c) => c.type === type);
}

// ── Doc-comment helpers ───────────────────────────────────

/** Block-comment doc (`/** … *​/`) for TS, JS, Java, Kotlin, C, C++. */
export function getBlockDoc(node: SyntaxNode): string | undefined {
  const prev = node.previousNamedSibling;
  if (!prev) return undefined;
  const text = prev.text;
  if ((prev.type === "comment" || prev.type === "block_comment") && text.startsWith("/**")) {
    return text;
  }
  return undefined;
}

/** Line-comment doc (`// …`) collected over consecutive lines (Go). */
export function getLineDoc(node: SyntaxNode): string | undefined {
  const lines: string[] = [];
  let prev = node.previousNamedSibling;
  while (prev?.type === "comment" && prev.text.startsWith("//")) {
    lines.unshift(prev.text);
    prev = prev.previousNamedSibling;
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/** Rust doc-comment (`/// …`), skipping `#[…]` attributes. */
export function getRustDoc(node: SyntaxNode): string | undefined {
  const lines: string[] = [];
  let prev = node.previousNamedSibling;
  while (prev) {
    if (prev.type === "attribute_item") {
      prev = prev.previousNamedSibling;
      continue;
    }
    if (prev.type === "line_comment" && prev.text.startsWith("///")) {
      lines.unshift(prev.text);
      prev = prev.previousNamedSibling;
      continue;
    }
    break;
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/** Python docstring: first `expression_statement > string` inside a block. */
export function getPyDocstring(node: SyntaxNode): string | undefined {
  const block = child(node, "block");
  if (!block) return undefined;
  const first = block.namedChildren[0];
  if (first?.type === "expression_statement") {
    const str = child(first, "string");
    if (str) return str.text;
  }
  return undefined;
}
