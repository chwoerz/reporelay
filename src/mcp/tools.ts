/**
 * MCP tool registrations.
 *
 * Each tool: Zod input schema → handler that delegates to the shared
 * service layer in src/services/.
 */
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpDeps } from "./server.js";
import { ContextStrategies } from "../core/types.js";
import {
  resolveRepoAndRef,
  findRepo,
  getFileContent,
  getSymbol,
  findByPattern,
  findReferences,
  buildContext,
  searchCode,
  listReposWithRefs,
} from "../services/index.js";

// ── Types ──

interface ToolResult {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

// ── Helpers ──

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Resolve repo + ref or return an error ToolResult.
 * Eliminates the repeated resolve-then-check pattern across tools.
 */
async function resolveOrError(
  deps: McpDeps,
  repoName: string,
  refParam?: string,
): Promise<
  | { ok: true; resolved: Exclude<Awaited<ReturnType<typeof resolveRepoAndRef>>, string> }
  | ToolResult
> {
  const resolved = await resolveRepoAndRef(deps.db, repoName, refParam);
  if (typeof resolved === "string") return errorResult(resolved);
  return { ok: true, resolved };
}

function isToolResult(value: unknown): value is ToolResult {
  return typeof value === "object" && value !== null && "content" in value;
}

// ── Registration ──

export function registerTools(server: McpServer, deps: McpDeps): void {
  // ── search_code ──
  server.registerTool(
    "search_code",
    {
      title: "Search Code",
      description: "Hybrid lexical + vector search across indexed repos.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search query"),
        repo: z.string().optional().describe("Filter by repository name"),
        ref: z.string().optional().describe("Filter by ref/tag (supports semver constraints)"),
        limit: z.number().int().positive().max(100).optional().describe("Max results (default 20)"),
      }),
    },
    async ({ query, repo, ref, limit }) => {
      const results = await searchCode(deps.db, deps.embedder, {
        query,
        repo,
        ref,
        limit: limit ?? 20,
        languages: deps.languages,
      });

      if (results.length === 0) return textResult("No results found.");

      const lines = results.map(
        (r) =>
          `--- ${r.repo}@${r.ref} ${r.filePath} L${r.startLine}-${r.endLine} (score: ${r.score.toFixed(3)}) ---\n${r.content}`,
      );
      return textResult(lines.join("\n\n"));
    },
  );

  // ── get_file ──
  server.registerTool(
    "get_file",
    {
      title: "Get File",
      description:
        "Retrieve file content by repo/path. Tries raw file from git mirror first, falls back to indexed chunks. Optional includeSymbols lists symbols.",
      inputSchema: z.object({
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path within the repo"),
        ref: z.string().optional().describe("Ref/tag (supports semver constraints)"),
        includeSymbols: z.boolean().optional().describe("Include symbol list with signatures"),
      }),
    },
    async ({ repo: repoName, path: filePath, ref: refParam, includeSymbols }) => {
      const resolveResult = await resolveOrError(deps, repoName, refParam);
      if (isToolResult(resolveResult)) return resolveResult;
      const { resolved } = resolveResult;

      const result = await getFileContent(deps.db, resolved, filePath, {
        mirrorsDir: deps.config.GIT_MIRRORS_DIR,
        includeSymbols,
      });
      if (typeof result === "string") return errorResult(result);

      const parts: string[] = [
        `--- ${result.repo}@${result.ref} ${result.path} ---`,
        result.content,
      ];

      if (result.symbols && result.symbols.length > 0) {
        parts.push("\n--- Symbols ---");
        for (const sym of result.symbols) {
          parts.push(
            `${sym.kind} ${sym.name} (L${sym.startLine}-${sym.endLine}): ${sym.signature}`,
          );
        }
      }

      return textResult(parts.join("\n"));
    },
  );

  // ── get_symbol ──
  server.registerTool(
    "get_symbol",
    {
      title: "Get Symbol",
      description: "Fetch a specific symbol (function, class, etc.) by name.",
      inputSchema: z.object({
        repo: z.string().describe("Repository name"),
        symbolName: z.string().describe("Symbol name"),
        ref: z.string().optional().describe("Ref/tag (supports semver constraints)"),
        includeImports: z.boolean().optional().describe("Show files that import this symbol"),
      }),
    },
    async ({ repo: repoName, symbolName, ref: refParam, includeImports }) => {
      const resolveResult = await resolveOrError(deps, repoName, refParam);
      if (isToolResult(resolveResult)) return resolveResult;
      const { resolved } = resolveResult;

      const result = await getSymbol(deps.db, resolved, symbolName, {
        includeImports,
        languages: deps.languages,
      });
      if (typeof result === "string") return errorResult(result);

      const parts: string[] = [];
      for (const sym of result.symbols) {
        parts.push(
          `--- ${sym.filePath} L${sym.startLine}-${sym.endLine} ---`,
          `${sym.kind}: ${sym.signature}`,
        );
        if (sym.documentation) parts.push(`/** ${sym.documentation} */`);
        if (sym.source) parts.push(sym.source);
      }

      if (result.imports && result.imports.length > 0) {
        parts.push("\n--- Imported by ---");
        for (const r of result.imports) {
          const label = r.isDefault ? "(default)" : "(named)";
          parts.push(`${r.filePath} from "${r.source}" ${label}`);
        }
      }

      return textResult(parts.join("\n"));
    },
  );

  // ── find ──
  server.registerTool(
    "find",
    {
      title: "Find",
      description: "Search for files or symbols by name/path pattern.",
      inputSchema: z.object({
        pattern: z.string().describe("Search pattern (glob-style wildcards)"),
        kind: z.enum(["file", "symbol"]).describe("What to search for"),
        repo: z.string().describe("Repository name"),
        ref: z.string().optional().describe("Ref/tag (supports semver constraints)"),
      }),
    },
    async ({ pattern, kind, repo: repoName, ref: refParam }) => {
      const resolveResult = await resolveOrError(deps, repoName, refParam);
      if (isToolResult(resolveResult)) return resolveResult;
      const { resolved } = resolveResult;

      const result = await findByPattern(deps.db, resolved.ref.id, kind, pattern, deps.languages);

      if (result.kind === "file") {
        if (result.files.length === 0) return textResult("No files matching pattern.");
        return textResult(result.files.map((f) => f.path).join("\n"));
      }

      if (result.symbols.length === 0) return textResult("No symbols matching pattern.");
      const lines = result.symbols.map(
        (s) => `${s.kind} ${s.name} — ${s.filePath} L${s.startLine}-${s.endLine}`,
      );
      return textResult(lines.join("\n"));
    },
  );

  // ── find_references ──
  server.registerTool(
    "find_references",
    {
      title: "Find References",
      description: "Find files that import a given symbol name.",
      inputSchema: z.object({
        repo: z.string().describe("Repository name"),
        symbolName: z.string().describe("Symbol name to search for"),
        ref: z.string().optional().describe("Ref/tag (supports semver constraints)"),
      }),
    },
    async ({ repo: repoName, symbolName, ref: refParam }) => {
      const resolveResult = await resolveOrError(deps, repoName, refParam);
      if (isToolResult(resolveResult)) return resolveResult;
      const { resolved } = resolveResult;

      const refs = await findReferences(deps.db, resolved.ref.id, symbolName);

      if (refs.length === 0) return textResult(`No references to "${symbolName}" found.`);

      const lines = refs.map((r) => {
        const label = r.isDefault ? "(default import)" : "(named import)";
        return `${r.filePath} — from "${r.source}" ${label}`;
      });
      return textResult(lines.join("\n"));
    },
  );

  // ── build_context_pack ──
  server.registerTool(
    "build_context_pack",
    {
      title: "Build Context Pack",
      description: "Build task-specific context for explain / implement / debug / recent-changes.",
      inputSchema: z.object({
        repo: z.string().describe("Repository name"),
        task: z.enum(ContextStrategies).describe("Context strategy"),
        ref: z.string().optional().describe("Ref/tag (supports semver constraints)"),
        fromRef: z.string().optional().describe("Base ref for recent-changes (previous version)"),
        query: z.string().optional().describe("Guiding query for context gathering"),
        paths: z.array(z.string()).optional().describe("Specific file paths to focus on"),
        maxTokens: z.number().int().positive().optional().describe("Token budget (default 8192)"),
      }),
    },
    async ({ repo: repoName, task, ref: refParam, fromRef, query, paths, maxTokens }) => {
      const repo = await findRepo(deps.db, repoName);
      if (!repo) return errorResult(`Repository "${repoName}" not found.`);

      const { pack, formatted } = await buildContext(deps.db, deps.embedder, {
        repo: repoName,
        repoId: repo.id,
        strategy: task,
        ref: refParam,
        fromRef,
        query,
        paths,
        maxTokens,
      });

      if (pack.chunks.length === 0) return textResult("No context found for the given parameters.");
      return textResult(
        `[${pack.strategy}] ${pack.repo}@${pack.ref ?? "latest"} (${pack.totalTokens} tokens)\n\n${formatted}`,
      );
    },
  );

  // ── list_repos ──
  server.registerTool(
    "list_repos",
    {
      title: "List Repos",
      description: "List all registered repositories with their indexing status and indexed refs.",
      inputSchema: z.object({}),
    },
    async () => {
      const entries = await listReposWithRefs(deps.db);

      if (entries.length === 0) return textResult("No repositories registered.");

      const lines: string[] = [];

      for (const { repo, refs } of entries) {
        const refStrs = refs
          .map((r) => {
            let label = `${r.ref} (${r.stage})`;
            if (r.languageStats && Object.keys(r.languageStats).length > 0) {
              const langParts = Object.entries(r.languageStats as Record<string, number>)
                .sort(([, a], [, b]) => b - a)
                .map(([lang, pct]) => `${lang}: ${pct}%`);
              label += ` [${langParts.join(", ")}]`;
            }
            return label;
          })
          .join(", ");
        lines.push(`${repo.name} — refs: ${refStrs || "(none)"}`);
      }

      return textResult(lines.join("\n"));
    },
  );
}
