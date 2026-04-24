# Project Structure

```
reporelay/
├── src/
│   ├── core/               Shared types, config (Zod), logging (Pino), bootstrap
│   ├── generated/          OpenAPI-generated types + Zod schemas — do not edit manually
│   ├── git/                Git mirror clone/fetch, worktree, file listing, credentials
│   ├── parser/             Unified tree-sitter pipeline + custom markdown parser
│   │   └── languages/      Per-language extractors (TS/JS, Python, Go, Java, Kotlin, Rust, C, C++)
│   ├── indexer/            Symbol-aware chunker, embedding client, orchestration pipeline
│   ├── storage/
│   │   ├── schema/         Drizzle ORM schema, DB connection, migrations
│   │   ├── repositories/   Type-safe CRUD repositories extending a generic base class
│   │   └── queue/          pg-boss job queue wrapper
│   ├── retrieval/          Hybrid search (BM25+vector), semver resolver
│   ├── services/           Shared business logic (used by both MCP tools and web API)
│   ├── mcp/                MCP server (HTTP), tools, resources
│   ├── mcp-proxy/          Local MCP proxy for remote servers (language injection)
│   ├── web/                Fastify REST API + Swagger UI at /docs
│   ├── worker/             Background indexing worker (pg-boss handler)
│   └── e2e/                End-to-end integration tests
├── test/
│   ├── fixtures/           Multi-language sample source code
│   └── setup/              Testcontainers (ParadeDB) + temp Git repo helpers
├── ui/                     Angular admin dashboard (Material, highlight.js)
├── docs/                   VitePress documentation site
├── openapi.yaml            OpenAPI 3.1 spec — single source of truth for API contracts
├── kubb.config.ts          Kubb codegen config (types + Zod from OpenAPI)
├── drizzle/                Generated SQL migrations
├── docker-compose.yml      Postgres (ParadeDB), worker, web services
├── Dockerfile              Multi-stage Node build
└── scripts/dev.sh          Dev convenience script (Postgres + worker + web)
```

## Module Descriptions

### `src/core/`

Shared configuration, types, and utilities used across all modules. Includes Zod-validated environment config, shared type definitions (`Languages`, `SymbolKinds`, etc.), Pino logger factory, and application bootstrap logic.

### `src/generated/`

Auto-generated from `openapi.yaml` by [Kubb](https://kubb.dev/) and [openapi-typescript](https://github.com/openapi-ts/openapi-typescript). Do not edit manually — regenerate with `pnpm generate:api`.

### `src/git/`

Git operations via `simple-git`. Handles mirror clone/fetch, worktree checkout, file listing (via `git ls-tree`), ref listing, token-based HTTPS credentials, file-to-language classification, and project language detection.

### `src/parser/`

Code parsing via tree-sitter with per-language extractors. A unified parsing pipeline takes source code and returns symbols (functions, classes, interfaces, imports, exports). Includes a custom markdown parser using `mdast` and per-language extractors for all supported languages.

### `src/indexer/`

The indexing pipeline that processes files into searchable chunks. Orchestrates file processing with SHA-256 dedup, symbol-aware chunking that respects function/class boundaries, and embedding generation (Ollama).

### `src/storage/`

Database layer using Drizzle ORM with PostgreSQL. Contains the schema definition, class-based repositories extending a generic `BaseRepository<T>` for type-safe CRUD, and a pg-boss job queue wrapper for background indexing jobs.

### `src/retrieval/`

Hybrid search. Combines BM25 full-text search (ParadeDB `pg_search`) with vector similarity (pgvector cosine) via Reciprocal Rank Fusion. Includes semver range resolution for tags.

### `src/services/`

Shared business logic consumed by both the MCP server and the REST API.

### `src/mcp/`

Model Context Protocol server. Registers tools and resource templates. Bootstraps DB + embedder on startup.

### `src/mcp-proxy/`

Local MCP proxy for remote RepoRelay servers. Runs as a stdio server on the developer's machine, detects languages from the working directory, and forwards requests to a remote RepoRelay MCP server over HTTP — injecting detected languages into tool calls.

### `src/web/`

Fastify REST API with Swagger UI. Handles system routes, repository management, and feature routes (search, file browsing, symbols).

### `src/worker/`

Background indexing worker. Picks up pg-boss jobs, checks out code, runs the indexing pipeline, and updates ref status.

### `test/`

Test infrastructure. Includes multi-language sample source code for parser tests, Testcontainers setup for ParadeDB, and temporary Git repository helpers for integration tests.

### `ui/`

Angular admin dashboard. See `ui/DESIGN.md` for the full UI design spec.

## Import Conventions

- **Cross-module:** Import through barrel `index.ts` files
- **Within a module:** Import directly from the source file
- **ESM:** All imports use `.js` extension (`import { foo } from "./bar.js"`)
- **Type-only:** `import type { Config } from "../core/config.js"`

## File Naming

| Type             | Pattern                 | Example                        |
| ---------------- | ----------------------- | ------------------------------ |
| Source           | `kebab-case.ts`         | `hybrid-search.ts`             |
| Unit test        | `*.test.ts`             | `config.test.ts`               |
| Integration test | `*.integration.test.ts` | `pipeline.integration.test.ts` |
| Barrel export    | `index.ts`              | `src/git/index.ts`             |
