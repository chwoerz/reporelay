# ── Build: Angular production build ──
FROM node:22-slim AS build
RUN corepack enable pnpm
WORKDIR /app/ui
COPY ui/package.json ui/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY ui/tsconfig.json ui/tsconfig.app.json ui/angular.json ./
COPY ui/src/ src/
COPY ui/public/ public/
# Generated API types used by the UI via @api/* path alias (→ ../src/generated/types/*)
COPY src/generated/types/ /app/src/generated/types/
RUN npx ng build --configuration=production

# ── Serve: nginx with SPA + API proxy ──
FROM nginx:alpine AS serve
COPY --from=build /app/ui/dist/ui/browser/ /usr/share/nginx/html/
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
