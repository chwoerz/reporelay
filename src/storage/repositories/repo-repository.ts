/**
 * Repository for the `repos` table.
 */
import { eq } from "drizzle-orm";
import { BaseRepository } from "./base-repository.js";
import { repos, type RepoSelect } from "../schema/schema.js";
import type { Db } from "../schema/db.js";

export class RepoRepository extends BaseRepository<typeof repos> {
  constructor(db: Db) {
    super(db, repos);
  }

  async findByName(name: string): Promise<RepoSelect | undefined> {
    return this.findOne(eq(repos.name, name));
  }

  async listAll(): Promise<RepoSelect[]> {
    return this.findAll();
  }

  /** Update a repo by name and return the updated row. */
  async updateByName(
    name: string,
    data: Partial<typeof repos.$inferInsert>,
  ): Promise<RepoSelect | undefined> {
    const rows = await this.updateWhere(eq(repos.name, name), data);
    return rows[0];
  }
}
