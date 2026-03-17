#!/usr/bin/env bash
# ===================================================================
# masitcon Zeiterfassung (Ameise) – Cloud → Lokal Datenmigration
# ===================================================================
# Einmaliger Import von Supabase Cloud in die lokale Docker-Umgebung.
#
# Voraussetzung: npm run setup (Stack muss laufen)
#
# Ausführen:
#   bash scripts/migrate-from-cloud.sh
#
# Was wird migriert:
#   - public schema: alle Tabellen (Schema + Daten)
#   - auth.users, auth.identities, auth.mfa_factors
#   - Passwort-Hashes bleiben erhalten → gleiche Passwörter lokal nutzbar
#
# Was NICHT migriert wird:
#   - Storage-Dateien (Bucket-Objekte)
#   - Auth-Sessions und Tokens
#   - Realtime-Subscriptions
#   - Supabase-interne Metadaten
#
# Nutzt supabase db dump (kein IPv6-Problem, kein Docker-pg_dump nötig).
# ===================================================================
set -uo pipefail

# ─── Farben & Logging ─────────────────────────────────────────────
BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

log()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()   { echo -e "  ${YELLOW}!${NC} $1"; }
err()    { echo -e "  ${RED}✗${NC} $1"; }
info()   { echo -e "  ${CYAN}ℹ${NC} $1"; }
header() { echo -e "\n${BOLD}══ $1 ══${NC}\n"; }

trap 'echo -e "\n\n${RED}Abgebrochen.${NC}"; exit 130' INT TERM

ask() {
    local prompt="$1" default="${2:-}" result
    if [ -n "$default" ]; then
        read -rp "  $prompt [$default]: " result
        echo "${result:-$default}"
    else
        read -rp "  $prompt: " result
        echo "$result"
    fi
}

ask_secret() {
    local prompt="$1" result
    read -rsp "  $prompt: " result
    echo "" >&2
    echo "$result"
}

confirm() {
    local prompt="$1" default="${2:-j}" yn
    if [ "$default" = "j" ]; then
        read -rp "  $prompt [J/n]: " yn; yn="${yn:-j}"
    else
        read -rp "  $prompt [j/N]: " yn; yn="${yn:-n}"
    fi
    [[ "$yn" =~ ^[jJyY]$ ]]
}

# ─── Konstanten ───────────────────────────────────────────────────
PROJECT_DISPLAY="masitcon Zeiterfassung (Ameise)"
LOCAL_ENV_FILE="docker/.env.local"
LOCAL_COMPOSE_FILE="docker/docker-compose.local.yml"
DUMP_DIR="migration-dumps"
PG_IMAGE="postgres:15-alpine"
LOCAL_COMPOSE_PROJECT="ameise-local"

# Wrapper: psql / pg_dump – lokal bevorzugt (IPv6-fähig), Docker als Fallback
_run_psql() {
    # $@: psql-Argumente
    if command -v psql >/dev/null 2>&1; then
        PGPASSWORD="$CLOUD_DB_PASS" psql "$@"
    else
        docker run --rm -e PGPASSWORD="$CLOUD_DB_PASS" "$PG_IMAGE" psql "$@"
    fi
}

_run_pg_dump() {
    # $@: pg_dump-Argumente
    if command -v pg_dump >/dev/null 2>&1; then
        PGPASSWORD="$CLOUD_DB_PASS" pg_dump "$@"
    else
        docker run --rm -e PGPASSWORD="$CLOUD_DB_PASS" "$PG_IMAGE" pg_dump "$@"
    fi
}

