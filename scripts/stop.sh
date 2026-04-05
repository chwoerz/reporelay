#!/usr/bin/env bash
# scripts/stop.sh — Stop all Docker containers and local dev processes.
#
# Usage:
#   ./scripts/stop.sh           Stop containers (keep volumes)
#   ./scripts/stop.sh --clean   Stop containers and remove volumes
set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}Stopping Docker containers…${NC}"

if [[ "${1:-}" == "--clean" ]]; then
  docker compose down -v
  echo -e "${GREEN}Containers stopped and volumes removed.${NC}"
else
  docker compose down
  echo -e "${GREEN}Containers stopped (volumes preserved).${NC}"
fi

# Kill any lingering local dev processes
echo -e "${CYAN}Stopping local dev processes…${NC}"
pkill -f "tsx.*src/worker/index.ts" 2>/dev/null || true
pkill -f "tsx.*src/web/main.ts" 2>/dev/null || true
pkill -f "tsx.*src/mcp/main.ts" 2>/dev/null || true
pkill -f "ng serve" 2>/dev/null || true

echo -e "${GREEN}Done.${NC}"
