/**
 * MCP resource registrations.
 *
 * Two resource templates:
 * - `reporelay://{repo}/{ref}/{path+}` — file content (chunks ordered by line)
 * - `reporelay://{repo}/{ref}/tree` — directory tree listing
 *
 * All data access goes through the shared service layer.
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpDeps } from "./server.js";
import {
  resolveRepoAndRef,
  getFileContent,
  listReposWithRefs,
  listFilePaths,
} from "../services/index.js";

/**
 * Build the resource listing (repo + ready refs) shared by both resources.
 */
async function listReadyRepoRefs(
  deps: McpDeps,
  uriBuilder: (repoName: string, ref: string) => string,
  nameBuilder: (repoName: string, ref: string) => string,
) {
  const entries = await listReposWithRefs(deps.db, undefined, deps.languageThreshold);
  const resources = entries.flatMap(({ repo, refs }) =>
    refs
      .filter((ref) => ref.stage === "ready")
      .map((ref) => ({
        uri: uriBuilder(repo.name, ref.ref),
        name: nameBuilder(repo.name, ref.ref),
      })),
  );
  return { resources };
}

export function registerResources(server: McpServer, deps: McpDeps): void {
  server.registerResource(
    "file-content",
    new ResourceTemplate("reporelay://{repo}/{ref}/{path+}", {
      list: () =>
        listReadyRepoRefs(
          deps,
          (repo, ref) => `reporelay://${repo}/${ref}/`,
          (repo, ref) => `${repo}@${ref}`,
        ),
    }),
    {
      title: "File Content",
      description: "Retrieve indexed file content by repo, ref, and path.",
      mimeType: "text/plain",
    },
    async (
      uri,
      { repo: repoName, ref: refStr, "path+": pathParts },
    ): Promise<ReadResourceResult> => {
      const filePath = Array.isArray(pathParts) ? pathParts.join("/") : String(pathParts);

      const resolved = await resolveRepoAndRef(deps.db, String(repoName), String(refStr));
      if (typeof resolved === "string") {
        return { contents: [{ uri: uri.href, text: `Not found: ${repoName}@${refStr}` }] };
      }

      const result = await getFileContent(deps.db, resolved, filePath, {
        mirrorsDir: deps.config.GIT_MIRRORS_DIR,
      });

      if (typeof result === "string") {
        return { contents: [{ uri: uri.href, text: `File not found: ${filePath}` }] };
      }

      return { contents: [{ uri: uri.href, text: result.content }] };
    },
  );

  server.registerResource(
    "directory-tree",
    new ResourceTemplate("reporelay://{repo}/{ref}/tree", {
      list: () =>
        listReadyRepoRefs(
          deps,
          (repo, ref) => `reporelay://${repo}/${ref}/tree`,
          (repo, ref) => `${repo}@${ref} tree`,
        ),
    }),
    {
      title: "Directory Tree",
      description: "List all file paths in an indexed repo/ref.",
      mimeType: "text/plain",
    },
    async (uri, { repo: repoName, ref: refStr }): Promise<ReadResourceResult> => {
      const resolved = await resolveRepoAndRef(deps.db, String(repoName), String(refStr));
      if (typeof resolved === "string") {
        return { contents: [{ uri: uri.href, text: `Not found: ${repoName}@${refStr}` }] };
      }

      const paths = await listFilePaths(deps.db, resolved.ref.id);
      const text = paths.length > 0 ? paths.join("\n") : "(no files)";
      return { contents: [{ uri: uri.href, text }] };
    },
  );
}
