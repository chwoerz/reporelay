# Implementation Plan

Bottom-up, test-driven. Each step: implement the module → fill in its `it.todo()` tests → green bar → move up.

## Steps

### Step 1 — `src/core/` (types, config, logger, progress)

Zero dependencies. Everything else imports from here.

- [x] Shared types & interfaces (`ParsedSymbol`, `ParsedImport`, `Chunk`, `FileRecord`, `Repo`, `RepoRef`, `Language`, `SearchResult`, `IndexJob`, etc.)
- [x] Zod schemas for config validation (13 env vars, including `MCP_LANGUAGE_THRESHOLD`)
- [x] Config loader (`.env` → validated config object via `dotenv` + Zod)
- [x] Pino logger factory
- [x] In-memory indexing progress tracker with cross-process sync via PostgreSQL `LISTEN/NOTIFY`
- [x] `connectPublisher(sql)` (worker) and `connectSubscriber(sql)` (web) for progress broadcasting
- [x] **Tests:** `core/config.test.ts` ✅

### Step 2 — `src/git/` (file classifier, sync, diff, refs)

Pure logic + `simple-git`. No DB dependency.

- [x] File classifier: extension → `Language` enum, gitignore filtering via `ignore` package
- [x] Git sync: mirror clone, fetch, resolve HEAD SHA
- [x] Worktree: checkout at commit, cleanup
- [x] `listFiles(mirrorPath, commitSha, globPatterns)` — full file listing via `git ls-tree` (replaces incremental `git diff`)
- [x] `readFileFromMirror(mirrorPath, commitSha, filePath)` — raw file read via `git show`; returns `null` if unavailable
- [x] `listGitRefs(mirrorPath)` — reads branches and tags from a bare mirror via `git for-each-ref`
- [x] Git credentials: `resolveGitAuth(remoteUrl, env)` injects `GIT_TOKEN_<HOST>` / `GIT_USER_<HOST>` tokens into HTTPS URLs at fetch/clone time; tokens never persisted on disk
- [x] `normalizeHost(host)` — converts hostname to env-var-safe suffix (e.g. `github.com` → `GITHUB_COM`)
- [x] `hasTokenConfigured(remoteUrl, env)` / `getConfiguredHosts(env)` — UI helpers for token status
- [x] Known-host username defaults: github.com → `x-access-token`, gitlab.com → `oauth2`, bitbucket.org → `x-token-auth`
- [x] Language detector: `detectLanguagesFromDir(dir)` scans for well-known manifest files (package.json, Cargo.toml, go.mod, pyproject.toml, pom.xml, CMakeLists.txt, etc.) and returns the detected `Language[]`
- [x] **Tests:** `git/file-classifier.test.ts`, `git/git-sync.test.ts`, `git/git-credentials.test.ts`, `git/language-detector.test.ts` ✅

### Step 3 — `src/parser/` (tree-sitter, markdown)

Pure parsing, no DB. Uses sample fixtures from `test/fixtures/samples.ts`.
One uniform tree-sitter pipeline for all code languages.
Per-language tree-sitter extractors live in `src/parser/languages/`.

- [x] Parser interface: `parse(content, language, filePath) → { symbols, imports }`
- [x] tree-sitter parser: TS/JS, Python, Go, Java, Kotlin, Rust, C, C++ symbol + import extraction
- [x] Markdown parser: heading hierarchy, code blocks, links
- [x] Parser registry: language → tree-sitter grammar dispatch
- [x] **Tests:** `parser/tree-sitter-parser.test.ts`, `parser/markdown-parser.test.ts`, `parser/parse.test.ts` ✅

### Step 4 — `src/storage/` (Drizzle schema, migrations, repositories, pg-boss)

First module that needs Postgres. Unlocks integration tests.

Organized into three sub-folders:

- `schema/` — table definitions (`schema.ts`), DB connection (`db.ts`), migrations (`migrate.ts`)
- `repositories/` — base repository class + 7 entity repositories (repo, repo-ref, file-content, ref-file, symbol, chunk, import)
- `queue/` — pg-boss wrapper (`queue.ts`)

