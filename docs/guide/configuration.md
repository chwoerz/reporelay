# Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` to get started.

## Environment Variables

| Variable               | Default                                                     | Description                                                |
| :--------------------- | :---------------------------------------------------------- | :--------------------------------------------------------- |
| `DATABASE_URL`         | `postgresql://reporelay:reporelay@localhost:5432/reporelay` | Postgres connection string                                 |
| `EMBEDDING_PROVIDER`   | `ollama`                                                    | Embedding provider (`ollama`)                              |
| `EMBEDDING_URL`        | `http://localhost:11434`                                    | Embedding API endpoint                                     |
| `EMBEDDING_MODEL`      | `nomic-embed-text`                                          | Embedding model name                                       |
| `EMBEDDING_BATCH_SIZE` | `64`                                                        | Batch size for embedding requests                          |
| `MCP_TRANSPORT`        | `stdio`                                                     | `stdio` or `http`                                          |
| `MCP_SERVER_PORT`      | `3000`                                                      | HTTP transport port                                        |
| `WEB_PORT`             | `3001`                                                      | REST API port                                              |
| `GIT_MIRRORS_DIR`      | `.reporelay/mirrors`                                        | Bare mirror storage path                                   |
| `GIT_WORKTREES_DIR`    | `.reporelay/worktrees`                                      | Temporary worktree path                                    |
| `GIT_TOKEN_<HOST>`     | —                                                           | Auth token for HTTPS remotes (e.g. `GIT_TOKEN_GITHUB_COM`) |
| `GIT_USER_<HOST>`      | _(auto)_                                                    | Override username for token auth (defaults per host)       |
| `LOG_LEVEL`            | `info`                                                      | Pino log level                                             |

## Git Credentials

See [Getting Started > Private Repositories](/guide/getting-started#private-repositories-https) for details on configuring HTTPS tokens.
