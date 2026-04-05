---
layout: home

hero:
  name: RepoRelay
  text: Code context for LLMs
  tagline: Self-hosted, MCP-native code context engine. Index any Git repo. Keep everything local.
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
  - icon: 🔍
    title: Hybrid Search
    details: BM25 full-text (ParadeDB) + vector similarity (pgvector), fused via Reciprocal Rank Fusion in a single query.
  - icon: 🌳
    title: Deep Code Understanding
    details: tree-sitter parsing extracts symbols, imports, signatures, and doc comments across TypeScript, JavaScript, Python, Go, Java, Kotlin, Rust, C, C++ — plus a custom Markdown parser.
    link: /guide/supported-languages
    linkText: See all languages
  - icon: 🔐
    title: Full-Index + SHA-256 Dedup
    details: Every ref indexes all files via git ls-tree. SHA-256 content addressing skips unchanged files — fast, correct, order-independent.
  - icon: 🤖
    title: MCP-Native
    details: 7 tools, 2 resources, 3 prompts — works with Claude Desktop, Cursor, Windsurf, or any MCP host.
  - icon: 📦
    title: Self-Hosted
    details: Your code stays on your infrastructure. Postgres is the only runtime dependency. Private repos authenticate via env-var tokens.
  - icon: ⚡
    title: Symbol-Aware Chunking
    details: Intelligent splitting that respects function boundaries with overlap windows — never cuts a symbol in half.
---
