# MCP Integration

RepoRelay exposes a rich set of MCP primitives that any compatible client can discover and use.

## Transport Modes

| Mode                | `MCP_TRANSPORT`   | Description                                                             |
| :------------------ | :---------------- | :---------------------------------------------------------------------- |
| **Stdio**           | `stdio` (default) | Standard I/O — for local clients (Cursor, Claude Desktop)               |
| **Streamable HTTP** | `http`            | HTTP server on `MCP_SERVER_PORT` — for remote deployment, multi-session |

When using HTTP transport, the MCP endpoint is at `/mcp` and `/health` is available for status checks.

```bash
# Stdio (default)
pnpm dev:mcp

# HTTP
MCP_TRANSPORT=http pnpm dev:mcp
```

## Tools (7)

| Tool                     | Description                                                                                   |
| :----------------------- | :-------------------------------------------------------------------------------------------- |
| **`search_code`**        | Hybrid lexical + vector search across indexed repos                                           |
| **`get_file`**           | Retrieve full file content by repo/path; optionally list symbols with signatures              |
| **`get_symbol`**         | Fetch a specific symbol (function, class, etc.); optionally show dependency graph             |
| **`find`**               | Search for files or symbols by name/path pattern (`kind: "file" \| "symbol"`, glob wildcards) |
| **`find_references`**    | Find all references to a symbol across the indexed codebase                                   |
| **`build_context_pack`** | Build task-specific context: `explain` / `implement` / `debug` / `recent-changes`             |
| **`list_repos`**         | List registered repositories, their indexing status, and indexed versions                     |

> Tools that accept `ref` also support semver constraints for indexed tags: `^1.2`, `~1.0`, `2.x`

> **Note:** `sync_repo` and `add_repo` are available via the Web API / admin UI, not as MCP tools.

## Resources

| Resource       | URI Pattern                              | Description           |
| :------------- | :--------------------------------------- | :-------------------- |
| File Content   | `reporelay://{repo}/{ref}/{path}`           | Read any indexed file |
| Directory Tree | `reporelay://{repo}/{ref}/tree[/{subtree}]` | Browse the file tree  |

## Prompts

| Prompt                  | Description                                                            |
| :---------------------- | :--------------------------------------------------------------------- |
| **`explain-library`**   | Understand how a library or module works with relevant code context    |
| **`implement-feature`** | Get implementation guidance based on existing patterns in the codebase |
| **`debug-issue`**       | Debug an error with relevant code context pulled automatically         |

## Connecting Clients

### Claude Desktop

Add to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "reporelay": {
      "command": "node",
      "args": ["--import", "tsx", "/path/to/reporelay/src/mcp/main.ts"],
      "env": {
        "DATABASE_URL": "postgresql://reporelay:reporelay@localhost:5432/reporelay"
      }
    }
  }
}
```

### Cursor / Windsurf

Point the MCP connection to the stdio command or the HTTP endpoint depending on your transport mode.