> **Note:** There is no `storage/search/` sub-folder. BM25 full-text search
> and pgvector similarity search are implemented in `retrieval/hybrid-search.ts`
> using raw SQL template tags against the Drizzle DB connection.

**Library choices:**

- **`postgres` (postgres.js)** over `pg` (node-postgres) — ESM-native, faster on benchmarks,
  better TypeScript support, and the recommended driver for Drizzle.
- **`drizzle-orm` / `drizzle-kit`** — schema-as-code with full SQL-level
  control. Drizzle's `sql` template tags let us express ParadeDB `@@@` operator,
  `pdb.score()`, and pgvector `<=>` cosine distance naturally.
- **`pgvector`** — standard Postgres extension for vector similarity search.
- **ParadeDB `pg_search`** — BM25 full-text search via Tantivy engine with `source_code`
  tokenizer that natively splits camelCase and snake_case identifiers.
- **`pg-boss`** over BullMQ — keeps the architecture Postgres-only (no Redis).
  Provides singleton key dedup, retry policies, and job lifecycle management.
- **`testcontainers`** — spins up real `paradedb/paradedb` containers per test run.

**Tables (7):**

| Table           | Description                                         |
| --------------- | --------------------------------------------------- |
| `repos`         | Registered repositories                             |
| `repo_refs`     | Indexed refs (branches/tags) per repo               |
| `file_contents` | Content-addressable file storage (keyed by SHA-256) |
| `ref_files`     | Junction: maps ref+path → file_contents             |
| `symbols`       | Extracted symbols per file_contents                 |
| `chunks`        | Chunked content with 768-dim embedding vectors      |
| `imports`       | Parsed import statements per file_contents          |

**Tasks:**

- [x] Drizzle schema: `repos`, `repo_refs`, `file_contents`, `ref_files`, `symbols`, `chunks`, `imports` tables
- [x] Migration runner (bootstrap pgvector + pg_trgm + pg_search extensions, create tables)
- [x] CRUD helpers for each table (base repository class + entity repositories)
- [x] Content-addressable design: files keyed by SHA-256, shared across refs
- [x] FTS: ParadeDB BM25 index on `chunks.content` with `source_code` tokenizer
- [x] Vector: pgvector embedding column (768 dims), HNSW index, cosine similarity
- [x] pg-boss wrapper: init, enqueue index job, handler registration, cancel jobs
- [x] `ImportRepository`: `findByFileContentId`, `findReferencesInRef` (named + default import lookup)
- [x] `FileContentRepository.deleteOrphans()` — removes file_contents no longer referenced by any ref_files
- [x] **Tests:** `storage/schema/schema.integration.test.ts`, `storage/repositories/import-repository.integration.test.ts`, `storage/queue/queue.integration.test.ts`, `storage/queue/queue.test.ts` ✅

### Step 5 — `src/indexer/` (chunker, embedder, pipeline)

Glues parser → storage. The pipeline integration test is the big validation.

- [x] Chunker: symbol-aware chunking, overflow windows, line-boundary splitting, overlap
- [x] Chunk token budget: configurable max-token-per-chunk limit (default sized for embedding models)
- [x] Density-aware `estimateTokens` — weighted heuristic for digits, punctuation, brackets (~1.5 chars/token) vs normal text (~4 chars/token)
- [x] Token-aware `truncateForEmbedding` with binary-search line-boundary truncation and `MAX_EMBED_TOKENS = 1900`
- [x] SHA-256 dedup: compute hash, detect existing file_contents, reuse symbols+chunks+embeddings
- [x] Dedup self-repair: collect un-embedded chunks from existing `file_contents` for re-embedding
- [x] Embedder interface + Mock provider (zero vectors) + Ollama provider (Metal GPU)
- [x] Embedder batching: split into configurable batch sizes, reassemble in order
- [x] `shouldSkipFile(content, maxFileSize, maxAvgLineLength)` guard — skips files > 1 MB or with avg line length > 500
- [x] Pipeline orchestrator: git ls-tree → parse → chunk → embed → store → status update (always-full-index model)
- [x] Per-file error isolation — `try/catch` per file, emit `file-error` event, continue processing
- [x] `file-skipped` / `file-error` progress event types
- [x] **Tests:** `indexer/chunker.test.ts`, `indexer/embedder.test.ts`, `indexer/embedder-ollama.test.ts`, `indexer/pipeline.integration.test.ts` ✅