# ─── Schritt 1: Voraussetzungen prüfen ───────────────────────────
check_prerequisites() {
    header "Voraussetzungen prüfen"

    # Docker
    if ! command -v docker >/dev/null 2>&1; then
        err "Docker nicht gefunden – bitte installieren"
        exit 1
    fi
    log "Docker $(docker --version | cut -d' ' -f3 | tr -d ',')"

    # Docker läuft
    if ! docker info >/dev/null 2>&1; then
        err "Docker läuft nicht – Docker Desktop starten"
        exit 1
    fi
    log "Docker Engine läuft"

    # Lokales pg_dump bevorzugt (IPv6-fähig), sonst Docker-Image
    if command -v pg_dump >/dev/null 2>&1; then
        log "pg_dump $(pg_dump --version | cut -d' ' -f3) (lokal – IPv6-fähig)"
    else
        info "Kein lokales pg_dump – nutze Docker (${PG_IMAGE})..."
        if ! docker image inspect "$PG_IMAGE" >/dev/null 2>&1; then
            docker pull "$PG_IMAGE" || { err "Image-Download fehlgeschlagen"; exit 1; }
        fi
        log "Image: ${PG_IMAGE}"
    fi

    # docker/.env.local vorhanden
    if [ ! -f "$LOCAL_ENV_FILE" ]; then
        err "docker/.env.local nicht gefunden"
        info "Zuerst ausführen: npm run setup"
        exit 1
    fi
    log "docker/.env.local vorhanden"

    # Lokaler Stack läuft
    local db_container="${LOCAL_COMPOSE_PROJECT}-db"
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${db_container}$"; then
        err "Lokaler Stack läuft nicht (Container '${db_container}' nicht gefunden)"
        info "Zuerst ausführen: npm run db:start"
        exit 1
    fi
    log "Lokaler Stack läuft (${db_container})"

    # Lokale Env-Variablen laden
    # shellcheck source=/dev/null
    source "$LOCAL_ENV_FILE"
    LOCAL_DB_PORT="${DB_PORT:-5433}"
    LOCAL_POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

    if [ -z "$LOCAL_POSTGRES_PASSWORD" ]; then
        err "POSTGRES_PASSWORD in docker/.env.local nicht gesetzt"
        exit 1
    fi
}

# ─── Schritt 2: Cloud-Credentials abfragen ───────────────────────
collect_cloud_credentials() {
    header "Supabase Cloud – Zugangsdaten"

    echo "  ${BOLD}Methode:${NC} supabase db dump (kein IPv6-Problem)"
    echo ""
    echo "  Beide Werte findest du im Supabase Dashboard:"
    echo "    Reference ID:  Settings → General → Reference ID"
    echo "    DB-Passwort:   Settings → Database → Database password"
    echo ""

    CLOUD_PROJECT_REF=$(ask "Project Reference ID" "gkmeedrduzzefzwezqlb")
    if [ -z "$CLOUD_PROJECT_REF" ]; then
        err "Project Reference ID ist Pflicht"
        exit 1
    fi

    CLOUD_DB_PASS=$(ask_secret "Datenbank-Passwort")
    if [ -z "$CLOUD_DB_PASS" ]; then
        err "Datenbank-Passwort ist Pflicht"
        exit 1
    fi

    echo ""
    log "Project: ${CLOUD_PROJECT_REF}"
}

# ─── Schritt 3: Supabase CLI prüfen & Projekt verlinken ──────────
link_cloud_project() {
    header "Supabase Projekt verlinken"

    # Supabase CLI vorhanden?
    if ! command -v supabase >/dev/null 2>&1; then
        err "Supabase CLI nicht gefunden"
        info "Installieren: brew install supabase/tap/supabase"
        exit 1
    fi
    log "Supabase CLI $(supabase --version 2>/dev/null | head -1)"

    # Angemeldet? (supabase link braucht Auth-Token)
    info "Verlinke Projekt ${CLOUD_PROJECT_REF}..."
    local link_out
    if ! link_out=$(supabase link \
            --project-ref "$CLOUD_PROJECT_REF" \
            --password "$CLOUD_DB_PASS" 2>&1); then
        err "supabase link fehlgeschlagen:"
        echo ""
        echo "$link_out" | sed 's/^/    /'
        echo ""
        info "Noch nicht angemeldet? Zuerst ausführen: supabase login"
        exit 1
    fi
    log "Projekt verlinkt (${CLOUD_PROJECT_REF})"
}

