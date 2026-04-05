/**
 * Application configuration loaded from environment variables.
 * Validated via Zod schema on startup.
 */
import { z } from "zod/v4";
import { EmbeddingProviders, Languages, McpTransports } from "./types.js";

// ── Schema ──

export const configSchema = z.object({
  // Database
  DATABASE_URL: z.string().default("postgresql://reporelay:reporelay@localhost:5432/reporelay"),

  // Embedding
  EMBEDDING_PROVIDER: z.enum(EmbeddingProviders).default("ollama"),
  EMBEDDING_URL: z.url().default("http://localhost:11434"),
  EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().default(64),

  // MCP
  MCP_TRANSPORT: z.enum(McpTransports).default("stdio"),
  MCP_SERVER_PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Comma-separated list of languages to include in MCP search results.
   * When set, only files/chunks in these languages are returned.
   * When empty/unset, all languages are included.
   * Example: "java,kotlin" or "typescript,javascript"
   */
  MCP_LANGUAGES: z.string().optional(),

  // Web
  WEB_PORT: z.coerce.number().int().positive().default(3001),

  // Git
  GIT_MIRRORS_DIR: z.string().default(".reporelay/mirrors"),
  GIT_WORKTREES_DIR: z.string().default(".reporelay/worktrees"),

  // Logging
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Parse the MCP_LANGUAGES config string into an array of validated language names.
 * Returns undefined when no valid languages are configured (meaning: all languages).
 */
export function parseLanguageFilter(raw?: string): string[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  const langs = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const valid = langs.filter((l) => (Languages as readonly string[]).includes(l));
  return valid.length > 0 ? valid : undefined;
}

// ── Loader ──

/**
 * Load and validate configuration from environment variables.
 * Call `dotenv.config()` before this if you want `.env` support.
 *
 * @param env - defaults to `process.env`
 * @throws {z.ZodError} if validation fails
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return configSchema.parse(env);
}
