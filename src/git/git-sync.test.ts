import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";
import { createTestRepo, addCommitToTestRepo, type TestRepo } from "../../test/setup/test-repo.js";
import {
  syncMirror,
  resolveCommitSha,
  checkoutWorktree,
  cleanupWorktree,
  listFiles,
  readFileFromMirror,
  friendlyRemoteError,
} from "./git-sync.js";

let repo: TestRepo;
let mirrorsDir: string;
let worktreesDir: string;

beforeAll(async () => {
  repo = await createTestRepo({
    "src/index.ts": 'export const hello = "world";',
    "src/utils.ts": "export function add(a: number, b: number) { return a + b; }",
    "src/bundled/nope.ts": "wupdi",
    "README.md": "# Test",
  });
  const tmpBase = await mkdtemp(join(tmpdir(), "reporelay-git-test-"));
  mirrorsDir = join(tmpBase, "mirrors");
  worktreesDir = join(tmpBase, "worktrees");
});

afterAll(async () => {
  await repo?.cleanup();
});

describe("Git Sync", () => {
  let mirrorPath: string;

  describe("mirror clone", () => {
    it("clones a local repo as a bare mirror", async () => {
      mirrorPath = await syncMirror(repo.path, mirrorsDir, repo.name);
      // Mirror dir should exist and be a bare git repo
      await expect(access(mirrorPath)).resolves.toBeUndefined();
      const git = simpleGit(mirrorPath);
      const isBare = await git.raw(["rev-parse", "--is-bare-repository"]);
      expect(isBare.trim()).toBe("true");
    });

    it("does not persist a credential helper in the mirror config", async () => {
      // After cloning, the mirror's git config should have no credential.helper
      // entry — the isolation is applied per-command via -c flags, never written.
      const git = simpleGit(mirrorPath);
      const raw = await git
        .raw(["config", "--local", "--get-all", "credential.helper"])
        .catch(() => "");
      expect(raw.trim()).toBe("");
    });

    it("fetches updates into an existing mirror", async () => {
      // Add a commit to the source repo
      await addCommitToTestRepo(repo.path, {
        "src/new-file.ts": "export const x = 1;",
      });
      // Re-sync — should fetch, not re-clone
      const path2 = await syncMirror(repo.path, mirrorsDir, repo.name);
      expect(path2).toBe(mirrorPath);

      // The new commit should be visible in the mirror
      const git = simpleGit(mirrorPath);
      const log = await git.log();
      expect(log.all.length).toBeGreaterThanOrEqual(2);
    });

    it("resolves HEAD commit SHA after fetch", async () => {
      const sha = await resolveCommitSha(mirrorPath, "HEAD");
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("worktree", () => {
    it("checks out a worktree at a specific commit SHA", async () => {
      const sha = await resolveCommitSha(mirrorPath, "HEAD");
      const wtPath = await checkoutWorktree(mirrorPath, worktreesDir, sha);

      // Worktree should have our files
      const content = await readFile(join(wtPath, "src/index.ts"), "utf-8");
      expect(content).toContain("hello");

      await cleanupWorktree(mirrorPath, wtPath);
    });

    it("cleans up worktree directory after use", async () => {
      const sha = await resolveCommitSha(mirrorPath, "HEAD");
      const wtPath = await checkoutWorktree(mirrorPath, worktreesDir, sha);
      await cleanupWorktree(mirrorPath, wtPath);

      // Worktree dir should be gone
      await expect(access(wtPath)).rejects.toThrow();
    });

    it("throws if commit SHA does not exist", async () => {
      const fakeSha = "0000000000000000000000000000000000000000";
      await expect(checkoutWorktree(mirrorPath, worktreesDir, fakeSha)).rejects.toThrow();
    });
  });

  describe("listFiles", () => {
    it("returns files matching glob patterns", async () => {
      const sha = await resolveCommitSha(mirrorPath, "HEAD");
      const result = await listFiles(mirrorPath, sha, ["src/**/*.ts", "!**/bundled/**"]);
      expect(result).toContain("src/index.ts");
      expect(result).not.toContain("src/bundled/nope.ts");
      expect(result).not.toContain("README.md");
    });

    it("returns all files when no glob patterns are provided", async () => {
      const sha = await resolveCommitSha(mirrorPath, "HEAD");
      const result = await listFiles(mirrorPath, sha, []);
      expect(result).toContain("src/index.ts");
      expect(result).toContain("README.md");
    });
  });

  describe("readFileFromMirror", () => {
    it("reads raw file content from a bare mirror at a given commit", async () => {
      const sha = await resolveCommitSha(mirrorPath, "HEAD");
      const content = await readFileFromMirror(mirrorPath, sha, "src/index.ts");
      expect(content).not.toBeNull();
      expect(content).toContain("hello");
    });

    it("returns null when the file path does not exist at that commit", async () => {
      const sha = await resolveCommitSha(mirrorPath, "HEAD");
      const content = await readFileFromMirror(mirrorPath, sha, "no/such/file.ts");
      expect(content).toBeNull();
    });

    it("returns null when the commit SHA does not exist", async () => {
      const fakeSha = "0000000000000000000000000000000000000000";
      const content = await readFileFromMirror(mirrorPath, fakeSha, "src/index.ts");
      expect(content).toBeNull();
    });

    it("returns null when the mirror path does not exist", async () => {
      const content = await readFileFromMirror(
        "/tmp/nonexistent-mirror-path",
        "abc123",
        "src/index.ts",
      );
      expect(content).toBeNull();
    });

    it("reads content from a specific older commit (not HEAD)", async () => {
      const git = simpleGit(mirrorPath);
      const log = await git.log();
      // The initial commit should have README.md
      const initialSha = log.all[log.all.length - 1].hash;
      const content = await readFileFromMirror(mirrorPath, initialSha, "README.md");
      expect(content).not.toBeNull();
      expect(content).toContain("# Test");
    });
  });

  describe("friendlyRemoteError", () => {
    const url = "https://github.com/org/repo.git";

    it("translates 403 / write-access error with auth configured", () => {
      const err = new Error("remote: Write access to repository not granted.");
      const msg = friendlyRemoteError(err, url, true);
      expect(msg).toContain("Authentication failed");
      expect(msg).toContain("GIT_TOKEN does not have access");
      expect(msg).toContain("Contents: Read");
      expect(msg).not.toContain("Write access to repository not granted");
    });

    it("translates 403 error without auth configured", () => {
      const err = new Error("The requested URL returned error: 403");
      const msg = friendlyRemoteError(err, url, false);
      expect(msg).toContain("Authentication failed");
      expect(msg).toContain("No GIT_TOKEN configured");
      expect(msg).toContain("GIT_TOKEN_<HOST>");
    });

    it("translates terminal-prompt-disabled error", () => {
      const err = new Error(
        "could not read Username for 'https://github.com': terminal prompts disabled",
      );
      const msg = friendlyRemoteError(err, url, false);
      expect(msg).toContain("Authentication required");
      expect(msg).toContain("GIT_TOKEN");
    });

    it("translates repository-not-found error", () => {
      const err = new Error("Repository not found");
      const msg = friendlyRemoteError(err, url, true);
      expect(msg).toContain("Repository not found");
      expect(msg).toContain(url);
    });

    it("passes through unknown errors with url context", () => {
      const err = new Error("network timeout");
      const msg = friendlyRemoteError(err, url, true);
      expect(msg).toContain("Mirror sync failed");
      expect(msg).toContain(url);
      expect(msg).toContain("network timeout");
    });

    it("handles non-Error values", () => {
      const msg = friendlyRemoteError("raw string error", url, false);
      expect(msg).toContain("Mirror sync failed");
      expect(msg).toContain("raw string error");
    });
  });

  describe("syncMirror error handling", () => {
    it("throws a friendly error for an unreachable remote URL", async () => {
      const tmpBase = await mkdtemp(join(tmpdir(), "reporelay-err-test-"));
      const errMirrorsDir = join(tmpBase, "mirrors");

      await expect(
        syncMirror(
          "https://github.com/this-org-does-not-exist-reporelay-test/nope.git",
          errMirrorsDir,
          "bad-repo",
        ),
      ).rejects.toThrow(/Authentication required|Repository not found|Authentication failed/);
    });
  });
});