### Step 6 — `src/retrieval/` (semver resolver, hybrid search, context builder)

Reads from storage. Pure query logic + scoring. Three implementation files.
BM25 and vector search are implemented here (not in storage/) using raw SQL.

**Design decisions:**

- **Semver resolver is pure** — `resolveSemver(constraint, candidates) → string | null`
  takes an array of tag strings + a semver range. A thin `resolveRef(db, repoId, refInput)` wrapper does the DB lookup.
- **No JS-side stop-word stripping** — Postgres `plainto_tsquery('english', …)` handles this.
- **One hybrid-search file** — `searchHybrid(db, embedder, options)` calls FTS + vector in parallel via `Promise.all`, deduplicates via `dedupOverlapping`, and returns ranked results.
- **`recent-changes` via storage, no git dependency** — compare `ref_files` between two indexed refs.

**Tasks:**

- [x] Semver resolver: pure `resolveSemver`, `resolveRef` wrapper
- [x] Query rewriting: split user query into FTS text + embedding text
- [x] Hybrid search: FTS + vector in parallel, `dedupOverlapping` scoring, repo/ref filters
- [x] `RefFileRepository.findChangedBetweenRefs(fromRefId, toRefId)`
- [x] Context builder strategies: `explain`, `implement`, `debug`, `recent-changes`
- [x] Token budget: truncate least-relevant chunks, order by file path then line number
- [x] **Tests:** `retrieval/semver-resolver.test.ts`, `retrieval/hybrid-search.test.ts`, `retrieval/context-builder.test.ts`, `retrieval/hybrid-search.integration.test.ts` ✅

### Step 7 — `src/services/` (shared service layer)

Shared business logic used by both the MCP tools and the Fastify web API,
eliminating duplication between those two surfaces.

**Functions:**

| Function            | Description                                                                             |
| ------------------- | --------------------------------------------------------------------------------------- |
| `listReposWithRefs` | List repos + refs, optionally filtered by language + threshold against `language_stats` |
| `findRepo`          | Resolve repo name → DB row                                                              |
| `resolveRepoAndRef` | Resolve repo + optional ref → fully-resolved repo & ref                                 |
| `getFileContent`    | Raw file from git mirror, fallback to indexed chunks                                    |
| `getSymbol`         | Symbol by name with source from chunks, optional imports                                |
| `findByPattern`     | Files or symbols by name/path pattern (ILIKE)                                           |
| `findReferences`    | Files that import a given symbol name                                                   |
| `buildContext`      | Context pack (explain/implement/debug/recent-changes)                                   |
| `searchCode`        | Hybrid lexical + vector search                                                          |

- [x] Service layer with shared types (`ResolvedRepoRef`, `FileResult`, `SymbolMatch`, `ImportRef`)
- [x] All operations delegated from both MCP tools and web API

### Step 8 — `src/mcp/` (tools, resources, prompts)

Wires retrieval to the MCP SDK. Delegates to the shared service layer.

**Files:**

| File           | Responsibility                                                         |
| -------------- | ---------------------------------------------------------------------- |
| `server.ts`    | Factory `createMcpServer(deps)` — McpServer, transport (stdio vs HTTP) |
| `tools.ts`     | `registerTools(server, deps)` — 7 tools with Zod schemas + handlers    |
| `resources.ts` | `registerResources(server, deps)` — 2 resource templates               |
| `prompts.ts`   | `registerPrompts(server, deps)` — 3 prompts                            |
| `main.ts`      | Standalone MCP entrypoint: DB + migrations + embedder + start          |
| `index.ts`     | Barrel export                                                          |

