<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/banner-light.png">
    <img alt="RepoRelay — Self-hosted, MCP-native code context engine" src="assets/banner-dark.png" width="600">
  </picture>
</p>

<p align="center">
  <a href="#quick-start"><img alt="Quick Start" src="https://img.shields.io/badge/-Quick_Start_%E2%86%92-blue?style=for-the-badge&color=2563eb"></a>
  <a href="https://chwoerz.github.io/reporelay/"><img alt="Documentation" src="https://img.shields.io/badge/-Docs_%E2%86%92-blue?style=for-the-badge&color=8b5cf6"></a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-Native-8b5cf6">
  <img alt="Postgres" src="https://img.shields.io/badge/Postgres-ParadeDB-4169E1?logo=postgresql&logoColor=white">
  <img alt="Tests" src="https://img.shields.io/badge/Tests-passing-22c55e">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue">
</p>

---

**RepoRelay** is a self-hosted code context engine that makes any Git repository — public or private — deeply searchable and contextually available to any LLM. It indexes your repos — code, docs, tests, examples — and exposes the knowledge through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

Point your MCP-capable client (Claude Desktop, Cursor, Windsurf) at RepoRelay, and your LLM instantly gains deep understanding of your entire codebase. Because it's self-hosted, even private repositories stay on your infrastructure.

---

## Highlights

|             | Feature                    | Description                                                                                     |
| :---------- | :------------------------- | :---------------------------------------------------------------------------------------------- |
| **Search**  | Hybrid Search              | BM25 full-text (ParadeDB) + vector similarity (pgvector), fused via Reciprocal Rank Fusion      |
| **Parse**   | Deep Code Understanding    | tree-sitter parsing across 9 languages extracts symbols, imports, signatures, and doc comments  |
| **Index**   | Full-Index + SHA-256 Dedup | Every ref indexes all files via `git ls-tree`; SHA-256 content addressing skips unchanged files |
| **MCP**     | MCP-Native                 | 7 tools, 2 resources, 3 prompts — works with any MCP host                                       |
| **Version** | Semver-Aware               | Query tags with `^1.2`, `~1.0`, or `2.x` — RepoRelay resolves them automatically                |
| **Deploy**  | Self-Hosted                | Your code stays on your infrastructure. Postgres is the only runtime dependency                 |
| **UI**      | REST API + Admin Dashboard | Fastify REST API (18 routes) + Angular 21 admin dashboard                                       |
| **Embed**   | Ollama                     | Ollama with Metal GPU acceleration for fast local embeddings                                    |
| **Chunk**   | Symbol-Aware Chunking      | Respects function boundaries with overlap windows — never cuts a symbol in half                 |

<p align="center">
  <img src="assets/icons/typescript-original.svg" width="38" alt="TypeScript"/>&nbsp;&nbsp;
  <img src="assets/icons/javascript-original.svg" width="38" alt="JavaScript"/>&nbsp;&nbsp;
  <img src="assets/icons/python-original.svg" width="38" alt="Python"/>&nbsp;&nbsp;
  <img src="assets/icons/go-original-wordmark.svg" width="38" alt="Go"/>&nbsp;&nbsp;
  <img src="assets/icons/java-original.svg" width="38" alt="Java"/>&nbsp;&nbsp;
  <img src="assets/icons/kotlin-original.svg" width="38" alt="Kotlin"/>&nbsp;&nbsp;
  <img src="assets/icons/rust-original.svg" width="38" alt="Rust"/>&nbsp;&nbsp;
  <img src="assets/icons/c-original.svg" width="38" alt="C"/>&nbsp;&nbsp;
  <img src="assets/icons/cplusplus-original.svg" width="38" alt="C++"/>&nbsp;&nbsp;
  <img src="assets/icons/markdown-original.svg" width="38" alt="Markdown"/>
</p>

---

## Quick Start

### Prerequisites

| Requirement | Version |
| ----------- | ------- |
| Node.js     | 22+     |
| pnpm        | 9+      |
| Docker      | Latest  |

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

