#!/usr/bin/env bash
# Loescht alle DB-Volumes und startet neu (Migrationen werden auto-angewendet).
# Usage: npm run db:reset
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ENV_FILE="docker/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "Fehler: $ENV_FILE nicht gefunden. Bitte 'npm run setup' ausfuehren."
  exit 1
fi

echo "WARNUNG: Alle Daten werden geloescht!"
echo "Migrationen werden danach automatisch neu angewendet."
echo ""
read -rp "Bist du sicher? [j/N]: " confirm
if [[ ! "$confirm" =~ ^[jJyY]$ ]]; then
  echo "Abgebrochen."
  exit 0
fi
echo ""
docker compose -f docker/docker-compose.local.yml --env-file "$ENV_FILE" down -v
bash "$SCRIPT_DIR/db-start.sh"
bash "$SCRIPT_DIR/apply-migration.sh"
