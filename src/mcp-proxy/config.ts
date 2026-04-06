/**
 * Proxy-specific configuration.
 *
 * A minimal schema for the local MCP proxy — only the settings it actually
 * needs.  The upstream RepoRelay server has its own, much larger config.
 *
 * Resolution order for the upstream URL:
 *   1. `--server <url>` CLI argument
 *   2. `REPORELAY_URL` environment variable
 */
import { z } from "zod/v4";
import { Languages } from "./languages.js";

// ── Schema ──

export const proxyConfigSchema = z.object({
  /** URL of the remote RepoRelay MCP endpoint (e.g. http://localhost:3000/mcp). */
  REPORELAY_URL: z.url().optional(),

  /**
   * Comma-separated language filter override.
   * When set, auto-detection from the working directory is skipped.
   */
  MCP_LANGUAGES: z.string().optional(),

  /**
   * Minimum language_stats percentage for a repo ref to qualify.
   * 0 disables language-based repo filtering entirely (auto-detect is skipped).
   */
  MCP_LANGUAGE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(10),

  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

export type ProxyConfig = z.infer<typeof proxyConfigSchema>;

// ── Loader ──

/**
 * Parse proxy configuration from environment + optional CLI overrides.
 *
 * @param env     defaults to `process.env`
 * @param cliUrl  value of `--server <url>` if provided
 */
export function loadProxyConfig(
  env: Record<string, string | undefined> = process.env,
  cliUrl?: string,
): ProxyConfig {
  const config = proxyConfigSchema.parse(env);
  if (cliUrl) config.REPORELAY_URL = cliUrl;
  return config;
}

// ── Language parsing (reuse from core) ──

/**
 * Parse a comma-separated language string into a validated array.
 * Returns `undefined` when no valid languages are present.
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
