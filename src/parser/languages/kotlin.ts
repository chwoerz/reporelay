/**
 * Kotlin extractor — classes, data classes, interfaces, objects, extension functions.
 */
import type {
  LanguageExtractor,
  SyntaxNode,
  ParseResult,
  ParsedSymbol,
  ParsedImport,
  SymbolKind,
} from "./base.js";
import { sym, child, getBlockDoc } from "./base.js";

export class KotlinExtractor implements LanguageExtractor {
  extract(root: SyntaxNode): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];

    for (const node of root.namedChildren) {
      switch (node.type) {
        case "class_declaration": {
          const name = child(node, "type_identifier")?.text ?? "(anonymous)";
          const isInterface = node.text.trimStart().startsWith("interface ");
          const kind: SymbolKind = isInterface ? "interface" : "class";
          symbols.push(sym(name, kind, node, getBlockDoc(node)));
          const body = child(node, "class_body");
          if (body) this.extractMethods(body, symbols);
          break;
        }
        case "object_declaration": {
          const name = child(node, "type_identifier")?.text ?? "(anonymous)";
          symbols.push(sym(name, "object", node, getBlockDoc(node)));
          const body = child(node, "class_body");
          if (body) this.extractMethods(body, symbols);
          break;
        }
        case "function_declaration": {
          const name = child(node, "simple_identifier")?.text ?? "(anonymous)";
          symbols.push(sym(name, "function", node, getBlockDoc(node)));
          break;
        }
        case "import_header": {
          const ident = child(node, "identifier");
          if (ident) imports.push({ source: ident.text, names: [] });
          break;
        }
      }
    }

    return { symbols, imports };
  }

  private extractMethods(body: SyntaxNode, symbols: ParsedSymbol[]): void {
    body.namedChildren
      .filter((m) => m.type === "function_declaration")
      .map((m) =>
        sym(child(m, "simple_identifier")?.text ?? "(anonymous)", "method", m, getBlockDoc(m)),
      )
      .forEach((s) => symbols.push(s));
  }
}
