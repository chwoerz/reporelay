
# RepoRelay MCP Proxy

A lightweight local wrapper that:
  1. Detects the host project's languages from the working directory
  2. Connects to a remote RepoRelay MCP server
  3. Exposes a stdio MCP interface to the local IDE / agent
  4. Injects detected languages into every language-aware tool call

## Usage:
```shell
npx reporelay --server https://reporelay.example.com/mcp
```

Or via environment variable:
```shell
REPORELAY_URL=https://reporelay.example.com/mcp npx reporelay
```

[Get Started](https://chwoerz.github.io/reporelay/guide/mcp-integration.html#connecting-clients)

For more details, see the main [RepoRelay Documentation](https://chwoerz.github.io/reporelay).
