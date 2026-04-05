# MCP Tools & Resources

RepoRelay implements the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) to provide
code context directly to LLM agents. The MCP server exposes **7 tools**, **2 resources**, and
**3 prompts**.

## Transport Modes

RepoRelay supports two MCP transport modes:

| Mode  | How                      | Use case                           |
| ----- | ------------------------ | ---------------------------------- |
| stdio | `pnpm dev:mcp` (default) | Direct integration with IDE agents |
| HTTP  | Set `MCP_TRANSPORT=http` | Remote or multi-client setups      |

HTTP mode serves the MCP protocol at `/mcp` and a health check at `/health` on the configured port.

## Client Configuration

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "reporelay": {
      "command": "npx",
      "args": ["tsx", "src/mcp/main.ts"],
      "env": {
        "DATABASE_URL": "postgresql://reporelay:reporelay@localhost:5432/reporelay",
        "EMBEDDING_PROVIDER": "ollama"
      }
    }
  }
}
```

### OpenCode

```toml
[mcp.reporelay]
type = "local"
command = "npx"
args = ["tsx", "src/mcp/main.ts"]

[mcp.reporelay.environment]
DATABASE_URL = "postgresql://reporelay:reporelay@localhost:5432/reporelay"
EMBEDDING_PROVIDER = "ollama"
```

---

## Tools

### `search_code`

Hybrid lexical + vector search across indexed repositories. Combines BM25 full-text search with
vector similarity via Reciprocal Rank Fusion (RRF).

| Parameter | Type   | Required | Description                                     |
| --------- | ------ | -------- | ----------------------------------------------- |
| `query`   | string | yes      | Search query (min 1 character)                  |
| `repo`    | string | no       | Filter by repository name                       |
| `ref`     | string | no       | Filter by ref/tag (supports semver constraints) |
| `limit`   | number | no       | Max results, 1-100 (default 20)                 |

**Example:**

```
search_code({ query: "authentication middleware", repo: "my-api", limit: 10 })
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

| Parameter        | Type    | Required | Description                           |
| ---------------- | ------- | -------- | ------------------------------------- |
| `repo`           | string  | yes      | Repository name                       |
| `symbolName`     | string  | yes      | Symbol name to look up                |
| `ref`            | string  | no       | Ref/tag (supports semver constraints) |
| `includeImports` | boolean | no       | Show files that import this symbol    |

**Example:**

```
get_symbol({ repo: "my-api", symbolName: "buildApp", includeImports: true })
```

---

### `find`

Search for files or symbols by a glob-style name pattern.

| Parameter | Type   | Required | Description                           |
| --------- | ------ | -------- | ------------------------------------- |
| `pattern` | string | yes      | Search pattern (glob-style wildcards) |
| `kind`    | string | yes      | `"file"` or `"symbol"`                |
| `repo`    | string | yes      | Repository name                       |
| `ref`     | string | no       | Ref/tag (supports semver constraints) |

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

### `build_context_pack`

Build task-specific context packs from indexed code. Four strategies are available:

| Strategy         | Description                                                 |
| ---------------- | ----------------------------------------------------------- |
| `explain`        | Understand how a library or module works                    |
| `implement`      | Get guidance for building with existing patterns            |
| `debug`          | Debug an error with relevant code context                   |
| `recent-changes` | Review recent changes between two refs (requires `fromRef`) |

| Parameter   | Type     | Required | Description                                                 |
| ----------- | -------- | -------- | ----------------------------------------------------------- |
| `repo`      | string   | yes      | Repository name                                             |
| `task`      | string   | yes      | Strategy: `explain`, `implement`, `debug`, `recent-changes` |
| `ref`       | string   | no       | Ref/tag (supports semver constraints)                       |
| `fromRef`   | string   | no       | Base ref for `recent-changes` strategy                      |
| `query`     | string   | no       | Guiding query for context gathering                         |
| `paths`     | string[] | no       | Specific file paths to focus on                             |
| `maxTokens` | number   | no       | Token budget (default 8192)                                 |

**Example:**

```
build_context_pack({
  repo: "my-api",
  task: "implement",
  query: "Add rate limiting to the auth endpoints",
  maxTokens: 4096
})
```

---

### `list_repos`

List all registered repositories with their indexing status and indexed refs.
Takes no parameters.

**Example:**

```
list_repos({})
```

---

## Resources

MCP resources allow clients to browse and read indexed content via URI templates.

### File Content

| Property     | Value                           |
| ------------ | ------------------------------- |
| URI Template | `reporelay://{repo}/{ref}/{path+}` |
| MIME Type    | `text/plain`                    |
| Description  | Retrieve indexed file content   |

**Example URI:** `reporelay://my-api/v1.0.0/src/auth/login.ts`

### Directory Tree

| Property     | Value                        |
| ------------ | ---------------------------- |
| URI Template | `reporelay://{repo}/{ref}/tree` |
| MIME Type    | `text/plain`                 |
| Description  | List all file paths in a ref |

**Example URI:** `reporelay://my-api/v1.0.0/tree`

Resource listings enumerate all repositories with `ready` refs, so clients can browse
available content without calling tools first.

---

## Prompts

Prompts provide pre-built templates for common workflows. Each prompt calls `build_context_pack`
internally and returns a formatted message with relevant code context.

### `explain-library`

Understand how a library or module works.

| Argument | Type   | Required | Description                  |
| -------- | ------ | -------- | ---------------------------- |
| `repo`   | string | yes      | Repository name              |
| `query`  | string | no       | Module or topic to focus on  |
| `ref`    | string | no       | Ref/tag (semver constraints) |

**Generated message:** "Explain the architecture and key concepts of {query or repo}. Use the following indexed code context: ..."

### `implement-feature`

Get guidance for building with existing patterns.

| Argument | Type   | Required | Description                  |
| -------- | ------ | -------- | ---------------------------- |
| `repo`   | string | yes      | Repository name              |
| `query`  | string | yes      | Feature description          |
| `ref`    | string | no       | Ref/tag (semver constraints) |

**Generated message:** "I want to implement: {query}. Follow the existing patterns in the codebase. Here is the relevant context: ..."

### `debug-issue`

Debug an error with relevant code context.

| Argument | Type   | Required | Description                  |
| -------- | ------ | -------- | ---------------------------- |
| `repo`   | string | yes      | Repository name              |
| `query`  | string | yes      | Issue description            |
| `ref`    | string | no       | Ref/tag (semver constraints) |

**Generated message:** "I'm debugging this issue: {query}. Here is the relevant code context: ..."

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
