/**
 * Git operations: mirror clone/fetch, worktree checkout, and diff.
 */
import { simpleGit, type SimpleGitOptions } from "simple-git";
import { access, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { minimatch } from "minimatch";
import { resolveGitAuth } from "./git-credentials.js";


/**
 * Create a `simpleGit` instance that ignores system credential helpers
 * (macOS Keychain, Windows Credential Manager, etc.) so only the tokens
 * we embed in the URL via GIT_TOKEN_<HOST> are used.
 */
function isolatedGit(baseDir?: string): ReturnType<typeof simpleGit> {
  const opts: Partial<SimpleGitOptions> = {
    config: ["credential.helper="],
  };
  if (baseDir) opts.baseDir = baseDir;
  return simpleGit(opts).env({ GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" });
}


/**
 * Run a git operation with the authenticated remote URL temporarily set.
 *
 * Partial clones (--filter=blob:none) lazily fetch blobs from the
 * "promisor remote" when worktree checkout, git-show, or ls-tree needs
 * actual file content.  The mirror's stored remote URL has credentials
 * stripped, so these lazy fetches fail with "terminal prompts disabled".
 *
 * This helper temporarily swaps in the authenticated URL (exactly like
 * `fetchExistingMirror` does), runs the operation, then restores the
 * clean URL.  For local repos (no auth) or already-available objects
 * the callback just runs directly.
 */
async function withAuth<T>(
  mirrorPath: string,
  remoteUrl: string | undefined,
  fn: (git: ReturnType<typeof simpleGit>) => Promise<T>,
): Promise<T> {
  const git = isolatedGit(mirrorPath);
  const auth = remoteUrl ? resolveGitAuth(remoteUrl) : null;

  if (!auth) return fn(git);

  await git.raw(["remote", "set-url", "origin", auth.authenticatedUrl]);
  try {
    return await fn(git);
  } finally {
    await git.raw(["remote", "set-url", "origin", auth.originalUrl]);
  }
}


/**
 * Translate cryptic git remote errors into human-readable messages.
 *
 * GitHub (and other hosts) return misleading error text — e.g. "Write
 * access to repository not granted" for a read-only token that simply
 * lacks access to the repo.  This helper intercepts those messages and
 * returns an actionable description.
 */
export function friendlyRemoteError(err: unknown, remoteUrl: string, hasAuth: boolean): string {
  const msg = err instanceof Error ? err.message : String(err);

  // GitHub fine-grained PAT without repo access → 403 "Write access …"
  if (
    msg.includes("Write access to repository not granted") ||
    msg.includes("The requested URL returned error: 403")
  ) {
    const hint = hasAuth
      ? "The configured GIT_TOKEN does not have access to this repository. " +
        "For fine-grained GitHub tokens, ensure the token is scoped to this " +
        'repository with at least the "Contents: Read" permission.'
      : "No GIT_TOKEN configured for this host and the repository returned 403. " +
        "Set GIT_TOKEN_<HOST> in your environment (see .env.example).";
    return `Authentication failed for ${remoteUrl}: ${hint}`;
  }

  // Generic auth failure (no credential, prompt disabled)
  if (msg.includes("terminal prompts disabled") || msg.includes("could not read Username")) {
    return (
      `Authentication required for ${remoteUrl}: ` +
      "No GIT_TOKEN configured for this host. " +
      "Set GIT_TOKEN_<HOST> in your environment (see .env.example)."
    );
  }

  // Repository genuinely not found (404 / does not exist)
  if (
    msg.includes("not found") ||
    msg.includes("does not exist") ||
    msg.includes("Repository not found")
  ) {
    return (
      `Repository not found: ${remoteUrl}. ` +
      "Check that the URL is correct and that your token has access to this repository."
    );
  }

  return `Mirror sync failed for ${remoteUrl}: ${msg}`;
}

/** Fetch updates into an existing bare mirror, using auth URL temporarily if needed. */
async function fetchExistingMirror(
  mirrorPath: string,
  auth: ReturnType<typeof resolveGitAuth>,
): Promise<void> {
  await withAuth(mirrorPath, auth?.originalUrl, (git) => git.fetch(["--prune"]));
}

/**
 * Clone a repo as a bare repo, configure refs, and strip credentials.
 *
 * We use --bare instead of --mirror because --mirror sets
 * remote.origin.mirror=true (push-mirror config), which causes GitHub
 * to demand write access even for a read-only clone.  After cloning,
 * we set the fetch refspec to +refs/*:refs/* so that all branches,
 * tags, and other refs are fetched — same read behaviour as --mirror,
 * without the push intent.
 *
 * For remote URLs we add --filter=blob:none (blobless / partial clone)
 * so the initial clone only fetches commits and trees — file blobs are
 * downloaded on demand when worktree checkout, git-show, or diff needs
 * them. This dramatically reduces clone time and disk usage for large
 * repositories (e.g. typescript-go drops from ~400 MB to ~50 MB).
 * Local paths always have all objects available, so the filter is skipped.
 */
async function cloneNewMirror(
  sourcePathOrUrl: string,
  mirrorsDir: string,
  mirrorPath: string,
  auth: ReturnType<typeof resolveGitAuth>,
): Promise<void> {
  await mkdir(mirrorsDir, { recursive: true });
  const git = isolatedGit();
  const cloneUrl = auth?.authenticatedUrl ?? sourcePathOrUrl;
  const isRemote = /^https?:\/\//.test(sourcePathOrUrl) || sourcePathOrUrl.includes("@");
  const cloneOpts = isRemote ? ["--bare", "--filter=blob:none"] : ["--bare"];
  await git.clone(cloneUrl, mirrorPath, cloneOpts);

  const mirrorGit = isolatedGit(mirrorPath);
  await mirrorGit.raw(["config", "remote.origin.fetch", "+refs/*:refs/*"]);

  // Strip credentials from the stored remote URL so they don't sit on disk
  if (auth) {
    await mirrorGit.raw(["remote", "set-url", "origin", auth.originalUrl]);
  }
}

/**
 * Clone a repo as a bare mirror, or fetch if the mirror already exists.
 *
 * For HTTPS remote URLs, credentials are resolved from environment
 * variables (GIT_TOKEN_<HOST> / GIT_USER_<HOST>).  The authenticated
 * URL is used only for the duration of the git operation — it is never
 * persisted in the mirror's config.
 *
 * Returns the path to the bare mirror directory.
 */
export async function syncMirror(
  sourcePathOrUrl: string,
  mirrorsDir: string,
  repoName: string,
): Promise<string> {
  const mirrorPath = join(mirrorsDir, `${repoName}.git`);
  const auth = resolveGitAuth(sourcePathOrUrl);

  try {
    if (await exists(mirrorPath)) {
      await fetchExistingMirror(mirrorPath, auth);
    } else {
      await cloneNewMirror(sourcePathOrUrl, mirrorsDir, mirrorPath, auth);
    }
  } catch (err) {
    throw new Error(friendlyRemoteError(err, auth?.originalUrl ?? sourcePathOrUrl, auth !== null));
  }

  return mirrorPath;
}

/**
 * Resolve the commit SHA for a given ref (branch, tag, or HEAD) in a mirror.
 */
export async function resolveCommitSha(mirrorPath: string, ref: string): Promise<string> {
  const git = isolatedGit(mirrorPath);
  const result = await git.revparse([ref]);
  return result.trim();
}


/**
 * Check out a worktree at a specific commit SHA.
 *
 * For partial clones, the worktree add may trigger lazy blob fetches
 * from the promisor remote — `remoteUrl` is used to resolve credentials
 * for the duration of the operation.
 *
 * Returns the worktree path. Caller must call `cleanupWorktree()` when done.
 */
export async function checkoutWorktree(
  mirrorPath: string,
  worktreesDir: string,
  commitSha: string,
  remoteUrl?: string,
): Promise<string> {
  const absWorktreesDir = resolve(worktreesDir);
  await mkdir(absWorktreesDir, { recursive: true });
  const worktreePath = join(absWorktreesDir, `wt-${randomUUID()}`);
  await withAuth(mirrorPath, remoteUrl, (git) =>
    git.raw(["worktree", "add", "--detach", worktreePath, commitSha]),
  );
  return worktreePath;
}

/**
 * Remove a worktree directory and prune it from the mirror.
 */
export async function cleanupWorktree(mirrorPath: string, worktreePath: string): Promise<void> {
  await rm(worktreePath, { recursive: true, force: true });
  const git = isolatedGit(mirrorPath);
  await git.raw(["worktree", "prune"]);
}


export function isFileIncluded(path: string, globPatterns: string[]) {
  return globPatterns.every((p) => minimatch(path, p));
}

/**
 * List all files at a given commit, optionally filtered by glob patterns.
 *
 * Always returns the complete file set via `git ls-tree`.
 * Callers rely on SHA-256 dedup in the pipeline to skip re-parsing
 * unchanged files, so a full listing is cheap in practice.
 */
export async function listFiles(
  mirrorPath: string,
  commitSha: string,
  globPatterns: string[],
): Promise<string[]> {
  const git = isolatedGit(mirrorPath);
  const raw = await git.raw(["ls-tree", "-r", "--name-only", commitSha]);
  return raw
    .trim()
    .split("\n")
    .filter((f) => f.length > 0 && isFileIncluded(f, globPatterns));
}


export interface GitRefs {
  branches: string[];
  tags: string[];
}

/**
 * List all branches and tags in a bare mirror.
 * Returns short names (e.g. "main", "v1.0.0") sorted alphabetically.
 * Returns empty lists if the mirror doesn't exist.
 */
export async function listGitRefs(mirrorPath: string): Promise<GitRefs> {
  if (!(await exists(mirrorPath))) return { branches: [], tags: [] };

  const git = isolatedGit(mirrorPath);

  const raw = await git.raw(["for-each-ref", "--format=%(refname)", "refs/heads/", "refs/tags/"]);

  const lines = raw
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);

  const branches = lines
    .filter((l) => l.startsWith("refs/heads/"))
    .map((l) => l.slice("refs/heads/".length))
    .sort((a, b) => a.localeCompare(b));

  const tags = lines
    .filter((l) => l.startsWith("refs/tags/"))
    .map((l) => l.slice("refs/tags/".length))
    .sort((a, b) => a.localeCompare(b));

  return { branches, tags };
}


/**
 * Read raw file content from a bare mirror at a specific commit.
 *
 * Uses `git show <commitSha>:<path>`. For partial clones this may
 * trigger a lazy blob fetch — `remoteUrl` is used to resolve credentials.
 *
 * Returns `null` if the mirror directory doesn't exist, the commit is
 * unknown, or the path doesn't exist at that commit — callers should
 * fall back to chunk-based content.
 */
export async function readFileFromMirror(
  mirrorPath: string,
  commitSha: string,
  filePath: string,
  remoteUrl?: string,
): Promise<string | null> {
  if (!(await exists(mirrorPath))) return null;

  try {
    return await withAuth(mirrorPath, remoteUrl, (git) => git.show([`${commitSha}:${filePath}`]));
  } catch {
    return null;
  }
}


async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
