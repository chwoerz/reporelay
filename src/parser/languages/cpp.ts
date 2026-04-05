/**
 * C++ extractor — namespaces, classes, templates, methods, includes.
 * Reuses C-family helpers from the C extractor.
 */
import type {
  LanguageExtractor,
  SyntaxNode,
  ParseResult,
  ParsedSymbol,
  ParsedImport,
} from "./base.js";
import { sym, name, child, getBlockDoc } from "./base.js";
import { findCFunctionName, findCDeclFunctionName, extractInclude } from "./c.js";

export class CppExtractor implements LanguageExtractor {
  extract(root: SyntaxNode): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];
    this.walk(root.namedChildren, symbols, imports);
    return { symbols, imports };
  }

  private walk(nodes: SyntaxNode[], symbols: ParsedSymbol[], imports: ParsedImport[]): void {
    for (const node of nodes) {
      switch (node.type) {
        case "preproc_include":
          extractInclude(node, imports);
          break;
        case "namespace_definition":
          symbols.push(sym(name(node), "namespace", node, getBlockDoc(node)));
          if (child(node, "declaration_list"))
            this.walk(child(node, "declaration_list")!.namedChildren, symbols, imports);
          break;
        case "class_specifier":
          symbols.push(sym(name(node), "class", node, getBlockDoc(node)));
          this.extractClassMethods(node, symbols);
          break;
        case "function_definition": {
          const name = findCFunctionName(node);
          if (name) symbols.push(sym(name, "function", node, getBlockDoc(node)));
          break;
        }
        case "template_declaration":
          this.handleTemplate(node, symbols);
          break;
      }
    }
  }

  private handleTemplate(node: SyntaxNode, symbols: ParsedSymbol[]): void {
    node.namedChildren.forEach((c) => {
      if (c.type === "class_specifier") {
        symbols.push(sym(name(c), "class", node, getBlockDoc(node)));
        this.extractClassMethods(c, symbols);
      } else if (c.type === "function_definition") {
        const fname = findCFunctionName(c);
        if (fname) symbols.push(sym(fname, "function", node, getBlockDoc(node)));
      }
    });
  }

  private extractClassMethods(classNode: SyntaxNode, symbols: ParsedSymbol[]): void {
    const body = child(classNode, "field_declaration_list");
    if (!body) return;
    body.namedChildren.forEach((m) => {
      if (m.type === "function_definition") {
        const name = findCFunctionName(m);
        if (name) symbols.push(sym(name, "method", m, getBlockDoc(m)));
      }
      if (m.type === "declaration" || m.type === "field_declaration") {
        const fname = findCDeclFunctionName(m);
        if (fname) symbols.push(sym(fname, "method", m, getBlockDoc(m)));
      }
    });
  }
}
