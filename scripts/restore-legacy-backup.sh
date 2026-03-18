#!/usr/bin/env bash
# ===================================================================
# Masitcon Ameise – Legacy Backup Restore
# ===================================================================
#
# Stellt ein rohes pg_dump-SQL-Backup selektiv wieder her.
# Nur Nutzerdaten und Anwendungsdaten werden eingespielt;
# die Supabase-Infrastruktur (JWT-Secrets, System-Schemas) bleibt erhalten.
#
# HINWEIS: Das .dump-Format (pg_dump v1.16 / PG17) kann vom PG15-Container
#          NICHT gelesen werden. Bitte ausschliesslich .sql-Dateien verwenden.
#
# Was wird wiederhergestellt:
#   auth.users, auth.identities   Nutzerdaten inkl. Passwort-Hashes
#   public.*                      Alle Anwendungstabellen
#
# Was NICHT wiederhergestellt wird (bleibt der laufenden Instanz):
#   auth.sessions / refresh_tokens  veraltete Sessions; Nutzer loggen sich neu ein
#   supabase_migrations.*           Supabase-interne Infrastruktur-Migrationen
#   storage.*, realtime.*           Supabase-System-Schemas
#
# Befehle:
#   analyze  <backup.sql>                        Backup analysieren (ohne DB-Zugriff)
#   restore  <backup.sql> [Optionen]             Backup einspielen
#   help                                         Hilfe anzeigen
#
# Optionen (nur restore):
#   --env <datei>     Env-Datei (Standard: docker/.env.local)
#   --force           Keine Rueckfrage, direkt einspielen (CI/CD)
#   --skip-safety     Kein Safety-Backup vor dem Restore
#   --skip-auth       Auth-Nutzer (auth.users/identities) NICHT ersetzen
#
# Workflow (lokal -> staging -> production):
#   1. Lokal testen:
#      bash scripts/restore-legacy-backup.sh analyze Backup/postgres_2026-3-18_1-5-6.sql
#      bash scripts/restore-legacy-backup.sh restore Backup/postgres_2026-3-18_1-5-6.sql
#
#   2. Staging (auf dem Staging-Server):
#      scp Backup/postgres_2026-3-18_1-5-6.sql user@staging:/opt/ameise-staging/backup.sql
#      ssh user@staging "cd /opt/ameise-staging/app && \
#        bash scripts/restore-legacy-backup.sh restore /opt/ameise-staging/backup.sql \
#        --env docker/.env.staging"
#
#   3. Produktion (auf dem Prod-Server):
#      scp Backup/postgres_2026-3-18_1-5-6.sql user@prod:/opt/ameise-production/backup.sql
#      ssh user@prod "cd /opt/ameise-production/app && \
#        bash scripts/restore-legacy-backup.sh restore /opt/ameise-production/backup.sql \
#        --env docker/.env"
# ===================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ─── Farben & Formatierung ────────────────────────────────────────
BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

log()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()   { echo -e "  ${YELLOW}!${NC} $1"; }
err()    { echo -e "  ${RED}✗${NC} $1" >&2; }
info()   { echo -e "  ${CYAN}ℹ${NC} $1"; }
header() { echo -e "\n${BOLD}══ $1 ══${NC}\n"; }
die()    { err "$1"; exit 1; }

# ─── Temp-Verzeichnis beim Skriptstart anlegen ───────────────────
# Wichtig: im Parent-Shell anlegen, NICHT lazy in einer Subshell.
# make_tmpfile() wird via $() aufgerufen (Subshell), die Subshell
# erbt TMPDIR_RESTORE und legt Dateien im bestehenden Verzeichnis ab.
# Die Subshell setzt KEINE eigene Trap -> Verzeichnis bleibt erhalten
# bis der Parent-Shell beendet wird und seine EXIT-Trap auslöst.
TMPDIR_RESTORE="$(mktemp -d /tmp/ameise-restore-XXXXXX)"
# shellcheck disable=SC2064
trap "rm -rf '$TMPDIR_RESTORE'" EXIT

