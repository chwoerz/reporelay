# AGENTS.md — RepoRelay

Self-hosted, MCP-native code context engine for any Git repository — public or private.
TypeScript (strict ESM), Fastify, Drizzle ORM, tree-sitter, pg-boss, pgvector/ParadeDB.

## Build / Dev / Test Commands

```bash
pnpm build                  # tsc — TypeScript compilation
pnpm dev                    # Start everything (Postgres + worker + web + UI)
pnpm dev:worker             # tsx watch src/worker/index.ts
pnpm dev:web                # tsx watch src/web/main.ts — REST API on :3001
pnpm dev:mcp                # tsx src/mcp/main.ts — MCP server (HTTP on :3000)
pnpm dev:ui                 # Angular dashboard on :4200

pnpm test                   # All tests (unit + integration)
pnpm test:unit              # Unit tests only
pnpm test:integration       # Integration tests (requires Docker for Testcontainers)
pnpm test:watch             # Vitest watch mode
```

### Running a single test

```bash
npx vitest run src/parser/tree-sitter-parser.test.ts          # single unit test file
npx vitest run src/indexer/pipeline.integration.test.ts        # single integration test file
npx vitest run -t "parses TypeScript functions"                # by test name pattern
npx vitest run --project unit src/core/config.test.ts          # single file, unit project only
```

### Database & Codegen

```bash
pnpm db:generate            # drizzle-kit generate — create SQL migrations
pnpm db:migrate             # drizzle-kit migrate — run migrations
pnpm generate:api           # Regenerate types/Zod from openapi.yaml (Kubb + openapi-typescript)
```

## Project Structure

```
src/
  core/        Config (Zod), types, logger (Pino), progress tracker
  storage/     Drizzle schema, repositories (class-based), pg-boss queue
  git/         Git mirror/fetch, worktree, diff, file classifier, credentials
  parser/      tree-sitter pipeline + per-language extractors + markdown parser
  indexer/     Chunker, embedder, orchestration pipeline
  retrieval/   Hybrid search (BM25 + vector via RRF), context builder, semver resolver
  services/    Shared business logic (used by both MCP + web)
  mcp/         MCP server, tools, resources, prompts
  web/         Fastify REST API (17 routes) + Swagger UI at /docs
  worker/      Background indexing worker (pg-boss handler)
  generated/   Auto-generated from openapi.yaml (types, Zod schemas, route paths)
  e2e/         End-to-end integration tests
test/
  fixtures/    Multi-language sample source code
  setup/       Testcontainers (ParadeDB) + temp Git repo helpers
ui/            Angular 21 admin dashboard (see ui/DESIGN.md for UI design spec)
```

## Mandatory Rules

- **ALWAYS create tests** when implementing new changes.
- **ALWAYS use `map`, `filter`** instead of `for` loops when there is no performance impact.

## Code Style

### Module System

- ESM throughout (`"type": "module"` in package.json).
- All local imports **must** use `.js` extension (Node16 ESM resolution):
  `import { loadConfig } from "../core/config.js";`
- Use `import type { ... }` for type-only imports.
- Cross-module imports go through barrel `index.ts` files; within the same module, import directly.

### Import Ordering

1. Node.js built-ins (prefixed `node:`): `import { readFile } from "node:fs/promises";`
2. Third-party packages: `import { eq } from "drizzle-orm";`
3. Local project imports (relative paths): `import { loadConfig } from "../core/config.js";`

### Formatting

- 2-space indentation. Always use semicolons. Double quotes for strings.
- Trailing commas in multi-line objects, arrays, and parameter lists.
- K&R brace style (opening brace on same line).
- Spaces inside import braces: `import { foo } from "bar";`
- Prefix unused parameters with underscore: `(_req, reply) => { ... }`
- Use numeric separators for large numbers: `120_000`, `60_000`.

### Naming Conventions

