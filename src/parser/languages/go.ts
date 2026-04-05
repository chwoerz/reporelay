/**
 * Go extractor — functions, methods, structs, interfaces, type declarations.
 */
import type {
  LanguageExtractor,
  SyntaxNode,
  ParseResult,
  ParsedSymbol,
  ParsedImport,
  SymbolKind,
} from "./base.js";
import { sym, name, child, children, getLineDoc } from "./base.js";

export class GoExtractor implements LanguageExtractor {
  extract(root: SyntaxNode): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];

    for (const node of root.namedChildren) {
      switch (node.type) {
        case "function_declaration":
          symbols.push(sym(name(node), "function", node, getLineDoc(node)));
          break;
        case "method_declaration":
          symbols.push(sym(name(node), "method", node, getLineDoc(node)));
          break;
        case "type_declaration":
          this.handleType(node, symbols);
          break;
        case "import_declaration":
          this.handleImport(node, imports);
          break;
      }
    }

    return { symbols, imports };
  }

  private handleType(node: SyntaxNode, symbols: ParsedSymbol[]): void {
    const doc = getLineDoc(node);
    children(node, "type_spec")
      .map((spec) => {
        const typeName = name(spec);
        const typeNode = spec.namedChildren.find((c) => c.type !== "type_identifier");
        let kind: SymbolKind = "type";
        if (typeNode?.type === "struct_type") kind = "struct";
        else if (typeNode?.type === "interface_type") kind = "interface";
        return sym(typeName, kind, node, doc);
      })
      .forEach((s) => symbols.push(s));
  }

  private handleImport(node: SyntaxNode, imports: ParsedImport[]): void {
    const specList = child(node, "import_spec_list");
    const specs = specList ? children(specList, "import_spec") : children(node, "import_spec");
    specs
      .map((spec) => child(spec, "interpreted_string_literal") ?? child(spec, "raw_string_literal"))
      .filter((strNode): strNode is SyntaxNode => strNode != null)
      .map((strNode) => ({
        source: strNode.text.replace(/^"|"$/g, ""),
        names: [] as string[],
      }))
      .forEach((imp) => imports.push(imp));
  }
}
