# MCP Tools & Resources

RepoRelay implements the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) to provide
code context directly to LLM agents. The MCP server exposes **6 tools** and **2 resources**.

## Server

The MCP server runs as an HTTP service (`pnpm dev:mcp`), serving the MCP protocol at `/mcp` and a health check at `/health` on `MCP_SERVER_PORT` (default 3000). Clients connect through the [MCP proxy](/guide/mcp-integration#mcp-proxy), which handles language auto-detection and forwards requests.

## Client Configuration

All clients connect via the MCP proxy (`npx reporelay --server <url>`).

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "reporelay": {
      "command": "npx",
      "args": ["reporelay", "--server", "http://localhost:3000/mcp"]
    }
  }
}
```

### OpenCode

```json
{
  "mcp": {
    "reporelay": {
      "type": "local",
      "command": ["npx", "reporelay", "--server", "http://localhost:3000/mcp"]
    }
  }
}
```

See [MCP Integration > Connecting Clients](/guide/mcp-integration#connecting-clients) for remote server examples.

---

## Tools

### `search_code`

Hybrid lexical + vector search across indexed repositories. Combines BM25 full-text search with
vector similarity via Reciprocal Rank Fusion (RRF).

| Parameter   | Type     | Required | Description                                                    |
| ----------- | -------- | -------- | -------------------------------------------------------------- |
| `query`     | string   | yes      | Search query (min 1 character)                                 |
| `repo`      | string   | no       | Filter by repository name                                      |
| `ref`       | string   | no       | Filter by ref/tag (supports semver constraints)                |
| `limit`     | number   | no       | Max results, 1-100 (default 20)                                |
| `languages` | string[] | no       | Language filter override (e.g. `["typescript", "javascript"]`) |

**Example:**

```
search_code({ query: "authentication middleware", repo: "my-api", limit: 10 })
search_code({ query: "auth", languages: ["typescript", "python"] })
```

---

### `get_file`

Retrieve file content by repository and path. Tries raw file from the git mirror first, falls
back to indexed chunks. Optionally includes a symbol list with signatures.

| Parameter        | Type    | Required | Description                           |
| ---------------- | ------- | -------- | ------------------------------------- |
| `repo`           | string  | yes      | Repository name                       |
| `path`           | string  | yes      | File path within the repo             |
| `ref`            | string  | no       | Ref/tag (supports semver constraints) |
| `includeSymbols` | boolean | no       | Include symbol list with signatures   |

**Example:**

```
get_file({ repo: "my-api", path: "src/auth/login.ts", includeSymbols: true })
```

---

### `get_symbol`

Fetch a specific symbol (function, class, interface, etc.) by name. Returns the symbol's source
code, location, and optionally which files import it.

| Parameter        | Type     | Required | Description                                                    |
| ---------------- | -------- | -------- | -------------------------------------------------------------- |
| `repo`           | string   | yes      | Repository name                                                |
| `symbolName`     | string   | yes      | Symbol name to look up                                         |
| `ref`            | string   | no       | Ref/tag (supports semver constraints)                          |
| `includeImports` | boolean  | no       | Show files that import this symbol                             |
| `languages`      | string[] | no       | Language filter override (e.g. `["typescript", "javascript"]`) |

**Example:**

```
get_symbol({ repo: "my-api", symbolName: "buildApp", includeImports: true })
```

---

### `find`

Search for files or symbols by a glob-style name pattern.

| Parameter   | Type     | Required | Description                                                    |
| ----------- | -------- | -------- | -------------------------------------------------------------- |
| `pattern`   | string   | yes      | Search pattern (glob-style wildcards)                          |
| `kind`      | string   | yes      | `"file"` or `"symbol"`                                         |
| `repo`      | string   | yes      | Repository name                                                |
| `ref`       | string   | no       | Ref/tag (supports semver constraints)                          |
| `languages` | string[] | no       | Language filter override (e.g. `["typescript", "javascript"]`) |

**Example:**

```
find({ pattern: "**/auth/*.ts", kind: "file", repo: "my-api" })
find({ pattern: "create*", kind: "symbol", repo: "my-api" })
```

---

### `find_references`

Find files that import a given symbol name. Useful for understanding how a function or class is
used across the codebase.

| Parameter    | Type   | Required | Description                           |
| ------------ | ------ | -------- | ------------------------------------- |
| `repo`       | string | yes      | Repository name                       |
| `symbolName` | string | yes      | Symbol name to search for             |
| `ref`        | string | no       | Ref/tag (supports semver constraints) |

**Example:**

```
find_references({ repo: "my-api", symbolName: "login" })
```

---

### `list_repos`

List all registered repositories with their indexing status and indexed refs.

| Parameter   | Type     | Required | Description                                                    |
| ----------- | -------- | -------- | -------------------------------------------------------------- |
| `languages` | string[] | no       | Language filter override (e.g. `["typescript", "javascript"]`) |

**Example:**

```
list_repos({})
list_repos({ languages: ["go", "rust"] })
```

---

## Resources

MCP resources allow clients to browse and read indexed content via URI templates.

### File Content

| Property     | Value                              |
| ------------ | ---------------------------------- |
| URI Template | `reporelay://{repo}/{ref}/{path+}` |
| MIME Type    | `text/plain`                       |
| Description  | Retrieve indexed file content      |

**Example URI:** `reporelay://my-api/v1.0.0/src/auth/login.ts`

### Directory Tree

| Property     | Value                           |
| ------------ | ------------------------------- |
| URI Template | `reporelay://{repo}/{ref}/tree` |
| MIME Type    | `text/plain`                    |
| Description  | List all file paths in a ref    |

**Example URI:** `reporelay://my-api/v1.0.0/tree`

Resource listings enumerate all repositories with `ready` refs, so clients can browse
available content without calling tools first.

---

## Semver Support

All tools and resources that accept a `ref` parameter support **semver constraint resolution**.
Instead of specifying an exact tag, you can use semver ranges:

```
ref: "^1.0.0"    → resolves to latest matching tag (e.g. v1.5.2)
ref: "~2.1.0"    → resolves to latest patch (e.g. v2.1.7)
ref: ">=3.0.0"   → resolves to latest matching tag
```

This is useful when agents need "the latest v1.x" without knowing the exact version.

---

## Language Filtering

Four tools (`search_code`, `get_symbol`, `find`, `list_repos`) accept an optional `languages` parameter. This allows per-request language filtering — only repos whose indexed refs contain the specified languages above the configured threshold are included in results.

Valid language values: `typescript`, `javascript`, `python`, `go`, `java`, `kotlin`, `rust`, `c`, `cpp`, `markdown`.

When using the [MCP proxy](/guide/mcp-integration#mcp-proxy-remote-server), detected languages from the developer's working directory are automatically injected into these tools. Explicitly provided `languages` values always take priority over auto-detected ones.