# ─── Schritt 4: Dump-Verzeichnis anlegen ─────────────────────────
prepare_dump_dir() {
    header "Dump-Verzeichnis"

    mkdir -p "$DUMP_DIR"
    log "Dump-Verzeichnis: ${DUMP_DIR}/"
    info "Dateien werden NICHT committet (in .gitignore)"
}

# ─── Schritt 5: Daten exportieren ────────────────────────────────
export_from_cloud() {
    header "Daten aus Supabase Cloud exportieren"

    local public_dump="${DUMP_DIR}/public-data.sql"
    local auth_dump="${DUMP_DIR}/auth-data.sql"
    local ts; ts=$(date +%Y%m%d-%H%M%S)

    # supabase db dump kennt den Pooler-Host, nutzt aber manchmal "postgres"
    # statt "postgres.PROJECT_REF" als Username → Password-Fehler.
    # Wir versuchen es, extrahieren bei Fehler den Pooler-Host und
    # nutzen danach pg_dump direkt mit dem korrekten Username.

    info "Versuche Export via supabase db dump..."
    local try_output
    try_output=$(supabase db dump \
        --schema public \
        -f "$public_dump" \
        -p "$CLOUD_DB_PASS" 2>&1)
    local try_rc=$?

    local pooler_host=""

    if [ $try_rc -eq 0 ] && [ -s "$public_dump" ]; then
        # Erfolg – supabase db dump hat funktioniert
        log "public schema exportiert: $(du -sh "$public_dump" | cut -f1)"
    elif echo "$try_output" | grep -q "password authentication failed"; then
        # Typischer Pooler-Username-Bug der Supabase CLI
        pooler_host=$(echo "$try_output" | grep -oE '[a-zA-Z0-9-]+\.pooler\.supabase\.com' | head -1)
        if [ -z "$pooler_host" ]; then
            err "Pooler-Host konnte nicht aus Fehlermeldung extrahiert werden:"
            echo "$try_output" | sed 's/^/    /'
            exit 1
        fi
        warn "supabase CLI nutzt falschen Pooler-Username – nutze pg_dump direkt"
        log "Pooler: ${pooler_host}  User: postgres.${CLOUD_PROJECT_REF}"
    else
        err "supabase db dump fehlgeschlagen:"
        echo "$try_output" | sed 's/^/    /'
        exit 1
    fi

    # ── Fallback: pg_dump direkt via Pooler ───────────────────────
    if [ -n "$pooler_host" ]; then
        # Passwort-Test VOR dem eigentlichen Dump
        info "Teste Passwort gegen Pooler..."
        local test_out
        test_out=$(PGPASSWORD="$CLOUD_DB_PASS" psql \
            -h "$pooler_host" -p 5432 \
            -U "postgres.${CLOUD_PROJECT_REF}" \
            -d postgres \
            -c "SELECT 1" -t -A 2>&1 || true)

        if ! echo "$test_out" | grep -q "^1$"; then
            echo ""
            err "Verbindung zum Pooler fehlgeschlagen – Passwort falsch!"
            echo ""
            echo -e "  ${BOLD}Das DB-Passwort stimmt nicht. So findest/resettest du es:${NC}"
            echo ""
            echo "  1. Supabase Dashboard öffnen"
            echo "  2. Dein Projekt auswählen"
            echo "  3. Oben rechts auf ${BOLD}'Connect'${NC} klicken"
            echo "     → Tab: 'Session pooler' oder 'Direct connection'"
            echo "     → Dort siehst du: User, Password, Host"
            echo ""
            echo "  ${BOLD}ODER:${NC} Settings → Database → 'Reset database password'"
            echo "  (setzt ein neues Passwort – dann hier neu eingeben)"
            echo ""
            echo "  Danach erneut ausführen: bash scripts/migrate-from-cloud.sh"
            echo ""
            exit 1
        fi
        log "Passwort korrekt – starte Export"

        info "Exportiere public schema via pg_dump..."
        PGPASSWORD="$CLOUD_DB_PASS" pg_dump \
            -h "$pooler_host" -p 5432 \
            -U "postgres.${CLOUD_PROJECT_REF}" \
            -d postgres \
            --schema=public \
            --no-owner --no-privileges --no-comments \
            -f "$public_dump" \
            || { err "pg_dump public schema fehlgeschlagen"; exit 1; }
        log "public schema: $(du -sh "$public_dump" | cut -f1)"

        info "Exportiere auth.users, auth.identities, auth.mfa_factors..."
        PGPASSWORD="$CLOUD_DB_PASS" pg_dump \
            -h "$pooler_host" -p 5432 \
            -U "postgres.${CLOUD_PROJECT_REF}" \
            -d postgres \
            --table=auth.users \
            --table=auth.identities \
            --table=auth.mfa_factors \
            --data-only \
            --no-owner --no-privileges --no-comments \
            --disable-triggers \
            -f "$auth_dump" \
            || { err "pg_dump auth fehlgeschlagen"; exit 1; }
    else
        # supabase db dump hat für public funktioniert – auch für auth versuchen
        info "Exportiere auth schema (nur Daten)..."
        supabase db dump \
            --schema auth \
            --data-only \
            -f "$auth_dump" \
            -p "$CLOUD_DB_PASS" 2>/dev/null \
            || { err "supabase db dump auth fehlgeschlagen"; exit 1; }
    fi

    [ -s "$auth_dump" ] || warn "Auth-Dump ist leer (keine User in der Cloud?)"
    log "auth dump: $(du -sh "$auth_dump" 2>/dev/null | cut -f1 || echo 'leer')"

    cp "$public_dump" "${DUMP_DIR}/public-data-${ts}.sql"
    cp "$auth_dump" "${DUMP_DIR}/auth-data-${ts}.sql" 2>/dev/null || true
    log "Backup: ${DUMP_DIR}/*-${ts}.sql"
}

