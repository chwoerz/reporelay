/**
 * Python extractor — classes, functions, decorators, docstrings.
 */
import type {
  LanguageExtractor,
  SyntaxNode,
  ParseResult,
  ParsedSymbol,
  ParsedImport,
  SymbolKind,
} from "./base.js";
import { sym, sLine, eLine, field, name, child, children, getPyDocstring } from "./base.js";

export class PythonExtractor implements LanguageExtractor {
  extract(root: SyntaxNode): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];

    // Module-level docstring
    const first = root.namedChildren[0];
    if (first?.type === "expression_statement") {
      const str = child(first, "string");
      if (str) {
        symbols.push({
          name: "(module)",
          kind: "module",
          signature: str.text.split("\n")[0],
          startLine: sLine(first),
          endLine: eLine(first),
          documentation: str.text,
          content: first.text,
        });
      }
    }

    for (const node of root.namedChildren) {
      switch (node.type) {
        case "function_definition":
          symbols.push(sym(name(node), "function", node, getPyDocstring(node)));
          break;
        case "class_definition":
          this.handleClass(node, symbols);
          break;
        case "decorated_definition":
          this.handleDecorated(node, symbols);
          break;
        case "import_statement":
          this.handleImport(node, imports);
          break;
        case "import_from_statement":
          this.handleFromImport(node, imports);
          break;
      }
    }

    return { symbols, imports };
  }

  private handleClass(node: SyntaxNode, symbols: ParsedSymbol[]): void {
    symbols.push(sym(name(node), "class", node, getPyDocstring(node)));
    this.extractMethods(node, symbols);
  }

  private handleDecorated(node: SyntaxNode, symbols: ParsedSymbol[]): void {
    const inner = child(node, "class_definition") ?? child(node, "function_definition");
    if (!inner) return;
    const kind: SymbolKind = inner.type === "class_definition" ? "class" : "function";
    // Use the decorated_definition node for range (includes decorators)
    symbols.push(sym(name(inner), kind, node, getPyDocstring(inner)));
    if (inner.type === "class_definition") {
      this.extractMethods(inner, symbols);
    }
  }

  private extractMethods(classNode: SyntaxNode, symbols: ParsedSymbol[]): void {
    const block = child(classNode, "block");
    if (!block) return;
    block.namedChildren
      .filter((m) => m.type === "function_definition")
      .map((m) => sym(name(m), "method", m, getPyDocstring(m)))
      .forEach((s) => symbols.push(s));
  }

  private handleImport(node: SyntaxNode, imports: ParsedImport[]): void {
    const names = children(node, "dotted_name").map((c) => c.text);
    if (names.length > 0) {
      imports.push({ source: names[0], names: names.slice(1) });
    }
  }

  private handleFromImport(node: SyntaxNode, imports: ParsedImport[]): void {
    const moduleName = child(node, "dotted_name") ?? child(node, "relative_import");
    const source = moduleName?.text ?? "(unknown)";
    const names: string[] = node.namedChildren
      .filter((c) => c !== moduleName && (c.type === "dotted_name" || c.type === "aliased_import"))
      .map((c) =>
        c.type === "aliased_import" ? (field(c, "name")?.toString() ?? c.text) : c.text,
      );
    imports.push({ source, names });
  }
}
