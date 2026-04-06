/**
 * Shared types and interfaces used across all modules.
 */

// ── Language ──

export const Languages = [
  "typescript",
  "javascript",
  "python",
  "go",
  "java",
  "kotlin",
  "rust",
  "c",
  "cpp",
  "markdown",
] as const;

export type Language = (typeof Languages)[number];

/**
 * Per-language file percentage breakdown.
 * Keys are Language strings, values are percentages (0–100).
 * e.g. { "typescript": 45.2, "java": 54.8 }
 */
export type LanguageStats = Partial<Record<Language, number>>;

// ── Symbol kinds ──

export const SymbolKinds = [
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "method",
  "struct",
  "trait",
  "variable",
  "module",
  "namespace",
  "object",
  "heading",
] as const;

export type SymbolKind = (typeof SymbolKinds)[number];

// ── Parsed symbol ──

export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  /** Full signature / first line (e.g. `export function foo(bar: string): void`) */
  signature: string;
  /** 1-based inclusive start line */
  startLine: number;
  /** 1-based inclusive end line */
  endLine: number;
  /** JSDoc / docstring / comment above the symbol */
  documentation?: string;
  /** Source code of the symbol */
  content: string;
}

// ── Import ──

export interface ParsedImport {
  /** Module specifier (e.g. `./foo`, `node:events`, `react`) */
  source: string;
  /** Named imports (e.g. `["EventEmitter", "on"]`) */
  names: string[];
  /** Default import name, if any */
  defaultName?: string;
  /** Whether this is a namespace import (`import * as x`) */
  isNamespace?: boolean;
}

// ── Parse result ──

export interface ParseResult {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
}

// ── Indexing stage (re-export from generated OpenAPI types) ──

export { indexingStageEnum, type IndexingStage } from "../generated/types/IndexingStage.js";

// ── Stored symbol (DB row) — use Drizzle-inferred types from schema.ts instead ──

// ── Search result ──

export interface SearchResult {
  filePath: string;
  repo: string;
  ref: string;
  content: string;
  startLine: number;
  endLine: number;
  score: number;
  symbolName?: string;
}

// ── Context pack strategy ──

export const ContextStrategies = ["explain", "implement", "debug", "recent-changes"] as const;
export type ContextStrategy = (typeof ContextStrategies)[number];

// ── Index job ──

export interface IndexJob {
  repo: string;
  ref: string;
  commitSha?: string;
}
