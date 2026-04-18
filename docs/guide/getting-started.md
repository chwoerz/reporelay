# Getting Started

## Prerequisites

| Requirement | Version |
| ----------- | ------- |
| Docker      | Latest  |

Node.js 22+ and pnpm 9+ are only needed for [local development](#local-development).

## Docker Compose (recommended)

Run the entire stack — Postgres, worker, REST API, MCP server, and admin UI — with a single command.

### 1. Clone and configure

```bash
git clone https://github.com/chwoerz/reporelay.git
cd reporelay
cp .env.example .env
```

Edit `.env` if you need to change the embedding model or Git tokens for private repos. The defaults work out of the box if you have [Ollama](https://ollama.com/) running locally.

### 2. Start everything

```bash
docker compose up -d
```

This builds and starts all 5 services:

| Service    | Port    | Description                                |
| ---------- | ------- | ------------------------------------------ |
| `postgres` | `5432`  | ParadeDB (Postgres + pgvector + pg_search) |
| `worker`   | —       | Background indexing worker (pg-boss)       |
| `web`      | `3001`  | REST API + Swagger UI (`/docs`)            |
| `mcp`      | `3000`  | MCP server (HTTP transport)                |
| `ui`       | `80`    | Angular admin dashboard (nginx)            |
| Ollama     | `11434` | Embedding model (external)                 |

The worker runs database migrations automatically on first startup.

### 3. Index your repos

```bash
# Register a remote repo
curl -sS -X POST http://localhost:3001/api/repos \
  -H 'content-type: application/json' \
  -d '{"name":"my-lib","remoteUrl":"https://github.com/org/my-lib.git"}'

# Trigger indexing for a specific branch
curl -sS -X POST http://localhost:3001/api/repos/my-lib/sync \
  -H 'content-type: application/json' \
  -d '{"ref":"main"}'

# Index a tagged release — each version is stored independently
curl -sS -X POST http://localhost:3001/api/repos/my-lib/sync \
  -H 'content-type: application/json' \
  -d '{"ref":"v2.0.0"}'

# Search across all indexed repos and versions
curl -sS 'http://localhost:3001/api/search?query=handleAuth'
```

Or use the admin dashboard at `http://localhost` and the Swagger UI at `http://localhost:3001/docs`.

## Local Development {#local-development}

Run services directly with Node.js for a faster dev loop with hot-reload.

### Additional prerequisites

| Requirement | Version |
| ----------- | ------- |
| Node.js     | 22+     |
| pnpm        | 9+      |

### 1. Clone and install

```bash
git clone https://github.com/chwoerz/reporelay.git
cd reporelay
pnpm install
```

### 2. Start Postgres

```bash
docker compose up -d postgres
```

This starts [ParadeDB](https://www.paradedb.com/) (Postgres with pgvector + pg_search for BM25 full-text search).

### 3. Configure environment

```bash
cp .env.example .env
# Defaults work for local development — no edits needed
```

### 4. Start services

```bash
# Option A: All-in-one dev script (Postgres + worker + web API)
pnpm dev

# Option B: Individual services
pnpm dev:worker   # Background indexing worker
pnpm dev:mcp      # MCP server (HTTP on :3000)
pnpm dev:web      # REST API on :3001
pnpm dev:proxy    # MCP proxy (connects to MCP server)
pnpm dev:ui       # Angular dashboard on :4200
```

| Service    | Port    | Description                                |
| ---------- | ------- | ------------------------------------------ |
| `postgres` | `5432`  | ParadeDB (Postgres + pgvector + pg_search) |
| `worker`   | —       | Background indexing worker (pg-boss)       |
| `web`      | `3001`  | REST API + Swagger UI (`/docs`)            |
| `mcp`      | `3000`  | MCP server (HTTP transport)                |
| `proxy`    | — stdio | MCP proxy (connects to MCP server)         |
| `ui`       | `4200`  | Angular dev server                         |
| Ollama     | `11434` | Embedding model (external)                 |

The worker automatically bootstraps the database on first startup (extensions, migrations, BM25 index).

### 5. Index your first repo

```bash
# Register a repo
curl -sS -X POST http://localhost:3001/api/repos \
  -H 'content-type: application/json' \
  -d '{"name":"my-repo","localPath":"/absolute/path/to/my-repo"}'

# Trigger indexing
curl -sS -X POST http://localhost:3001/api/repos/my-repo/sync \
  -H 'content-type: application/json' \
  -d '{"ref":"main"}'

# Check status (moves from "indexing" to "ready")
curl -sS http://localhost:3001/api/repos
```

Or use the Angular admin dashboard at `http://localhost:4200`, or MCP tools from your client.

## Supported Git Hosts

RepoRelay works with **any Git repository** accessible over HTTPS or on the local filesystem. There is no vendor lock-in — your repos can come from any combination of:

- **GitHub** (github.com and GitHub Enterprise)
- **GitLab** (gitlab.com and self-managed)
- **Bitbucket** (Cloud and Data Center)
- **Azure DevOps**
- **Gitea / Forgejo**
- **Any on-premise Git server** (Gerrit, cgit, etc.)
- **Local repositories** on disk

## Private Repositories (HTTPS)

RepoRelay can fetch from private HTTPS remotes using token-based authentication. Set environment variables following the `GIT_TOKEN_<HOST>` pattern:

```sh
# GitHub — uses x-access-token by default
GIT_TOKEN_GITHUB_COM=ghp_xxxxxxxxxxxxxxxxxxxx

# GitLab — uses oauth2 by default
GIT_TOKEN_GITLAB_COM=glpat-xxxxxxxxxxxxxxxxxxxx

# Custom host
GIT_TOKEN_GIT_INTERNAL_EXAMPLE_COM=my-token
GIT_USER_GIT_INTERNAL_EXAMPLE_COM=deploy      # override default username
```

The host suffix is derived by converting the hostname to uppercase and replacing dots/hyphens with underscores (e.g. `github.com` becomes `GITHUB_COM`). Known hosts have sensible username defaults; override with `GIT_USER_<HOST>` when needed.

Tokens are injected at fetch/clone time only and **never persisted** on disk. The admin dashboard shows a lock icon indicating whether a token is configured for each repo's remote URL.

## Next Steps

- [MCP Integration](/guide/mcp-integration) — connect to Claude Desktop, Cursor, or other clients
- [Admin Dashboard](/guide/admin-dashboard) — manage repos through the UI
- [Configuration reference](/guide/configuration) — all environment variables
