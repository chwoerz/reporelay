# Why RepoRelay?

## The Problem

LLMs don't know your code. They can't see your private repositories, your internal APIs, your team's patterns and conventions. When you ask Claude or GPT about your codebase, they hallucinate function names, invent APIs that don't exist, and miss the context that would make their answers useful.

**Existing solutions have tradeoffs:**

| Approach                              | Problem                                             |
| :------------------------------------ | :-------------------------------------------------- |
| Copy-paste code into chat             | Tedious, limited context window, no search          |
| Cloud-hosted RAG (Cody, Greptile)     | Your source code leaves your infrastructure         |
| IDE-embedded search (Cursor, Copilot) | Only sees open files, no cross-repo search          |
| Manual embeddings                     | High maintenance, no MCP integration, no versioning |

## RepoRelay's Approach

RepoRelay sits between your Git repos and your LLM. It continuously indexes your code — symbols, imports, documentation — and exposes everything through the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

```
Your Repos → RepoRelay (index + search) → MCP → Claude / Cursor / Any MCP Host
```

**What this means in practice:**

```
You:    How does the authentication middleware work in our API?

Claude: Based on the codebase, authentication is handled in
        src/middleware/auth.ts:15 using JWT validation via the
        verifyToken() function. It checks the Authorization header,
        validates the token against the JWT_SECRET env var, and
        attaches the decoded user to req.user. The middleware is
        applied to all /api/* routes in src/web/app.ts:42.
```

Claude didn't guess — it searched your actual indexed code via RepoRelay's MCP tools.

## Comparison with Other Tools

|                                   |       **RepoRelay**        |   **Greptile**   |         **Sourcegraph / Cody**         |      **Cursor**       | **GitHub Copilot** |     **Windsurf**      | **Continue.dev**  |    **OpenCtx**    |
| :-------------------------------- | :------------------------: | :--------------: | :------------------------------------: | :-------------------: | :----------------: | :-------------------: | :---------------: | :---------------: |
| **Self-hosted / air-gapped**      |            Yes             |    No (cloud)    | Partial (self-host available, complex) |      No (cloud)       |     No (cloud)     |      No (cloud)       |        Yes        |        Yes        |
| **MCP-native**                    |            Yes             |        No        |                   No                   |     Consumes MCP      |         No         |     Consumes MCP      |   Consumes MCP    | No (own protocol) |
| **Multi-repo search**             |            Yes             |       Yes        |                  Yes                   | No (single workspace) |  No (single repo)  | No (single workspace) |      Limited      |        Yes        |
| **Multi-version indexing**        |   Yes (branches + tags)    |        No        |           Partial (branches)           |          No           |         No         |          No           |        No         |        No         |
| **Semver resolution**             |    Yes (`^1.2`, `~2.0`)    |        No        |                   No                   |          No           |         No         |          No           |        No         |        No         |
| **Hybrid search (BM25 + vector)** |            Yes             |   Vector only    |           BM25 only (Zoekt)            |      Vector only      |    Vector only     |      Vector only      |    Vector only    |        N/A        |
| **Symbol-aware parsing**          | Yes (tree-sitter, 9 langs) |     Unknown      |         Yes (SCIP, 40+ langs)          |        Limited        |      Limited       |        Limited        |      Limited      |        N/A        |
| **Symbol-aware chunking**         |            Yes             |     Unknown      |            No (line-based)             |        Unknown        |      Unknown       |        Unknown        |        No         |        N/A        |
| **REST API**                      |     Yes (20 endpoints)     |       Yes        |                  Yes                   |          No           |         No         |          No           |        No         |        Yes        |
| **Context strategies**            |         4 built-in         |       Auto       |                  Auto                  |         Auto          |        Auto        |         Auto          |   Configurable    |        N/A        |
| **Embedding provider choice**     |           Ollama           |   Proprietary    |              Proprietary               |      Proprietary      |    Proprietary     |      Proprietary      |   Configurable    |        N/A        |
| **Infrastructure**                |       Postgres only        |    Cloud SaaS    |        Postgres + Redis + more         |      Cloud SaaS       |     Cloud SaaS     |      Cloud SaaS       | None (in-process) | None (in-process) |
| **LLM-agnostic**                  | Yes (context engine only)  | No (bundled LLM) |            No (bundled LLM)            |   No (bundled LLM)    |  No (bundled LLM)  |   No (bundled LLM)    |        Yes        |        Yes        |
| **Open source**                   |            Yes             |        No        |         Partial (Cody is OSS)          |          No           |         No         |          No           |        Yes        |        Yes        |
| **Pricing**                       |            Free            |       Paid       |            Free tier + paid            |   Free tier + paid    |  Free tier + paid  |   Free tier + paid    |       Free        |       Free        |

### Reading the table

- **RepoRelay is a context engine, not an IDE or chat UI.** It focuses exclusively on indexing, searching, and serving code context. It doesn't include an LLM — it connects to any LLM via MCP. This makes it complementary to tools like Cursor or Copilot rather than a direct replacement for their full feature set.
- **Greptile** is the closest comparison: a dedicated code search/RAG service. The key difference is RepoRelay runs on your infrastructure with your choice of embedding model.
- **Sourcegraph/Cody** is a mature code intelligence platform. RepoRelay is smaller and simpler — single Postgres instance vs. a multi-service deployment — but trades language breadth for depth in the languages it supports.
- **Cursor, Copilot, and Windsurf** are AI-powered IDEs/extensions. They include codebase indexing as a feature alongside chat, completion, and editing. RepoRelay doesn't compete with the IDE layer — it provides a richer code context backend that these tools can consume via MCP.
- **Continue.dev** is the closest in spirit: open-source, LLM-agnostic, with context providers. RepoRelay differs by providing a persistent, pre-indexed search backend rather than on-the-fly context gathering.
- **OpenCtx** is Sourcegraph's open context protocol. RepoRelay uses MCP instead, which has broader client adoption.

## Key Differentiators

- **Self-hosted**: Your code never leaves your infrastructure. No cloud API calls for indexing.
- **MCP-native**: Not a custom integration — works with any MCP-capable client out of the box.
- **Version-aware**: Index multiple branches and tags. Query with semver constraints like `^1.2` or `~2.0`.
- **Content-addressable**: SHA-256 dedup means identical files across branches share parsed symbols, chunks, and embeddings automatically.
- **Single dependency**: Just Postgres (via ParadeDB). No Redis, no Elasticsearch, no separate vector DB.