**MCP Tools (7):**

| Tool                 | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `search_code`        | Hybrid lexical + vector search                                 |
| `get_file`           | File content (raw from mirror or indexed chunks)               |
| `get_symbol`         | Symbol by name with source and optional imports                |
| `find`               | Files or symbols by pattern                                    |
| `find_references`    | Import-based references                                        |
| `build_context_pack` | Task-specific context (explain/implement/debug/recent-changes) |
| `list_repos`         | List all repositories with indexing status                     |

> **Note:** `sync_repo` and `add_repo` are exposed via the Web API only (not as MCP tools).

**Tasks:**

- [x] MCP server factory: stdio + streamable HTTP transport via `MCP_TRANSPORT` env var
- [x] Language auto-detection: when `MCP_LANGUAGES` is unset, scans CWD for manifest files to auto-populate the language filter; `MCP_LANGUAGE_THRESHOLD` (default 10, 0 = disabled) controls repo filtering strictness
- [x] 7 tool registrations with Zod input schemas and handlers
- [x] Resources: `reporelay://{repo}/{ref}/{path+}` (file content), `reporelay://{repo}/{ref}/tree` (dir tree)
- [x] Prompts: `explain-library`, `implement-feature`, `debug-issue`
- [x] **Tests:** `mcp/tools.test.ts`, `mcp/resources.test.ts`, `mcp/prompts.test.ts`, `mcp/mcp.integration.test.ts` ✅

### Step 9 — `src/web/` (Fastify API routes)

Full HTTP layer over storage + queue + shared services. Serves as the backend for
the Angular admin dashboard and exposes all MCP features as REST endpoints.

**REST API routes:**

```
GET    /health                                       Health check
POST   /api/repos                                    Register a repository
GET    /api/repos                                    List all repositories + refs
GET    /api/repos/:name                              Repository details
PATCH  /api/repos/:name                              Update repo settings (globPatterns)
GET    /api/repos/:name/git-refs                     Branches + tags from mirror
POST   /api/repos/:name/sync                         Enqueue indexing job
DELETE /api/repos/:name                              Delete repo (cascades)
DELETE /api/repos/:name/versions/:ref                Delete indexed version
GET    /api/indexing-status                           All active indexing progress
GET    /api/indexing-status/:name/:ref                Progress for specific ref
GET    /api/git-credentials/hosts                     Configured credential host suffixes
GET    /api/search                                    Hybrid code search
GET    /api/repos/:name/refs/:ref/tree                File tree listing
GET    /api/repos/:name/refs/:ref/file                File content + optional symbols
GET    /api/repos/:name/refs/:ref/symbols/:name       Symbol detail + optional imports
GET    /api/repos/:name/refs/:ref/find                Find files or symbols by pattern
GET    /api/repos/:name/refs/:ref/references/:name    Import-based references
POST   /api/repos/:name/context                       Build context pack
```

**Design decisions:**

- **Background mirror clone** — `POST /api/repos` fires `syncMirror` in background, returns immediately with `mirrorStatus: "cloning"`. UI polls until ready.
- **Background orphan cleanup** — deleting repos/refs triggers `FileContentRepository.deleteOrphans()` asynchronously to avoid blocking the response.
- **Synchronous delete** — `DELETE /api/repos/:name` and `DELETE /api/repos/:name/versions/:ref` await deletion before responding (204 No Content).
- **Job cancellation** — deleting a repo/ref cancels any in-flight pg-boss jobs and clears progress entries.
- **Glob patterns** — stored as a `text[]` column on `repos`, configurable via `PATCH /api/repos/:name`.

**Tasks:**

