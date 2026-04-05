#!/usr/bin/env bash
# scripts/dev.sh — Start all services for local development.
#
# Usage:
#   ./scripts/dev.sh          Start Postgres + worker + web
#   ./scripts/dev.sh --down   Stop everything
set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

if [[ "${1:-}" == "--down" ]]; then
  echo -e "${CYAN}Stopping services…${NC}"
  docker compose down
  pkill -f "tsx.*src/worker/index.ts" 2>/dev/null || true
  pkill -f "tsx.*src/web/main.ts" 2>/dev/null || true
  pkill -f "tsx.*src/mcp/main.ts" 2>/dev/null || true
  pkill -f "ng serve" 2>/dev/null || true
  echo -e "${GREEN}Done.${NC}"
  exit 0
fi

# ── 1. Postgres ──
echo -e "${CYAN}Starting Postgres (ParadeDB)…${NC}"
docker compose up -d postgres
echo -n "Waiting for Postgres to be healthy "
until docker compose exec -T postgres pg_isready -U reporelay -d reporelay >/dev/null 2>&1; do
  echo -n "."
  sleep 1
done
echo -e " ${GREEN}ready${NC}"

# ── 2. .env ──
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo -e "${CYAN}Created .env from .env.example${NC}"
fi

# ── 3. Read MCP transport config from .env ──
MCP_TRANSPORT=$(grep -E '^MCP_TRANSPORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
MCP_TRANSPORT="${MCP_TRANSPORT:-stdio}"
MCP_SERVER_PORT=$(grep -E '^MCP_SERVER_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
MCP_SERVER_PORT="${MCP_SERVER_PORT:-3000}"

# ── 4. Log files ──
LOG_DIR=".reporelay/logs"
mkdir -p "$LOG_DIR"
WORKER_LOG="$LOG_DIR/worker.log"
WEB_LOG="$LOG_DIR/web.log"

# ── 5. Worker ──
echo -e "${CYAN}Starting worker…${NC}"
npx tsx --env-file=.env src/worker/index.ts > "$WORKER_LOG" 2>&1 &
WORKER_PID=$!

# ── 6. Web ──
echo -e "${CYAN}Starting web server…${NC}"
npx tsx --env-file=.env src/web/main.ts > "$WEB_LOG" 2>&1 &
WEB_PID=$!

# ── 7. MCP Server (HTTP mode only) ──
MCP_PID=""
if [[ "$MCP_TRANSPORT" == "http" ]]; then
  MCP_LOG="$LOG_DIR/mcp.log"
  echo -e "${CYAN}Starting MCP server (HTTP on port $MCP_SERVER_PORT)…${NC}"
  npx tsx --env-file=.env src/mcp/main.ts > "$MCP_LOG" 2>&1 &
  MCP_PID=$!
fi

# ── 8. UI ──
UI_LOG="$LOG_DIR/ui.log"
echo -e "${CYAN}Starting Angular UI…${NC}"
(cd ui && npx ng serve --port 4200) > "$UI_LOG" 2>&1 &
UI_PID=$!

# ── 9. Trap signals ──
cleanup() {
  echo ""
  echo -e "${CYAN}Shutting down…${NC}"
  kill "$WORKER_PID" "$WEB_PID" "$UI_PID" 2>/dev/null || true
  if [[ -n "$MCP_PID" ]]; then
    kill "$MCP_PID" 2>/dev/null || true
  fi
  pkill -f "tsx.*src/worker/index.ts" 2>/dev/null || true
  pkill -f "tsx.*src/web/main.ts" 2>/dev/null || true
  pkill -f "tsx.*src/mcp/main.ts" 2>/dev/null || true
  pkill -f "ng serve" 2>/dev/null || true
  wait 2>/dev/null || true
  echo -e "${GREEN}All services stopped.${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# Wait for web server to be ready before printing the banner
echo -n "Waiting for API to start "
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then
    echo -e " ${GREEN}ready${NC}"
    break
  fi
  echo -n "."
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo -e " ${RED}timed out${NC}"
  fi
done

# Wait for MCP server (HTTP mode only)
if [[ "$MCP_TRANSPORT" == "http" ]]; then
  echo -n "Waiting for MCP server to start "
  for i in $(seq 1 30); do
    if curl -sf "http://localhost:${MCP_SERVER_PORT}/health" >/dev/null 2>&1; then
      echo -e " ${GREEN}ready${NC}"
      break
    fi
    echo -n "."
    sleep 1
    if [ "$i" -eq 30 ]; then
      echo -e " ${RED}timed out (check $MCP_LOG)${NC}"
    fi
  done
fi

# Wait for Angular dev server
echo -n "Waiting for UI to start "
for i in $(seq 1 60); do
  if curl -sf http://localhost:4200 >/dev/null 2>&1; then
    echo -e " ${GREEN}ready${NC}"
    break
  fi
  echo -n "."
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo -e " ${RED}timed out (check $UI_LOG)${NC}"
  fi
done

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  RepoRelay is running${NC}"
echo -e "  UI:       ${CYAN}http://localhost:4200${NC}"
echo -e "  Web API:  ${CYAN}http://localhost:3001${NC}"
echo -e "  Health:   ${CYAN}http://localhost:3001/health${NC}"
if [[ "$MCP_TRANSPORT" == "http" ]]; then
echo -e "  MCP:      ${CYAN}http://localhost:${MCP_SERVER_PORT}/mcp${NC}"
fi
echo -e "  Logs:     ${CYAN}$LOG_DIR/${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Press ${RED}Ctrl+C${NC} to stop"
echo ""

# Keep the script alive until all background processes exit.
# Uses a sleep loop instead of `wait -n` for bash 3.2 compatibility (macOS).
while true; do
  ALIVE=false
  kill -0 "$WORKER_PID" 2>/dev/null && ALIVE=true
  kill -0 "$WEB_PID" 2>/dev/null && ALIVE=true
  kill -0 "$UI_PID" 2>/dev/null && ALIVE=true
  if [[ -n "$MCP_PID" ]]; then
    kill -0 "$MCP_PID" 2>/dev/null && ALIVE=true
  fi

  if ! $ALIVE; then
    break
  fi
  sleep 1
done

echo -e "${RED}All processes exited unexpectedly.${NC}"
cleanup

