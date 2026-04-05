# ── Base: Node 22 with pnpm + git (needed for simple-git at runtime) ──
FROM node:22-slim AS base
RUN apt-get update && \
    apt-get install -y --no-install-recommends git python3 make g++ && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable pnpm
WORKDIR /app

# ── Deps: install production + dev dependencies (tree-sitter needs build tools) ──
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── App: copy source + migrations ──
FROM base AS app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts ./
COPY src/ src/
COPY drizzle/ drizzle/

# Default: worker (override via docker-compose `command`)
CMD ["pnpm", "tsx", "src/worker/index.ts"]

