/**
 * Repository for the `imports` table.
 */
import { sql } from "drizzle-orm";
import { FileContentBaseRepository } from "./base-repository.js";
import { imports } from "../schema/schema.js";
import type { Db } from "../schema/db.js";

export interface ImportReference {
  filePath: string;
  source: string;
  importedName: string;
  isDefault: boolean;
}

export class ImportRepository extends FileContentBaseRepository<typeof imports> {
  constructor(db: Db) {
    super(db, imports);
  }

  /**
   * Find all files in a ref that import a given symbol name.
   *
   * Searches both `names` array (named imports) and `default_name` (default import).
   */
  async findReferencesInRef(repoRefId: number, symbolName: string): Promise<ImportReference[]> {
    const rows = await this.db.execute<{
      file_path: string;
      source: string;
      is_default: boolean;
    }>(sql`
      SELECT
        rf."path" AS file_path,
        i."source" AS source,
        CASE WHEN i."default_name" = ${symbolName} THEN true ELSE false END AS is_default
      FROM "imports" i
      INNER JOIN "file_contents" fc ON i."file_content_id" = fc."id"
      INNER JOIN "ref_files" rf ON rf."file_content_id" = fc."id"
      WHERE rf."repo_ref_id" = ${repoRefId}
        AND (${symbolName} = ANY(i."names") OR i."default_name" = ${symbolName})
    `);

    return rows.map((r) => ({
      filePath: r.file_path,
      source: r.source,
      importedName: symbolName,
      isDefault: r.is_default,
    }));
  }
}
