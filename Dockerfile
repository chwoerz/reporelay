# ── Base: Node 22 with pnpm + git (needed for simple-git at runtime) ──
FROM node:22-slim AS base
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates python3 make g++ && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable pnpm
WORKDIR /app

# ── Deps: install all dependencies (tree-sitter needs build tools) ──
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Build: compile TypeScript to JavaScript (excludes test files) ──
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
RUN pnpm tsc --project tsconfig.build.json

# ── Production: lean image with compiled JS only ──
FROM base AS prod
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/ ./dist/
COPY package.json drizzle.config.ts openapi.yaml ./
COPY drizzle/ drizzle/

# Default: worker (override via docker-compose `command`)
CMD ["node", "dist/src/worker/index.js"]
