#!/usr/bin/env bash
# Generiert TypeScript-Typen aus der lokalen Docker-DB.
# Usage: npm run db:types
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ENV_FILE="docker/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "Fehler: $ENV_FILE nicht gefunden. Bitte 'npm run setup' ausfuehren."
  exit 1
fi

get_env() {
  grep "^${1}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-
}

PW=$(get_env "POSTGRES_PASSWORD")
PORT=$(get_env "DB_PORT")
PORT="${PORT:-5433}"

if [ -z "$PW" ]; then
  echo "Fehler: POSTGRES_PASSWORD nicht in $ENV_FILE gefunden."
  exit 1
fi

echo "Generiere TypeScript-Typen aus lokaler DB (localhost:${PORT})..."
supabase gen types typescript \
  --db-url "postgresql://postgres:${PW}@localhost:${PORT}/postgres" \
  > src/integrations/supabase/types.ts
echo "Fertig: src/integrations/supabase/types.ts"
