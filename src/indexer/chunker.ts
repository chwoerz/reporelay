/**
 * Symbol-aware chunker.
 *
 * Splits parsed file content into embedding-friendly chunks respecting:
 * - Symbol boundaries (one chunk per symbol when it fits)
 * - Token budget (~512 tokens default, estimated conservatively)
 * - ~20% overlap for split symbols
 * - Language-appropriate import/docstring context prefix (counted in budget)
 * - Line-boundary-safe overflow windows for symbolless regions
 */
import type { Language, ParsedImport, ParsedSymbol } from "../core/types.js";

export interface ChunkerOptions {
  /** Default: 512 */
  maxTokens?: number;
  /** 0-1, default: 0.2 */
  overlapRatio?: number;
  /** Controls how the import prefix is rendered. */
  language?: Language;
}

export interface ChunkOutput {
  content: string;
  startLine: number;
  endLine: number;
  symbolName?: string;
  symbolKind?: string;
  symbolSignature?: string;
}

/** Minimum lines per window — keeps very-low-budget windows usable. */
const MIN_WINDOW_LINES = 3;

/**
 * Conservative char-to-token heuristic.
 *
 * Precise token counts require a model-specific tokenizer: OpenAI uses
 * tiktoken (BPE), Ollama's nomic-embed-text uses BERT WordPiece. A single
 * library can't cover both, and BERT tends to produce ~1.5× more tokens
 * than tiktoken on code. Rather than pretend to be accurate, we use
 * `ceil(len/3)`, which is a ~25% overestimate for typical code in either
 * tokenizer — safely under any model's context window for chunk sizing.
 *
 * If exact counts ever matter, add a provider-specific tokenizer behind
 * an opt-in switch; don't try to calibrate this heuristic further.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function renderImport(imp: ParsedImport, language?: Language): string {
  const hasNames = imp.names.length > 0;
  const names = imp.names.join(", ");

  switch (language) {
    case "python":
      if (hasNames) return `from ${imp.source} import ${names}`;
      if (imp.isNamespace && imp.defaultName) {
        return `import ${imp.source} as ${imp.defaultName}`;
      }
      return `import ${imp.source}`;

    case "go":
      if (imp.defaultName) return `import ${imp.defaultName} "${imp.source}"`;
      return `import "${imp.source}"`;

    case "rust":
      if (hasNames) return `use ${imp.source}::{${names}};`;
      if (imp.defaultName && imp.defaultName !== imp.source) {
        return `use ${imp.source} as ${imp.defaultName};`;
      }
      return `use ${imp.source};`;

    case "java":
    case "kotlin":
      return `import ${imp.source};`;

    case "c":
    case "cpp":
      // ParsedImport.source is expected to already include the delimiter hint;
      // wrap in quotes as a safe default when it doesn't.
      if (imp.source.startsWith("<") || imp.source.startsWith('"')) {
        return `#include ${imp.source}`;
      }
      return `#include "${imp.source}"`;

    case "markdown":
      // Markdown "imports" are link references, which aren't meaningful as
      // prepended context — emit a comment so the embedder sees them but
      // they don't look like live code.
      return `<!-- link: ${imp.source} -->`;

    case "typescript":
    case "javascript":
    default:
      if (imp.isNamespace && imp.defaultName) {
        return `import * as ${imp.defaultName} from "${imp.source}";`;
      }
      if (imp.defaultName && hasNames) {
        return `import ${imp.defaultName}, { ${names} } from "${imp.source}";`;
      }
      if (imp.defaultName) return `import ${imp.defaultName} from "${imp.source}";`;
      if (hasNames) return `import { ${names} } from "${imp.source}";`;
      return `import "${imp.source}";`;
  }
}

function buildImportPrefix(imports: ParsedImport[], language?: Language): string {
  if (imports.length === 0) return "";
  return imports.map((imp) => renderImport(imp, language)).join("\n") + "\n\n";
}

/**
 * Emit one or more chunks over a line range, splitting into windows when
 * content exceeds `budget`. Single path for every caller (symbol, gap,
 * symbolless whole file) so budget, windowing, and prefix stay in sync.
 */
