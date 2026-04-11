/**
 * Application configuration loaded from environment variables.
 * Validated via Zod schema on startup.
 */
import { z } from "zod/v4";
import { Languages } from "./types.js";

// ── Schema ──

export const EmbeddingProviders = ["ollama", "openai"] as const;
export type EmbeddingProvider = (typeof EmbeddingProviders)[number];

/**
 * Treat empty strings as undefined.
 *
 * Docker Compose passes `VAR=` (empty string) for `${VAR:-}` when the
 * variable is not set in `.env`.  Zod's `.optional()` only treats
 * `undefined` as "not present", so an empty string would fail URL or
 * number validation.  This transform normalises the empty case.
 */
const emptyToUndefined = (val: unknown) =>
  typeof val === "string" && val.trim() === "" ? undefined : val;

/** Optional URL that accepts empty strings from Docker Compose. */
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

/** Optional positive integer that accepts empty strings from Docker Compose. */
const optionalPositiveInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);

/** Optional string that accepts empty strings from Docker Compose. */
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

export const configSchema = z
  .object({
    // Database
    DATABASE_URL: z.string().default("postgresql://reporelay:reporelay@localhost:5432/reporelay"),

    // Embedding
    EMBEDDING_PROVIDER: z.enum(EmbeddingProviders).default("ollama"),
    /**
     * Base URL for the embedding API.
     * When unset, a provider-specific default is used:
     * - ollama → http://localhost:11434
     * - openai → https://api.openai.com/v1
     *
     * Set this explicitly when using a custom OpenAI-compatible provider
     * (Azure, Together, Mistral, etc.).
     */
    EMBEDDING_URL: optionalUrl,
    EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
    EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().default(64),
    /**
     * Number of dimensions to request from the embedding API.
     * Only supported by some providers (e.g. OpenAI text-embedding-3).
     * Must produce vectors matching DB_EMBEDDING_DIMENSIONS (768) or
     * init() will report a mismatch.
     * When unset, the model's native dimension is used.
     */
    EMBEDDING_DIMENSIONS: optionalPositiveInt,

    // OpenAI-compatible embedding provider
    /** API key for OpenAI-compatible embedding providers. Required when EMBEDDING_PROVIDER=openai. */
    OPENAI_API_KEY: optionalString,

    // CORS
    /**
     * Comma-separated list of allowed CORS origins.
     * When unset, only same-origin requests are allowed (CORS disabled).
     * Use "*" to allow all origins (development only — NOT recommended for production).
     * Example: "http://localhost:4200,https://my-app.example.com"
     */
    CORS_ORIGIN: optionalString,

    // MCP
    MCP_SERVER_PORT: z.coerce.number().int().positive().default(3000),
    /**
     * Comma-separated list of languages to include in MCP search results.
     * When set, only files/chunks in these languages are returned.
     * When empty/unset, languages are auto-detected from the current working
     * directory's manifest files (e.g. package.json → typescript, Cargo.toml → rust).
     * If auto-detection finds nothing, all languages are included.
     * Example: "java,kotlin" or "typescript,javascript"
     */
    MCP_LANGUAGES: optionalString,
    /**
     * Minimum language_stats percentage (0–100) for a repo ref to be
     * considered a match when filtering by language.
     * A ref is included if at least one of its detected languages meets this threshold.
     * Set to 0 to disable language-based repo filtering entirely
     * (all repos are served regardless of detected languages).
     * Default: 10 (i.e. the language must represent ≥10% of the ref's files).
     */
    MCP_LANGUAGE_THRESHOLD: z.coerce.number().min(0).max(100).default(10),

    // Web
    WEB_PORT: z.coerce.number().int().positive().default(3001),

    // Git
    GIT_MIRRORS_DIR: z.string().default(".reporelay/mirrors"),
    GIT_WORKTREES_DIR: z.string().default(".reporelay/worktrees"),

    // Logging
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  })
  .refine((c) => c.EMBEDDING_PROVIDER !== "openai" || !!c.OPENAI_API_KEY, {
    message: "OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai",
    path: ["OPENAI_API_KEY"],
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
