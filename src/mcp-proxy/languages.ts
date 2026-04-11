/**
 * Language constants and project language detection.
 *
 * Inlined from `src/core/types.ts` and `src/git/language-detector.ts` so the
 * mcp-proxy can be published as a standalone npm package with zero cross-module
 * imports.  Keep in sync with the canonical definitions when adding languages.
 */
import { access } from "node:fs/promises";
import { join } from "node:path";


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
 * Each entry maps a well-known project file to the language(s) it implies.
 * Order doesn't matter — all matching manifests contribute to the result.
 */
const MANIFEST_MAP: { file: string; languages: Language[] }[] = [
  // TypeScript / JavaScript
  { file: "tsconfig.json", languages: ["typescript", "javascript"] },
  { file: "package.json", languages: ["typescript", "javascript"] },
  { file: "deno.json", languages: ["typescript", "javascript"] },
  { file: "deno.jsonc", languages: ["typescript", "javascript"] },
  { file: "bun.lockb", languages: ["typescript", "javascript"] },

  // Python
  { file: "pyproject.toml", languages: ["python"] },
  { file: "setup.py", languages: ["python"] },
  { file: "setup.cfg", languages: ["python"] },
  { file: "requirements.txt", languages: ["python"] },
  { file: "Pipfile", languages: ["python"] },

  // Go
  { file: "go.mod", languages: ["go"] },

  // Java / Kotlin
  { file: "pom.xml", languages: ["java", "kotlin"] },
  { file: "build.gradle", languages: ["java", "kotlin"] },
  { file: "build.gradle.kts", languages: ["java", "kotlin"] },
  { file: "settings.gradle", languages: ["java", "kotlin"] },
  { file: "settings.gradle.kts", languages: ["java", "kotlin"] },

  // Rust
  { file: "Cargo.toml", languages: ["rust"] },

  // C / C++
  { file: "CMakeLists.txt", languages: ["c", "cpp"] },
  { file: "Makefile", languages: ["c", "cpp"] },
  { file: "meson.build", languages: ["c", "cpp"] },
];


/**
 * Check whether a file exists at the given path.
 * Returns `true` if accessible, `false` otherwise.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect programming languages used in a directory by scanning for
 * well-known manifest and config files.
 *
 * Returns a deduplicated, sorted array of `Language` values.
 * Returns an empty array if no recognized manifests are found.
 *
 * @param dir - Absolute path to the directory to scan (typically `process.cwd()`)
 */
export async function detectLanguagesFromDir(dir: string): Promise<Language[]> {
  const checks = await Promise.all(
    MANIFEST_MAP.map(async ({ file, languages }) => ({
      languages,
      exists: await fileExists(join(dir, file)),
    })),
  );

  const detected = new Set<Language>();
  checks
    .filter((c) => c.exists)
    .flatMap((c) => c.languages)
    .forEach((lang) => detected.add(lang));

  return [...detected].sort();
}