- [x] Fastify app factory with test-friendly DI (accept DB, boss, embedder, config, logger)
- [x] CORS via `@fastify/cors` with `origin: true`
- [x] Request validation via Zod
- [x] Background mirror clone on repo creation
- [x] MCP feature endpoints (search, browse, symbols, context) exposed as REST
- [x] Orphan cleanup on delete
- [x] Job cancellation on delete
- [x] Git credentials: `GET /api/git-credentials/hosts` endpoint; `tokenConfigured` field in repo list/detail/create responses
- [x] OpenAPI 3.1 spec (`openapi.yaml`) — single source of truth for all API contracts (20 endpoints, 20+ schemas)
- [x] Swagger UI at `/docs` via `@fastify/swagger` + `@fastify/swagger-ui`
- [x] Codegen: Kubb (Zod validation schemas + TypeScript types) + openapi-typescript (`api.d.ts`)
- [x] Angular UI types derived from generated spec via `@api/*` tsconfig path alias
- [x] Backend `IndexingStage` type derived from generated spec (single source of truth)
- [x] Request validation migrated from inline Zod to generated schemas (`createRepoBodySchema`, `syncBodySchema`, `contextBodySchema`)
- [x] **Tests:** `web/api.integration.test.ts` ✅

### Step 10 — `src/worker/` (pg-boss handler, entrypoint)

Wires queue → indexing pipeline. Thin glue code.

**Design decisions:**

- **No pg-boss retry** — on failure the handler sets `repo_ref.status = "error"` and does NOT rethrow.
- **Always-full-index** — lists all files via `git ls-tree` at the target commit. SHA-256 dedup in the pipeline skips unchanged files automatically. No dependency on indexing order.
- **Semver detection** — `semver.clean(ref)` populates the `semver` column.
- **Stale worktree cleanup on startup** — removes `wt-*` directories from `GIT_WORKTREES_DIR`.
- **Duplicate-ref guard** — skips re-indexing when `repo_ref.status === "ready"`.
- **Cross-process progress** — calls `connectPublisher(sql)` to broadcast progress via PG `NOTIFY`.

**Files:**

