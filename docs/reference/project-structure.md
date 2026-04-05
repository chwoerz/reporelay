# Project Structure

```
reporelay/
├── src/
│   ├── core/               Shared types, config (Zod), logging (Pino), progress tracker
│   ├── generated/          OpenAPI-generated types + Zod schemas — do not edit manually
│   │   ├── types/          TypeScript interfaces for all API schemas and operations
│   │   ├── zod/            Zod validation schemas for request/response bodies
│   │   ├── schemas/        JSON Schema files
│   │   └── api.d.ts        openapi-typescript generated types
│   ├── git/                Git mirror clone/fetch, worktree, file listing, credentials
│   ├── parser/             Unified tree-sitter pipeline + custom markdown parser
│   │   └── languages/      Per-language extractors (TS/JS, Python, Go, Java, Kotlin, Rust, C, C++)
│   ├── indexer/            Symbol-aware chunker, embedding client, orchestration pipeline
│   ├── storage/
│   │   ├── schema/         Drizzle ORM schema (7 tables), DB connection, migrations
│   │   ├── repositories/   Type-safe CRUD repositories (7 entity repos + base class)
│   │   └── queue/          pg-boss job queue wrapper
│   ├── retrieval/          Hybrid search (BM25+vector), semver resolver, context builder
│   ├── services/           Shared business logic (used by both MCP tools and web API)
│   ├── mcp/                MCP server, 7 tools, 2 resources, 3 prompts (stdio + HTTP)
│   ├── web/                Fastify REST API (18 routes) + Swagger UI at /docs
│   ├── worker/             Background indexing worker (pg-boss handler)
│   └── e2e/                End-to-end integration tests
├── test/
│   ├── fixtures/           Multi-language sample source code
│   └── setup/              Testcontainers (ParadeDB) + temp Git repo helpers
├── ui/                     Angular 21 admin dashboard (Material, highlight.js, 6 views)
├── docs/                   VitePress documentation site
├── openapi.yaml            OpenAPI 3.1 spec — single source of truth for API contracts
├── kubb.config.ts          Kubb codegen config (types + Zod from OpenAPI)
├── drizzle/                Generated SQL migrations
├── docker-compose.yml      Postgres (ParadeDB), worker, web services
├── Dockerfile              Multi-stage Node 22 build
└── scripts/dev.sh          Dev convenience script (Postgres + worker + web)
```

## Module Descriptions

### `src/core/`

Shared configuration, types, and utilities used across all modules.

- **`config.ts`** — Zod-validated environment configuration (`DATABASE_URL`, `EMBEDDING_PROVIDER`, etc.)
- **`types.ts`** — Shared type definitions, `as const` arrays (`Languages`, `SymbolKinds`, `ContextStrategies`, `EmbeddingProviders`, `McpTransports`)
- **`logger.ts`** — Pino logger factory
- **`progress.ts`** — Indexing progress tracker using PostgreSQL `LISTEN`/`NOTIFY`
- **`bootstrap.ts`** — Shared application bootstrap (DB connection, migrations, embedder)

### `src/generated/`

Auto-generated from `openapi.yaml` by [Kubb](https://kubb.dev/) and [openapi-typescript](https://github.com/openapi-ts/openapi-typescript). Do not edit manually — regenerate with `pnpm generate:api`.

### `src/git/`

Git operations via `simple-git`.

- **`git-sync.ts`** — Mirror clone/fetch, worktree checkout, `listFiles` (via `git ls-tree`), file classification, ref listing, HTTPS credential helpers
- **`index.ts`** — Barrel exports

### `src/parser/`

Code parsing via tree-sitter with per-language extractors.

- **`tree-sitter-parser.ts`** — Unified parsing pipeline: takes source code, returns symbols (functions, classes, interfaces, imports, exports)
- **`markdown-parser.ts`** — Custom markdown parser using `mdast`
- **`languages/`** — Per-language extractors for TypeScript/JavaScript, Python, Go, Java, Kotlin, Rust, C, and C++

### `src/indexer/`

The indexing pipeline that processes files into searchable chunks.

- **`pipeline.ts`** — Orchestration: file processing, SHA-256 dedup, parsing, chunking, embedding coordination
- **`chunker.ts`** — Symbol-aware code chunker that respects function/class boundaries
- **`embedder.ts`** — Embedding client abstraction (Ollama provider)

### `src/storage/`

Database layer using Drizzle ORM with PostgreSQL.

- **`schema/schema.ts`** — 7 tables: `repos`, `refs`, `file_contents`, `ref_files`, `symbols`, `chunks`, `imports`
- **`repositories/`** — Class-based repositories extending `BaseRepository<T>` for type-safe CRUD
- **`queue/`** — pg-boss job queue wrapper for background indexing jobs

### `src/retrieval/`

Search and context building.

- **`hybrid-search.ts`** — BM25 (ParadeDB `pg_search`) + vector (pgvector cosine) combined via RRF
- **`semver-resolver.ts`** — Resolves semver range constraints (e.g. `^1.0.0`) to indexed tags
- **`context-builder.ts`** — Four strategies: `explain`, `implement`, `debug`, `recent-changes`

### `src/services/`

Shared business logic consumed by both the MCP server and the REST API.

### `src/mcp/`

Model Context Protocol server.

- **`main.ts`** — Entry point (bootstraps DB + embedder, starts server)
- **`server.ts`** — MCP server factory (registers tools, resources, prompts)
- **`tools.ts`** — 7 tool definitions
- **`resources.ts`** — 2 resource templates (file content, directory tree)
- **`prompts.ts`** — 3 prompt templates (explain, implement, debug)

### `src/web/`

Fastify REST API with 18 routes.

- **`main.ts`** — Entry point (bootstraps DB + embedder, starts Fastify)
- **`app.ts`** — Route registration (system, repo management, feature routes) + Swagger UI

### `src/worker/`

Background indexing worker.

- **`index.ts`** — Entry point (bootstraps DB + embedder + pg-boss, starts worker)
- **`handler.ts`** — Job handler: checkout, list files, run pipeline, update ref status

### `test/`

Test infrastructure.

- **`fixtures/samples.ts`** — Multi-language sample source code for parser tests
- **`setup/postgres.ts`** — Testcontainers setup for ParadeDB
- **`setup/test-repo.ts`** — Temporary Git repository helpers for integration tests

### `ui/`

Angular 21 admin dashboard with 6 views. See `ui/DESIGN.md` for the full UI design spec.

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