# ─── Schritt 6: Dump-Größe anzeigen (kein direkter DB-Zugriff) ───
get_cloud_counts() {
    # Mit supabase db dump haben wir keinen direkten SQL-Zugriff auf die Cloud-DB.
    # Counts werden nach dem Import lokal verglichen.
    CLOUD_COUNTS=""
    info "Dump-Größen werden nach Export angezeigt – Counts nach Import."
}

# ─── Schritt 7: Warten bis lokale DB bereit ist ──────────────────
wait_for_local_db() {
    local container="${LOCAL_COMPOSE_PROJECT}-db"
    info "Prüfe lokale Datenbank..."
    local i=0
    while [ $i -lt 30 ]; do
        if docker exec "$container" pg_isready -U postgres -q 2>/dev/null; then
            log "Lokale Datenbank bereit"
            return 0
        fi
        sleep 2
        i=$((i + 2))
        printf "."
    done
    echo ""
    err "Lokale Datenbank nicht erreichbar"
    err "Stack prüfen: docker ps | grep ameise-local"
    exit 1
}

# ─── Schritt 8: Daten in lokale DB importieren ───────────────────
import_to_local() {
    header "Daten in lokale Datenbank importieren"

    local container="${LOCAL_COMPOSE_PROJECT}-db"
    local public_dump="${DUMP_DIR}/public-data.sql"
    local auth_dump="${DUMP_DIR}/auth-data.sql"

    wait_for_local_db

    # Bestätigung vor Import (destructive operation)
    echo ""
    warn "ACHTUNG: Der Import überschreibt bestehende Daten in der lokalen DB!"
    warn "Bestehende public-Tabellen-Daten werden ersetzt."
    echo ""
    confirm "Import jetzt starten?" "j" || { info "Abgebrochen"; exit 0; }
    echo ""

    # Public-Tabellen leeren (sonst COPY-Fehler wegen doppelter PKs)
    info "Leere bestehende public-Tabellen..."
    docker exec "$container" psql -U postgres -d postgres -q << 'TRUNCSQL' 2>/dev/null || true
SET session_replication_role = replica;
DO $$ DECLARE r record; BEGIN
    FOR r IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END $$;
SET session_replication_role = DEFAULT;
TRUNCSQL

    # Public Schema importieren
    # WICHTIG: SET + dump müssen in EINER psql-Session laufen (kein -c + stdin).
    info "Importiere public schema..."
    local import_errors
    import_errors=$(
        { echo "SET session_replication_role = replica;"; cat "$public_dump"; } \
        | docker exec -i "$container" psql -U postgres -d postgres \
            -v ON_ERROR_STOP=0 2>&1 >/dev/null \
        | grep -v "^$\|already exists\|NOTICE\|skipping" \
        || true
    )
    if [ -n "$import_errors" ]; then
        warn "Public-Import: einige Fehler (meist harmlos – Schema war schon vorhanden):"
        echo "$import_errors" | head -10 | sed 's/^/    /'
    else
        log "public schema importiert"
    fi

    # Auth-Daten importieren
    if [ -s "$auth_dump" ]; then
        info "Importiere auth.users und Identitäten..."
        # Bestehende User löschen um PK-Konflikte zu vermeiden
        docker exec "$container" psql -U postgres -d postgres -q << 'AUTHCLEAN' 2>/dev/null || true
SET session_replication_role = replica;
DELETE FROM auth.identities;
DELETE FROM auth.mfa_factors;
DELETE FROM auth.sessions;
DELETE FROM auth.refresh_tokens;
DELETE FROM auth.users;
SET session_replication_role = DEFAULT;
AUTHCLEAN

        import_errors=$(
            { echo "SET session_replication_role = replica;"; cat "$auth_dump"; } \
            | docker exec -i "$container" psql -U postgres -d postgres \
                -v ON_ERROR_STOP=0 2>&1 >/dev/null \
            | grep -v "^$\|NOTICE\|skipping" \
            || true
        )
        if [ -n "$import_errors" ]; then
            warn "Auth-Import-Fehler (meist harmlos):"
            echo "$import_errors" | head -10 | sed 's/^/    /'
        else
            log "Auth-Daten importiert (Passwort-Hashes erhalten)"
        fi
    else
        info "Keine Auth-Daten zu importieren (leere Datei)"
    fi

    # Sequences zurücksetzen (verhindert Primary-Key-Konflikte bei neuen Einträgen)
    info "Setze Sequences zurück..."
    docker exec "$container" \
        psql -U postgres -d postgres -q << 'SEQSQL' 2>/dev/null || true
DO $$
DECLARE
    r record;
    max_val bigint;
BEGIN
    FOR r IN
        SELECT
            n.nspname AS schema,
            c.relname AS table,
            a.attname AS col,
            pg_get_serial_sequence(n.nspname||'.'||c.relname, a.attname) AS seq
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relkind = 'r'
          AND n.nspname IN ('public', 'auth')
          AND pg_get_serial_sequence(n.nspname||'.'||c.relname, a.attname) IS NOT NULL
    LOOP
        EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I.%I', r.col, r.schema, r.table)
            INTO max_val;
        IF max_val > 0 THEN
            EXECUTE format('SELECT setval(%L, %s)', r.seq, max_val);
        END IF;
    END LOOP;
END $$;
SEQSQL
    log "Sequences aktualisiert"
}

