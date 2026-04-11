# MCP Integration

RepoRelay exposes a rich set of MCP primitives that any compatible client can discover and use.

## Architecture

The MCP server runs as an **HTTP-only** service. Clients connect through the **MCP proxy**, a lightweight local binary that:

1. Runs on the developer's machine as a stdio MCP server
2. Detects languages from the local working directory
3. Forwards all requests to the remote RepoRelay HTTP server, injecting detected languages

```
Local IDE ──stdio──▶ MCP Proxy ──HTTP──▶ RepoRelay MCP Server
              │                              │
       detects languages            indexing + search
       from local CWD               (HTTP on MCP_SERVER_PORT)
```

The MCP HTTP endpoint is at `/mcp` and a health check is at `/health`. The server is stateless — each request creates a fresh server instance, so no session tracking is needed.

```bash
# Start the MCP server (HTTP)
pnpm dev:mcp

# Start the proxy (connects to the MCP server)
pnpm dev:proxy
```

## MCP Proxy

### Usage

```bash
# Via CLI argument
npx reporelay --server https://reporelay.example.com/mcp

# Or via environment variable
REPORELAY_URL=https://reporelay.example.com/mcp npx reporelay

# Development mode
pnpm dev:proxy
```

### How Language Injection Works

The proxy detects your project's languages by scanning the working directory for well-known manifest files:

| Manifest File                   | Detected Languages     |
| ------------------------------- | ---------------------- |
| `package.json`, `tsconfig.json` | typescript, javascript |
| `Cargo.toml`                    | rust                   |
| `go.mod`                        | go                     |
| `pyproject.toml`, `setup.py`    | python                 |
| `pom.xml`, `build.gradle(.kts)` | java, kotlin           |
| `CMakeLists.txt`, `Makefile`    | c, cpp                 |

Detected languages are used to filter which repos are served — only repos whose `language_stats` contain a matching language above the threshold are included.

The proxy injects detected languages into 4 language-aware tools: `search_code`, `get_symbol`, `find`, and `list_repos`. Injection only happens when:

- The tool is one of the 4 language-aware tools
- The caller did **not** already provide a `languages` value
- There are detected languages available

Per-request `languages` values provided by the caller always take priority over auto-detected ones.

### Proxy Configuration

| Variable                 | Default | Description                                                |
| :----------------------- | :------ | :--------------------------------------------------------- |
| `REPORELAY_URL`          | —       | Remote RepoRelay MCP endpoint URL                          |
| `MCP_LANGUAGES`          | —       | Comma-separated language override (skips auto-detection)   |
| `MCP_LANGUAGE_THRESHOLD` | —       | Minimum language_stats % for repo filtering (0 = disabled) |
| `LOG_LEVEL`              | `info`  | Log level                                                  |

The `--server` CLI argument takes priority over `REPORELAY_URL`.

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

### Per-Request Language Filtering

Four tools (`search_code`, `get_symbol`, `find`, `list_repos`) accept an optional `languages` parameter — an array of language names that overrides the server-level language filter for that single request. Valid values are: `typescript`, `javascript`, `python`, `go`, `java`, `kotlin`, `rust`, `c`, `cpp`, `markdown`.

```
search_code({ query: "auth middleware", languages: ["typescript", "javascript"] })
```

When the MCP proxy is used, detected languages are automatically injected into these tools unless the caller explicitly provides their own `languages` value.

## Resources

| Resource       | URI Pattern                                 | Description           |
| :------------- | :------------------------------------------ | :-------------------- |
| File Content   | `reporelay://{repo}/{ref}/{path}`           | Read any indexed file |
| Directory Tree | `reporelay://{repo}/{ref}/tree[/{subtree}]` | Browse the file tree  |

## Prompts

| Prompt                  | Description                                                            |
| :---------------------- | :--------------------------------------------------------------------- |
| **`explain-library`**   | Understand how a library or module works with relevant code context    |
| **`implement-feature`** | Get implementation guidance based on existing patterns in the codebase |
| **`debug-issue`**       | Debug an error with relevant code context pulled automatically         |

## Connecting Clients

All clients connect via the MCP proxy. The proxy runs locally as a stdio server and forwards requests to the RepoRelay HTTP server.

### Claude Desktop / Cursor

Add to your MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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

For a remote server, replace the URL:

```json
{
  "mcpServers": {
    "reporelay": {
      "command": "npx",
      "args": ["reporelay", "--server", "https://reporelay.example.com/mcp"]
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

### Cursor / Windsurf

Point the MCP connection to the proxy binary: `npx reporelay --server <url>`.
