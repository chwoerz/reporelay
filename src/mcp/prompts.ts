/**
 * MCP prompt registrations.
 *
 * Three prompts that wrap the shared service layer's `buildContext`
 * to provide structured LLM messages. Uses a data-driven approach
 * to eliminate per-prompt boilerplate.
 */
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpDeps } from "./server.js";
import { findRepo, buildContext } from "../services/index.js";

// ── Types ──

/** Descriptor for a context-backed prompt. */
interface PromptDef {
  name: string;
  title: string;
  description: string;
  /** Whether `query` is required (true) or optional (false). */
  queryRequired: boolean;
  /** Build the user-facing message text from args and context. */
  buildMessage: (args: { repoName: string; query?: string; context: string }) => string;
}

// ── Prompt definitions ──

const PROMPT_DEFS: PromptDef[] = [
  {
    name: "explain-library",
    title: "Explain Library",
    description: "Understand how a library or module works.",
    queryRequired: false,
    buildMessage: ({ repoName, query, context }) =>
      [
        `Explain the architecture and key concepts of ${query ?? repoName}.`,
        `Use the following indexed code context:`,
        "",
        context,
      ].join("\n"),
  },
  {
    name: "implement-feature",
    title: "Implement Feature",
    description: "Get guidance for building with existing patterns.",
    queryRequired: true,
    buildMessage: ({ query, context }) =>
      [
        `I want to implement: ${query}`,
        `Follow the existing patterns in the codebase. Here is the relevant context:`,
        "",
        context,
      ].join("\n"),
  },
  {
    name: "debug-issue",
    title: "Debug Issue",
    description: "Debug an error with relevant code context.",
    queryRequired: true,
    buildMessage: ({ query, context }) =>
      [
        `I'm debugging this issue: ${query}`,
        `Here is the relevant code context:`,
        "",
        context,
      ].join("\n"),
  },
];

// ── Helpers ──

function notFoundPrompt(repoName: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text: `Repository "${repoName}" not found.` },
      },
    ],
  };
}

function userMessage(text: string) {
  return {
    messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
  };
}

// ── Registration ──

export function registerPrompts(server: McpServer, deps: McpDeps): void {
  for (const def of PROMPT_DEFS) {
    const strategy = def.name.split("-")[0]! as "explain" | "implement" | "debug";
    const querySchema = def.queryRequired
      ? z.string().describe("Query / description")
      : z.string().optional().describe("Module or topic to focus on");

    server.registerPrompt(
      def.name,
      {
        title: def.title,
        description: def.description,
        argsSchema: {
          repo: z.string().describe("Repository name"),
          query: querySchema,
          ref: z.string().optional().describe("Ref/tag (supports semver constraints)"),
        },
      },
      async ({ repo: repoName, query, ref }) => {
        const repo = await findRepo(deps.db, repoName);
        if (!repo) return notFoundPrompt(repoName);

        const { formatted } = await buildContext(deps.db, deps.embedder, {
          repo: repoName,
          repoId: repo.id,
          strategy,
          ref,
          query,
        });

        const text = def.buildMessage({
          repoName,
          query,
          context: formatted || "(no context available)",
        });
        return userMessage(text);
      },
    );
  }
}
