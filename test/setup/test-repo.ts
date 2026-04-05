/**
 * Helpers to create temporary git repos with known file trees for testing.
 */
import { simpleGit } from "simple-git";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

export interface TestRepo {
  path: string;
  name: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates a minimal git repo in a temp directory with the given files.
 * Each key is a relative path, each value is the file content.
 *
 * The repo is initialized with a single commit and a v1.0.0 tag.
 */
export async function createTestRepo(
  files: Record<string, string>,
  options?: { tag?: string },
): Promise<TestRepo> {
  const dir = await mkdtemp(join(tmpdir(), "reporelay-test-"));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.email", "test@reporelay.local");
  await git.addConfig("user.name", "reporelay Test");

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const fullPath = join(dir, relativePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf-8");
    }),
  );

  await git.add(".");
  await git.commit("initial commit");
  await git.addTag(options?.tag ?? "v1.0.0");

  return {
    path: dir,
    name: "test-repo",
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Adds a new commit to an existing test repo.
 * Returns the new commit SHA.
 */
export async function addCommitToTestRepo(
  repoPath: string,
  changes: Record<string, string | null>, // null = delete the file
  message = "test commit",
): Promise<string> {
  const git = simpleGit(repoPath);

  for (const [relativePath, content] of Object.entries(changes)) {
    const fullPath = join(repoPath, relativePath);
    if (content === null) {
      await git.rm(relativePath);
    } else {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf-8");
      await git.add(relativePath);
    }
  }

  const result = await git.commit(message);
  return result.commit;
}
