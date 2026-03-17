#!/usr/bin/env bash
# Apply migration(s) without resetting the DB.
#
# Usage:
#   bash scripts/apply-migration.sh                                     # Alle pending Migrationen
#   bash scripts/apply-migration.sh supabase/migrations/TIMESTAMP.sql   # Eine Migration
#   npm run db:apply                                                     # Alle pending
#   npm run db:apply -- supabase/migrations/TIMESTAMP.sql               # Eine Migration
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ENV_FILE="docker/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "Fehler: $ENV_FILE nicht gefunden. Bitte 'npm run setup' ausfuehren."
  exit 1
fi

COMPOSE="docker compose -f docker/docker-compose.local.yml --env-file $ENV_FILE"

# Tracking-Tabelle sicherstellen
ensure_tracking_table() {
  $COMPOSE exec -T db psql -U postgres -c \
    "CREATE TABLE IF NOT EXISTS public._applied_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now());" \
    > /dev/null 2>&1
}

if [ -n "${1:-}" ]; then
  # ── Einzelne Migration ──────────────────────────────────────────
  MIGRATION_FILE="$1"

  if [ ! -f "$MIGRATION_FILE" ]; then
    echo "Migration file not found: $MIGRATION_FILE"
    exit 1
  fi

  FILENAME=$(basename "$MIGRATION_FILE")
  ensure_tracking_table

  echo "Applying migration: $MIGRATION_FILE"
  $COMPOSE exec -T db psql -U postgres -v ON_ERROR_STOP=1 -f "/app-migrations/${FILENAME}"
  $COMPOSE exec -T db psql -U postgres -c \
    "INSERT INTO public._applied_migrations (version) VALUES ('${FILENAME}') ON CONFLICT DO NOTHING;" \
    > /dev/null
  echo "Done."

else
  # ── Alle pending Migrationen ────────────────────────────────────
  MIGRATIONS_DIR="supabase/migrations"

  if [ ! -d "$MIGRATIONS_DIR" ] || [ -z "$(ls -A "$MIGRATIONS_DIR"/*.sql 2>/dev/null)" ]; then
    echo "Keine Migrationen in $MIGRATIONS_DIR gefunden."
    exit 0
  fi

  ensure_tracking_table

  applied=0
  skipped=0

  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -f "$f" ] || continue
    version=$(basename "$f")

    already=$($COMPOSE exec -T db psql -U postgres -tAc \
      "SELECT 1 FROM public._applied_migrations WHERE version = '${version}'" \
      2>/dev/null | tr -d '[:space:]')

    if [ "$already" = "1" ]; then
      echo "  SKIP:  $version"
      skipped=$((skipped + 1))
      continue
    fi

    echo "  APPLY: $version"
    $COMPOSE exec -T db psql -U postgres -v ON_ERROR_STOP=1 -f "/app-migrations/${version}"
    $COMPOSE exec -T db psql -U postgres -c \
      "INSERT INTO public._applied_migrations (version) VALUES ('${version}') ON CONFLICT DO NOTHING;" \
      > /dev/null
    applied=$((applied + 1))
  done

  echo "Fertig: $applied angewendet, $skipped bereits vorhanden."
fi
