#!/usr/bin/env bash
# Startet den Supabase-Stack via Docker Compose (ohne app-Container).
# Usage: npm run db:start
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
NC="\033[0m"

log()   { echo -e "${GREEN}[DB]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

ENV_FILE="docker/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  error "$ENV_FILE nicht gefunden. Bitte 'npm run setup' ausfuehren."
fi

log "Starte Supabase-Stack (Docker Compose)..."
log "Warte auf Healthchecks (Studio kann ~30s benoetigen)..."

docker compose \
  -f docker/docker-compose.local.yml \
  --env-file "$ENV_FILE" \
  up -d db kong rest auth storage meta studio inbucket \
  --wait

log "Supabase-Stack gestartet."
API_PORT=$(grep "^API_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
STUDIO_PORT=$(grep "^STUDIO_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
INBUCKET_PORT=$(grep "^INBUCKET_WEB_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
API_PORT="${API_PORT:-8100}"
STUDIO_PORT="${STUDIO_PORT:-3101}"
INBUCKET_PORT="${INBUCKET_PORT:-9000}"
log "  Kong API:     http://localhost:${API_PORT}"
log "  Studio:       http://localhost:${STUDIO_PORT}"
log "  Inbucket:     http://localhost:${INBUCKET_PORT}"