make_tmpfile() {
    # macOS mktemp: X-Sequenz muss am Ende des Templates stehen
    mktemp "${TMPDIR_RESTORE}/tmpXXXXXX"
}

# ─── Env-Variable aus Datei lesen (ohne sourcing) ────────────────
env_peek() {
    local file="$1" var="$2"
    # || true verhindert Pipeline-Fehler (set -e / pipefail) wenn Variable nicht gesetzt ist
    grep -m1 "^${var}=" "$file" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true
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

# ─── Env laden ───────────────────────────────────────────────────
load_env() {
    local env_file="${1:-docker/.env.local}"

    [ -f "$env_file" ] || die "Env-Datei nicht gefunden: $env_file"

    COMPOSE_FILE=$(get_compose_file "$env_file")
    COMPOSE_CMD="docker compose -f $COMPOSE_FILE --env-file $env_file"
    DB_NAME=$(env_peek "$env_file" "POSTGRES_DB")
    DB_NAME="${DB_NAME:-postgres}"
    PROJECT=$(env_peek "$env_file" "COMPOSE_PROJECT_NAME")
    PROJECT="${PROJECT:-ameise-local}"

    info "Umgebung: ${PROJECT}  (${env_file})"
}

# ─── DB-Verbindung prüfen ─────────────────────────────────────────
check_db() {
    info "Prüfe DB-Verbindung..."
    if ! $COMPOSE_CMD exec -T db pg_isready -U postgres -q 2>/dev/null; then
        die "Datenbank nicht erreichbar. Bitte erst 'npm run db:start' ausfuehren."
    fi
    log "Datenbank erreichbar"
}

# ─── psql-Abfrage (einzelne SQL-Zeile, gibt Text zurück) ─────────
psql_q() {
    $COMPOSE_CMD exec -T db psql -U postgres -tAc "$1" 2>/dev/null
}

# ─── SQL-Datei an psql übergeben (Rückgabe: Fehlerausgabe) ────────
psql_file() {
    local file="$1"
    $COMPOSE_CMD exec -T db psql -U postgres -d "$DB_NAME" -q -v ON_ERROR_STOP=0 < "$file" 2>&1 || true
}

# ─── Tabellen, die NIE aus dem Backup eingespielt werden ──────────
declare -a BASE_SKIP_TABLES=(
    "auth.audit_log_entries"
    "auth.flow_state"
    "auth.instances"
    "auth.mfa_amr_claims"
    "auth.mfa_challenges"
    "auth.mfa_factors"
    "auth.oauth_authorizations"
    "auth.oauth_client_states"
    "auth.oauth_clients"
    "auth.oauth_consents"
    "auth.one_time_tokens"
    "auth.refresh_tokens"
    "auth.saml_providers"
    "auth.saml_relay_states"
    "auth.schema_migrations"
    "auth.sessions"
    "auth.sso_domains"
    "auth.sso_providers"
)

# ═════════════════════════════════════════════════════════════════
# Python-Hilfsfunktion: COPY-Blöcke zeilenweise aus SQL-Datei lesen
# ─────────────────────────────────────────────────────────────────
# Liefert ein dict: table_name -> list_of_lines (ohne Header + ohne \.)
# Robust gegen leere COPY-Blöcke und komplexe JSONB-Daten.
# ─────────────────────────────────────────────────────────────────
# Wird in ALLEN Python-Hilfsskripten verwendet (copy_blocks).
# ═════════════════════════════════════════════════════════════════

# ═════════════════════════════════════════════════════════════════
# Python-Hilfsskript: Backup-Datei analysieren
# ─────────────────────────────────────────────
# Aufruf: _py_analyze <sql_file>
# Ausgabe: Formatierte Analyse auf stdout
# ═════════════════════════════════════════════════════════════════
_py_analyze() {
    python3 - "$1" << 'PYEOF'
import sys
import re
import os
from collections import OrderedDict

sql_file = sys.argv[1]

SKIP = {
    'auth.audit_log_entries','auth.flow_state','auth.instances',
    'auth.mfa_amr_claims','auth.mfa_challenges','auth.mfa_factors',
    'auth.oauth_authorizations','auth.oauth_client_states','auth.oauth_clients',
    'auth.oauth_consents','auth.one_time_tokens','auth.refresh_tokens',
    'auth.saml_providers','auth.saml_relay_states','auth.schema_migrations',
    'auth.sessions','auth.sso_domains','auth.sso_providers',
}

BOLD  = "\033[1m"
DIM   = "\033[2m"
GREEN = "\033[0;32m"
NC    = "\033[0m"

size_bytes = os.path.getsize(sql_file)

def fmt_bytes(b):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"

# Metadaten aus pg_dump-Header
pg_version = "?"
dump_version = "?"
with open(sql_file, encoding='utf-8', errors='replace') as f:
    for i, line in enumerate(f):
        if i > 20:
            break
        m = re.search(r'Dumped from database version (\S+)', line)
        if m:
            pg_version = m.group(1)
        m = re.search(r'Dumped by pg_dump version (\S+)', line)
        if m:
            dump_version = m.group(1)

# ── Zeilenweise COPY-Block-Parser (robust gegen leere Blöcke) ────
# Kein Regex-Greedy-Problem, korrekt für 0-Zeilen-Blöcke.
counts    = OrderedDict()   # table -> row count
col_map   = {}              # table -> list of column names
copy_rows = {}              # table -> list of raw data rows (for auth.users, time_entries)

current      = None
current_cols = None

with open(sql_file, encoding='utf-8', errors='replace') as f:
    for raw_line in f:
        line = raw_line.rstrip('\n')
        if current is None:
            m = re.match(r'^COPY ([\w.]+) [(]([^)]+)[)] FROM stdin;$', line)
            if m:
                current      = m.group(1)
                current_cols = [c.strip() for c in m.group(2).split(',')]
                counts[current]    = 0
                col_map[current]   = current_cols
                copy_rows[current] = []
        else:
            if line == '\\.':
                current      = None
                current_cols = None
            else:
                counts[current] += 1
                copy_rows[current].append(line)

# Auth-Nutzer extrahieren
users = []
user_cols = col_map.get('auth.users', [])
email_idx = user_cols.index('email') if 'email' in user_cols else -1
for row in copy_rows.get('auth.users', []):
    fields = row.split('\t')
    email = fields[email_idx] if email_idx >= 0 and len(fields) > email_idx else '?'
    users.append(email)

# Zeiteinträge: Datumsbereich
date_range = None
te_cols = col_map.get('public.time_entries', [])
date_idx = te_cols.index('date') if 'date' in te_cols else -1
dates = []
for row in copy_rows.get('public.time_entries', []):
    fields = row.split('\t')
    if date_idx >= 0 and len(fields) > date_idx:
        d = fields[date_idx].strip()
        if re.match(r'\d{4}-\d{2}-\d{2}', d):
            dates.append(d)
if dates:
    date_range = f"{min(dates)}  ->  {max(dates)}"

# Ausgabe
print(f"  {BOLD}{'Quelldatenbank:':<28}{NC} PostgreSQL {pg_version}")
print(f"  {BOLD}{'Erstellt mit pg_dump:':<28}{NC} Version {dump_version}")
print(f"  {BOLD}{'Dateigrösse:':<28}{NC} {fmt_bytes(size_bytes)}")
print()

print(f"  {BOLD}Auth-Nutzer ({len(users)}):{NC}")
for u in users:
    print(f"    {DIM}->  {u}{NC}")
print()

print(f"  {BOLD}Tabellen-Zeilenanzahlen (Backup):{NC}")
print(f"  {BOLD}  {'Tabelle':<44} {'Zeilen':>8}{NC}")
print("  " + chr(9472) * 54)
total = 0
for tbl, cnt in counts.items():
    if not (tbl.startswith('public.') or tbl.startswith('auth.')):
        continue
    if tbl in SKIP:
        continue
    style = DIM if cnt == 0 else ""
    total += cnt
    print(f"  {style}  {tbl:<44} {cnt:>8}{NC}")
print("  " + chr(9472) * 54)
print(f"  {BOLD}  {'Gesamt (wiederherstellbare Daten)':<44} {total:>8}{NC}")
print()

if date_range:
    print(f"  {BOLD}Zeiteinträge-Zeitraum:{NC}  {date_range}")
    print()

skipped = {t: c for t, c in counts.items() if t in SKIP and c > 0}
if skipped:
    print(f"  {DIM}Uebersprungen (Infrastruktur / veraltete Sessions):{NC}")
    for t, c in sorted(skipped.items()):
        print(f"  {DIM}    {t:<40} {c:>8} Zeilen{NC}")
    print()

print(f"  {GREEN}✓{NC}  Analyse abgeschlossen — kein Datenbankzugriff erforderlich")
PYEOF
}

# ═════════════════════════════════════════════════════════════════
# Python-Hilfsskript: Restore-SQL generieren
# ───────────────────────────────────────────
# Aufruf: _py_generate_restore <sql_file> <db_tables_file> <skip_tables_file>
# Ausgabe: SQL auf stdout, Fortschritt auf stderr
# ═════════════════════════════════════════════════════════════════
_py_generate_restore() {
    python3 - "$1" "$2" "$3" << 'PYEOF'
import sys
import re

sql_file       = sys.argv[1]
db_tables_file = sys.argv[2]
skip_file      = sys.argv[3]

db_tables = set(open(db_tables_file).read().splitlines())
skip_set  = set(open(skip_file).read().splitlines())

# ── Zeilenweiser COPY-Block-Parser ───────────────────────────────
# Sammelt (table, header_line, data_rows) für alle public.* und auth.* Tabellen
blocks = []
current_table  = None
current_header = None
current_rows   = []

with open(sql_file, encoding='utf-8', errors='replace') as f:
    for raw_line in f:
        line = raw_line.rstrip('\n')
        if current_table is None:
            m = re.match(r'^COPY ((?:public|auth)[.]\w+) [(][^)]+[)] FROM stdin;$', line)
            if m:
                current_table  = m.group(1)
                current_header = line
                current_rows   = []
        else:
            if line == '\\.':
                blocks.append((current_table, current_header, list(current_rows)))
                current_table  = None
                current_header = None
                current_rows   = []
            else:
                current_rows.append(line)

# ── SQL ausgeben ─────────────────────────────────────────────────
print("-- =============================================================")
print("-- Ameise Legacy Restore – generiert von restore-legacy-backup.sh")
print("-- =============================================================")
print()
print("SET session_replication_role = replica;")
print()

restored = 0
total_rows = 0

for full_table, header, rows in blocks:
    schema, tbl_name = full_table.split('.', 1)

    if full_table in skip_set:
        sys.stderr.write(f"  UEBERSPRUNGEN (Blacklist):   {full_table}\n")
        continue

    if schema == 'public' and tbl_name not in db_tables:
        sys.stderr.write(f"  UEBERSPRUNGEN (nicht in DB): {full_table}\n")
        continue

    row_count = len(rows)
    print(f"-- Tabelle: {full_table}  ({row_count} Zeilen)")
    print(header)
    for row in rows:
        print(row)
    print('\\.')
    print()

    restored   += 1
    total_rows += row_count
    sys.stderr.write(f"  -> {full_table}: {row_count} Zeilen\n")

print("RESET session_replication_role;")

sys.stderr.write(f"\n  {restored} Tabellen, {total_rows} Zeilen gesamt\n\n")
PYEOF
}

# ═════════════════════════════════════════════════════════════════
# Python-Hilfsskript: Erwartete Zeilenzahlen aus Backup extrahieren
# ─────────────────────────────────────────────────────────────────
# Aufruf: _py_expected_counts <sql_file>
# Ausgabe: "schema.tabelle=N" Zeilen auf stdout
# ═════════════════════════════════════════════════════════════════
_py_expected_counts() {
    python3 - "$1" << 'PYEOF'
import sys
import re

SKIP = {
    'auth.audit_log_entries','auth.flow_state','auth.instances',
    'auth.mfa_amr_claims','auth.mfa_challenges','auth.mfa_factors',
    'auth.oauth_authorizations','auth.oauth_client_states','auth.oauth_clients',
    'auth.oauth_consents','auth.one_time_tokens','auth.refresh_tokens',
    'auth.saml_providers','auth.saml_relay_states','auth.schema_migrations',
    'auth.sessions','auth.sso_domains','auth.sso_providers',
}

# Zeilenweiser Parser
current = None
counts  = {}

with open(sys.argv[1], encoding='utf-8', errors='replace') as f:
    for raw_line in f:
        line = raw_line.rstrip('\n')
        if current is None:
            m = re.match(r'^COPY ((?:public|auth)[.]\w+) [(][^)]+[)] FROM stdin;$', line)
            if m:
                current = m.group(1)
                counts[current] = 0
        else:
            if line == '\\.':
                current = None
            else:
                counts[current] += 1

for table, rows in sorted(counts.items()):
    if table in SKIP:
        continue
    if rows > 0:
        print(f"{table}={rows}")
PYEOF
}

# ═════════════════════════════════════════════════════════════════
# ANALYSE – Backup-Datei analysieren (kein DB-Zugriff nötig)
# ═════════════════════════════════════════════════════════════════
cmd_analyze() {
    local sql_file="${1:-}"
    [ -z "$sql_file" ] && die "Usage: restore-legacy-backup.sh analyze <backup.sql>"
    [ -f "$sql_file"  ] || die "Datei nicht gefunden: $sql_file"

    local abs_path
    abs_path=$(cd "$(dirname "$sql_file")" && pwd)/$(basename "$sql_file")

    header "Backup-Analyse: $(basename "$abs_path")"
    _py_analyze "$abs_path"
}

# ═════════════════════════════════════════════════════════════════
# RESTORE – Daten selektiv einspielen
# ═════════════════════════════════════════════════════════════════
cmd_restore() {
    local sql_file="" env_file="docker/.env.local"
    local force=false skip_safety=false skip_auth=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --env)         env_file="$2";    shift 2 ;;
            --force)       force=true;       shift   ;;
            --skip-safety) skip_safety=true; shift   ;;
            --skip-auth)   skip_auth=true;   shift   ;;
            -*)            die "Unbekannte Option: $1" ;;
            *)             sql_file="$1";    shift   ;;
        esac
    done

    [ -z "$sql_file" ] && die "Usage: restore-legacy-backup.sh restore <backup.sql> [--env <datei>]"
    [ -f "$sql_file"  ] || die "Backup-Datei nicht gefunden: $sql_file"

    local abs_sql
    abs_sql=$(cd "$(dirname "$sql_file")" && pwd)/$(basename "$sql_file")

    # ── Backup-Analyse anzeigen ──────────────────────────────────
    cmd_analyze "$abs_sql"

    load_env "$env_file"

    header "Restore: ${PROJECT}"

    check_db

    # ── Schema-Kompatibilität prüfen ────────────────────────────
    info "Prüfe Schema-Kompatibilität..."

    local db_tables_file
    db_tables_file=$(make_tmpfile)

    psql_q \
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\\_%' ORDER BY tablename" \
        > "$db_tables_file" 2>/dev/null || true

    local backup_public_tables incompat=0
    backup_public_tables=$(python3 - "$abs_sql" << 'PYEOF'
import sys, re
# Zeilenweiser Parser für öffentliche Tabellen
tables = set()
current = None
with open(sys.argv[1], encoding='utf-8', errors='replace') as f:
    for raw_line in f:
        line = raw_line.rstrip('\n')
        if current is None:
            m = re.match(r'^COPY public[.](\w+) [(]', line)
            if m:
                tables.add(m.group(1))
                current = 'x'
        elif line == '\\.':
            current = None
print('\n'.join(sorted(tables)))
PYEOF
)
    while IFS= read -r tbl; do
        [ -z "$tbl" ] && continue
        if ! grep -qx "$tbl" "$db_tables_file" 2>/dev/null; then
            warn "Backup-Tabelle 'public.${tbl}' fehlt in der Ziel-DB — wird uebersprungen"
            incompat=$((incompat + 1))
        fi
    done <<< "$backup_public_tables"

    if [ "$incompat" -eq 0 ]; then
        log "Schema-Kompatibilitaet OK"
    else
        warn "${incompat} Backup-Tabelle(n) nicht in Ziel-DB — werden uebersprungen"
    fi

    # ── Safety-Backup ────────────────────────────────────────────
    if ! $skip_safety; then
        local safety_dir="backups/pre-restore-$(date +%Y-%m-%d_%H%M%S)"
        info "Erstelle Safety-Backup: ${safety_dir}"
        if bash "$SCRIPT_DIR/db-backup.sh" backup --dir "$safety_dir" --env "$env_file"; then
            log "Safety-Backup erstellt: ${safety_dir}"
        else
            warn "Safety-Backup fehlgeschlagen"
            if ! $force; then
                die "Restore abgebrochen. Mit '--skip-safety' ueberspringen oder Fehler beheben."
            fi
        fi
    else
        warn "Safety-Backup uebersprungen (--skip-safety)"
    fi

    # ── Bestätigung ──────────────────────────────────────────────
    echo ""
    echo -e "  ${RED}${BOLD}ACHTUNG: Alle Nutzerdaten und Anwendungsdaten in '${PROJECT}'${NC}"
    echo -e "  ${RED}${BOLD}         werden durch die Backup-Daten ersetzt!${NC}"
    echo ""
    if $skip_auth; then
        info "Auth-Nutzer werden NICHT ersetzt (--skip-auth)"
    else
        info "auth.users + auth.identities werden ersetzt"
        info "Aktive Sessions werden unguelig -> Nutzer muessen sich neu einloggen"
    fi
    echo ""

    if ! $force; then
        read -rp "  Zur Bestaetigung 'RESTORE' eingeben: " confirm_input
        if [ "$confirm_input" != "RESTORE" ]; then
            echo ""
            info "Abgebrochen."
            exit 0
        fi
    else
        warn "Automatisch bestaetigt (--force)"
    fi

    echo ""

    # ── Aktive Verbindungen trennen ──────────────────────────────
    info "Trenne aktive DB-Verbindungen..."
    psql_q "SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = '${DB_NAME}'
              AND pid <> pg_backend_pid()" > /dev/null 2>&1 || true
    log "Verbindungen getrennt"

    # ── Bestehende Daten löschen ─────────────────────────────────
    info "Loesche bestehende Anwendungsdaten..."

    local del_file
    del_file=$(make_tmpfile)

    {
        echo "SET session_replication_role = replica;"
        # Alle public.* Tabellen dynamisch leeren
        psql_q "SELECT 'TRUNCATE public.\"' || tablename || '\" RESTART IDENTITY CASCADE;'
                FROM pg_tables
                WHERE schemaname = 'public'
                  AND tablename NOT LIKE '\\_%'
                ORDER BY tablename" 2>/dev/null || true
        if ! $skip_auth; then
            echo "DELETE FROM auth.identities;"
            echo "DELETE FROM auth.refresh_tokens;"
            echo "DELETE FROM auth.sessions;"
            echo "DELETE FROM auth.mfa_amr_claims;"
            echo "DELETE FROM auth.one_time_tokens;"
            echo "DELETE FROM auth.flow_state;"
            echo "DELETE FROM auth.audit_log_entries;"
            echo "DELETE FROM auth.users;"
        fi
        echo "RESET session_replication_role;"
    } > "$del_file"

    local del_out
    del_out=$(psql_file "$del_file")
    local del_errors
    del_errors=$(echo "$del_out" | grep -iE "^ERROR" || true)
    if [ -n "$del_errors" ]; then
        err "Fehler beim Loeschen der Daten:"
        echo "$del_errors"
        die "Restore abgebrochen"
    fi
    log "Bestehende Daten geloescht"

    # ── Restore-SQL generieren ────────────────────────────────────
    info "Generiere Restore-SQL aus Backup..."

    local skip_file
    skip_file=$(make_tmpfile)

    # Skip-Liste in Datei schreiben
    {
        for t in "${BASE_SKIP_TABLES[@]}"; do echo "$t"; done
        if $skip_auth; then
            echo "auth.users"
            echo "auth.identities"
        fi
    } > "$skip_file"

    local restore_file
    restore_file=$(make_tmpfile)

    # stdout → restore_file (reines SQL), stderr → Terminal (Fortschritts-Ausgabe)
    _py_generate_restore "$abs_sql" "$db_tables_file" "$skip_file" \
        > "$restore_file"

    local gen_size
    gen_size=$(du -sh "$restore_file" 2>/dev/null | cut -f1)
    log "Restore-SQL generiert (${gen_size})"

    # ── Restore ausführen ────────────────────────────────────────
    info "Spiele Daten ein (bitte warten)..."

    local psql_out
    psql_out=$(psql_file "$restore_file")
    local restore_errors
    restore_errors=$(echo "$psql_out" | grep -iE "^ERROR" || true)

    if [ -n "$restore_errors" ]; then
        warn "psql meldete Fehler:"
        echo "$restore_errors" | while IFS= read -r line; do
            echo -e "    ${DIM}${line}${NC}"
        done
        warn "Restore mit Fehlern abgeschlossen — bitte Ausgabe pruefen"
    else
        log "Alle Daten erfolgreich eingespielt"
    fi

    echo ""

    # ── Post-Restore-Validierung ─────────────────────────────────
    echo -e "  ${CYAN}Starte Post-Restore-Validierung...${NC}"
    echo ""
    _validate_after_restore "$abs_sql"

    echo ""
    log "Restore abgeschlossen: ${PROJECT}"
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# POST-RESTORE VALIDIERUNG
# ═════════════════════════════════════════════════════════════════
_validate_after_restore() {
    local sql_file="$1"

    local expected_file
    expected_file=$(make_tmpfile)
    _py_expected_counts "$sql_file" > "$expected_file"

    echo -e "${BOLD}Post-Restore Validierung${NC}"
    echo -e "  $(printf '─%.0s' {1..68})"
    echo ""
    printf "  ${BOLD}  %-38s %10s %10s   %s${NC}\n" "Tabelle" "Backup" "DB jetzt" "Status"
    printf "  $(printf '─%.0s' {1..68})\n"

    local all_ok=true

    while IFS='=' read -r table expected; do
        [ -z "$table" ] && continue
        local schema tbl_name actual
        schema="${table%%.*}"
        tbl_name="${table#*.}"
        actual=$(psql_q "SELECT COUNT(*) FROM ${schema}.\"${tbl_name}\"" 2>/dev/null \
                 | tr -d ' ' || echo "?")

        if [ "$actual" = "$expected" ]; then
            printf "  ${GREEN}✓${NC}  %-38s %10s %10s   OK\n" "$table" "$expected" "$actual"
        else
            printf "  ${RED}✗${NC}  %-38s %10s %10s   DIFF\n" "$table" "$expected" "$actual"
            all_ok=false
        fi
    done < "$expected_file"

    printf "  $(printf '─%.0s' {1..68})\n"
    echo ""

    local auth_users auth_sessions
    auth_users=$(psql_q   "SELECT COUNT(*) FROM auth.users"    2>/dev/null | tr -d ' ' || echo "n/a")
    auth_sessions=$(psql_q "SELECT COUNT(*) FROM auth.sessions" 2>/dev/null | tr -d ' ' || echo "n/a")
    printf "    %-40s %10s\n" "auth.users   (nach Restore)"    "$auth_users"
    printf "    %-40s %10s\n" "auth.sessions  (zurueckgesetzt)" "$auth_sessions"
    echo ""

    if $all_ok; then
        log "Validierung erfolgreich — alle Zeilenanzahlen stimmen ueberein"
    else
        warn "Validierung: Abweichungen festgestellt — bitte Ausgabe oben pruefen"
    fi
}

