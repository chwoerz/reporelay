/**
 * Symbol-aware chunker.
 *
 * Splits parsed file content into embedding-friendly chunks respecting:
 * - Symbol boundaries (one chunk per symbol when it fits)
 * - Token budget (~512 tokens default, estimated via len/4)
 * - ~20% overlap for split symbols
 * - Import/docstring context prefix (counted in budget)
 * - Line-boundary-safe overflow windows for symbolless regions
 */
import type { ParsedImport, ParsedSymbol } from "../core/types.js";

// ── Types ──

export interface ChunkerOptions {
  /** Max tokens per chunk (estimated via text.length / 4). Default: 512 */
  maxTokens?: number;
  /** Overlap ratio for split windows (0-1). Default: 0.2 */
  overlapRatio?: number;
}

export interface ChunkOutput {
  content: string;
  startLine: number;
  endLine: number;
  /** Symbol this chunk belongs to (if any). */
  symbolName?: string;
  symbolKind?: string;
  symbolSignature?: string;
}

// ── Helpers ──

/**
 * Estimate token count via character heuristic.
 *
 * Plain `text.length / 4` is accurate for natural language and typical code,
 * but badly underestimates tokens for dense content like SVG paths, numeric
 * arrays, or minified code where each number/symbol is its own token.
 *
 * This improved heuristic counts "dense" characters (digits, punctuation,
 * operators) at a higher rate (~1 char/token) and everything else at the
 * normal ~4 chars/token rate.
 */
export function estimateTokens(text: string): number {
  let denseChars = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    // digits 0-9, common punctuation/operators that tokenize as individual tokens
    if (
      (ch >= 48 && ch <= 57) || // 0-9
      ch === 46 || // .
      ch === 44 || // ,
      ch === 59 || // ;
      ch === 40 ||
      ch === 41 || // ( )
      ch === 91 ||
      ch === 93 || // [ ]
      ch === 123 ||
      ch === 125 // { }
    ) {
      denseChars++;
    }
  }
  const normalChars = text.length - denseChars;
  // Dense chars: ~1.5 chars/token; normal chars: ~4 chars/token
  return Math.ceil(denseChars / 1.5 + normalChars / 4);
}

/**
 * Build an import block string from parsed imports.
 */
function buildImportPrefix(imports: ParsedImport[]): string {
  if (imports.length === 0) return "";
  const lines: string[] = [];
  for (const imp of imports) {
    if (imp.isNamespace) {
      lines.push(`import * as ${imp.defaultName} from "${imp.source}";`);
    } else if (imp.defaultName && imp.names.length > 0) {
      lines.push(`import ${imp.defaultName}, { ${imp.names.join(", ")} } from "${imp.source}";`);
    } else if (imp.defaultName) {
      lines.push(`import ${imp.defaultName} from "${imp.source}";`);
    } else if (imp.names.length > 0) {
      lines.push(`import { ${imp.names.join(", ")} } from "${imp.source}";`);
    } else {
      lines.push(`import "${imp.source}";`);
    }
  }
  return lines.join("\n") + "\n\n";
}

type Window = { content: string; startLine: number; endLine: number };

/**
 * Split text into line-boundary-safe windows of approximately `maxLines` lines
 * with `overlapLines` overlap.
 */
function splitIntoWindows(
  lines: string[],
  startLineBase: number,
  maxLines: number,
  overlapLines: number,
): Window[] {
  const windows: Window[] = [];
  let i = 0;
  while (i < lines.length) {
    const end = Math.min(i + maxLines, lines.length);
    const windowLines = lines.slice(i, end);
    windows.push({
      content: windowLines.join("\n"),
      startLine: startLineBase + i,
      endLine: startLineBase + end - 1,
    });
    if (end >= lines.length) break;
    i += maxLines - overlapLines;
  }
  return windows;
}

// ── Main Chunker ──

function oneChunkFile(config: {
  contentBudget: number;
  allLines: string[];
  fileContent: string;
  overlapRatio: number;
  importPrefix: string;
  chunks: ChunkOutput[];
}) {
  const { maxLines, overlapLines } = computeWindowParams(
    config.contentBudget,
    config.fileContent.length,
    config.allLines.length,
    config.overlapRatio,
    5,
  );

  const windows = splitIntoWindows(config.allLines, 1, maxLines, overlapLines);
  for (const win of windows) {
    const content = config.importPrefix ? config.importPrefix + win.content : win.content;
    config.chunks.push({
      content,
      startLine: win.startLine,
      endLine: win.endLine,
    });
  }
  return config.chunks;
}

/** Push a chunk with optional import/doc prefix and symbol metadata. */
function addChunk(
  chunks: ChunkOutput[],
  opts: {
    importPrefix: string;
    docPrefix: string;
    content: string;
    startLine: number;
    endLine: number;
    sym?: ParsedSymbol;
  },
): void {
  const prefix = (opts.importPrefix || "") + opts.docPrefix;
  const content = prefix ? prefix + opts.content : opts.content;
  chunks.push({
    content,
    startLine: opts.startLine,
    endLine: opts.endLine,
    symbolName: opts.sym?.name,
    symbolKind: opts.sym?.kind,
    symbolSignature: opts.sym?.signature,
  });
}

