/**
 * Maps file extensions to Language and filters files via gitignore rules.
 */
import ignore, { type Ignore } from "ignore";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { Language } from "../core/types.js";

const EXT_MAP: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".md": "markdown",
  ".mdx": "markdown",
};

/**
 * Classify a file path into a Language based on its extension.
 * Returns `null` for unsupported file types.
 */
export function classifyLanguage(filePath: string): Language | null {
  const ext = extname(filePath).toLowerCase();
  return EXT_MAP[ext] ?? null;
}

/** Patterns that are always ignored regardless of .gitignore content. */
const ALWAYS_IGNORED = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "__pycache__",
  ".DS_Store",
  "*.lock",
];

/**
 * Build an `ignore` instance by reading .gitignore files from a repo root.
 * Reads the root .gitignore and optionally nested .gitignore files at given subdirectory paths.
 */
export async function buildIgnoreFilterFromRepo(
  repoRoot: string,
  nestedDirs: string[] = [],
): Promise<Ignore> {
  const ig = ignore().add(ALWAYS_IGNORED);

  // Root .gitignore
  try {
    const content = await readFile(join(repoRoot, ".gitignore"), "utf-8");
    ig.add(content);
  } catch {
    // No root .gitignore — that's fine
  }

  // Nested .gitignore files
  for (const dir of nestedDirs) {
    try {
      const content = await readFile(join(repoRoot, dir, ".gitignore"), "utf-8");
      // Prefix patterns with the subdirectory so they match correctly
      const prefixed = content
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("#"))
        .map((line) => `${dir}/${line}`);
      ig.add(prefixed);
    } catch {
      // No .gitignore in this subdir — skip
    }
  }

  return ig;
}

/**
 * Filter a list of file paths through an ignore filter,
 * returning only the paths that are NOT ignored.
 */
export function filterIgnored(paths: string[], ig: Ignore): string[] {
  return ig.filter(paths);
}
