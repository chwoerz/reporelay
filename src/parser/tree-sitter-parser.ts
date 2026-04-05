/**
 * Tree-sitter parser entry point.
 *
 * Loads grammars, caches Parser instances, and delegates symbol / import
 * extraction to per-language {@link LanguageExtractor} implementations.
 */
import Parser from "tree-sitter";
import _tsGrammars from "tree-sitter-typescript";
import _jsGrammar from "tree-sitter-javascript";
import _pyGrammar from "tree-sitter-python";
import _goGrammar from "tree-sitter-go";
import _javaGrammar from "tree-sitter-java";
import _ktGrammar from "tree-sitter-kotlin";
import _rsGrammar from "tree-sitter-rust";
import _cGrammar from "tree-sitter-c";
import _cppGrammar from "tree-sitter-cpp";
import type { Language, ParseResult } from "../core/types.js";
import type { LanguageExtractor } from "./languages/index.js";
import {
  TypeScriptJavaScriptExtractor,
  PythonExtractor,
  GoExtractor,
  JavaExtractor,
  KotlinExtractor,
  RustExtractor,
  CExtractor,
  CppExtractor,
} from "./languages/index.js";

// ── Grammar registry ──────────────────────────────────────

const GRAMMARS: Record<string, unknown> = {
  typescript: _tsGrammars.typescript,
  javascript: _jsGrammar,
  python: _pyGrammar,
  go: _goGrammar,
  java: _javaGrammar,
  kotlin: _ktGrammar,
  rust: _rsGrammar,
  c: _cGrammar,
  cpp: _cppGrammar,
};

// ── Parser cache ──────────────────────────────────────────

const parserCache = new Map<string, Parser>();

function getParser(lang: string): Parser {
  let p = parserCache.get(lang);
  if (!p) {
    p = new Parser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.setLanguage(GRAMMARS[lang] as any);
    parserCache.set(lang, p);
  }
  return p;
}

// ── Extractor registry ────────────────────────────────────

const tsjs = new TypeScriptJavaScriptExtractor();

const EXTRACTORS: Partial<Record<Language, LanguageExtractor>> = {
  typescript: tsjs,
  javascript: tsjs,
  python: new PythonExtractor(),
  go: new GoExtractor(),
  java: new JavaExtractor(),
  kotlin: new KotlinExtractor(),
  rust: new RustExtractor(),
  c: new CExtractor(),
  cpp: new CppExtractor(),
};

// ── Public API ────────────────────────────────────────────

/**
 * Parse source code with tree-sitter and extract symbols + imports.
 * Returns empty result for unsupported languages or markdown.
 */
export function parseWithTreeSitter(
  content: string,
  language: Language,
  filePath: string,
): ParseResult {
  if (language === "markdown" || !GRAMMARS[language]) {
    return { symbols: [], imports: [] };
  }
  if (!content.trim()) {
    return { symbols: [], imports: [] };
  }

  const parser = getParser(language);
  const tree = parser.parse(content);
  const extractor = EXTRACTORS[language];
  if (!extractor) return { symbols: [], imports: [] };
  return extractor.extract(tree.rootNode);
}