/** Compute window parameters from a token budget and text stats. */
function computeWindowParams(
  contentBudget: number,
  textLength: number,
  lineCount: number,
  overlapRatio: number,
  minLines = 3,
): { maxLines: number; overlapLines: number } {
  const maxChars = contentBudget * 4;
  const avgCharsPerLine = lineCount > 0 ? textLength / lineCount : 80;
  const maxLines = Math.max(Math.floor(maxChars / avgCharsPerLine), minLines);
  const overlapLines = Math.max(Math.floor(maxLines * overlapRatio), 1);
  return { maxLines, overlapLines };
}

function determineGapLines(allLines: string[], coveredLines: Set<number>) {
  let gapStart: number | null = null;
  const gapLines: { start: number; end: number }[] = [];

  for (let l = 1; l <= allLines.length; l++) {
    if (!coveredLines.has(l)) {
      if (gapStart === null) gapStart = l;
    } else {
      if (gapStart !== null) {
        gapLines.push({ start: gapStart, end: l - 1 });
        gapStart = null;
      }
    }
  }
  if (gapStart !== null) {
    gapLines.push({ start: gapStart, end: allLines.length });
  }
  return gapLines;
}

function addGapChunks(
  chunks: ChunkOutput[],
  opts: {
    contentBudget: number;
    lines: string[];
    gapContent: string;
    overlapRatio: number;
    gapStart: number;
  },
): void {
  const { maxLines, overlapLines } = computeWindowParams(
    opts.contentBudget,
    opts.gapContent.length,
    opts.lines.length,
    opts.overlapRatio,
  );

  const windows = splitIntoWindows(opts.lines, opts.gapStart, maxLines, overlapLines);
  windows
    .filter((win) => win.content.trim())
    .forEach((win) => {
      chunks.push({
        content: win.content,
        startLine: win.startLine,
        endLine: win.endLine,
      });
    });
}

/**
 * Chunk file content into embedding-friendly pieces.
 *
 * @param fileContent - Full file source code
 * @param symbols - Parsed symbols from the file
 * @param imports - Parsed imports from the file
 * @param options - Chunker options (maxTokens, overlapRatio)
 * @returns Array of chunks with content, line ranges, and optional symbol metadata
 */
export function chunkFile(
  fileContent: string,
  symbols: ParsedSymbol[],
  imports: ParsedImport[],
  options: ChunkerOptions = {},
): ChunkOutput[] {
  const maxTokens = options.maxTokens ?? 512;
  const overlapRatio = options.overlapRatio ?? 0.2;

  const allLines = fileContent.split("\n");
  const chunks: ChunkOutput[] = [];

  // Build import context prefix
  const importPrefix = buildImportPrefix(imports);
  const importTokens = estimateTokens(importPrefix);

  // Budget available for actual content (after import prefix)
  const contentBudget = Math.max(maxTokens - importTokens, maxTokens * 0.5);

  if (symbols.length === 0) {
    // No symbols — chunk the entire file into overflow windows
    return oneChunkFile({
      contentBudget: contentBudget,
      allLines: allLines,
      fileContent: fileContent,
      overlapRatio: overlapRatio,
      importPrefix: importPrefix,
      chunks: chunks,
    });
  }

  // Sort symbols by start line
  const sorted = [...symbols].sort((a, b) => a.startLine - b.startLine);

  // Track which lines are covered by symbols
  const coveredLines = new Set<number>();
  for (const sym of sorted) {
    for (let l = sym.startLine; l <= sym.endLine; l++) {
      coveredLines.add(l);
    }
  }

  // Process each symbol
  for (const sym of sorted) {
    // Build documentation prefix (if any)
    const docPrefix = sym.documentation ? sym.documentation + "\n" : "";
    const docTokens = estimateTokens(docPrefix);

    const symbolBudget = Math.max(contentBudget - docTokens, maxTokens * 0.3);

    const symbolContent = sym.content;
    const symbolTokens = estimateTokens(symbolContent);

    if (symbolTokens <= symbolBudget) {
      // Symbol fits in one chunk
      addChunk(chunks, {
        importPrefix,
        docPrefix,
        content: symbolContent,
        startLine: sym.startLine,
        endLine: sym.endLine,
        sym,
      });
    } else {
      // Symbol is too large — split into overlapping windows
      const symLines = symbolContent.split("\n");
      const { maxLines, overlapLines } = computeWindowParams(
        symbolBudget,
        symbolContent.length,
        symLines.length,
        overlapRatio,
      );

      const windows = splitIntoWindows(symLines, sym.startLine, maxLines, overlapLines);
      for (const win of windows) {
        addChunk(chunks, {
          importPrefix,
          docPrefix,
          content: win.content,
          startLine: win.startLine,
          endLine: win.endLine,
          sym,
        });
      }
    }
  }

  // Handle uncovered lines (gaps between symbols, or before/after)
  const gapLines = determineGapLines(allLines, coveredLines);

  for (const gap of gapLines) {
    const lines = allLines.slice(gap.start - 1, gap.end);
    const gapContent = lines.join("\n").trim();
    if (!gapContent) continue; // Skip empty gaps

    const gapTokens = estimateTokens(gapContent);
    if (gapTokens <= contentBudget) {
      chunks.push({
        content: gapContent,
        startLine: gap.start,
        endLine: gap.end,
      });
    } else {
      addGapChunks(chunks, { contentBudget, lines, gapContent, overlapRatio, gapStart: gap.start });
    }
  }

  return chunks;
}