function emitWindows(
  chunks: ChunkOutput[],
  opts: {
    lines: string[];
    startLineBase: number;
    budget: number;
    overlapRatio: number;
    prefix: string;
    sym?: ParsedSymbol;
  },
): void {
  const { lines, startLineBase, budget, overlapRatio, prefix, sym } = opts;
  const text = lines.join("\n");
  if (!text.trim()) return;

  const push = (content: string, startLine: number, endLine: number) => {
    chunks.push({
      content: prefix ? prefix + content : content,
      startLine,
      endLine,
      symbolName: sym?.name,
      symbolKind: sym?.kind,
      symbolSignature: sym?.signature,
    });
  };

  // Fast path: whole range fits.
  if (estimateTokens(text) <= budget) {
    push(text, startLineBase, startLineBase + lines.length - 1);
    return;
  }

  // Split into line-boundary-safe windows with overlap.
  const maxChars = budget * 3; // inverse of estimateTokens
  const avgCharsPerLine = lines.length > 0 ? text.length / lines.length : 80;
  const maxLines = Math.max(Math.floor(maxChars / avgCharsPerLine), MIN_WINDOW_LINES);
  const overlapLines = Math.max(Math.floor(maxLines * overlapRatio), 1);

  for (let i = 0; i < lines.length; ) {
    const end = Math.min(i + maxLines, lines.length);
    const windowLines = lines.slice(i, end);
    push(windowLines.join("\n"), startLineBase + i, startLineBase + end - 1);
    if (end >= lines.length) break;
    i += maxLines - overlapLines;
  }
}

/**
 * Compute the line ranges NOT covered by any symbol, via interval subtraction.
 * O(symbols) — the old Set-of-covered-lines approach was O(symbols × avg-lines-per-symbol)
 * and allocated a Set entry per covered line (a 30k-line file → 30k Set entries).
 */
function computeGapRanges(
  symbolsSortedByStart: ParsedSymbol[],
  totalLines: number,
): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = [];
  let cursor = 1; // 1-based line numbering

  for (const sym of symbolsSortedByStart) {
    if (sym.startLine > cursor) {
      gaps.push({ start: cursor, end: sym.startLine - 1 });
    }
    if (sym.endLine + 1 > cursor) cursor = sym.endLine + 1;
  }
  if (cursor <= totalLines) {
    gaps.push({ start: cursor, end: totalLines });
  }
  return gaps;
}

export function chunkFile(
  fileContent: string,
  symbols: ParsedSymbol[],
  imports: ParsedImport[],
  options: ChunkerOptions = {},
): ChunkOutput[] {
  const maxTokens = options.maxTokens ?? 512;
  const overlapRatio = options.overlapRatio ?? 0.2;
  const language = options.language;

  const allLines = fileContent.split("\n");
  const chunks: ChunkOutput[] = [];

  const importPrefix = buildImportPrefix(imports, language);
  const importTokens = estimateTokens(importPrefix);
  // Budget available for actual content (after import prefix). Clamp so a
  // very long import block can't starve the chunk body entirely.
  const contentBudget = Math.max(maxTokens - importTokens, maxTokens * 0.5);

  if (symbols.length === 0) {
    emitWindows(chunks, {
      lines: allLines,
      startLineBase: 1,
      budget: contentBudget,
      overlapRatio,
      prefix: importPrefix,
    });
    return chunks;
  }

  const sorted = [...symbols].sort((a, b) => a.startLine - b.startLine);

  for (const sym of sorted) {
    const docPrefix = sym.documentation ? sym.documentation + "\n" : "";
    const docTokens = estimateTokens(docPrefix);
    const symbolBudget = Math.max(contentBudget - docTokens, maxTokens * 0.3);
    const prefix = importPrefix + docPrefix;
    const symLines = sym.content.split("\n");

    emitWindows(chunks, {
      lines: symLines,
      startLineBase: sym.startLine,
      budget: symbolBudget,
      overlapRatio,
      prefix,
      sym,
    });
  }

  // Gap chunks get the import prefix too, for parity with symbol chunks —
  // top-level statements (module config, register calls) live in gaps and
  // benefit from the same module-level context.
  for (const gap of computeGapRanges(sorted, allLines.length)) {
    const gapLines = allLines.slice(gap.start - 1, gap.end);
    emitWindows(chunks, {
      lines: gapLines,
      startLineBase: gap.start,
      budget: contentBudget,
      overlapRatio,
      prefix: importPrefix,
    });
  }

  return chunks;
}
