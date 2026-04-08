# ── Build base: Node 22 with pnpm + native build tools (tree-sitter needs node-gyp) ──
FROM node:22-slim AS build-base
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates python3 make g++ && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable pnpm
WORKDIR /app

# ── Deps: install all dependencies (devDependencies needed for tsc) ──
FROM build-base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Prod deps: production-only node_modules (no devDependencies) ──
FROM build-base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ── Build: compile TypeScript to JavaScript (excludes test files) ──
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
RUN pnpm tsc --project tsconfig.build.json

# ── Production: lean image with compiled JS only (no build tools) ──
FROM node:22-slim AS prod
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/ ./dist/
COPY package.json drizzle.config.ts openapi.yaml ./
COPY drizzle/ drizzle/

# Run as non-root user for security
RUN groupadd -r reporelay && useradd -r -g reporelay -m -d /home/reporelay reporelay && \
    chown -R reporelay:reporelay /app
USER reporelay

# Default: worker (override via docker-compose `command`)
CMD ["node", "dist/src/worker/index.js"]