This starts [ParadeDB](https://www.paradedb.com/) (Postgres with pgvector + pg_search).

### 3. Configure environment

```bash
cp .env.example .env
# Defaults work for local development — no edits needed
```

### 4. Start services

```bash
# All-in-one dev script (Postgres + worker + web API)
pnpm dev

# Or individual services
pnpm dev:worker   # Background indexing worker
pnpm dev:mcp      # MCP server (stdio)
pnpm dev:web      # REST API on :3001
pnpm dev:ui       # Angular dashboard on :4200
```

The worker bootstraps the database on first startup (extensions, migrations, BM25 index).

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

# Check status
curl -sS http://localhost:3001/api/repos
```

Or use the admin dashboard at `http://localhost:4200`.

---

## MCP Client Setup

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "reporelay": {
      "command": "npx",
      "args": ["tsx", "src/mcp/main.ts"],
      "env": {
        "DATABASE_URL": "postgresql://reporelay:reporelay@localhost:5432/reporelay",
        "EMBEDDING_PROVIDER": "ollama"
      }
    }
  }
}
```

See the [full documentation](https://chwoerz.github.io/reporelay/guide/mcp-integration) for OpenCode, HTTP transport, and other client configurations.

### Language Auto-Detection

When `MCP_LANGUAGES` is not set, the MCP server automatically detects the host project's language by scanning the working directory for well-known manifest files:

| Manifest File                   | Detected Languages     |
| ------------------------------- | ---------------------- |
| `package.json`, `tsconfig.json` | typescript, javascript |
| `Cargo.toml`                    | rust                   |
| `go.mod`                        | go                     |
| `pyproject.toml`, `setup.py`    | python                 |
| `pom.xml`, `build.gradle(.kts)` | java, kotlin           |
| `CMakeLists.txt`, `Makefile`    | c, cpp                 |

Detected languages are used to filter which repos are served — only repos whose `language_stats` contain a matching language above the threshold are included.

**`MCP_LANGUAGE_THRESHOLD`** (default: `10`) controls the minimum percentage a language must represent in a repo ref's file breakdown. Set to `0` to disable repo filtering entirely.

```json
{
  "mcpServers": {
    "reporelay": {
      "command": "npx",
      "args": ["tsx", "src/mcp/main.ts"],
      "env": {
        "DATABASE_URL": "postgresql://reporelay:reporelay@localhost:5432/reporelay",
        "MCP_LANGUAGE_THRESHOLD": "0"
      }
    }
  }
}
```

---

## Documentation

Full documentation is available at the **[RepoRelay docs site](https://chwoerz.github.io/reporelay/)**, including:

- [Indexing pipeline deep-dive](https://chwoerz.github.io/reporelay/guide/indexing-pipeline)
- [MCP tools, resources & prompts reference](https://chwoerz.github.io/reporelay/reference/mcp-tools)
- [REST API reference (18 endpoints)](https://chwoerz.github.io/reporelay/reference/api)
- [Configuration reference](https://chwoerz.github.io/reporelay/guide/configuration)
- [Database design](https://chwoerz.github.io/reporelay/guide/database-design)
- [Project structure](https://chwoerz.github.io/reporelay/reference/project-structure)
- [Tech stack](https://chwoerz.github.io/reporelay/reference/tech-stack)

---

## Testing

Comprehensive test suite (unit + integration) covering every module.

```bash
pnpm test              # All tests
pnpm test:unit         # Unit tests only
pnpm test:integration  # Integration tests (requires Docker)
pnpm test:watch        # Watch mode
```

Integration tests use real ParadeDB containers via [Testcontainers](https://testcontainers.com/).

---

## Tech Stack

<p align="center">
  <img src="assets/icons/typescript-original.svg" width="34" alt="TypeScript"/>&nbsp;&nbsp;
  <img src="assets/icons/nodejs-original.svg" width="34" alt="Node.js"/>&nbsp;&nbsp;
  <img src="assets/icons/fastify-original.svg" width="34" alt="Fastify"/>&nbsp;&nbsp;
  <img src="assets/icons/postgresql-original.svg" width="34" alt="Postgres"/>&nbsp;&nbsp;
  <img src="assets/icons/angular-original.svg" width="34" alt="Angular"/>&nbsp;&nbsp;
  <img src="assets/icons/docker-original.svg" width="34" alt="Docker"/>
</p>

TypeScript (ESM, strict) / Node.js 22+ / Fastify 5 / Drizzle ORM / ParadeDB (BM25 + pgvector) / pg-boss / tree-sitter / MCP SDK / Angular 21 / Vitest + Testcontainers / Docker

---

## License

[MIT](LICENSE)
