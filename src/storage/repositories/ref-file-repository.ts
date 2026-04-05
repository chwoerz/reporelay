/**
 * Repository for the `ref_files` junction table.
 */
import { eq, and, sql, ilike, like, inArray } from "drizzle-orm";
import { BaseRepository } from "./base-repository.js";
import { refFiles, fileContents, type RefFileSelect } from "../schema/schema.js";
import type { Db } from "../schema/db.js";

export type ChangeType = "added" | "modified" | "deleted";

export interface RefFileChange {
  path: string;
  changeType: ChangeType;
  /** fileContentId in the target ref (undefined for deleted files). */
  fileContentId?: number;
}

export class RefFileRepository extends BaseRepository<typeof refFiles> {
  constructor(db: Db) {
    super(db, refFiles);
  }

  /**
   * Insert or update a ref_file entry.
   *
   * When re-indexing the same ref, the (repoRefId, path) row may already
   * exist. This upsert updates the fileContentId on conflict so re-index
   * doesn't violate the unique constraint.
   */
  async upsertByRefAndPath(data: {
    repoRefId: number;
    fileContentId: number;
    path: string;
  }): Promise<RefFileSelect> {
    const [row] = await this.db
      .insert(refFiles)
      .values(data)
      .onConflictDoUpdate({
        target: [refFiles.repoRefId, refFiles.path],
        set: { fileContentId: data.fileContentId },
      })
      .returning();
    return row as RefFileSelect;
  }

  async findByRepoRef(repoRefId: number): Promise<RefFileSelect[]> {
    return this.findAll(eq(refFiles.repoRefId, repoRefId));
  }

  async findByRepoRefAndPath(repoRefId: number, path: string): Promise<RefFileSelect | undefined> {
    return this.findOne(and(eq(refFiles.repoRefId, repoRefId), eq(refFiles.path, path))!);
  }

  /**
   * Compare two indexed refs and return the list of changed files.
   *
   * Uses a FULL OUTER JOIN on path to detect:
   * - added:    path exists only in `toRefId`
   * - deleted:  path exists only in `fromRefId`
   * - modified: path exists in both but `file_content_id` differs
   */
  async findChangedBetweenRefs(fromRefId: number, toRefId: number): Promise<RefFileChange[]> {
    const rows = await this.db.execute<{
      from_path: string | null;
      to_path: string | null;
      from_fc_id: number | null;
      to_fc_id: number | null;
    }>(sql`
      SELECT
        f."path"            AS from_path,
        t."path"            AS to_path,
        f."file_content_id" AS from_fc_id,
        t."file_content_id" AS to_fc_id
      FROM
        (SELECT "path", "file_content_id" FROM "ref_files" WHERE "repo_ref_id" = ${fromRefId}) f
      FULL OUTER JOIN
        (SELECT "path", "file_content_id" FROM "ref_files" WHERE "repo_ref_id" = ${toRefId}) t
      ON f."path" = t."path"
      WHERE
        f."path" IS NULL
        OR t."path" IS NULL
        OR f."file_content_id" != t."file_content_id"
    `);

    return rows.map((r) => {
      if (r.from_path == null) {
        return { path: r.to_path!, changeType: "added" as const, fileContentId: r.to_fc_id! };
      }
      if (r.to_path == null) {
        return { path: r.from_path!, changeType: "deleted" as const };
      }
      return { path: r.to_path!, changeType: "modified" as const, fileContentId: r.to_fc_id! };
    });
  }

  /** Find files matching an ILIKE pattern within a ref, optionally filtered by languages. */
  async findByPathPattern(
    repoRefId: number,
    pattern: string,
    languages?: string[],
  ): Promise<RefFileSelect[]> {
    const conditions = [eq(refFiles.repoRefId, repoRefId), ilike(refFiles.path, `%${pattern}%`)];
    if (languages && languages.length > 0) {
      conditions.push(inArray(fileContents.language, languages));
      return this.db
        .select({
          id: refFiles.id,
          repoRefId: refFiles.repoRefId,
          fileContentId: refFiles.fileContentId,
          path: refFiles.path,
        })
        .from(refFiles)
        .innerJoin(fileContents, eq(refFiles.fileContentId, fileContents.id))
        .where(and(...conditions)) as Promise<RefFileSelect[]>;
    }

    return this.db
      .select()
      .from(refFiles)
      .where(and(...conditions)) as Promise<RefFileSelect[]>;
  }

  /** List all file paths in a ref, optionally filtered by prefix and/or languages. */
  async listPaths(repoRefId: number, prefix?: string, languages?: string[]): Promise<string[]> {
    const conditions = [eq(refFiles.repoRefId, repoRefId)];
    if (prefix) {
      conditions.push(like(refFiles.path, `${prefix}%`));
    }

    const needsJoin = languages && languages.length > 0;
    if (needsJoin) {
      conditions.push(inArray(fileContents.language, languages));
    }

    const query = needsJoin
      ? this.db
          .select({ path: refFiles.path })
          .from(refFiles)
          .innerJoin(fileContents, eq(refFiles.fileContentId, fileContents.id))
          .where(and(...conditions))
          .orderBy(refFiles.path)
      : this.db
          .select({ path: refFiles.path })
          .from(refFiles)
          .where(and(...conditions))
          .orderBy(refFiles.path);

    const rows = await query;
    return rows.map((r) => r.path);
  }
}
