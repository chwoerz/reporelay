/**
 * Git credential resolution from environment variables.
 *
 * Reads GIT_TOKEN_<HOST> and optional GIT_USER_<HOST> from env to build
 * authenticated HTTPS URLs for git clone/fetch operations.
 *
 * Host normalization: hostname chars `.` and `-` are replaced with `_`,
 * then uppercased.  e.g. `gitlab.my-company.com` → `GITLAB_MY_COMPANY_COM`
 *
 * Known-host username defaults:
 *   github.com     → x-access-token
 *   gitlab.com     → oauth2
 *   bitbucket.org  → x-token-auth
 *   (everything else) → oauth2
 */

const TOKEN_PREFIX = "GIT_TOKEN_";
const USER_PREFIX = "GIT_USER_";

/** Default usernames per well-known git host. */
const KNOWN_HOST_USERS: Record<string, string> = {
  "github.com": "x-access-token",
  "gitlab.com": "oauth2",
  "bitbucket.org": "x-token-auth",
};

const DEFAULT_USER = "oauth2";

export interface GitAuth {
  /** HTTPS URL with credentials embedded (https://user:token@host/path). */
  authenticatedUrl: string;
  /** Original URL without credentials. */
  originalUrl: string;
}

/**
 * Normalize a hostname into an env-var-safe suffix.
 *
 * Replaces `.` and `-` with `_` and uppercases the result.
 *
 * @example normalizeHost("gitlab.my-company.com") // "GITLAB_MY_COMPANY_COM"
 */
export function normalizeHost(host: string): string {
  return host.replace(/[.\-]/g, "_").toUpperCase();
}

/**
 * Resolve git credentials for a remote URL by looking up env vars.
 *
 * Returns `null` when:
 * - The source is a local path (no `://` scheme)
 * - The URL uses a non-HTTPS scheme (e.g. `git@…` / SSH)
 * - No `GIT_TOKEN_<HOST>` env var is set for the URL's hostname
 *
 * @param remoteUrl  The git remote URL or local path.
 * @param env        Environment map (defaults to `process.env`).
 */
export function resolveGitAuth(
  remoteUrl: string,
  env: Record<string, string | undefined> = process.env,
): GitAuth | null {
  // Skip local filesystem paths
  if (!remoteUrl.includes("://")) return null;

  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return null;
  }

  // Only HTTPS URLs get token injection (SSH uses keys, not tokens)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const suffix = normalizeHost(host);

  const token = env[`${TOKEN_PREFIX}${suffix}`];
  if (!token) return null;

  const user = env[`${USER_PREFIX}${suffix}`] ?? KNOWN_HOST_USERS[host] ?? DEFAULT_USER;

  // Build authenticated URL — preserve everything except credentials.
  // The URL .username/.password setters handle percent-encoding internally,
  // so we must NOT pre-encode with encodeURIComponent (that would double-encode).
  const authUrl = new URL(remoteUrl);
  authUrl.username = user;
  authUrl.password = token;

  // Build a clean original URL (strip any pre-existing credentials)
  const cleanUrl = new URL(remoteUrl);
  cleanUrl.username = "";
  cleanUrl.password = "";

  return {
    authenticatedUrl: authUrl.toString(),
    originalUrl: cleanUrl.toString(),
  };
}

/**
 * Check whether a GIT_TOKEN_<HOST> env var exists for the given remote URL.
 *
 * Useful for UI indicators — tells the user whether auth will be used
 * without exposing the actual token.
 */
export function hasTokenConfigured(
  remoteUrl: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveGitAuth(remoteUrl, env) !== null;
}

/**
 * Return the normalized host suffixes that have a GIT_TOKEN_* env var set.
 *
 * Used by the UI to give instant feedback when the user types a remote URL.
 * Only the suffixes are returned — never the actual tokens.
 *
 * @example getConfiguredHosts({ GIT_TOKEN_GITHUB_COM: "tok" })
 *          // ["GITHUB_COM"]
 */
export function getConfiguredHosts(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return Object.keys(env)
    .filter((key) => key.startsWith(TOKEN_PREFIX) && env[key])
    .map((key) => key.slice(TOKEN_PREFIX.length));
}
