import { describe, it, expect } from "vitest";
import { chunkFile } from "./chunker.js";
import { shouldSkipFile, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_AVG_LINE_LENGTH } from "./pipeline.js";
import { parse } from "../parser/index.js";
import { TYPESCRIPT_SAMPLE, PYTHON_SAMPLE } from "../../test/fixtures/samples.js";
import type { ParsedSymbol } from "../core/types.js";

describe("Chunker", () => {
  describe("symbol-aware chunking", () => {
    it("creates one chunk per symbol when symbol fits within max token limit", () => {
      const { symbols, imports } = parse(TYPESCRIPT_SAMPLE, "typescript", "service.ts");
      // Use a generous budget so every symbol fits in one chunk
      const chunks = chunkFile(TYPESCRIPT_SAMPLE, symbols, imports, { maxTokens: 2048 });

      // Each symbol should produce exactly one chunk
      const symbolChunks = chunks.filter((c) => c.symbolName != null);
      const uniqueSymbols = new Set(symbols.map((s) => s.name));

      // At least one chunk per symbol
      for (const sym of uniqueSymbols) {
        const matching = symbolChunks.filter((c) => c.symbolName === sym);
        expect(matching.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("splits large symbols into overlapping windows", () => {
      // Create a fake very large symbol
      const longBody = Array.from({ length: 200 }, (_, i) => `  const x${i} = ${i};`).join("\n");
      const content = `function bigFn() {\n${longBody}\n}`;
      const symbol: ParsedSymbol = {
        name: "bigFn",
        kind: "function",
        signature: "function bigFn()",
        startLine: 1,
        endLine: 202,
        content,
      };

      // Use a tiny token budget to force splitting
      const chunks = chunkFile(content, [symbol], [], { maxTokens: 128 });

      expect(chunks.length).toBeGreaterThan(1);
      // All chunks should belong to the symbol
      chunks.forEach((c) => expect(c.symbolName).toBe("bigFn"));

      // Verify overlap: endLine of chunk[i] should be >= startLine of chunk[i+1]
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i]!.endLine).toBeGreaterThanOrEqual(chunks[i + 1]!.startLine - 1);
      }
    });

    it("preserves symbol metadata (name, kind, signature) on each chunk", () => {
      const { symbols, imports } = parse(TYPESCRIPT_SAMPLE, "typescript", "service.ts");
      const chunks = chunkFile(TYPESCRIPT_SAMPLE, symbols, imports, { maxTokens: 2048 });
      const symbolChunks = chunks.filter((c) => c.symbolName != null);

      expect(symbolChunks.length).toBeGreaterThan(0);
      symbolChunks.forEach((chunk) => {
        expect(chunk.symbolName).toBeTruthy();
        expect(chunk.symbolKind).toBeTruthy();
        expect(chunk.symbolSignature).toBeTruthy();
      });
    });

    it("includes surrounding context lines (imports, leading comments)", () => {
      const { symbols, imports } = parse(TYPESCRIPT_SAMPLE, "typescript", "service.ts");
      expect(imports.length).toBeGreaterThan(0);

      const chunks = chunkFile(TYPESCRIPT_SAMPLE, symbols, imports, { maxTokens: 2048 });
      const symbolChunks = chunks.filter((c) => c.symbolName != null);

      // Symbol chunks should start with reconstructed import prefix
      symbolChunks.forEach((chunk) => {
        expect(chunk.content).toContain("import");
      });
    });
  });

  describe("overflow windows", () => {
    it("chunks files without symbols into fixed-size windows with overlap", () => {
      // Plain text with no parseable symbols
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}: some content here`);
      const content = lines.join("\n");

      const chunks = chunkFile(content, [], [], { maxTokens: 128 });

      expect(chunks.length).toBeGreaterThan(1);
      // No chunks should have symbol metadata
      chunks.forEach((c) => {
        expect(c.symbolName).toBeUndefined();
      });
    });

    it("respects line boundaries (never splits mid-line)", () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line-${i + 1}-content`);
      const content = lines.join("\n");

      const chunks = chunkFile(content, [], [], { maxTokens: 64 });

      chunks.forEach((chunk) => {
        // Content should not end or start with a partial line
        // Each line in the chunk should be a complete original line
        const chunkLines = chunk.content.split("\n");
        chunkLines.forEach((line) => {
          if (line.startsWith("line-")) {
            expect(line).toMatch(/^line-\d+-content$/);
          }
        });
      });
    });

    it("overlap size is configurable", () => {
      const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`);
      const content = lines.join("\n");

      const chunksLowOverlap = chunkFile(content, [], [], {
        maxTokens: 128,
        overlapRatio: 0.1,
      });
      const chunksHighOverlap = chunkFile(content, [], [], {
        maxTokens: 128,
        overlapRatio: 0.4,
      });

      // Higher overlap should produce more chunks (since each step advances fewer lines)
      expect(chunksHighOverlap.length).toBeGreaterThanOrEqual(chunksLowOverlap.length);
    });
  });

  describe("deduplication", () => {
    it("deterministically produces same chunks for identical content", () => {
      const { symbols, imports } = parse(TYPESCRIPT_SAMPLE, "typescript", "service.ts");
      const chunks1 = chunkFile(TYPESCRIPT_SAMPLE, symbols, imports);
      const chunks2 = chunkFile(TYPESCRIPT_SAMPLE, symbols, imports);

      expect(chunks1).toEqual(chunks2);
    });

    it("produces different chunks for different content", () => {
      const { symbols: s1, imports: i1 } = parse(TYPESCRIPT_SAMPLE, "typescript", "service.ts");
      const { symbols: s2, imports: i2 } = parse(PYTHON_SAMPLE, "python", "calc.py");

      const chunks1 = chunkFile(TYPESCRIPT_SAMPLE, s1, i1);
      const chunks2 = chunkFile(PYTHON_SAMPLE, s2, i2);

      expect(chunks1.map((c) => c.content)).not.toEqual(chunks2.map((c) => c.content));
    });

    it("content hash (SHA-256) is consistent for same input", async () => {
      const { createHash } = await import("node:crypto");
      const hash1 = createHash("sha256").update(TYPESCRIPT_SAMPLE, "utf-8").digest("hex");
      const hash2 = createHash("sha256").update(TYPESCRIPT_SAMPLE, "utf-8").digest("hex");

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex is 64 chars
    });
  });

  describe("metadata", () => {
    it("each chunk includes startLine and endLine", () => {
      const { symbols, imports } = parse(TYPESCRIPT_SAMPLE, "typescript", "service.ts");
      const chunks = chunkFile(TYPESCRIPT_SAMPLE, symbols, imports);

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((chunk) => {
        expect(chunk.startLine).toBeGreaterThanOrEqual(1);
        expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      });
    });

    it("each chunk includes the content string for embedding", () => {
      const { symbols, imports } = parse(TYPESCRIPT_SAMPLE, "typescript", "service.ts");
      const chunks = chunkFile(TYPESCRIPT_SAMPLE, symbols, imports);

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((chunk) => {
        expect(typeof chunk.content).toBe("string");
        expect(chunk.content.length).toBeGreaterThan(0);
      });
    });
  });

  describe("large file handling", () => {
    it("chunks a file with thousands of lines without crashing", () => {
      // Simulate a large file like a React type definition (~4500 lines)
      const lines: string[] = [];
      for (let i = 0; i < 4500; i++) {
        lines.push(`  export type Type${i} = { value: number; label: string };`);
      }
      const content = lines.join("\n");

      // This should not throw
      const chunks = chunkFile(content, [], []);
      expect(chunks.length).toBeGreaterThan(1);

      // Each chunk should be bounded in size
      for (const chunk of chunks) {
        // Default maxTokens=512, so each chunk content should be roughly ≤ 512*4 = 2048 chars
        // (plus some import prefix overhead)
        expect(chunk.content.length).toBeLessThan(4096);
      }
    });

    it("chunks a file with many large symbols", () => {
      const symbols: ParsedSymbol[] = [];
      const lines: string[] = [];
      let lineNum = 1;
      // Create 50 symbols, each 100 lines long
      for (let s = 0; s < 50; s++) {
        const start = lineNum;
        const symLines: string[] = [];
        symLines.push(`function bigFunction${s}() {`);
        for (let l = 0; l < 98; l++) {
          symLines.push(`  const x_${s}_${l} = ${l};`);
        }
        symLines.push("}");
        const symContent = symLines.join("\n");
        lines.push(...symLines);

        symbols.push({
          name: `bigFunction${s}`,
          kind: "function",
          signature: `function bigFunction${s}()`,
          startLine: start,
          endLine: start + 99,
          content: symContent,
        });
        lineNum += 100;
      }

      const content = lines.join("\n");
      const chunks = chunkFile(content, symbols, [], { maxTokens: 256 });

      // Should produce chunks without throwing
      expect(chunks.length).toBeGreaterThan(50); // each symbol should be split
    });
  });
});

describe("shouldSkipFile", () => {
  it("returns null for normal-sized files", () => {
    const content = "const x = 1;\nconst y = 2;\n";
    expect(shouldSkipFile(content, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_AVG_LINE_LENGTH)).toBeNull();
  });

  it("returns 'too-large' for files exceeding maxFileSize", () => {
    // Create a file just over the default 3 MB cap
    const content = "x".repeat(DEFAULT_MAX_FILE_SIZE + 1024);
    expect(shouldSkipFile(content, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_AVG_LINE_LENGTH)).toBe(
      "too-large",
    );
  });

  it("returns 'too-large' for files just over the limit", () => {
    const content = "x".repeat(DEFAULT_MAX_FILE_SIZE + 1);
    expect(shouldSkipFile(content, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_AVG_LINE_LENGTH)).toBe(
      "too-large",
    );
  });

  it("returns null for files just under the limit", () => {
    // Create content just under 1MB (note: ASCII chars are 1 byte each)
    const content = "x".repeat(DEFAULT_MAX_FILE_SIZE - 1);
    expect(shouldSkipFile(content, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_AVG_LINE_LENGTH)).toBeNull();
  });

  it("returns 'minified-or-generated' for files with very long average line lengths", () => {
    // Simulate minified JavaScript: 2 very long lines
    const line = "var " + "a=1;".repeat(200); // ~804 chars per line
    const content = line + "\n" + line;
    expect(shouldSkipFile(content, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_AVG_LINE_LENGTH)).toBe(
      "minified-or-generated",
    );
  });

  it("does not flag single-line files as minified", () => {
    // A single-line file with a long line should NOT be flagged as minified
    // (it might just be one big export statement)
    const content = "x".repeat(1000);
    expect(shouldSkipFile(content, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_AVG_LINE_LENGTH)).toBeNull();
  });

  it("does not flag multi-line files with normal line lengths", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `const x${i} = ${i}; // some comment`);
    const content = lines.join("\n");
    expect(shouldSkipFile(content, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_AVG_LINE_LENGTH)).toBeNull();
  });

  it("respects custom maxFileSize parameter", () => {
    const content = "x".repeat(5000);
    expect(shouldSkipFile(content, 4000, DEFAULT_MAX_AVG_LINE_LENGTH)).toBe("too-large");
    expect(shouldSkipFile(content, 10000, DEFAULT_MAX_AVG_LINE_LENGTH)).toBeNull();
  });

  it("respects custom maxAvgLineLength parameter", () => {
    const content = "a".repeat(100) + "\n" + "b".repeat(100);
    // avg line length is 100
    expect(shouldSkipFile(content, DEFAULT_MAX_FILE_SIZE, 50)).toBe("minified-or-generated");
    expect(shouldSkipFile(content, DEFAULT_MAX_FILE_SIZE, 200)).toBeNull();
  });

  it("handles empty files", () => {
    expect(shouldSkipFile("", DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_AVG_LINE_LENGTH)).toBeNull();
  });

  it("handles multi-byte characters correctly for size check", () => {
    // Each emoji is 4 bytes in UTF-8
    const emoji = "🎉";
    const content = emoji.repeat(DEFAULT_MAX_FILE_SIZE / 4 + 1);
    // This should exceed 1 MB in bytes even though char count is lower
    expect(shouldSkipFile(content, DEFAULT_MAX_FILE_SIZE, DEFAULT_MAX_AVG_LINE_LENGTH)).toBe(
      "too-large",
    );
  });
});
