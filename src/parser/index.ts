/**
 * Parser registry: dispatches to tree-sitter or markdown parser based on language.
 */
import type { Language, ParseResult } from "../core/types.js";
import { parseWithTreeSitter } from "./tree-sitter-parser.js";
import { parseMarkdown } from "./markdown-parser.js";

/**
 * Parse source code and extract symbols + imports.
 * Routes to the appropriate parser based on language.
 */
export function parse(content: string, language: Language, filePath: string): ParseResult {
  if (language === "markdown") {
    return parseMarkdown(content, filePath);
  }
  return parseWithTreeSitter(content, language, filePath);
}