# ═════════════════════════════════════════════════════════════════
# USAGE
# ═════════════════════════════════════════════════════════════════
usage() {
    echo ""
    echo -e "${BOLD}Masitcon Ameise – Legacy Backup Restore${NC}"
    echo ""
    echo "  Stellt ein rohes pg_dump-SQL-Backup selektiv wieder her."
    echo "  Nutzerdaten und Anwendungsdaten werden eingespielt;"
    echo "  die Supabase-Infrastruktur (JWT-Secrets, System-Schemas) bleibt erhalten."
    echo ""
    echo "  Befehle:"
    echo "    analyze  <backup.sql>                   Backup analysieren (kein DB-Zugriff)"
    echo "    restore  <backup.sql>  [Optionen]        Backup einspielen"
    echo "    help                                     Diese Hilfe anzeigen"
    echo ""
    echo "  Optionen (restore):"
    echo "    --env <datei>     Env-Datei (Standard: docker/.env.local)"
    echo "    --force           Keine Rueckfrage (CI/CD)"
    echo "    --skip-safety     Kein automatisches Safety-Backup"
    echo "    --skip-auth       Auth-Nutzer (auth.users/identities) NICHT ersetzen"
    echo ""
    echo "  Backup-Formate:"
    echo "    *.sql    pg_dump --format=plain  <- empfohlen, immer kompatibel"
    echo "    *.dump   pg_dump --format=custom <- erfordert pg_restore >= Dump-Version"
    echo "             (pg_dump v1.16/PG17 = NICHT kompatibel mit PG15-Container!)"
    echo ""
    echo "  Workflow: lokal -> staging -> production"
    echo ""
    echo "    # 1. Lokal analysieren und testen"
    echo "    bash scripts/restore-legacy-backup.sh analyze Backup/postgres_2026-3-18_1-5-6.sql"
    echo "    bash scripts/restore-legacy-backup.sh restore Backup/postgres_2026-3-18_1-5-6.sql"
    echo ""
    echo "    # 2. Staging (auf dem Staging-Server ausfuehren)"
    echo "    scp Backup/postgres_2026-3-18_1-5-6.sql user@staging:/opt/ameise-staging/backup.sql"
    echo "    ssh user@staging 'cd /opt/ameise-staging/app && \\"
    echo "      bash scripts/restore-legacy-backup.sh restore /opt/ameise-staging/backup.sql \\"
    echo "      --env docker/.env.staging'"
    echo ""
    echo "    # 3. Produktion (auf dem Prod-Server ausfuehren)"
    echo "    scp Backup/postgres_2026-3-18_1-5-6.sql user@prod:/opt/ameise-production/backup.sql"
    echo "    ssh user@prod 'cd /opt/ameise-production/app && \\"
    echo "      bash scripts/restore-legacy-backup.sh restore /opt/ameise-production/backup.sql \\"
    echo "      --env docker/.env'"
    echo ""
    echo "  Beispiele:"
    echo "    bash scripts/restore-legacy-backup.sh analyze Backup/postgres_2026-3-18_1-5-6.sql"
    echo "    bash scripts/restore-legacy-backup.sh restore Backup/postgres_2026-3-18_1-5-6.sql"
    echo "    bash scripts/restore-legacy-backup.sh restore /tmp/backup.sql --env docker/.env --force"
    echo "    bash scripts/restore-legacy-backup.sh restore /tmp/backup.sql --skip-auth --skip-safety"
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════
COMMAND="${1:-}"
shift || true

case "$COMMAND" in
    analyze)         cmd_analyze  "$@" ;;
    restore)         cmd_restore  "$@" ;;
    help|--help|-h)  usage ;;
    "")              usage ;;
    *)               err "Unbekannter Befehl: ${COMMAND}"; usage; exit 1 ;;
esac
