# Getting Started

## Prerequisites

| Requirement | Version |
| ----------- | ------- |
| Node.js     | 22+     |
| pnpm        | 9+      |
| Docker      | Latest  |

## 1. Clone and install

```bash
git clone https://github.com/chwoerz/reporelay.git
cd reporelay
pnpm install
```

## 2. Start Postgres

```bash
docker compose up -d postgres
```

This starts [ParadeDB](https://www.paradedb.com/) (Postgres with pgvector + pg_search for BM25 full-text search).

## 3. Configure environment

```bash
cp .env.example .env
# Defaults work for local development — no edits needed
```

## 4. Start services

```bash
# Option A: All-in-one dev script (Postgres + worker + web API)
pnpm dev

# Option B: Individual services
pnpm dev:worker   # Background indexing worker
pnpm dev:mcp      # MCP server (stdio)
pnpm dev:web      # REST API on :3001
pnpm dev:ui       # Angular dashboard on :4200
```

The worker automatically bootstraps the database on first startup (extensions, migrations, BM25 index).

## 5. Index your first repo

```bash
# Register a repo
curl -sS -X POST http://localhost:3001/api/repos \
  -H 'content-type: application/json' \
  -d '{"name":"my-repo","localPath":"/absolute/path/to/my-repo","defaultBranch":"main"}'

# Trigger indexing
curl -sS -X POST http://localhost:3001/api/repos/my-repo/sync \
  -H 'content-type: application/json' \
  -d '{"ref":"main"}'

# Check status (moves from "indexing" to "ready")
curl -sS http://localhost:3001/api/repos
```

Or use the Angular admin dashboard at `http://localhost:4200`, or MCP tools from your client.

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
