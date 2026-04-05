# Database Design

RepoRelay uses a content-addressable storage model. Files are keyed by SHA-256 hash, so identical content across branches and tags shares parsed symbols, chunks, and embeddings automatically. Every ref gets a complete `ref_files` set via `git ls-tree` — no incremental diffs, no ordering dependencies.

## Schema

```
repos (1) ──< repo_refs (1) ──< ref_files >── (1) file_contents
                                                       │
                                                       ├──< symbols
                                                       ├──< chunks  (with embedding vectors)
                                                       └──< imports
```

## Tables (7)

| Table           | Description                                             |
| --------------- | ------------------------------------------------------- |
| `repos`         | Registered repositories (name, path/URL, glob patterns) |
| `repo_refs`     | Indexed refs (branches/tags) per repo                   |
| `file_contents` | Content-addressable file storage (keyed by SHA-256)     |
| `ref_files`     | Junction: maps ref+path → file_contents                 |
| `symbols`       | Extracted symbols per file_contents                     |
| `chunks`        | Chunked content with 768-dim embedding vectors          |
| `imports`       | Parsed import statements per file_contents              |

## Hybrid Search

Search combines two approaches, fused in a single SQL query:

- **BM25 full-text** via ParadeDB's `pg_search` extension with a `source_code` tokenizer (handles camelCase and snake_case)
- **Vector similarity** via pgvector with HNSW index and cosine distance
- Results are fused via **Reciprocal Rank Fusion (RRF)** — scale-invariant, no weight tuning needed

## Migrations

The worker runs migrations automatically on startup. Schema is defined in `src/storage/schema/schema.ts` using Drizzle ORM. After schema changes:

```bash
pnpm db:generate   # Create migration SQL
pnpm db:migrate    # Apply migrations
```
