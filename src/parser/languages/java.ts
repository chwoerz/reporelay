/**
 * Java extractor — classes, interfaces, enums, methods, nested types.
 */
import type {
  LanguageExtractor,
  SyntaxNode,
  ParseResult,
  ParsedSymbol,
  ParsedImport,
} from "./base.js";
import { sym, name, child, getBlockDoc } from "./base.js";

export class JavaExtractor implements LanguageExtractor {
  extract(root: SyntaxNode): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];

    for (const node of root.namedChildren) {
      switch (node.type) {
        case "class_declaration":
          this.handleClass(node, symbols, getBlockDoc(node));
          break;
        case "interface_declaration":
          symbols.push(sym(name(node), "interface", node, getBlockDoc(node)));
          break;
        case "enum_declaration":
          symbols.push(sym(name(node), "enum", node, getBlockDoc(node)));
          break;
        case "import_declaration": {
          const scoped = child(node, "scoped_identifier");
          if (scoped) imports.push({ source: scoped.text, names: [] });
          break;
        }
      }
    }

    return { symbols, imports };
  }

  private handleClass(node: SyntaxNode, symbols: ParsedSymbol[], doc: string | undefined): void {
    symbols.push(sym(name(node), "class", node, doc));

    const body = child(node, "class_body");
    if (!body) return;

    body.namedChildren.forEach((m) => {
      switch (m.type) {
        case "method_declaration":
        case "constructor_declaration":
          symbols.push(sym(name(m), "method", m, getBlockDoc(m)));
          break;
        case "enum_declaration":
          symbols.push(sym(name(m), "enum", m, getBlockDoc(m)));
          break;
        case "class_declaration":
          this.handleClass(m, symbols, getBlockDoc(m));
          break;
      }
    });
  }
}
