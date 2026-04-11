/**
 * Semver resolver — pure version matching + thin DB wrapper.
 *
 * Core function `resolveSemver` is pure: given a constraint string and
 * candidate tag array, picks the best match via the `semver` library.
 *
 * `resolveRef` adds DB lookup: fetches all indexed refs for a repo,
 * tries semver resolution, falls back to exact branch/tag name match.
 */
import * as semver from "semver";
import { eq } from "drizzle-orm";
import { repoRefs } from "../storage/index.js";
import type { Db } from "../storage/index.js";


/**
 * Pick the highest semver-satisfying tag from `candidates`.
 *
 * Accepts any range/constraint that `semver.satisfies` understands:
 * exact (`1.2.3`), caret (`^1.2.0`), tilde (`~1.2.0`), x-range (`1.x`),
 * hyphen (`1.0.0 - 2.0.0`), etc.
 *
 * Returns `null` when no candidate satisfies the constraint.
 */
export function resolveSemver(constraint: string, candidates: string[]): string | null {
  const range = semver.validRange(constraint);
  if (!range) return null;

  const valid = candidates
    .filter((c) => semver.valid(semver.clean(c) ?? c))
    .filter((c) => semver.satisfies(semver.clean(c) ?? c, range))
    .sort((a, b) => semver.rcompare(semver.clean(a) ?? a, semver.clean(b) ?? b));

  return valid[0] ?? null;
}


export interface ResolvedRef {
  id: number;
  ref: string;
  commitSha: string;
}

/**
 * Resolve a user-supplied ref string to an indexed `repo_refs` row.
 *
 * Resolution order:
 * 1. If `refInput` is a valid semver range, find the best matching indexed tag.
 * 2. Otherwise, try an exact match on the `ref` column (branch name / tag).
 * 3. Return `null` if nothing matches.
 */
export async function resolveRef(
  db: Db,
  repoId: number,
  refInput: string,
): Promise<ResolvedRef | null> {
  const allRefs = await db
    .select({ id: repoRefs.id, ref: repoRefs.ref, commitSha: repoRefs.commitSha })
    .from(repoRefs)
    .where(eq(repoRefs.repoId, repoId));

  if (allRefs.length === 0) return null;

  // 1. Try semver resolution
  const candidates = allRefs.map((r) => r.ref);
  const best = resolveSemver(refInput, candidates);
  if (best) {
    const match = allRefs.find((r) => r.ref === best)!;
    return { id: match.id, ref: match.ref, commitSha: match.commitSha };
  }

  // 2. Exact name match
  const exact = allRefs.find((r) => r.ref === refInput);
  if (exact) return { id: exact.id, ref: exact.ref, commitSha: exact.commitSha };

  return null;
}
