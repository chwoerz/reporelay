# Admin Dashboard

The Angular 21 admin dashboard provides a full UI for managing repositories and exploring indexed code.

Default: `http://localhost:4200` (proxies `/api` to the Fastify server)

## Views

| View                | Description                                                                                                       |
| :------------------ | :---------------------------------------------------------------------------------------------------------------- |
| **Repo List**       | List repos, inline add form (local or remote), live indexing progress, token indicators                           |
| **Repo Detail**     | Ref table with status, sync with branch/tag picker, repo-level glob patterns, per-ref delete, live progress cards |
| **Search**          | Hybrid code search with syntax highlighting                                                                       |
| **Context Builder** | Build context packs (explain/implement/debug/recent-changes)                                                      |
| **File Browser**    | File tree with filter + file content viewer with line numbers                                                     |
| **Symbol Explorer** | Find files/symbols by pattern, lookup symbol source + imports                                                     |

## Running the Dashboard

```bash
pnpm dev:ui   # Angular dev server on :4200
```

The proxy config (`ui/proxy.conf.json`) forwards `/api` requests to the Fastify backend at `http://localhost:3001`.

::: tip
Make sure the web API (`pnpm dev:web`) is running alongside the dashboard.
:::
