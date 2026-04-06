# Indexing Pipeline

Every indexing run follows the same full-index path — no special cases for first vs. subsequent runs.

```mermaid
flowchart TD
    trigger([Web API / Admin Dashboard])
    trigger --> enqueue[Enqueue pg-boss job]
    enqueue --> worker[Worker picks up job]

    worker --> sync[Git sync · fetch or clone mirror]
    sync --> upsertRef[Upsert repo_ref · status = indexing<br/><i>store semver if tag-like ref</i>]
    upsertRef --> checkout[Checkout worktree at commitSha]
    checkout --> listFiles[git ls-tree · list all files<br/>filter by glob patterns]
    listFiles --> process

    subgraph loop [For each file]
        process[Read content · SHA-256 hash<br/>Upsert file record + ref_files link] --> dedup{SHA-256<br/>match?}
        dedup -->|Yes · unchanged| skip[Skip parse/chunk/embed<br/>Reuse existing file_contents]
        dedup -->|No · new content| parse[Parse · extract symbols<br/><i>tree-sitter / markdown</i>]
        parse --> chunk[Create chunks<br/><i>symbol-aware + overlap</i>]
    end

    skip --> collect
    chunk --> collect
    collect[Collect new chunks] --> embed[Batch embed<br/><i>Ollama</i>]
    embed --> storePG[Persist embedding vectors<br/><i>pgvector + ParadeDB BM25</i>]
    storePG --> done[Status = ready · cleanup worktree]

    style trigger fill:#3b82f6,color:#fff,stroke:none
    style done fill:#22c55e,color:#fff,stroke:none
    style dedup fill:#f59e0b,color:#fff,stroke:none
    style skip fill:#22c55e,color:#fff,stroke:none
    style loop fill:none,stroke:#6b7280,stroke-dasharray:5 5
```

## How SHA-256 Dedup Works

When the pipeline encounters a file:

1. Read the file content and compute its SHA-256 hash
2. Check if `file_contents` already has a row with that hash
3. **If yes**: create only the `ref_files` link (ref + path → existing file_contents). Skip parsing, chunking, and embedding entirely.
4. **If no**: parse the file, extract symbols, create chunks, generate embeddings, and store everything.

This means re-indexing a branch where 95% of files are unchanged only processes the 5% that changed — without needing `git diff` or knowledge of what was indexed before.

## Glob Patterns

Repos can have glob patterns (stored as `text[]` on the `repos` table) that filter which files are indexed. Patterns use `minimatch` with AND conjunction — all patterns must match for a file to be included. An empty array includes all files.

Configure via the admin dashboard or `PATCH /api/repos/:name`:

```bash
curl -X PATCH http://localhost:3001/api/repos/my-repo \
  -H 'content-type: application/json' \
  -d '{"globPatterns": ["src/**", "!**/*.test.ts"]}'
```

## Error Handling

- Each file is processed in isolation — a parse error in one file doesn't stop the pipeline
- `file-skipped` events are emitted for unsupported or too-large files
- `file-error` events are emitted for parse failures
- Progress is broadcast in real-time via PostgreSQL `LISTEN/NOTIFY`
