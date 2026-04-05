/**
 * Repository for the `symbols` table.
 */
import { eq, and, ilike, inArray, type SQL } from "drizzle-orm";
import { FileContentBaseRepository } from "./base-repository.js";
import { symbols, refFiles, fileContents, type SymbolSelect } from "../schema/schema.js";
import type { Db } from "../schema/db.js";

export interface SymbolWithPath extends SymbolSelect {
  filePath: string;
}

/** Shared select shape for symbol + file path queries. */
const symbolWithPathColumns = {
  id: symbols.id,
  fileContentId: symbols.fileContentId,
  name: symbols.name,
  kind: symbols.kind,
  signature: symbols.signature,
  startLine: symbols.startLine,
  endLine: symbols.endLine,
  documentation: symbols.documentation,
  filePath: refFiles.path,
} as const;

export class SymbolRepository extends FileContentBaseRepository<typeof symbols> {
  constructor(db: Db) {
    super(db, symbols);
  }

  /** Find symbols by exact name within a ref, optionally filtered by languages. */
  async findByNameInRef(
    repoRefId: number,
    name: string,
    languages?: string[],
  ): Promise<SymbolWithPath[]> {
    return this.queryWithPath(repoRefId, eq(symbols.name, name), languages);
  }

  /** Find symbols by ILIKE pattern within a ref, optionally filtered by languages. */
  async findByPatternInRef(
    repoRefId: number,
    pattern: string,
    languages?: string[],
  ): Promise<SymbolWithPath[]> {
    return this.queryWithPath(repoRefId, ilike(symbols.name, `%${pattern}%`), languages);
  }

  /** Shared query: join symbols → file_contents → ref_files with optional language filter. */
  private async queryWithPath(
    repoRefId: number,
    nameCondition: SQL,
    languages?: string[],
  ): Promise<SymbolWithPath[]> {
    const conditions = [eq(refFiles.repoRefId, repoRefId), nameCondition];
    if (languages && languages.length > 0) {
      conditions.push(inArray(fileContents.language, languages));
    }

    const rows = await this.db
      .select(symbolWithPathColumns)
      .from(symbols)
      .innerJoin(fileContents, eq(symbols.fileContentId, fileContents.id))
      .innerJoin(refFiles, eq(refFiles.fileContentId, fileContents.id))
      .where(and(...conditions));

    return rows as SymbolWithPath[];
  }
}
