/**
 * C extractor — functions, structs, typedefs, prototypes, includes.
 * Handles preprocessor-guarded headers (`#ifdef`).
 *
 * Also exports C-family helpers reused by the C++ extractor.
 */
import type {
  LanguageExtractor,
  SyntaxNode,
  ParseResult,
  ParsedSymbol,
  ParsedImport,
  SymbolKind,
} from "./base.js";
import { sym, child, children, getBlockDoc } from "./base.js";


/** Walk through nested declarators to find a function name. */
export function findCFunctionName(node: SyntaxNode): string | null {
  const declarator = node.childForFieldName("declarator");
  if (!declarator) return null;
  if (declarator.type === "function_declarator") {
    return declarator.childForFieldName("declarator")?.text ?? null;
  }
  if (declarator.type === "pointer_declarator") {
    const inner = child(declarator, "function_declarator");
    return inner?.childForFieldName("declarator")?.text ?? null;
  }
  return null;
}

/** Find a function name inside a forward declaration / prototype. */
export function findCDeclFunctionName(node: SyntaxNode): string | null {
  const funcDecl = node.namedChildren.find(
    (c) => c.type === "function_declarator" || c.type === "pointer_declarator",
  );
  if (!funcDecl) return null;
  if (funcDecl.type === "function_declarator") {
    return (
      funcDecl.childForFieldName("declarator")?.text ?? child(funcDecl, "identifier")?.text ?? null
    );
  }
  // pointer_declarator
  const inner = child(funcDecl, "function_declarator");
  if (inner) {
    return inner.childForFieldName("declarator")?.text ?? child(inner, "identifier")?.text ?? null;
  }
  return null;
}

/** Extract an `#include` as an import. */
export function extractInclude(node: SyntaxNode, imports: ParsedImport[]): void {
  const path = child(node, "system_lib_string") ?? child(node, "string_literal");
  if (path) {
    imports.push({
      source: path.text.replace(/^[<"]|[>"]$/g, ""),
      names: [],
    });
  }
}


export class CExtractor implements LanguageExtractor {
  extract(root: SyntaxNode): ParseResult {
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];
    this.walk(root.namedChildren, symbols, imports);
    return { symbols, imports };
  }

  private walk(nodes: SyntaxNode[], symbols: ParsedSymbol[], imports: ParsedImport[]): void {
    for (const node of nodes) {
      switch (node.type) {
        // Recurse into preprocessor guards
        case "preproc_ifdef":
        case "preproc_if":
        case "preproc_else":
        case "preproc_elif":
          this.walk(node.namedChildren, symbols, imports);
          break;
        case "preproc_include":
          extractInclude(node, imports);
          break;
        case "function_definition": {
          const name = findCFunctionName(node);
          if (name) symbols.push(sym(name, "function", node, getBlockDoc(node)));
          break;
        }
        case "type_definition": {
          const nameNode = children(node, "type_identifier").at(-1);
          const structSpec = child(node, "struct_specifier");
          const kind: SymbolKind = structSpec ? "struct" : "type";
          if (nameNode) symbols.push(sym(nameNode.text, kind, node));
          break;
        }
        case "declaration": {
          const fname = findCDeclFunctionName(node);
          if (fname) symbols.push(sym(fname, "function", node));
          break;
        }
      }
    }
  }
}
