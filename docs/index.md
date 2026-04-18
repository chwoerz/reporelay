---
layout: home

hero:
  name: RepoRelay
  text: Code context for LLMs
  tagline: Self-hosted, MCP-native code context engine. <br>Index any number of Git repos — from any host — and make them queryable by your LLM.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why RepoRelay?
      link: /guide/why-reporelay
    - theme: alt
      text: GitHub
      link: https://github.com/chwoerz/reporelay

features:
  - icon: 📂
    title: Unlimited Repositories
    details: Register repos from any Git host — GitHub, GitLab, Bitbucket, Azure DevOps, on-premise, or local paths. Each independently indexed and queryable.
  - icon: 🔍
    title: Hybrid Search
    details: BM25 full-text (ParadeDB) + vector similarity (pgvector), fused via Reciprocal Rank Fusion in a single query. Not git grep — deep semantic search.
  - icon: 🌳
    title: Deep Code Understanding
    details: tree-sitter parsing extracts symbols, imports, signatures, and doc comments across TypeScript, JavaScript, Python, Go, Java, Kotlin, Rust, C, C++ — plus a custom Markdown parser.
    link: /guide/supported-languages
    linkText: See all languages
  - icon: 🏷️
    title: Versioned Snapshots
    details: Every branch and tag is indexed independently. Query a specific version, or use semver ranges like ^1.2, ~3.0, or 2.x — RepoRelay resolves them automatically.
  - icon: 🤖
    title: MCP-Native
    details: 7 tools, 2 resources, 3 prompts — works with Claude Desktop, Cursor, Windsurf, OpenCode, or any MCP host.
  - icon: 🔐
    title: Full-Index + SHA-256 Dedup
    details: Every ref indexes all files via git ls-tree. SHA-256 content addressing skips unchanged files — fast, correct, order-independent.
  - icon: 📦
    title: Self-Hosted
    details: Your code stays on your infrastructure. Postgres is the only runtime dependency. Private repos authenticate via env-var tokens.
  - icon: 🌐
    title: Language Auto-Detection
    details: The MCP proxy detects your project's languages from manifest files and automatically filters results to relevant repos.
    link: /guide/mcp-integration
    linkText: Learn more
  - icon: ⚡
    title: Symbol-Aware Chunking
    details: Intelligent splitting that respects function boundaries with overlap windows — never cuts a symbol in half.
---

## Demo

<p align="center">
  <a href="https://www.youtube.com/watch?v=LBRttRAcL3w">
    <img src="https://img.youtube.com/vi/LBRttRAcL3w/maxresdefault.jpg" alt="RepoRelay demo" width="720">
  </a>
</p>
