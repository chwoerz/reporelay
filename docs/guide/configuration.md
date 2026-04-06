# Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` to get started.

## Server Environment Variables

| Variable                 | Default                                                     | Description                                                |
| :----------------------- | :---------------------------------------------------------- | :--------------------------------------------------------- |
| `DATABASE_URL`           | `postgresql://reporelay:reporelay@localhost:5432/reporelay` | Postgres connection string                                 |
| `EMBEDDING_URL`          | `http://localhost:11434`                                    | Embedding API endpoint (Ollama)                            |
| `EMBEDDING_MODEL`        | `nomic-embed-text`                                          | Embedding model name                                       |
| `EMBEDDING_BATCH_SIZE`   | `64`                                                        | Batch size for embedding requests                          |
| `MCP_SERVER_PORT`        | `3000`                                                      | MCP HTTP server port                                       |
| `MCP_LANGUAGES`          | —                                                           | Comma-separated language filter (skips auto-detection)     |
| `MCP_LANGUAGE_THRESHOLD` | `10`                                                        | Min language_stats % for repo filtering (0 = disabled)     |
| `WEB_PORT`               | `3001`                                                      | REST API port                                              |
| `GIT_MIRRORS_DIR`        | `.reporelay/mirrors`                                        | Bare mirror storage path                                   |
| `GIT_WORKTREES_DIR`      | `.reporelay/worktrees`                                      | Temporary worktree path                                    |
| `GIT_TOKEN_<HOST>`       | —                                                           | Auth token for HTTPS remotes (e.g. `GIT_TOKEN_GITHUB_COM`) |
| `GIT_USER_<HOST>`        | _(auto)_                                                    | Override username for token auth (defaults per host)       |
| `LOG_LEVEL`              | `info`                                                      | Pino log level                                             |

## Proxy Environment Variables

These variables configure the [MCP proxy](/guide/mcp-integration#mcp-proxy-remote-server) — the lightweight local wrapper that connects to a remote RepoRelay server.

| Variable                 | Default | Description                                              |
| :----------------------- | :------ | :------------------------------------------------------- |
| `REPORELAY_URL`          | —       | Remote RepoRelay MCP endpoint URL                        |
| `MCP_LANGUAGES`          | —       | Comma-separated language override (skips auto-detection) |
| `MCP_LANGUAGE_THRESHOLD` | `10`    | Min language_stats % for repo filtering (0 = disabled)   |
| `LOG_LEVEL`              | `info`  | Pino log level                                           |

The `--server` CLI argument takes priority over `REPORELAY_URL`.

## Git Credentials

See [Getting Started > Private Repositories](/guide/getting-started#private-repositories-https) for details on configuring HTTPS tokens.
