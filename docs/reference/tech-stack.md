# Tech Stack

## Core Stack

| Layer                | Technology                                           | Purpose                                     |
| :------------------- | :--------------------------------------------------- | :------------------------------------------ |
| **Language**         | TypeScript (ESM, strict, ES2022)                     | Type-safe development                       |
| **Runtime**          | Node.js 22+                                          | Server runtime                              |
| **Package Manager**  | pnpm 9+                                              | Fast, disk-efficient package management     |
| **MCP**              | Official MCP TypeScript SDK                          | LLM agent integration (stdio + HTTP)        |
| **HTTP**             | Fastify 5                                            | High-performance REST API                   |
| **API Contract**     | OpenAPI 3.1 (hand-written spec)                      | API documentation + code generation         |
| **Codegen**          | Kubb + openapi-typescript                            | Generate types and Zod schemas from OpenAPI |
| **ORM**              | Drizzle ORM + Drizzle Kit                            | Type-safe database queries + migrations     |
| **Database**         | PostgreSQL via ParadeDB                              | Primary data store                          |
| **Full-Text Search** | ParadeDB BM25 (`pg_search`, `source_code` tokenizer) | Lexical code search                         |
| **Vector Store**     | pgvector (HNSW, cosine distance)                     | Semantic similarity search                  |
| **Job Queue**        | pg-boss (Postgres-backed)                            | Background job processing (no Redis)        |
| **Parsers**          | tree-sitter (9 languages) + custom markdown          | AST-based code parsing                      |
| **Embedding**        | Ollama (Metal)                                       | Vector embedding generation                 |
| **Frontend**         | Angular 21 + Angular Material + highlight.js         | Admin dashboard                             |
| **Testing**          | Vitest 3 + Testcontainers                            | Unit and integration tests                  |
| **Container**        | Docker + Docker Compose                              | Deployment and local development            |

## Key Design Choices

### PostgreSQL Does Everything

RepoRelay uses a single PostgreSQL instance (via ParadeDB) for:

- **Relational storage** — repos, refs, files, symbols, chunks, imports
- **Full-text search** — ParadeDB's BM25 index with `source_code` tokenizer
- **Vector search** — pgvector HNSW index with cosine distance
- **Job queue** — pg-boss stores jobs in Postgres tables (no Redis needed)
- **Real-time notifications** — `LISTEN`/`NOTIFY` for indexing progress

This eliminates the need for Redis, Elasticsearch, or dedicated vector databases.

### tree-sitter for Parsing

tree-sitter provides fast, incremental, language-agnostic parsing:

- Produces concrete syntax trees (CSTs) for 9 languages
- Custom extractors pull out functions, classes, interfaces, imports, and exports
- Symbol-aware chunking respects function/class boundaries

### Hybrid Search via RRF

Search combines two signals for better results:

1. **BM25** — Lexical matching via ParadeDB's `pg_search` extension
2. **Vector** — Semantic similarity via pgvector cosine distance

Results are merged using **Reciprocal Rank Fusion** (RRF) for a single ranked list.

### Full-Index + SHA-256 Dedup

Every ref is indexed by listing ALL files via `git ls-tree`. The pipeline uses SHA-256 hashing
to skip re-parsing, re-chunking, and re-embedding unchanged files. This gives every ref a
complete `ref_files` set while keeping indexing fast for incremental updates.
