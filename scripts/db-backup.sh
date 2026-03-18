#!/usr/bin/env bash
# ===================================================================
# Masitcon Ameise – Datenbank Backup & Restore
# ===================================================================
#
# Umgebungen:
#   Entwicklung (lokal)  docker/.env.local   COMPOSE_PROJECT_NAME=ameise-local
#   Production (Server)  docker/.env         COMPOSE_PROJECT_NAME=ameise-production
#
# Backup:    bash scripts/db-backup.sh backup   [--dir <pfad>] [--env <env-file>]
# Restore:   bash scripts/db-backup.sh restore  <backup-pfad>  [--env <env-file>]
# Validate:  bash scripts/db-backup.sh validate [--env <env-file>]
# Info:      bash scripts/db-backup.sh info     <backup-pfad>
#
# Prod→Lokal-Workflow:
#   1. Auf Prod:   bash scripts/db-backup.sh backup --dir /tmp/backup --env docker/.env
#   2. Kopieren:   scp -r prod:/tmp/backup /tmp/backup
#   3. Lokal:      bash scripts/db-backup.sh restore /tmp/backup
# ===================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ─── Farben & Formatierung ────────────────────────────────────────
BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

log()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()   { echo -e "  ${YELLOW}!${NC} $1"; }
err()    { echo -e "  ${RED}✗${NC} $1" >&2; }
info()   { echo -e "  ${CYAN}ℹ${NC} $1"; }
header() { echo -e "\n${BOLD}══ $1 ══${NC}\n"; }
die()    { err "$1"; exit 1; }

# ─── Env-Datei: einzelne Variable lesen (ohne sourcing) ──────────
env_peek() {
    local file="$1" var="$2"
    # || true verhindert Pipeline-Fehler (set -e / pipefail) wenn Variable nicht gesetzt ist
    grep -m1 "^${var}=" "$file" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

env_label() {
    local env_file="$1"
    local proj
    proj=$(env_peek "$env_file" "COMPOSE_PROJECT_NAME")
    [ -z "$proj" ] && proj="?"

    local tier
    case "$proj" in
        *dev*|*local*) tier="Entwicklung" ;;
        *stage*|*staging*) tier="Stage" ;;
        *prod*|*production*) tier="Production" ;;
        *) tier="Server" ;;
    esac

    echo "${tier}  ·  ${proj}"
}

# ─── Compose-Datei anhand der Env-Datei bestimmen ────────────────
get_compose_file() {
    local env_file="$1"
    if [[ "$env_file" == *".env.local"* ]]; then
        echo "docker/docker-compose.local.yml"
    else
        echo "docker/docker-compose.yml"
    fi
}

# ─── Env-Datei laden ─────────────────────────────────────────────
load_env() {
    local env_file="${1:-docker/.env.local}"

    if [ ! -f "$env_file" ]; then
        die "Env-Datei nicht gefunden: $env_file"
    fi

    local compose_file
    compose_file=$(get_compose_file "$env_file")

    COMPOSE_CMD="docker compose -f $compose_file --env-file $env_file"
    DB_NAME=$(env_peek "$env_file" "POSTGRES_DB")
    DB_NAME="${DB_NAME:-postgres}"
    PROJECT=$(env_peek "$env_file" "COMPOSE_PROJECT_NAME")
    PROJECT="${PROJECT:-ameise-local}"

    info "Umgebung: ${PROJECT} (${env_file})"
}

# ─── DB-Verbindung prüfen ─────────────────────────────────────────
check_db() {
    info "Prüfe DB-Verbindung..."
    if ! $COMPOSE_CMD exec -T db pg_isready -U postgres -q 2>/dev/null; then
        die "Datenbank nicht erreichbar. Bitte 'npm run db:start' ausführen."
    fi
    log "Datenbank erreichbar"
}

# ─── psql-Abfrage ────────────────────────────────────────────────
psql_q() {
    $COMPOSE_CMD exec -T db psql -U postgres -tAc "$1" 2>/dev/null
}

# ─── Datei-Größe in Bytes ─────────────────────────────────────────
file_size_bytes() {
    local f="$1"
    stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo "0"
}

