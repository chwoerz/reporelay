/**
 * TypeScript & JavaScript extractor.
 *
 * Both languages share the same tree-sitter extraction logic;
 * TS simply has extra node types (interface, type alias, enum).
 */
import type {
  LanguageExtractor,
  SyntaxNode,
  ParseResult,
  ParsedSymbol,
  ParsedImport,
  SymbolKind,
} from "./base.js";
import { sym, field, name, child, children, getBlockDoc } from "./base.js";

const DECL_TYPES = new Set([
  "function_declaration",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "lexical_declaration",
]);

export class TypeScriptJavaScriptExtractor implements LanguageExtractor {
  extract(root: SyntaxNode): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];

    for (const node of root.namedChildren) {
      switch (node.type) {
        case "export_statement":
          this.handleExport(node, symbols, imports);
          break;
        case "import_statement":
          this.handleImport(node, imports);
          break;
        default:
          this.handleDecl(node, node, getBlockDoc(node), symbols);
          break;
      }
    }

    return { symbols, imports };
  }

  
  private handleExport(node: SyntaxNode, symbols: ParsedSymbol[], imports: ParsedImport[]): void {
    const doc = getBlockDoc(node);

    // Inner declaration
    const decl = node.namedChildren.find((c) => DECL_TYPES.has(c.type));
    if (decl) {
      this.handleDecl(decl, node, doc, symbols);
    }

    // Re-export: export { X } from 'Y'
    const src = node.childForFieldName("source");
    if (src) {
      const clause = child(node, "export_clause");
      const names = clause
        ? children(clause, "export_specifier")
            .map((spec) => spec.childForFieldName("name")?.text)
            .filter((n): n is string => n != null)
        : [];
      imports.push({
        source: src.text.replace(/^['"]|['"]$/g, ""),
        names,
      });
    }

    // Default export: export default <identifier>
    const hasDefault = node.children.some((c) => !c.isNamed && c.text === "default");
    if (hasDefault && !decl) {
      const ident = node.namedChildren.find((c) => c.type === "identifier");
      if (ident) {
        symbols.push(sym("default", "variable", node, doc));
      }
    }
  }

  
  private handleDecl(
    inner: SyntaxNode,
    outer: SyntaxNode,
    doc: string | undefined,
    symbols: ParsedSymbol[],
  ): void {
    switch (inner.type) {
      case "function_declaration":
        symbols.push(sym(name(inner), "function", outer, doc));
        break;
      case "class_declaration":
        symbols.push(sym(name(inner), "class", outer, doc));
        if (child(inner, "class_body")) this.extractMethods(child(inner, "class_body")!, symbols);
        break;
      case "interface_declaration":
        symbols.push(sym(name(inner), "interface", outer, doc));
        break;
      case "type_alias_declaration":
        symbols.push(sym(name(inner), "type", outer, doc));
        break;
      case "enum_declaration":
        symbols.push(sym(name(inner), "enum", outer, doc));
        break;
      case "lexical_declaration":
        this.handleLexical(inner, outer, doc, symbols);
        break;
      case "expression_statement":
        this.handleCJSExport(inner, symbols);
        break;
    }
  }

  
  private extractMethods(body: SyntaxNode, symbols: ParsedSymbol[]): void {
    body.namedChildren
      .filter((m) => m.type === "method_definition")
      .map((m) => sym(name(m), "method", m, getBlockDoc(m)))
      .forEach((s) => symbols.push(s));
  }

  
  private handleLexical(
    inner: SyntaxNode,
    outer: SyntaxNode,
    doc: string | undefined,
    symbols: ParsedSymbol[],
  ): void {
    children(inner, "variable_declarator")
      .filter((decl) => field(decl, "name") != null)
      .map((decl) => {
        const name = field(decl, "name")!;
        const value = decl.childForFieldName("value");
        const kind: SymbolKind =
          value?.type === "arrow_function" || value?.type === "function" ? "function" : "variable";
        return sym(name, kind, outer, doc);
      })
      .forEach((s) => symbols.push(s));
  }

  
  private handleCJSExport(node: SyntaxNode, symbols: ParsedSymbol[]): void {
    const assign = child(node, "assignment_expression");
    if (!assign) return;
    const left = assign.childForFieldName("left");
    if (!left || left.type !== "member_expression") return;
    const obj = left.childForFieldName("object");
    const prop = left.childForFieldName("property");
    if (obj?.text !== "module" || prop?.text !== "exports") return;
    symbols.push(sym("module.exports", "variable", node));
  }

  
  private handleImport(node: SyntaxNode, imports: ParsedImport[]): void {
    const src = node.childForFieldName("source") ?? child(node, "string");
    if (!src) return;
    const source = src.text.replace(/^['"]|['"]$/g, "");
    const clause = child(node, "import_clause");
    if (!clause) {
      imports.push({ source, names: [] });
      return;
    }

    const names: string[] = [];
    let defaultName: string | undefined;
    let isNamespace = false;

    for (const c of clause.namedChildren) {
      switch (c.type) {
        case "identifier":
          defaultName = c.text;
          break;
        case "named_imports":
          children(c, "import_specifier")
            .map((spec) => spec.childForFieldName("name")?.text ?? spec.namedChildren[0]?.text)
            .filter((n): n is string => n != null)
            .forEach((n) => names.push(n));
          break;
        case "namespace_import":
          isNamespace = true;
          defaultName = c.namedChildren[0]?.text;
          break;
      }
    }

    imports.push({
      source,
      names,
      defaultName,
      isNamespace: isNamespace || undefined,
    });
  }
}
