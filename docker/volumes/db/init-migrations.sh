#!/bin/bash
# ===================================================================
# App-Migrationen beim ersten DB-Start anwenden
# ===================================================================
# Wird als Teil von docker-entrypoint-initdb.d ausgefuehrt.
# Laeuft NUR beim ersten Start (wenn das Data-Volume leer ist).
# Fuer Updates nach git pull: apply-migrations.sh verwenden.
# ===================================================================

set -e

MIGRATIONS_DIR="/app-migrations"

if [ ! -d "$MIGRATIONS_DIR" ] || [ -z "$(ls -A "$MIGRATIONS_DIR"/*.sql 2>/dev/null)" ]; then
    echo "init-migrations: Keine Migrationen in $MIGRATIONS_DIR gefunden."
    exit 0
fi

echo "init-migrations: Erstelle Migrations-Tracking-Tabelle..."
psql -v ON_ERROR_STOP=0 -U postgres -d postgres <<'SQL'
CREATE TABLE IF NOT EXISTS public._applied_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz DEFAULT now()
);
SQL

echo "init-migrations: Wende App-Migrationen an..."
applied=0
failed=0

for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
    version=$(basename "$f")

    already=$(psql -U postgres -d postgres -tAc \
        "SELECT 1 FROM public._applied_migrations WHERE version = '$version'" 2>/dev/null || echo "")

    if [ "$already" = "1" ]; then
        echo "  SKIP: $version (bereits angewendet)"
        continue
    fi

    echo "  APPLY: $version"
    if psql -v ON_ERROR_STOP=0 -U postgres -d postgres -f "$f" > /dev/null 2>&1; then
        psql -U postgres -d postgres -c \
            "INSERT INTO public._applied_migrations (version) VALUES ('$version') ON CONFLICT DO NOTHING;" \
            > /dev/null 2>&1
        applied=$((applied + 1))
    else
        echo "  WARN: $version hatte Fehler (uebersprungen)"
        failed=$((failed + 1))
    fi
done

echo "init-migrations: Fertig. $applied angewendet, $failed mit Warnungen."
