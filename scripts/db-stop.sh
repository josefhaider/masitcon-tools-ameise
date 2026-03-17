#!/usr/bin/env bash
# Stoppt den Supabase-Stack (Daten bleiben erhalten).
# Usage: npm run db:stop
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ENV_FILE="docker/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "Fehler: $ENV_FILE nicht gefunden."
  exit 1
fi

echo "Stoppe Supabase-Stack..."
docker compose -f docker/docker-compose.local.yml --env-file "$ENV_FILE" down
echo "Fertig. Daten bleiben in den Volumes erhalten."