| File         | Responsibility                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handler.ts` | `handleIndexJob(job, deps)` — refactored into `resolveRepoSource`, `syncAndResolve`, `upsertRepoRef`, `checkoutAndListFiles`, `pipelineProgressCallback` |
| `index.ts`   | Entrypoint: bootstrap DB, migrations, pg-boss, embedder; register handler; graceful shutdown                                                             |

**Tasks:**

- [x] Worker entrypoint: bootstrap DB, start pg-boss, register index job handler
- [x] Job handler orchestration with focused helper functions
- [x] Graceful shutdown on SIGTERM/SIGINT (double-signal guard)
- [x] Stale worktree cleanup on startup
- [x] Semver detection on upsert
- [x] Duplicate-ref guard
- [x] `indexedAt` set atomically in pipeline
- [x] **Tests:** `worker/handler.test.ts` ✅

### Step 11 — `docker-compose.yml` + `.env.example` + Dockerfile + entrypoints

Production-ready container setup.

- [x] `docker-compose.yml`: ParadeDB (Postgres), worker service, web API service
- [x] `Dockerfile`: Multi-stage Node 22 build (base → deps → app)
- [x] `.env.example`: all 13 config vars with defaults and comments, plus `GIT_TOKEN_<HOST>` / `GIT_USER_<HOST>` credential patterns
- [x] `src/web/main.ts`: standalone web server entrypoint with PG subscriber
- [x] `src/mcp/main.ts`: standalone MCP server entrypoint
- [x] `scripts/dev.sh`: starts Postgres + worker + web for local development
- [x] `.gitignore`: added `.reporelay/` for mirrors and worktrees

### Step 12 — `ui/` (Angular 21 admin dashboard)

Full-featured admin dashboard built with Angular 21, Angular Material, and highlight.js.
Uses standalone components, signals, `httpResource` for reactive data fetching.

**Folder structure:**

```
ui/
  proxy.conf.json                         ← /api → http://localhost:3001
  src/
    app/
      app.ts                              ← Root component (Material toolbar + router-outlet)
      app.component.html                  ← Layout shell with nav links (Repos, Search)
      app.config.ts                       ← provideHttpClient(), provideRouter(), provideAnimationsAsync()
      app.routes.ts                       ← 6 routes (lazy-loaded)
      types.ts                            ← Re-exports from generated OpenAPI types via @api/* path alias
      repos/
        repo-list/                        ← List repos, inline add form, live indexing status
        repo-detail/                      ← Repo detail, ref table, sync + delete, live progress
      search/
        search.component.ts               ← Hybrid code search with syntax highlighting
      context-builder/
        context-builder.component.ts      ← Build context packs (explain/implement/debug/recent-changes)
      file-browser/
        file-browser.component.ts         ← File tree + file content viewer with line numbers
      symbol-explorer/
        symbol-explorer.component.ts      ← Find files/symbols, lookup symbol source + imports
      shared/
        ref-picker/                       ← Searchable branch/tag dropdown with autocomplete
        progress-card/                    ← Reusable indexing progress card with stage/file/chunk bars
        highlight.pipe.ts                 ← highlight.js syntax highlighting pipe (17 languages)
        lang-from-path.ts                 ← File extension → highlight.js language mapper
        stage-label.ts                    ← Human-friendly stage labels with emoji + percent helpers
```

**Routes (6, all lazy-loaded):**

| Path                  | Component                 | Description                                 |
| --------------------- | ------------------------- | ------------------------------------------- |
| `/`                   | `RepoListComponent`       | Repo list + add form + live indexing status |
| `/search`             | `SearchComponent`         | Hybrid code search                          |
| `/:name`              | `RepoDetailComponent`     | Repo detail, sync, delete refs              |
| `/:name/context`      | `ContextBuilderComponent` | Build context packs                         |
| `/:name/:ref/browse`  | `FileBrowserComponent`    | File tree + content viewer                  |
| `/:name/:ref/symbols` | `SymbolExplorerComponent` | Find & inspect symbols                      |

**UI libraries:**

- Angular 21 (`^21.2.x`)
- Angular Material (`^21.2.x`) — toolbar, table, cards, chips, buttons, icons, form fields, autocomplete, progress bars/spinners, select
- highlight.js (`^11.11.x`) — syntax highlighting for 17 languages
- RxJS (`~7.8.x`) — for polling, reactive data flows

**Tasks:**

- [x] Angular 21 standalone app with Material theming
- [x] Proxy config — `proxy.conf.json` mapping `/api` → `http://localhost:3001`
- [x] CORS on Fastify — `@fastify/cors` with `origin: true`
- [x] App shell — Material toolbar with Repos and Search nav links
- [x] Repo list — `httpResource<Repo[]>`, inline add form (local or remote), delete, live progress polling
- [x] Repo list — token status: `configuredHosts` httpResource, live token status hint while typing remote URLs, vpn_key/vpn_key_off icons per repo
- [x] Repo detail — `httpResource<Repo>`, ref table with status chips, sync with ref picker, repo-level glob patterns (PATCH), per-ref delete, live progress cards
- [x] Repo detail — auth status row showing "Token configured" / "No token" with icon
- [x] Search — hybrid code search with syntax highlighting and result cards
- [x] Context builder — strategy selection, ref picker, query/paths input, formatted output with copy
- [x] File browser — file tree with filter, file content viewer with line numbers
- [x] Symbol explorer — find files/symbols by pattern, symbol detail with source + imports
- [x] Ref picker — searchable autocomplete dropdown with branches/tags groups
- [x] Progress card — reusable card with stage badge, file/chunk progress bars, error display
- [x] Highlight pipe — syntax highlighting for 17 languages via highlight.js
- [x] Dev script — `"dev:ui": "cd ui && npx ng serve"` in root `package.json`

### Step 13 — `src/e2e/` (end-to-end integration tests)

Full-flow integration tests that exercise the entire pipeline from git sync
through to retrieval.

- [x] `full-flow.integration.test.ts` — complete indexing + search flow
- [x] `git-worktree-pipeline.integration.test.ts` — worktree checkout + pipeline
- [x] `ollama-embedding.integration.test.ts` — Ollama embedding provider integration
