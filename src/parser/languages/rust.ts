/**
 * Rust extractor — functions, structs, enums, traits, impl blocks.
 */
import type {
  LanguageExtractor,
  SyntaxNode,
  ParseResult,
  ParsedSymbol,
  ParsedImport,
} from "./base.js";
import { sym, name, child, getRustDoc } from "./base.js";

export class RustExtractor implements LanguageExtractor {
  extract(root: SyntaxNode): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];

    for (const node of root.namedChildren) {
      switch (node.type) {
        case "function_item":
          symbols.push(sym(name(node), "function", node, getRustDoc(node)));
          break;
        case "struct_item":
          symbols.push(sym(name(node), "struct", node, getRustDoc(node)));
          break;
        case "enum_item":
          symbols.push(sym(name(node), "enum", node, getRustDoc(node)));
          break;
        case "trait_item": {
          symbols.push(sym(name(node), "trait", node, getRustDoc(node)));
          const decls = child(node, "declaration_list");
          if (decls) this.extractMethods(decls, symbols);
          break;
        }
        case "impl_item": {
          const decls = child(node, "declaration_list");
          if (decls) this.extractMethods(decls, symbols);
          break;
        }
        case "use_declaration":
          this.handleUse(node, imports);
          break;
      }
    }

    return { symbols, imports };
  }

  private extractMethods(declList: SyntaxNode, symbols: ParsedSymbol[]): void {
    declList.namedChildren
      .filter((m) => m.type === "function_item" || m.type === "function_signature_item")
      .map((m) => sym(name(m), "method", m, getRustDoc(m)))
      .forEach((s) => symbols.push(s));
  }

  private handleUse(node: SyntaxNode, imports: ParsedImport[]): void {
    const arg =
      child(node, "scoped_identifier") ??
      child(node, "use_wildcard") ??
      child(node, "scoped_use_list") ??
      child(node, "identifier");
    if (arg) {
      imports.push({ source: arg.text, names: [] });
    }
  }
}