# ─── JSON-Feld aus Manifest lesen ───────────────────────────────
manifest_get() {
    local manifest="$1" field="$2"
    python3 -c "
import json, sys
try:
    d = json.load(open('$manifest'))
    v = d.get('$field', '?')
    print(v if not isinstance(v, list) else str(len(v)) + ' Einträge')
except Exception as e:
    print('?')
" 2>/dev/null || echo "?"
}

# ═════════════════════════════════════════════════════════════════
# BACKUP
# ═════════════════════════════════════════════════════════════════
cmd_backup() {
    local backup_dir="" env_file="docker/.env.local"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dir) backup_dir="$2"; shift 2 ;;
            --env) env_file="$2";   shift 2 ;;
            *)     die "Unbekannte Option: $1" ;;
        esac
    done

    load_env "$env_file"

    local timestamp
    timestamp=$(date +%Y-%m-%d_%H%M%S)

    if [ -z "$backup_dir" ]; then
        backup_dir="backups/${timestamp}"
    fi

    header "DB Backup: ${PROJECT}"
    check_db

    mkdir -p "$backup_dir"
    local abs_backup_dir
    abs_backup_dir=$(cd "$backup_dir" && pwd)
    info "Backup-Verzeichnis: ${abs_backup_dir}"

    # ── Datenbank-Dump ───────────────────────────────────────────
    info "Erstelle Datenbank-Dump (custom format, komprimiert)..."

    if $COMPOSE_CMD exec -T db pg_dump \
        -U postgres \
        --format=custom \
        --compress=6 \
        --no-password \
        "$DB_NAME" \
        > "${backup_dir}/db.dump"; then
        local dump_size
        dump_size=$(du -sh "${backup_dir}/db.dump" 2>/dev/null | cut -f1)
        log "Datenbank-Dump OK (${dump_size})"
    else
        rm -f "${backup_dir}/db.dump" 2>/dev/null || true
        die "Datenbank-Dump fehlgeschlagen!"
    fi

    # ── Angewendete Migrationen ──────────────────────────────────
    info "Lese angewendete Migrationen..."
    local migrations_json="[]"

    if psql_q "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='_applied_migrations'" | grep -q "1"; then
        local migrations_raw
        migrations_raw=$(psql_q "SELECT version FROM public._applied_migrations ORDER BY applied_at")
        echo "$migrations_raw" > "${backup_dir}/applied_migrations.txt"

        migrations_json=$(python3 -c "
import sys
lines = [l.strip() for l in open('${backup_dir}/applied_migrations.txt') if l.strip()]
import json; print(json.dumps(lines))
" 2>/dev/null || echo "[]")

        local mig_count
        mig_count=$(grep -c . "${backup_dir}/applied_migrations.txt" 2>/dev/null || echo "0")
        log "${mig_count} Migrationen gesichert"
    else
        warn "Tabelle _applied_migrations nicht gefunden"
        echo "" > "${backup_dir}/applied_migrations.txt"
    fi

    # ── Zeilenanzahlen ───────────────────────────────────────────
    info "Lese Zeilenanzahlen (public-Schema)..."

    local table_counts_json
    table_counts_json=$(python3 -c "
import subprocess, json, sys

def run(sql):
    cmd = '''$COMPOSE_CMD exec -T db psql -U postgres -tAc \"''' + sql + '''\"'''
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.stdout.strip()

tables_raw = run(\"SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\\\\_%' ORDER BY tablename\")
tables = [t for t in tables_raw.splitlines() if t.strip()]

counts = {}
for tbl in tables:
    cnt_raw = run(f\"SELECT COUNT(*) FROM public.\\\"{tbl}\\\"\")
    try:
        counts[tbl] = int(cnt_raw.strip())
    except ValueError:
        counts[tbl] = 0

print(json.dumps(counts))
" 2>/dev/null || echo "{}")

    # Auth & Storage
    local auth_users storage_objects
    auth_users=$(psql_q "SELECT COUNT(*) FROM auth.users" 2>/dev/null | tr -d ' ' || echo "0")
    storage_objects=$(psql_q "SELECT COUNT(*) FROM storage.objects" 2>/dev/null | tr -d ' ' || echo "0")

    # ── Manifest erstellen ───────────────────────────────────────
    info "Erstelle Manifest..."
    local dump_size_bytes
    dump_size_bytes=$(file_size_bytes "${backup_dir}/db.dump")

    python3 -c "
import json
manifest = {
    'timestamp':         '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    'environment':       '${PROJECT}',
    'env_file':          '${env_file}',
    'db_name':           '${DB_NAME}',
    'dump_size_bytes':   ${dump_size_bytes},
    'dump_format':       'custom',
    'auth_users':        int('${auth_users}') if '${auth_users}'.isdigit() else 0,
    'storage_objects':   int('${storage_objects}') if '${storage_objects}'.isdigit() else 0,
    'applied_migrations': json.loads('${migrations_json}'),
    'table_row_counts':  json.loads(r'''${table_counts_json}'''),
}
with open('${backup_dir}/manifest.json', 'w') as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)
print('OK')
" 2>/dev/null && log "Manifest erstellt" || warn "Manifest konnte nicht erstellt werden"

    echo ""
    log "Backup erfolgreich: ${abs_backup_dir}"
    echo ""
    info "Dateien:"
    info "  db.dump                $(du -sh "${backup_dir}/db.dump" | cut -f1)"
    [ -f "${backup_dir}/manifest.json" ]         && info "  manifest.json          $(du -sh "${backup_dir}/manifest.json" | cut -f1)"
    [ -f "${backup_dir}/applied_migrations.txt" ] && info "  applied_migrations.txt"
    echo ""
    info "Tipp: bash scripts/db-backup.sh info ${backup_dir}"
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# INFO
# ═════════════════════════════════════════════════════════════════
cmd_info() {
    local backup_path="${1:-}"

    if [ -z "$backup_path" ]; then
        die "Usage: db-backup.sh info <backup-pfad>"
    fi

    if [ ! -d "$backup_path" ]; then
        die "Verzeichnis nicht gefunden: $backup_path"
    fi

    if [ ! -f "${backup_path}/db.dump" ]; then
        die "db.dump nicht gefunden in: $backup_path"
    fi

    header "Backup-Info: $(cd "$backup_path" && pwd)"

    if [ ! -f "${backup_path}/manifest.json" ]; then
        warn "manifest.json nicht vorhanden – eingeschränkte Anzeige"
        local dump_size
        dump_size=$(du -sh "${backup_path}/db.dump" | cut -f1)
        info "Dump-Größe: ${dump_size}"
        echo ""
        return
    fi

    python3 -c "
import json, sys

with open('${backup_path}/manifest.json') as f:
    d = json.load(f)

def fmt_bytes(b):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if b < 1024:
            return f'{b:.1f} {unit}'
        b /= 1024
    return f'{b:.1f} TB'

print()
print(f\"  {'Zeitstempel:':<26} {d.get('timestamp','?')}\")
print(f\"  {'Umgebung:':<26} {d.get('environment','?')}\")
print(f\"  {'Datenbank:':<26} {d.get('db_name','?')}\")
print(f\"  {'Dump-Format:':<26} {d.get('dump_format','?')}\")
print(f\"  {'Dump-Größe:':<26} {fmt_bytes(d.get('dump_size_bytes',0))}\")
print(f\"  {'Auth-Benutzer:':<26} {d.get('auth_users','?')}\")
print(f\"  {'Storage-Objekte:':<26} {d.get('storage_objects','?')}\")

migs = d.get('applied_migrations', [])
print(f\"  {'Migrationen:':<26} {len(migs)}\")

print()
if migs:
    print('  Angewendete Migrationen:')
    for m in migs:
        print(f'    \033[2m{m}\033[0m')
    print()

counts = d.get('table_row_counts', {})
if counts:
    print('  Tabellen-Zeilenanzahlen (Backup-Zeitpunkt):')
    print(f\"  \033[1m  {'Tabelle':<42} {'Zeilen':>8}\033[0m\")
    print('  ' + '─' * 52)
    total = 0
    for tbl, cnt in sorted(counts.items()):
        total += cnt
        style = '\033[2m' if cnt == 0 else ''
        print(f'  {style}  {tbl:<42} {cnt:>8}\033[0m')
    print('  ' + '─' * 52)
    print(f\"  \033[1m  {'Gesamt (' + str(len(counts)) + ' Tabellen)':<42} {total:>8}\033[0m\")
    print()
" 2>/dev/null || warn "Manifest konnte nicht gelesen werden (Python3 benötigt)"
}

# ═════════════════════════════════════════════════════════════════
# VALIDATE
# ═════════════════════════════════════════════════════════════════
cmd_validate() {
    local env_file="docker/.env.local"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --env) env_file="$2"; shift 2 ;;
            *)     die "Unbekannte Option: $1" ;;
        esac
    done

    load_env "$env_file"

    header "DB Validierung: ${PROJECT}"
    check_db

    local errors=0
    local warnings=0

    # ── Schema: Migrationen-Abgleich ─────────────────────────────
    echo -e "\n${BOLD}Schema-Validierung${NC}"
    echo -e "  $(printf '─%.0s' {1..54})"

    local local_migrations=()
    if ls supabase/migrations/*.sql >/dev/null 2>&1; then
        while IFS= read -r f; do
            local_migrations+=("$(basename "$f")")
        done < <(ls supabase/migrations/*.sql | sort)
    fi

    local applied_migrations=()
    if psql_q "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='_applied_migrations'" | grep -q "1" 2>/dev/null; then
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            applied_migrations+=("$line")
        done < <(psql_q "SELECT version FROM public._applied_migrations ORDER BY applied_at")
    fi

    local local_count=${#local_migrations[@]}
    local applied_count=${#applied_migrations[@]}

    printf "  %-44s %s\n" "Lokale Migration-Dateien:"         "$local_count"
    printf "  %-44s %s\n" "Angewendete Migrationen (DB):"    "$applied_count"

    local missing_in_db=()
    for m in "${local_migrations[@]:-}"; do
        [ -z "$m" ] && continue
        local found=false
        for a in "${applied_migrations[@]:-}"; do
            [ "$m" = "$a" ] && found=true && break
        done
        $found || missing_in_db+=("$m")
    done

    if [ ${#missing_in_db[@]} -gt 0 ]; then
        echo ""
        warn "Nicht angewendete Migrationen (${#missing_in_db[@]}):"
        for m in "${missing_in_db[@]}"; do
            echo -e "    ${YELLOW}→${NC} $m"
        done
        warnings=$((warnings + ${#missing_in_db[@]}))
    else
        log "Alle lokalen Migrationen sind angewendet"
    fi

    local extra_in_db=()
    for a in "${applied_migrations[@]:-}"; do
        [ -z "$a" ] && continue
        local found=false
        for m in "${local_migrations[@]:-}"; do
            [ "$a" = "$m" ] && found=true && break
        done
        $found || extra_in_db+=("$a")
    done

    if [ ${#extra_in_db[@]} -gt 0 ]; then
        echo ""
        warn "In DB vorhanden, aber lokal nicht gefunden (${#extra_in_db[@]}):"
        for a in "${extra_in_db[@]}"; do
            echo -e "    ${YELLOW}→${NC} $a"
        done
        warnings=$((warnings + 1))
    fi

    # ── Inhalts-Validierung ──────────────────────────────────────
    echo -e "\n${BOLD}Inhalts-Validierung${NC}"
    echo -e "  $(printf '─%.0s' {1..54})"

    local tables_raw
    tables_raw=$(psql_q "
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
    " || echo "")

    local total_tables=0
    local empty_tables=0
    local total_rows=0

    echo ""
    printf "  ${BOLD}  %-40s %10s${NC}\n" "Tabelle" "Zeilen"
    printf "  $(printf '─%.0s' {1..54})\n"

    if [ -n "$tables_raw" ]; then
        while IFS= read -r tbl; do
            [ -z "$tbl" ] && continue
            local cnt
            cnt=$(psql_q "SELECT COUNT(*) FROM public.\"${tbl}\"" 2>/dev/null | tr -d ' ' || echo "0")
            [ -z "$cnt" ] && cnt=0

            total_tables=$((total_tables + 1))
            total_rows=$((total_rows + cnt))

            if [ "$cnt" = "0" ]; then
                empty_tables=$((empty_tables + 1))
                printf "  ${DIM}  %-40s %10s${NC}\n" "$tbl" "$cnt"
            else
                printf "    %-40s %10s\n" "$tbl" "$cnt"
            fi
        done <<< "$tables_raw"
    fi

    printf "  $(printf '─%.0s' {1..54})\n"
    printf "  ${BOLD}  %-40s %10s${NC}\n" "Gesamt (${total_tables} Tabellen)" "$total_rows"

    echo ""

    local auth_users auth_sessions storage_objs
    auth_users=$(psql_q    "SELECT COUNT(*) FROM auth.users"    2>/dev/null | tr -d ' ' || echo "n/a")
    auth_sessions=$(psql_q "SELECT COUNT(*) FROM auth.sessions" 2>/dev/null | tr -d ' ' || echo "n/a")
    storage_objs=$(psql_q  "SELECT COUNT(*) FROM storage.objects" 2>/dev/null | tr -d ' ' || echo "n/a")

    printf "    %-40s %10s\n" "auth.users"       "$auth_users"
    printf "    %-40s %10s\n" "auth.sessions"    "$auth_sessions"
    printf "    %-40s %10s\n" "storage.objects"  "$storage_objs"

    echo ""

    if [ "$empty_tables" -gt 0 ]; then
        info "${empty_tables} leere Tabelle(n) ${DIM}(grau markiert)${NC}"
    fi

    # ── Ergebnis ─────────────────────────────────────────────────
    echo -e "\n${BOLD}Ergebnis${NC}"
    echo -e "  $(printf '─%.0s' {1..54})"

    if [ "$errors" -gt 0 ]; then
        err "Validierung FEHLGESCHLAGEN: ${errors} Fehler, ${warnings} Warnungen"
        return 1
    elif [ "$warnings" -gt 0 ]; then
        warn "Validierung mit ${warnings} Warnung(en) abgeschlossen"
    else
        log "Validierung erfolgreich — kein Fehler"
    fi
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# RESTORE
# ═════════════════════════════════════════════════════════════════
cmd_restore() {
    local backup_path="" env_file="docker/.env.local"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --env) env_file="$2"; shift 2 ;;
            -*)    die "Unbekannte Option: $1" ;;
            *)     backup_path="$1"; shift ;;
        esac
    done

    if [ -z "$backup_path" ]; then
        die "Usage: db-backup.sh restore <backup-pfad> [--env <env-file>]"
    fi

    if [ ! -d "$backup_path" ]; then
        die "Backup-Verzeichnis nicht gefunden: $backup_path"
    fi

    if [ ! -f "${backup_path}/db.dump" ]; then
        die "db.dump nicht gefunden in: $backup_path"
    fi

    load_env "$env_file"

    header "DB Restore: ${PROJECT}"

    if [ -f "${backup_path}/manifest.json" ]; then
        local backup_ts backup_env
        backup_ts=$(python3 -c "import json; d=json.load(open('${backup_path}/manifest.json')); print(d.get('timestamp','?'))" 2>/dev/null || echo "?")
        backup_env=$(python3 -c "import json; d=json.load(open('${backup_path}/manifest.json')); print(d.get('environment','?'))" 2>/dev/null || echo "?")

        info "Backup erstellt:   ${backup_ts}"
        info "Backup-Umgebung:   ${backup_env}"
        info "Ziel-Umgebung:     ${PROJECT}"

        if [ "$backup_env" != "$PROJECT" ]; then
            echo ""
            warn "Umgebungs-Wechsel erkannt!"
            warn "  Backup: '${backup_env}'  →  Ziel: '${PROJECT}'"
            warn "  Infrastruktur-Secrets (JWT, Passwörter) bleiben unverändert."
        fi
    else
        warn "Kein manifest.json — Backup ohne Metadaten"
    fi

    local dump_size
    dump_size=$(du -sh "${backup_path}/db.dump" | cut -f1)
    info "Dump-Größe: ${dump_size}"

    echo ""
    echo -e "  ${RED}${BOLD}ACHTUNG: Diese Aktion überschreibt ALLE Daten in '${PROJECT}'!${NC}"
    echo -e "  ${RED}Alle bestehenden Daten werden unwiderruflich ersetzt.${NC}"
    echo ""
    read -rp "  Zur Bestätigung 'RESTORE' eingeben: " confirm_input

    if [ "$confirm_input" != "RESTORE" ]; then
        echo ""
        info "Abgebrochen."
        exit 0
    fi

    echo ""
    check_db

    # ── Aktive Verbindungen trennen ──────────────────────────────
    info "Trenne aktive DB-Verbindungen..."
    psql_q "SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = '${DB_NAME}'
              AND pid <> pg_backend_pid()" >/dev/null || true
    log "Verbindungen getrennt"

    # ── Dump in Container kopieren ───────────────────────────────
    info "Kopiere Dump in Container..."
    local container_name="${PROJECT}-db"

    if ! docker cp "${backup_path}/db.dump" "${container_name}:/tmp/db_restore.dump" 2>/dev/null; then
        die "Konnte db.dump nicht in Container '${container_name}' kopieren. Läuft der Container?"
    fi
    log "Dump kopiert ($(du -sh "${backup_path}/db.dump" | cut -f1))"

    # ── pg_restore ausführen ─────────────────────────────────────
    info "Führe pg_restore aus (das kann einige Minuten dauern)..."

    local restore_exit=0
    $COMPOSE_CMD exec -T db pg_restore \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        --no-comments \
        -U postgres \
        -d "$DB_NAME" \
        /tmp/db_restore.dump \
        2>&1 | while IFS= read -r line; do
            echo -e "    ${DIM}${line}${NC}"
        done || restore_exit=$?

    $COMPOSE_CMD exec -T db rm -f /tmp/db_restore.dump 2>/dev/null || true

    if [ "$restore_exit" -gt 1 ]; then
        die "pg_restore fehlgeschlagen (Exit-Code: ${restore_exit})"
    elif [ "$restore_exit" -eq 1 ]; then
        warn "pg_restore abgeschlossen mit Warnungen (Exit 1 — bei --clean üblich)"
    else
        log "pg_restore erfolgreich"
    fi

    echo ""
    log "Restore abgeschlossen: ${PROJECT}"
    echo ""

    echo -e "  ${CYAN}Starte automatische Validierung...${NC}"
    echo ""
    cmd_validate --env "$env_file"
}

# ═════════════════════════════════════════════════════════════════
# INTERAKTIVER MODUS
# ═════════════════════════════════════════════════════════════════
cmd_menu() {
    clear 2>/dev/null || true
    echo ""
    echo -e "${BOLD}══════════════════════════════════════════${NC}"
    echo -e "${BOLD}   Masitcon Ameise – DB Backup & Restore   ${NC}"
    echo -e "${BOLD}══════════════════════════════════════════${NC}"
    echo ""

    echo -e "  ${BOLD}Umgebung wählen:${NC}"
    echo ""

    local env_options=()
    local env_labels=()

    for candidate in "docker/.env.local" "docker/.env"; do
        [ -f "$candidate" ] || continue
        local lbl
        lbl=$(env_label "$candidate")
        env_options+=("$candidate")
        env_labels+=("${lbl}  ${DIM}(${candidate})${NC}")
    done

    if [ ${#env_options[@]} -eq 0 ]; then
        die "Keine Env-Datei gefunden (docker/.env.local oder docker/.env)."
    fi

    local i=1
    for label in "${env_labels[@]}"; do
        echo -e "    ${CYAN}[$i]${NC} ${label}"
        i=$((i + 1))
    done
    echo -e "    ${CYAN}[a]${NC} Anderen Pfad eingeben"
    echo ""

    local env_choice env_file=""
    read -rp "  Wähle [1-${#env_options[@]}/a]: " env_choice

    case "$env_choice" in
        a|A)
            read -rp "  Pfad zur Env-Datei: " env_file
            if [ ! -f "$env_file" ]; then
                die "Datei nicht gefunden: $env_file"
            fi
            local custom_lbl
            custom_lbl=$(env_label "$env_file")
            info "Umgebung: ${custom_lbl}  (${env_file})"
            ;;
        *)
            local idx=$((env_choice - 1))
            if [ "$idx" -lt 0 ] || [ "$idx" -ge ${#env_options[@]} ] 2>/dev/null; then
                die "Ungültige Auswahl."
            fi
            env_file="${env_options[$idx]}"
            ;;
    esac

    echo ""
    echo -e "  ${BOLD}Was möchtest du tun?${NC}"
    echo ""
    echo -e "    ${CYAN}[1]${NC} Backup erstellen"
    echo -e "    ${CYAN}[2]${NC} Backup wiederherstellen"
    echo -e "    ${CYAN}[3]${NC} Datenbank validieren"
    echo -e "    ${CYAN}[4]${NC} Backup-Info anzeigen"
    echo -e "    ${CYAN}[5]${NC} Beenden"
    echo ""

    local action_choice
    read -rp "  Wähle [1-5]: " action_choice

    echo ""

    case "$action_choice" in
        1)
            local default_dir="backups/$(date +%Y-%m-%d_%H%M%S)"
            echo -e "  ${BOLD}Backup-Verzeichnis:${NC}"
            echo -e "    ${DIM}Standard: ${default_dir}${NC}"
            echo ""
            read -rp "  Verzeichnis eingeben (Enter = Standard): " backup_dir_input
            local backup_dir="${backup_dir_input:-$default_dir}"
            echo ""
            cmd_backup --dir "$backup_dir" --env "$env_file"
            ;;
        2)
            echo -e "  ${BOLD}Backup-Pfad eingeben:${NC}"
            echo ""
            read -rp "  Backup-Verzeichnis: " restore_path
            echo ""
            cmd_restore "$restore_path" --env "$env_file"
            ;;
        3)
            cmd_validate --env "$env_file"
            ;;
        4)
            echo -e "  ${BOLD}Backup-Pfad eingeben:${NC}"
            echo ""
            read -rp "  Backup-Verzeichnis: " info_path
            echo ""
            cmd_info "$info_path"
            ;;
        5)
            info "Beendet."
            exit 0
            ;;
        *)
            die "Ungültige Auswahl: ${action_choice}"
            ;;
    esac
}

# ═════════════════════════════════════════════════════════════════
# USAGE
# ═════════════════════════════════════════════════════════════════
usage() {
    echo ""
    echo -e "${BOLD}Masitcon Ameise – DB Backup & Restore${NC}"
    echo ""
    echo "  Befehle:"
    echo "    backup   [--dir <pfad>] [--env <env-file>]   Backup erstellen"
    echo "    restore  <backup-pfad>  [--env <env-file>]   Backup wiederherstellen"
    echo "    validate [--env <env-file>]                   DB-Zustand validieren"
    echo "    info     <backup-pfad>                        Backup-Inhalt anzeigen"
    echo ""
    echo "  Optionen:"
    echo "    --dir   Zielverzeichnis (Standard: ./backups/YYYY-MM-DD_HHMMSS)"
    echo "    --env   Env-Datei       (Standard: docker/.env.local)"
    echo ""
    echo "  Umgebungen:"
    echo "    Entwicklung   docker/.env.local   (lokal, COMPOSE_PROJECT_NAME=ameise-local)"
    echo "    Production    docker/.env         (Server, COMPOSE_PROJECT_NAME=ameise-production)"
    echo ""
    echo "  Beispiele:"
    echo "    bash scripts/db-backup.sh backup"
    echo "    bash scripts/db-backup.sh backup --dir /mnt/nas/backups/ameise"
    echo "    bash scripts/db-backup.sh info backups/2026-03-17_120000"
    echo "    bash scripts/db-backup.sh restore backups/2026-03-17_120000"
    echo "    bash scripts/db-backup.sh validate --env docker/.env"
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════
COMMAND="${1:-}"
shift || true

case "$COMMAND" in
    backup)        cmd_backup   "$@" ;;
    restore)       cmd_restore  "$@" ;;
    validate)      cmd_validate "$@" ;;
    info)          cmd_info     "$@" ;;
    menu)          cmd_menu ;;
    help|--help|-h) usage ;;
    "")
        if [ -t 0 ]; then
            cmd_menu
        else
            usage
        fi
        ;;
    *) err "Unbekannter Befehl: ${COMMAND}"; usage; exit 1 ;;
esac
