# REST API Reference

RepoRelay exposes 20 REST API routes via Fastify 5 with full OpenAPI 3.1 documentation.
Interactive Swagger UI is available at `/docs` when the web server is running.

## Base URL

```
http://localhost:3001
```

## Authentication

No authentication is required for the API. Git credentials for private repos are configured via `GIT_TOKEN_*` environment variables on the server.

---

## System Routes

### `GET /health`

Health check endpoint.

**Response:** `200`

```json
{ "status": "ok" }
```

---

### `GET /api/git-credentials/hosts`

Returns a list of normalized host suffixes that have `GIT_TOKEN_*` environment variables configured.

**Response:** `200`

```json
["github.com", "gitlab.example.com"]
```

---

### `GET /api/indexing-status`

Returns all active indexing progress entries.

**Response:** `200` — Array of [`IndexingProgress`](#indexingprogress)

---

### `GET /api/indexing-status/:name/:ref`

Returns indexing progress for a specific repository and ref.

| Parameter | Type   | In   | Description      |
| --------- | ------ | ---- | ---------------- |
| `name`    | string | path | Repository name  |
| `ref`     | string | path | Ref (branch/tag) |

**Response:** `200` — [`IndexingProgress`](#indexingprogress)
**Error:** `404` — No active indexing tracked for this repo/ref

---

## Repository Management Routes

### `POST /api/repos`

Register a new repository. Triggers a background mirror clone for remote repos.

**Request Body:**
| Field | Type | Required | Description |
|----------------|----------|----------|--------------------------------------|
| `name` | string | yes | Unique repository name (min 1 char) |
| `localPath` | string | no | Path to a local git repository |
| `remoteUrl` | string | no | Remote git URL (HTTPS) |
| `globPatterns` | string[] | no | File inclusion glob patterns |

Either `localPath` or `remoteUrl` must be provided.

**Response:** `201` — [`Repo`](#repo)

---

### `GET /api/repos`

List all registered repositories with their refs, mirror status, and token configuration.

**Response:** `200` — Array of [`Repo`](#repo)

---

### `GET /api/repos/:name`

Get detailed information about a specific repository including indexing stats and refs.

| Parameter | Type   | In   | Description     |
| --------- | ------ | ---- | --------------- |
| `name`    | string | path | Repository name |

**Response:** `200` — [`Repo`](#repo)
**Error:** `404` — Repository not found

---

### `GET /api/repos/:name/git-refs`

List branches and tags from the git mirror.

| Parameter | Type   | In   | Description     |
| --------- | ------ | ---- | --------------- |
| `name`    | string | path | Repository name |

**Response:** `200` — [`GitRefs`](#gitrefs)

```json
{
  "branches": ["main", "develop"],
  "tags": ["v1.0.0", "v1.1.0"]
}
```

---

### `POST /api/repos/:name/refresh-refs`

Fetch latest refs from the remote (via `git fetch --prune`) and return updated branches and tags. Does not trigger indexing.

| Parameter | Type   | In   | Description     |
| --------- | ------ | ---- | --------------- |
| `name`    | string | path | Repository name |

**Response:** `200` — [`GitRefs`](#gitrefs)
**Error:** `404` — Repository not found
**Error:** `500` — Mirror sync failed

---

### `POST /api/repos/:name/sync`

Enqueue indexing for a specific ref. Returns immediately with a job ID.

| Parameter | Type   | In   | Description     |
| --------- | ------ | ---- | --------------- |
| `name`    | string | path | Repository name |

**Request Body:**
| Field | Type | Required | Description |
|-------|--------|----------|----------------------------|
| `ref` | string | yes | Branch or tag to index |

**Response:** `202` — [`SyncResponse`](#syncresponse)

```json
{
  "jobId": "abc-123",
  "repo": "my-lib",
  "ref": "v2.0.0"
}
```

---

### `PATCH /api/repos/:name`

Update repository settings.

| Parameter | Type   | In   | Description     |
| --------- | ------ | ---- | --------------- |
| `name`    | string | path | Repository name |

**Request Body:**
| Field | Type | Required | Description |
|----------------|----------|----------|--------------------------|
| `globPatterns` | string[] | no | File inclusion patterns |

**Response:** `200` — [`Repo`](#repo)

---

### `DELETE /api/repos/:name`

Delete a repository and all its indexed data (cascades). Awaits completion.

| Parameter | Type   | In   | Description     |
| --------- | ------ | ---- | --------------- |
| `name`    | string | path | Repository name |

**Response:** `204` — No content

---

### `DELETE /api/repos/:name/versions/:ref`

Delete a single indexed version/ref. Awaits completion.

| Parameter | Type   | In   | Description     |
| --------- | ------ | ---- | --------------- |
| `name`    | string | path | Repository name |
| `ref`     | string | path | Ref to delete   |

**Response:** `204` — No content

---

## Feature Routes

### `GET /api/search`

Hybrid code search combining BM25 full-text search and vector similarity, merged via Reciprocal Rank Fusion (RRF).

| Parameter | Type   | In    | Required | Description                            |
| --------- | ------ | ----- | -------- | -------------------------------------- |
| `query`   | string | query | yes      | Search query text                      |
| `repo`    | string | query | no       | Filter by repository name              |
| `ref`     | string | query | no       | Filter by ref (supports semver ranges) |
| `limit`   | number | query | no       | Max results (default 20)               |

**Response:** `200` — Array of [`SearchResult`](#searchresult)

---

### `GET /api/repos/:name/refs/:ref/tree`

List all files in an indexed ref. Optional prefix to filter to a subdirectory.

| Parameter | Type   | In    | Required | Description                |
| --------- | ------ | ----- | -------- | -------------------------- |
| `name`    | string | path  | yes      | Repository name            |
| `ref`     | string | path  | yes      | Ref (branch/tag)           |
| `prefix`  | string | query | no       | Filter by directory prefix |

**Response:** `200` — Array of file path strings

---

### `GET /api/repos/:name/refs/:ref/file`

Retrieve the content of a specific file.

| Parameter        | Type    | In    | Required | Description                         |
| ---------------- | ------- | ----- | -------- | ----------------------------------- |
| `name`           | string  | path  | yes      | Repository name                     |
| `ref`            | string  | path  | yes      | Ref (branch/tag)                    |
| `path`           | string  | query | yes      | File path within the repo           |
| `includeSymbols` | boolean | query | no       | Include symbol list with signatures |

**Response:** `200` — [`FileContent`](#filecontent)

---

### `GET /api/repos/:name/refs/:ref/symbols/:symbolName`

Fetch a specific symbol (function, class, interface, etc.) by name with its source code.

| Parameter        | Type    | In    | Required | Description                        |
| ---------------- | ------- | ----- | -------- | ---------------------------------- |
| `name`           | string  | path  | yes      | Repository name                    |
| `ref`            | string  | path  | yes      | Ref (branch/tag)                   |
| `symbolName`     | string  | path  | yes      | Symbol name                        |
| `includeImports` | boolean | query | no       | Show files that import this symbol |

**Response:** `200` — [`SymbolLookup`](#symbollookup)

---

### `GET /api/repos/:name/refs/:ref/find`

Find files or symbols by a glob-style name pattern.

| Parameter | Type   | In    | Required | Description                     |
| --------- | ------ | ----- | -------- | ------------------------------- |
| `name`    | string | path  | yes      | Repository name                 |
| `ref`     | string | path  | yes      | Ref (branch/tag)                |
| `pattern` | string | query | yes      | Search pattern (glob wildcards) |
| `kind`    | string | query | yes      | `"file"` or `"symbol"`          |

**Response:** `200` — Array of [`FindResult`](#findresult)

---

### `GET /api/repos/:name/refs/:ref/references/:symbolName`

Find files that import a given symbol.

| Parameter    | Type   | In   | Required | Description      |
| ------------ | ------ | ---- | -------- | ---------------- |
| `name`       | string | path | yes      | Repository name  |
| `ref`        | string | path | yes      | Ref (branch/tag) |
| `symbolName` | string | path | yes      | Symbol name      |

**Response:** `200` — Array of [`ImportReference`](#importreference)

---

### `POST /api/repos/:name/context`

Build a task-specific context pack from indexed code.

| Parameter | Type   | In   | Required | Description     |
| --------- | ------ | ---- | -------- | --------------- |
| `name`    | string | path | yes      | Repository name |

**Request Body:**
| Field | Type | Required | Description |
|------------|----------|----------|----------------------------------------------------------|
| `strategy` | string | yes | `"explain"`, `"implement"`, `"debug"`, `"recent-changes"` |
| `ref` | string | no | Ref/tag (supports semver constraints) |
| `fromRef` | string | no | Base ref for `recent-changes` strategy |
| `query` | string | no | Guiding query for context gathering |
| `paths` | string[] | no | Specific file paths to focus on |
| `maxTokens`| integer | no | Token budget (must be > 0) |

**Response:** `200` — [`ContextPackResult`](#contextpackresult)

---

## Response Schemas

### Repo

```json
{
  "id": 1,
  "name": "my-lib",
  "localPath": null,
  "remoteUrl": "https://github.com/org/my-lib.git",
  "globPatterns": ["src/**/*.ts"],
  "createdAt": "2025-01-15T10:30:00Z",
  "mirrorStatus": "ready",
  "mirrorError": null,
  "tokenConfigured": true,
  "refs": [
    {
      "ref": "v1.0.0",
      "stage": "ready",
      "commitSha": "abc123",
      "languageStats": null,
      "indexingError": null
    }
  ]
}
```

### RepoRef

```json
{
  "ref": "v1.0.0",
  "stage": "ready",
  "commitSha": "abc123def456...",
  "languageStats": { "typescript": 45.2, "java": 54.8 },
  "indexingError": null
}
```

### IndexingStage

One of: `queued`, `syncing`, `resolving`, `checking-out`, `diffing`, `processing-files`, `embedding`, `finalizing`, `ready`, `error`

### IndexingProgress

```json
{
  "repo": "my-lib",
  "ref": "v1.0.0",
  "stage": "processing-files",
  "message": "Processing file 15 of 42",
  "filesTotal": 42,
  "filesProcessed": 15,
  "chunksTotal": 120,
  "chunksEmbedded": 80,
  "startedAt": "2025-01-15T10:30:00Z",
  "updatedAt": "2025-01-15T10:31:00Z",
  "error": null
}
```

### SyncResponse

```json
{
  "jobId": "abc-123-def",
  "repo": "my-lib",
  "ref": "v2.0.0"
}
```

### GitRefs

```json
{
  "branches": ["main", "develop", "feature/auth"],
  "tags": ["v1.0.0", "v1.1.0", "v2.0.0"]
}
```

### SearchResult

```json
{
  "filePath": "src/auth/login.ts",
  "repo": "my-lib",
  "ref": "v1.0.0",
  "content": "export async function login(username: string, password: string) { ... }",
  "startLine": 15,
  "endLine": 42,
  "score": 0.87,
  "symbolName": "login"
}
```

### FileContent

```json
{
  "repo": "my-lib",
  "ref": "v1.0.0",
  "path": "src/auth/login.ts",
  "content": "import { hash } from ...",
  "symbols": [
    {
      "name": "login",
      "kind": "function",
      "signature": "login(username: string, password: string): Promise<User>",
      "startLine": 15,
      "endLine": 42,
      "documentation": "Authenticate a user"
    }
  ]
}
```

### SymbolInfo

```json
{
  "name": "login",
  "kind": "function",
  "signature": "login(username: string, password: string): Promise<User>",
  "startLine": 15,
  "endLine": 42,
  "documentation": "Authenticate a user"
}
```

### SymbolDetail

```json
{
  "name": "login",
  "kind": "function",
  "filePath": "src/auth/login.ts",
  "startLine": 15,
  "endLine": 42,
  "signature": "login(username: string, password: string): Promise<User>",
  "documentation": "Authenticate a user",
  "fileContentId": 7,
  "source": "export async function login(username: string, password: string): Promise<User> {\n  ...\n}"
}
```

### SymbolLookup

```json
{
  "symbols": [{ "...SymbolDetail" }],
  "imports": [
    { "filePath": "src/routes/auth.ts", "source": "./login", "importedName": "login", "isDefault": false }
  ]
}
```

### ImportReference

```json
{
  "filePath": "src/routes/auth.ts",
  "source": "./login",
  "importedName": "login",
  "isDefault": false
}
```

### FindResult

```json
{
  "path": "src/auth/login.ts",
  "name": "login",
  "kind": "function",
  "filePath": "src/auth/login.ts",
  "startLine": 15,
  "endLine": 42,
  "signature": "login(username: string, password: string): Promise<User>"
}
```

### ContextChunk

```json
{
  "filePath": "src/auth/login.ts",
  "startLine": 1,
  "endLine": 50,
  "content": "// Full file content...",
  "annotation": "Authentication entry point"
}
```

### ContextPackResult

```json
{
  "strategy": "explain",
  "repo": "my-lib",
  "ref": "v1.0.0",
  "totalTokens": 4200,
  "chunks": [{ "...ContextChunk" }],
  "formatted": "## File: src/auth/login.ts (lines 1-50)\n..."
}
```

### ErrorResponse

```json
{
  "error": "Repository not found"
}
```