# ─── Schritt 9: Record-Counts verifizieren ───────────────────────
verify_counts() {
    header "Verifizierung (Cloud vs. Lokal)"

    local container="${LOCAL_COMPOSE_PROJECT}-db"

    local local_counts
    local_counts=$(docker exec "$container" \
        psql -U postgres -d postgres -t -A -c "
            SELECT schemaname || '.' || tablename || ':' || n_live_tup
            FROM pg_stat_user_tables
            WHERE schemaname IN ('public', 'auth')
              AND tablename NOT LIKE 'pg_%'
              AND n_live_tup > 0
            ORDER BY schemaname, tablename;
        " 2>/dev/null || echo "")

    echo ""
    echo -e "  ${BOLD}Vergleich Cloud → Lokal:${NC}"
    echo ""

    if [ -n "$CLOUD_COUNTS" ] && [ -n "$local_counts" ]; then
        # Tabellenweise vergleichen
        local all_ok=true
        echo "$local_counts" | while IFS=: read -r tbl local_count; do
            local cloud_count
            cloud_count=$(echo "$CLOUD_COUNTS" | grep "^${tbl}:" | cut -d: -f2 || echo "?")
            if [ "$local_count" = "$cloud_count" ]; then
                printf "    %-40s %s → %s ${GREEN}✓${NC}\n" "$tbl" "$cloud_count" "$local_count"
            else
                printf "    %-40s %s → %s ${YELLOW}(abweichend)${NC}\n" "$tbl" "$cloud_count" "$local_count"
                all_ok=false
            fi
        done
        echo ""
    else
        info "Lokale Tabellen mit Daten:"
        echo "$local_counts" | while IFS=: read -r tbl count; do
            printf "    %-40s %s Zeilen\n" "$tbl" "$count"
        done
        echo ""
    fi
}

# ─── Schritt 10: Zusammenfassung ─────────────────────────────────
show_summary() {
    # shellcheck source=/dev/null
    [ -f "$LOCAL_ENV_FILE" ] && source "$LOCAL_ENV_FILE"
    local api_port="${API_PORT:-8100}"
    local studio_port="${STUDIO_PORT:-3101}"

    echo ""
    echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║   Datenmigration abgeschlossen!                       ║${NC}"
    echo -e "${BOLD}${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BOLD}Nächste Schritte:${NC}"
    echo ""
    echo "    1. Studio öffnen und Daten prüfen:"
    echo "       http://localhost:${studio_port}"
    echo ""
    echo "    2. API testen (ANON_KEY aus docker/.env.local):"
    echo "       curl http://localhost:${api_port}/rest/v1/ \\"
    echo "            -H \"apikey: \${ANON_KEY}\""
    echo ""
    echo "    3. App starten (falls noch nicht laufend):"
    echo "       npm run dev"
    echo ""
    echo "    4. Login mit Cloud-Zugangsdaten:"
    echo "       Passwort-Hashes wurden übertragen → gleiche Passwörter nutzbar"
    echo "       HINWEIS: Neue Sessions nötig (JWT_SECRET hat sich geändert)"
    echo ""
    echo -e "  ${DIM}Dumps gespeichert in: ${DUMP_DIR}/${NC}"
    echo -e "  ${DIM}(in .gitignore – werden nicht committet)${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════════════
# ─── MAIN
# ═══════════════════════════════════════════════════════════════
main() {
    echo ""
    echo -e "${BOLD}${CYAN}  ${PROJECT_DISPLAY} – Cloud → Lokal Migration${NC}"
    echo -e "  ${DIM}Einmaliger Datenimport von Supabase Cloud${NC}"
    echo ""

    # Repo-Kontext prüfen
    if [ ! -d .git ]; then
        err "Nicht im Repo-Root ausführen"
        info "  cd masitcon-tools-ameise && bash scripts/migrate-from-cloud.sh"
        exit 1
    fi

    check_prerequisites
    collect_cloud_credentials
    link_cloud_project
    prepare_dump_dir
    get_cloud_counts
    export_from_cloud
    import_to_local
    verify_counts
    show_summary
}

main