| Element                | Convention              | Example                                  |
| ---------------------- | ----------------------- | ---------------------------------------- |
| Variables, functions   | `camelCase`             | `getMirrorStatus`, `sha256`              |
| Classes                | `PascalCase`            | `ChunkRepository`, `OllamaEmbedder`      |
| Interfaces, types      | `PascalCase`            | `Embedder`, `PipelineOptions`            |
| Module-level constants | `UPPER_SNAKE_CASE`      | `RRF_K`, `DEFAULT_LIMIT`                 |
| `as const` arrays      | `PascalCase`            | `Languages`, `SymbolKinds`               |
| Database columns       | `snake_case` in SQL     | `local_path`, `created_at`               |
| Files                  | `kebab-case`            | `hybrid-search.ts`, `file-classifier.ts` |
| Tests (unit)           | `*.test.ts`             | `config.test.ts`                         |
| Tests (integration)    | `*.integration.test.ts` | `api.integration.test.ts`                |

### Types

- TypeScript strict mode is enabled. Do not use `any` unless absolutely necessary.
- Derive types from `as const` arrays: `export type Language = (typeof Languages)[number];`
- Use Zod schemas for runtime validation; infer static types with `z.infer<typeof schema>`.
- Use Drizzle's `$inferInsert` / `$inferSelect` for DB row types.
- Use `Pick<Config, "LOG_LEVEL">` for partial dependency injection.
- Prefer explicit return types on exported functions, especially for complex returns.
- Use non-null assertion (`!`) sparingly and only when certain: `issues[0]!.message`.

### Functions & Patterns

- Use `function` declarations at module scope (not arrow functions).
- Arrow functions only in callbacks, `.map()/.filter()` chains, and inline handlers.
- Async/await everywhere. Use `.then()/.catch()` only for fire-and-forget operations.
- Dependency injection via typed "deps" interface objects (not classes/constructors):
  `function buildApp(deps: AppDeps): FastifyInstance`
- Factory functions over constructors for singletons/services:
  `createDb()`, `createLogger()`, `createEmbedder()`, `buildApp()`
- Class-based repositories extending a generic `BaseRepository<T>`.

### Error Handling

- Return `string` error messages for expected failures (not exceptions):
  `async function resolveRepoAndRef(...): Promise<ResolvedRepoRef | string>`
  Callers check with `typeof resolved === "string"`.
- Use `try/catch` for infrastructure errors. Use `finally` for cleanup.
- `.catch(() => {})` for fire-and-forget cleanup that must not throw.
- `throw new Error(...)` only for programmer errors or unrecoverable states.
- Zod `.safeParse()` for request validation (no exceptions).
- No custom error classes — use built-in `Error`, string returns, and Zod errors.

### Comments & Documentation

- Every file should have a JSDoc header explaining its purpose.
- Use section dividers with `// ── Section Name ──` for long files.
- Use route markers in web files: `// ── GET /api/repos ──`
- Inline comments explain _why_, not _what_.

### Database & API

- OpenAPI spec (`openapi.yaml`) is the single source of truth for the REST API.
- After modifying `openapi.yaml`, run `pnpm generate:api` to regenerate types/schemas.
- Database schema lives in `src/storage/schema/schema.ts`. After changes, run `pnpm db:generate`.
- Drizzle file-based migrations in `drizzle/` are applied at runtime via `migrate.ts`.
  The migration SQL has been made idempotent (`IF NOT EXISTS`, `DO $$ ... EXCEPTION ...`)
  so it is safe on both fresh and existing databases.
- Extensions (pgvector, pg_trgm, pg_search) and the ParadeDB BM25 index live in
  `migrate.ts` as raw SQL because they cannot be expressed in the Drizzle schema.

### Testing

- Co-locate test files next to source: `src/core/config.ts` + `src/core/config.test.ts`.
- Integration tests use Testcontainers (ParadeDB) — Docker must be running.
- Test helpers: `test/setup/postgres.ts` (DB container), `test/setup/test-repo.ts` (temp Git repos).
- Fixtures: `test/fixtures/samples.ts` (multi-language sample code).
