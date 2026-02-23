#!/usr/bin/env bash
# ===================================================================
# masitcon Zeiterfassung (Ameise) - Deploy & Setup Script
# ===================================================================
#
# Voraussetzung: Repo geklont (siehe README – Einstieg)
# Zielplattform: Ubuntu Server 22.04+ (--local auch auf Mac)
#
# Server Setup:    bash scripts/deploy.sh
# Lokale Dev-Env:  bash scripts/deploy.sh --local
# Update:          bash scripts/deploy.sh --update [--env production|staging]
# Status:          bash scripts/deploy.sh --status
# Logs:            bash scripts/deploy.sh --logs [--env production|staging]
# Stoppen:         bash scripts/deploy.sh --stop
# Neu starten:     bash scripts/deploy.sh --restart
# Alles löschen:   bash scripts/deploy.sh --clean [--full]
# Aufräumen:       bash scripts/deploy.sh --prune
# Nur Migrationen: bash scripts/deploy.sh --migrate
# Backup:          bash scripts/deploy.sh --backup
# Port-Check:      bash scripts/deploy.sh --check-ports
# Nginx-Setup:     bash scripts/deploy.sh --setup-nginx
#
# ===================================================================
set -uo pipefail

# ─── Farben & Formatierung ───────────────────────────────────────
BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
NC="\033[0m"

# ─── Logging ─────────────────────────────────────────────────────
log()    { echo -e "  ${GREEN}✓${NC} $1"; }
warn()   { echo -e "  ${YELLOW}!${NC} $1"; }
err()    { echo -e "  ${RED}✗${NC} $1"; }
info()   { echo -e "  ${CYAN}ℹ${NC} $1"; }
header() { echo -e "\n${BOLD}══ $1 ══${NC}\n"; }

# ─── Abbruch-Handler ─────────────────────────────────────────────
trap 'echo -e "\n\n${RED}Abgebrochen.${NC}"; exit 130' INT TERM

# ─── Hilfsfunktionen ─────────────────────────────────────────────

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

is_port_free() {
    # Ubuntu/Linux: ss ist Standard, lsof optional
    if command -v ss >/dev/null 2>&1; then
        ! ss -tlnp 2>/dev/null | grep -q ":${1} "
    elif command -v lsof >/dev/null 2>&1; then
        ! lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | grep -q ":${1} "
    else
        return 1
    fi
}

find_free_port() {
    local port="$1"
    local max=$((port + 200))
    while ! is_port_free "$port" && [ "$port" -lt "$max" ]; do port=$((port + 1)); done
    [ "$port" -ge "$max" ] && { echo ""; return 1; }
    echo "$port"
}

# Prüft ob Port von unserem eigenen Stack belegt ist (Reconfigure/Update)
is_port_used_by_our_stack() {
    local port="$1"
    local prefix="${DEPLOY_COMPOSE_PROJECT:-${PROJECT_NAME}-${ENV_TARGET}}"
    local occ; occ=$(get_port_occupant "$port" 2>/dev/null)
    [[ "$occ" == "Docker: ${prefix}-"* ]]
}

# Prüft ob POSTGRES_PASSWORD in der secrets.env gesetzt ist – bricht ab wenn leer
_check_postgres_password() {
    local sf="${1:-${DIR_BASE}/secrets.env}"
    if [ ! -f "$sf" ]; then return 0; fi
    local pw; pw=$(grep -E '^POSTGRES_PASSWORD=' "$sf" | cut -d= -f2- | tr -d '"' | tr -d "'")
    if [ -z "$pw" ]; then
        err "POSTGRES_PASSWORD in ${sf} ist leer!"
        err "Das passiert wenn setup erneut ausgeführt wird ohne Schlüssel neu zu generieren."
        info "Fix-Optionen:"
        info "  1) Schlüssel bei Setup-Frage 'Vorhandene Schlüssel beibehalten?' mit N antworten"
        info "  2) secrets.env manuell editieren: POSTGRES_PASSWORD=<passwort>"
        info "  3) DB neu initialisieren: bash scripts/deploy.sh --reset-db --env ${ENV_TARGET}"
        exit 1
    fi
}

# Zeigt die letzten DB-Logs wenn der Container existiert – hilfreich bei Absturz
_show_db_crash_logs() {
    local db_container="${DEPLOY_COMPOSE_PROJECT:-${COMPOSE_PROJECT_NAME:-${PROJECT_NAME}-${ENV_TARGET}}}-db"
    if docker inspect "$db_container" >/dev/null 2>&1; then
        echo ""
        warn "── Letzte DB-Logs (${db_container}) ──────────────────────────────────"
        docker logs --tail 25 "$db_container" 2>&1 | sed 's/^/  /'
        echo ""
        info "Vollständige Logs: docker logs ${db_container}"
        info "Wenn Volume korrupt: bash scripts/deploy.sh --reset-db --env ${ENV_TARGET}"
    fi
}

detect_compose() {
    if docker compose version >/dev/null 2>&1; then echo "docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then echo "docker-compose"
    else echo ""; fi
}

bytes_human() {
    local b="$1"
    if   [ "$b" -ge 1073741824 ]; then printf "%.1f GB" "$(echo "scale=1; $b/1073741824" | bc 2>/dev/null || echo 0)"
    elif [ "$b" -ge 1048576 ];    then printf "%.1f MB" "$(echo "scale=1; $b/1048576"    | bc 2>/dev/null || echo 0)"
    elif [ "$b" -ge 1024 ];       then printf "%.1f KB" "$(echo "scale=1; $b/1024"       | bc 2>/dev/null || echo 0)"
    else echo "${b} B"; fi
}

# ─── Projekt-Konstanten ──────────────────────────────────────────
PROJECT_NAME="masitcon-tools-ameise"
NGINX_SITE_NAME="ameise"
PROJECT_DISPLAY="masitcon Zeiterfassung (Ameise)"
NODE_VERSION="20"
APP_FRAMEWORK="vite"
APP_PORT="8080"
HAS_SUPABASE="true"
HAS_MIGRATIONS="true"
BUILD_COMMAND="npm run build"
START_COMMAND="npx serve -s dist -l 8080"

# ─── Argument-Parsing ────────────────────────────────────────────
MODE="setup"
ENV_TARGET="production"
ENV_EXPLICIT=false
SHOW_LOGS_SERVICE=""
CLEAN_FULL=false
CLI_BASE_DIR=""   # überschreibt interaktive Abfrage wenn gesetzt

while [[ $# -gt 0 ]]; do
    case "$1" in
        --local)   MODE="local";   shift ;;
        --update)  MODE="update";  shift ;;
        --status)  MODE="status";  shift ;;
        --logs)    MODE="logs";    shift ;;
        --stop)    MODE="stop";    shift ;;
        --restart) MODE="restart"; shift ;;
        --clean)   MODE="clean";   shift ;;
        --full)    CLEAN_FULL=true; shift ;;
        --prune)   MODE="prune";   shift ;;
        --migrate)      MODE="migrate";      shift ;;
        --backup)       MODE="backup";       shift ;;
        --check-ports)   MODE="check-ports";   shift ;;
        --reconfigure)   MODE="reconfigure";   shift ;;
        --sync-migrations) MODE="sync-migrations"; shift ;;
        --setup-nginx)     MODE="setup-nginx";     shift ;;
        --reset-db)        MODE="reset-db";        shift ;;
        --env)      ENV_TARGET="${2:-production}"; ENV_EXPLICIT=true; shift 2 ;;
        --base-dir) CLI_BASE_DIR="${2:-}"; shift 2 ;;
        --service)  SHOW_LOGS_SERVICE="${2:-}"; shift 2 ;;
        --help|-h)
            cat << 'HELP'
Deploy-Script für masitcon Zeiterfassung (Ameise)

Modi:
  (kein Flag)        Interaktives Server-Setup (Ersteinrichtung)
  --local            Lokale Entwicklungsumgebung einrichten & starten
  --update           Container updaten und neu starten
  --migrate          Nur Datenbankmigrationen ausführen
  --backup           Datenbank-Backup erstellen
  --status           Alle Container und Ressourcen anzeigen
  --logs             Container-Logs anzeigen (live)
  --stop             Alle Container stoppen
  --restart          Alle Container neu starten
  --clean            Projekt entfernen (Container + Volumes + Configs)
  --clean --full     Alles entfernen inkl. Verzeichnisse, Backups, Logs
  --prune            Docker-System aufräumen (ungenutzte Images/Volumes)
  --check-ports      Ports prüfen (Supabase) – zeigt Belegung, bietet Alternativen
  --reconfigure      Bestehende Einstellungen laden, ändern und neu deployen
  --sync-migrations  Migrationen als angewendet markieren (ohne Ausführung)
  --setup-nginx      Nginx-Configs nach sites-available kopieren + Symlinks in sites-enabled
  --reset-db         DB-Volume löschen und neu initialisieren (bei korruptem Volume)

Optionen:
  --env production|staging    Ziel-Umgebung (Default: production)
  --base-dir /pfad            Basisverzeichnis für Installation (Default: /opt/masitcon/ameise)
  --service NAME              Für --logs: nur diesen Container
  --help                      Diese Hilfe
HELP
            exit 0 ;;
        *) err "Unbekannte Option: $1"; exit 1 ;;
    esac
done

# ─── Ordnerstruktur ──────────────────────────────────────────────
# DIR_APP: Repo-Verzeichnis – immer das Verzeichnis in dem deploy.sh liegt.
#          Kein extra app/-Unterverzeichnis mehr nötig.
# DIR_BASE: Nur für Konfiguration, Secrets und Nginx-Snippets.
#           Standard: /opt/masitcon/ameise – überschreibbar per --base-dir oder Wizard
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR_APP="$(dirname "$_SCRIPT_DIR")"          # Repo-Root (Elternverzeichnis von scripts/)
DIR_BASE="${CLI_BASE_DIR:-/opt/masitcon/ameise}"
DIR_BACKUPS="${DIR_BASE}/backups"
DIR_LOGS="${DIR_BASE}/logs"
DIR_CONFIGS="${DIR_BASE}/${ENV_TARGET}/configs"
DEPLOY_ENV_FILE="${DIR_BASE}/deploy.env"

load_or_init_dirs() {
    # Per-Env: deploy.env.staging / deploy.env.production (Referenz-konform)
    local env_file="${DIR_BASE}/deploy.env.${ENV_TARGET}"
    if [ -f "$env_file" ]; then
        # shellcheck source=/dev/null
        source "$env_file"
    fi
    # Fallback: gemeinsame deploy.env
    if [ -f "$DEPLOY_ENV_FILE" ]; then
        # shellcheck source=/dev/null
        source "$DEPLOY_ENV_FILE"
    fi
    # DIR_APP bleibt immer das Repo-Root wo das Script liegt
    DIR_CONFIGS="${DIR_BASE}/${ENV_TARGET}/configs"
}

# Fragt Umgebung ab, wenn nicht per --env gesetzt (für update, status, logs, etc.)
ask_env_target() {
    [ "$ENV_EXPLICIT" = true ] && return 0
    info "Ziel-Umgebung: 1) production  2) staging"
    local c
    c=$(ask "Auswahl [1/2]" "1")
    case "$c" in
        2) ENV_TARGET="staging" ;;
        *) ENV_TARGET="production" ;;
    esac
    log "Umgebung: ${ENV_TARGET}"
    DIR_CONFIGS="${DIR_BASE}/${ENV_TARGET}/configs"
}

# ─── Voraussetzungen prüfen ──────────────────────────────────────
check_prerequisites() {
    header "Voraussetzungen prüfen"
    local missing=()
    command -v docker >/dev/null 2>&1 || missing+=("docker")
    command -v git    >/dev/null 2>&1 || missing+=("git")
    command -v curl   >/dev/null 2>&1 || missing+=("curl")
    [ -z "$(detect_compose)" ] && missing+=("docker-compose-plugin")
    if [ ${#missing[@]} -gt 0 ]; then
        err "Fehlende Tools: ${missing[*]}"
        info "Installation: sudo apt install ${missing[*]}"
        exit 1
    fi
    log "Docker    $(docker --version | cut -d' ' -f3 | tr -d ',')"
    log "Compose   verfügbar"
    log "Git       $(git --version | cut -d' ' -f3)"
}

check_supabase_cli() {
    if ! command -v supabase >/dev/null 2>&1; then
        err "Supabase CLI nicht gefunden"
        info "Ubuntu/Debian:  sudo apt install supabase  (oder: https://supabase.com/docs/guides/cli)"
        info "Mac:            brew install supabase/tap/supabase"
        info "Alternativ:     npm install -g supabase"
        exit 1
    fi
    log "Supabase CLI $(supabase --version 2>/dev/null || echo 'installiert')"
}

# ─── Port-Check vor Supabase (PFLICHT – mehrere Instanzen auf Server) ─
# Liest Ports aus supabase/config.toml, zeigt Belegung, bietet freie Alternativen

read_supabase_ports() {
    local config="${1:-supabase/config.toml}"
    [ ! -f "$config" ] && { echo "54331 54332 54333 54334 54337"; return; }
    grep -E "^\s*port\s*=" "$config" 2>/dev/null | awk -F= '{gsub(/[^0-9]/,"",$2); if($2) print $2}' | sort -nu
}

# Zeigt welcher Prozess/Container einen Port belegt
get_port_occupant() {
    local port="$1"
    # Docker-Container (häufigste Ursache bei mehreren Supabase-Instanzen)
    if command -v docker >/dev/null 2>&1; then
        local dc; dc=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E ":${port}(->|/|[^0-9]|$)" | head -1)
        [ -n "$dc" ] && { echo "Docker: ${dc%% *}"; return; }
    fi
    # ss (Ubuntu/Linux – Standard)
    if command -v ss >/dev/null 2>&1; then
        local s; s=$(ss -tlnp 2>/dev/null | grep ":${port} ")
        [ -n "$s" ] && { echo "Socket: $(echo "$s" | awk '{print $6}')"; return; }
    fi
    # lsof (Fallback, z.B. Mac)
    if command -v lsof >/dev/null 2>&1; then
        local l; l=$(lsof -iTCP:${port} -sTCP:LISTEN -nP 2>/dev/null | tail -1)
        [ -n "$l" ] && { echo "Prozess: $(echo "$l" | awk '{print $1, $2}')"; return; }
    fi
    echo "unbekannt"
}

# Hauptfunktion: Prüft alle Supabase-Ports, blockiert bei Konflikt
# Gibt 0 zurück wenn alle frei, 1 bei Konflikt (oder nach Abbruch)
check_ports_before_supabase() {
    header "Port-Check (Supabase)"
    local ports
    ports=($(read_supabase_ports))
    [ ${#ports[@]} -eq 0 ] && ports=(54331 54332 54333 54334 54337)

    local occupied=()
    local details=()

    for p in "${ports[@]}"; do
        if is_port_free "$p"; then
            log "Port $p: frei"
        else
            local occ; occ=$(get_port_occupant "$p")
            occupied+=("$p")
            details+=("  $p → $occ")
        fi
    done

    if [ ${#occupied[@]} -gt 0 ]; then
        echo ""
        warn "Folgende Ports sind belegt:"
        printf '%s\n' "${details[@]}"
        echo ""
        info "Alle laufenden Docker-Container:"
        docker ps --format '  {{.Names}} ({{.Ports}})' 2>/dev/null | head -20 || true
        echo ""
        info "Alle Ports 543xx im Einsatz:"
        (ss -tlnp 2>/dev/null || lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null) | grep -E ":54[0-9]{3}\s" | head -15 || true
        echo ""

        # Option: Freie Alternativ-Ports finden und config.toml anpassen
        local base=54331
        local free_ports=()
        local i=0
        while [ $i -le 100 ]; do
            local candidate=$((base + i))
            if is_port_free "$candidate"; then
                free_ports+=("$candidate")
                [ ${#free_ports[@]} -ge 5 ] && break
            fi
            i=$((i + 1))
        done

        if [ ${#free_ports[@]} -ge 5 ]; then
            info "Freie Port-Block-Alternative gefunden: ${free_ports[*]}"
            if confirm "supabase/config.toml mit diesen Ports aktualisieren?" "j"; then
                _update_config_ports "${free_ports[@]}" && return 0
            fi
        fi

        warn "Lösung: Andere Supabase-Instanz stoppen (supabase stop) oder Ports in supabase/config.toml anpassen."
        confirm "Trotzdem fortfahren (Start wird wahrscheinlich fehlschlagen)?" "n" || exit 1
    else
        log "Alle Supabase-Ports frei"
    fi
}

# Aktualisiert config.toml mit neuem Port-Block
_update_config_ports() {
    local api_port="${1:-54331}" db_port="${2:-54332}" studio_port="${3:-54333}" inbucket_port="${4:-54334}" analytics_port="${5:-54337}"
    local config="supabase/config.toml"
    [ ! -f "$config" ] && { err "config.toml nicht gefunden"; return 1; }

    cp "$config" "${config}.bak"
    local in_section=""
    while IFS= read -r line; do
        if [[ "$line" =~ ^\[api\] ]]; then in_section="api"; fi
        if [[ "$line" =~ ^\[db\] ]]; then in_section="db"; fi
        if [[ "$line" =~ ^\[studio\] ]]; then in_section="studio"; fi
        if [[ "$line" =~ ^\[inbucket\] ]]; then in_section="inbucket"; fi
        if [[ "$line" =~ ^\[analytics\] ]]; then in_section="analytics"; fi
        if [[ "$line" =~ ^[[:space:]]*port[[:space:]]*=[[:space:]]*[0-9]+ ]]; then
            case "$in_section" in
                api)      echo "port = ${api_port}" ;;
                db)       echo "port = ${db_port}" ;;
                studio)   echo "port = ${studio_port}" ;;
                inbucket) echo "port = ${inbucket_port}" ;;
                analytics) echo "port = ${analytics_port}" ;;
                *)        echo "$line" ;;
            esac
        else
            echo "$line"
        fi
    done < "$config" > "${config}.new" && mv "${config}.new" "$config"

    log "config.toml aktualisiert: API=$api_port DB=$db_port Studio=$studio_port"
    return 0
}

# ─── Lokal (Docker Compose) ──────────────────────────────────────
LOCAL_COMPOSE_FILE="docker/docker-compose.local.yml"
LOCAL_ENV_FILE="docker/.env.local"

# Generiert docker/.env.local mit frischen kryptografischen Schlüsseln
generate_local_env() {
    header "Lokale Secrets generieren"

    if ! command -v openssl >/dev/null 2>&1; then
        err "openssl nicht gefunden – kann Schlüssel nicht generieren"
        exit 1
    fi

    info "Generiere kryptografische Schlüssel..."
    generate_supabase_keys

    mkdir -p docker
    cat > "$LOCAL_ENV_FILE" << LOCALENV
# ===================================================================
# masitcon Zeiterfassung (Ameise) – Lokale Docker-Umgebung
# Automatisch generiert von deploy.sh --local am $(date '+%Y-%m-%d %H:%M')
# NICHT committen! (.gitignore bereits konfiguriert)
# ===================================================================
COMPOSE_PROJECT_NAME=ameise-local

# Kryptografische Schlüssel
JWT_SECRET=${DEPLOY_JWT_SECRET}
POSTGRES_PASSWORD=${DEPLOY_POSTGRES_PASSWORD}
ANON_KEY=${DEPLOY_ANON_KEY}
SERVICE_ROLE_KEY=${DEPLOY_SERVICE_ROLE_KEY}
PG_META_CRYPTO_KEY=${DEPLOY_PG_META_CRYPTO_KEY}

# Ports
APP_PORT=8080
API_PORT=8100
DB_PORT=5433
STUDIO_PORT=3101
INBUCKET_WEB_PORT=9000
INBUCKET_SMTP_PORT=2500

# URLs
SITE_URL=http://localhost:8080
SITE_HOSTNAME=localhost
API_EXTERNAL_URL=http://localhost:8100
VITE_SUPABASE_URL=http://localhost:8100

# Build
BUILD_MODE=development

# Edge Functions
DATA_TRANSFER_PASSWORD=ameise-local-transfer

# Supabase Studio – Anzeigename
STUDIO_DEFAULT_ORGANIZATION=Masitcon
STUDIO_DEFAULT_PROJECT=Ameise Local

# SMTP → Inbucket (lokal, kein echter Versand)
SMTP_ADMIN_EMAIL=admin@ameise.local
SMTP_SENDER_NAME="Ameise Local"
LOCALENV
    chmod 600 "$LOCAL_ENV_FILE"
    log "Lokale Secrets generiert: ${LOCAL_ENV_FILE}"
    warn "Nicht committen! (.gitignore bereits gesetzt)"
}

# Prüft ob die lokalen Docker-Ports frei sind (8100, 5433, 3101, 9000)
check_local_ports() {
    header "Port-Check (Lokale Umgebung)"

    local api_port=8100 db_port=5433 studio_port=3101 inbucket_port=9000
    if [ -f "$LOCAL_ENV_FILE" ]; then
        local v
        v=$(grep -E "^API_PORT=" "$LOCAL_ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d ' ')
        [ -n "$v" ] && api_port="$v"
        v=$(grep -E "^DB_PORT=" "$LOCAL_ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d ' ')
        [ -n "$v" ] && db_port="$v"
        v=$(grep -E "^STUDIO_PORT=" "$LOCAL_ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d ' ')
        [ -n "$v" ] && studio_port="$v"
        v=$(grep -E "^INBUCKET_WEB_PORT=" "$LOCAL_ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d ' ')
        [ -n "$v" ] && inbucket_port="$v"
    fi

    local all_free=true
    for entry in "${api_port}:API (Kong)" "${db_port}:PostgreSQL" "${studio_port}:Studio" "${inbucket_port}:Inbucket"; do
        local port="${entry%%:*}"
        local label="${entry#*:}"
        if is_port_free "$port"; then
            log "Port ${port} (${label}): frei"
        else
            local occ; occ=$(get_port_occupant "$port")
            warn "Port ${port} (${label}): BELEGT – ${occ}"
            all_free=false
        fi
    done

    if [ "$all_free" = false ]; then
        echo ""
        info "Tipp: Stack bereits gestartet? → docker ps | grep ameise-local"
        info "      Anderes Projekt am gleichen Port? → Ports in docker/.env.local anpassen"
        echo ""
        confirm "Trotzdem fortfahren (Stack-Start kann fehlschlagen)?" "j" || exit 1
    else
        log "Alle lokalen Ports frei"
    fi
}

# Wartet bis der lokale DB-Container gesund ist (max 90s)
wait_for_local_db() {
    local proj="${COMPOSE_PROJECT_NAME:-ameise-local}"
    local container="${proj}-db"
    info "Warte auf Datenbank-Container '${container}' (max 90s)..."
    local i=0
    while [ $i -lt 90 ]; do
        if docker exec "$container" pg_isready -U postgres -q 2>/dev/null; then
            echo ""
            log "Datenbank bereit"
            return 0
        fi
        sleep 3
        i=$((i + 3))
        printf "."
    done
    echo ""
    warn "Timeout – Datenbank möglicherweise noch nicht bereit."
    warn "  Logs prüfen: docker logs ${container}"
    return 1
}

setup_local() {
    header "Lokale Entwicklungsumgebung – ${PROJECT_DISPLAY}"

    # Voraussetzungen: docker und compose müssen installiert sein
    check_prerequisites

    # docker/.env.local: neu generieren oder laden
    if [ ! -f "$LOCAL_ENV_FILE" ]; then
        info "Keine lokale Konfiguration gefunden – generiere neue Secrets..."
        generate_local_env
    else
        info "Lokale Konfiguration gefunden: ${LOCAL_ENV_FILE}"
    fi

    # Variablen aus docker/.env.local laden
    # shellcheck source=/dev/null
    source "$LOCAL_ENV_FILE"
    local proj="${COMPOSE_PROJECT_NAME:-ameise-local}"

    echo ""
    echo -e "  ${BOLD}Lokale Konfiguration:${NC}"
    printf "    %-30s %s\n" "COMPOSE_PROJECT_NAME:" "$proj"
    printf "    %-30s %s\n" "API (Kong):"           "http://localhost:${API_PORT:-8100}"
    printf "    %-30s %s\n" "Studio:"                "http://localhost:${STUDIO_PORT:-3101}"
    printf "    %-30s %s\n" "PostgreSQL:"            "localhost:${DB_PORT:-5433}"
    printf "    %-30s %s\n" "Inbucket (E-Mails):"   "http://localhost:${INBUCKET_WEB_PORT:-9000}"
    echo ""

    # Port-Check
    check_local_ports

    # Compose-Datei prüfen
    if [ ! -f "$LOCAL_COMPOSE_FILE" ]; then
        err "Compose-Datei nicht gefunden: ${LOCAL_COMPOSE_FILE}"
        info "Repo-Zustand prüfen: git status"
        exit 1
    fi

    # Stack starten
    local DC; DC=$(detect_compose)
    [ -z "$DC" ] && { err "Docker Compose nicht gefunden – bitte installieren"; exit 1; }

    info "Starte lokalen Supabase-Stack (${proj})..."
    $DC -f "$LOCAL_COMPOSE_FILE" --env-file "$LOCAL_ENV_FILE" up -d \
        || { err "docker compose up fehlgeschlagen"; exit 1; }

    # Auf DB warten (Migrations werden beim ersten Start automatisch angewendet)
    wait_for_local_db

    # Env-Variablen neu laden (sicherstellen dass alle gesetzt sind)
    # shellcheck source=/dev/null
    source "$LOCAL_ENV_FILE"
    local anon_key="${ANON_KEY:-}"
    local service_key="${SERVICE_ROLE_KEY:-}"
    local api_port="${API_PORT:-8100}"
    
    local studio_port="${STUDIO_PORT:-3101}"
    local db_port="${DB_PORT:-5433}"
    local inbucket_port="${INBUCKET_WEB_PORT:-9000}"
    local data_transfer_pw="${DATA_TRANSFER_PASSWORD:-ameise-local-transfer}"

    # .env schreiben (Vite liest diese während `npm run dev`)
    cat > .env << DOTENV
# ================================================================
# ${PROJECT_DISPLAY} – Lokale Entwicklung (automatisch generiert)
# Nicht committen! Wird von deploy.sh --local überschrieben.
# ================================================================
VITE_SUPABASE_URL=http://localhost:${api_port}
VITE_SUPABASE_ANON_KEY=${anon_key}
DOTENV
    chmod 600 .env
    log ".env geschrieben (Vite)"

    # supabase/.env für Edge Functions (supabase functions serve)
    mkdir -p supabase
    cat > supabase/.env << SBENV
# ${PROJECT_DISPLAY} – Edge Functions (lokal)
SUPABASE_URL=http://localhost:${api_port}
SUPABASE_SERVICE_ROLE_KEY=${service_key}
DATA_TRANSFER_PASSWORD=${data_transfer_pw}
ALLOWED_ORIGIN=http://localhost:${APP_PORT}
SBENV
    chmod 600 supabase/.env
    log "supabase/.env geschrieben (Edge Functions)"

    # npm install falls node_modules fehlt
    if [ ! -d "node_modules" ]; then
        info "Installiere Dependencies..."
        if [ -f "package-lock.json" ]; then
            npm ci --silent 2>/dev/null || npm install
        else
            npm install
        fi
        log "Dependencies installiert"
    fi

    echo ""
    echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║   Lokaler Stack bereit!                               ║${NC}"
    echo -e "${BOLD}${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BOLD}URLs:${NC}"
    printf "    %-30s %s\n" "App (startet gleich):"  "http://localhost:${APP_PORT}"
    printf "    %-30s %s\n" "Supabase API (Kong):"   "http://localhost:${api_port}"
    printf "    %-30s %s\n" "Supabase Studio:"        "http://localhost:${studio_port}"
    printf "    %-30s %s\n" "Inbucket (E-Mails):"    "http://localhost:${inbucket_port}"
    printf "    %-30s %s\n" "PostgreSQL (direkt):"   "localhost:${db_port}"
    echo ""
    echo -e "  ${BOLD}Weitere Befehle:${NC}"
    echo "    Stack stoppen:   docker compose -f docker/docker-compose.local.yml down"
    echo "    Stack neu:       docker compose -f docker/docker-compose.local.yml down -v"
    echo "    Stack-Logs:      docker compose -f docker/docker-compose.local.yml logs -f"
    echo "    Edge Functions:  supabase functions serve --env-file supabase/.env"
    echo ""

    # Optional: Cloud-Datenmigration anbieten
    if [ -f "scripts/migrate-from-cloud.sh" ]; then
        if confirm "Daten von Supabase Cloud einmalig migrieren?" "n"; then
            bash scripts/migrate-from-cloud.sh
        fi
    fi

    echo ""
    echo -e "  ${DIM}Strg+C beendet npm run dev (Stack läuft weiter im Hintergrund)${NC}"
    echo ""
    npm run dev
}

# ─── Supabase-Key-Generierung ────────────────────────────────────
# Generiert JWT_SECRET, POSTGRES_PASSWORD, ANON_KEY, SERVICE_ROLE_KEY
# und PG_META_CRYPTO_KEY via openssl (reine Bash-JWT-Implementierung).

_base64url_encode() {
    openssl base64 -e -A | tr '+/' '-_' | tr -d '='
}

_generate_jwt() {
    local role="$1" secret="$2"
    local iat exp header payload signature
    iat=$(date +%s)
    exp=4102444800  # 2099-12-31
    header=$(printf '{"alg":"HS256","typ":"JWT"}' | _base64url_encode)
    payload=$(printf '{"role":"%s","iss":"supabase","iat":%d,"exp":%d}' "$role" "$iat" "$exp" | _base64url_encode)
    signature=$(printf '%s.%s' "$header" "$payload" \
        | openssl dgst -sha256 -hmac "$secret" -binary \
        | _base64url_encode)
    printf '%s.%s.%s' "$header" "$payload" "$signature"
}

generate_supabase_keys() {
    info "Generiere Supabase-Schlüssel automatisch..."
    DEPLOY_JWT_SECRET=$(openssl rand -hex 32)
    DEPLOY_POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/\n' | head -c 32)
    DEPLOY_ANON_KEY=$(_generate_jwt "anon" "$DEPLOY_JWT_SECRET")
    DEPLOY_SERVICE_ROLE_KEY=$(_generate_jwt "service_role" "$DEPLOY_JWT_SECRET")
    DEPLOY_PG_META_CRYPTO_KEY=$(openssl rand -hex 16)
    log "Schlüssel generiert"
}

# ─── Server: Konfiguration abfragen ─────────────────────────────

# Globale Deploy-Variablen (werden in collect_config gesetzt)
DEPLOY_DOMAIN=""
DEPLOY_PROTOCOL="https"
DEPLOY_GIT_REMOTE=""
DEPLOY_GIT_BRANCH="master"
DEPLOY_APP_PORT=""
DEPLOY_API_PORT=""
DEPLOY_DB_PORT=""
DEPLOY_STUDIO_PORT=""
DEPLOY_COMPOSE_PROJECT=""
DEPLOY_JWT_SECRET=""
DEPLOY_POSTGRES_PASSWORD=""
DEPLOY_ANON_KEY=""
DEPLOY_SERVICE_ROLE_KEY=""
DEPLOY_PG_META_CRYPTO_KEY=""
DEPLOY_DATA_TRANSFER_PASSWORD=""
SMTP_HOST=""
SMTP_PORT="465"
SMTP_USER=""
SMTP_PASS=""
SMTP_ADMIN_EMAIL=""
SMTP_SENDER_NAME="Ameise"
DEPLOY_DOCKER_SUBNET=""

# Lädt gespeicherte Konfiguration (idempotenter Re-Run)
_load_saved_config() {
    local cfg="${DIR_BASE}/config.env.${ENV_TARGET}"
    [ -f "$cfg" ] || cfg="${DIR_BASE}/config.env"
    [ -f "$cfg" ] || return 0
    # shellcheck source=/dev/null
    source "$cfg"
    # DIR_BASE aus config.env übernehmen und abhängige Pfade aktualisieren
    if [ -n "${DIR_BASE:-}" ]; then
        DIR_CONFIGS="${DIR_BASE}/${ENV_TARGET}/configs"
        DIR_BACKUPS="${DIR_BASE}/backups"
        DIR_LOGS="${DIR_BASE}/logs"
        DEPLOY_ENV_FILE="${DIR_BASE}/deploy.env"
    fi
    echo -e "  ${GREEN}✓${NC} Vorherige Konfiguration geladen."
    echo -e "  ${DIM}Enter = bisherigen Wert übernehmen.${NC}"
    echo ""
}

# Speichert nicht-sensible Konfiguration für Re-Runs (pro Umgebung)
_save_config() {
    local cfg="${DIR_BASE}/config.env.${ENV_TARGET}"
    # /opt/masitcon erfordert Root-Rechte – sudo mit Ownership-Transfer
    if ! mkdir -p "$DIR_BASE" 2>/dev/null; then
        info "Erstelle ${DIR_BASE} mit sudo..."
        sudo mkdir -p "$DIR_BASE"
        sudo chown "$(id -u):$(id -g)" "$DIR_BASE"
    fi
    cat > "$cfg" << SAVEDCFG
# Gespeicherte Konfiguration – ${PROJECT_DISPLAY}
# Automatisch von deploy.sh generiert – nicht manuell bearbeiten
DIR_BASE=${DIR_BASE}
DEPLOY_DOMAIN=${DEPLOY_DOMAIN}
DEPLOY_PROTOCOL=${DEPLOY_PROTOCOL}
DEPLOY_GIT_REMOTE=${DEPLOY_GIT_REMOTE}
DEPLOY_GIT_BRANCH=${DEPLOY_GIT_BRANCH}
DEPLOY_APP_PORT=${DEPLOY_APP_PORT}
DEPLOY_API_PORT=${DEPLOY_API_PORT}
DEPLOY_DB_PORT=${DEPLOY_DB_PORT}
DEPLOY_STUDIO_PORT=${DEPLOY_STUDIO_PORT}
DEPLOY_COMPOSE_PROJECT=${DEPLOY_COMPOSE_PROJECT}
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_ADMIN_EMAIL=${SMTP_ADMIN_EMAIL}
SMTP_SENDER_NAME=${SMTP_SENDER_NAME}
DEPLOY_DOCKER_SUBNET=${DEPLOY_DOCKER_SUBNET}
SAVEDCFG
    chmod 600 "$cfg"
}

# Sendet eine echte Test-E-Mail via curl um SMTP-Credentials zu verifizieren
_smtp_send_test() {
    local recipient="$1"
    local subject="Ameise SMTP-Test (${ENV_TARGET})"
    local body
    body="Hallo,

dies ist eine automatische Test-E-Mail von deploy.sh.

Konfiguration:
  Host:     ${SMTP_HOST}:${SMTP_PORT}
  Absender: ${SMTP_ADMIN_EMAIL}
  Umgebung: ${ENV_TARGET}

Wenn du diese Mail erhältst, funktioniert SMTP korrekt.

-- Ameise Deploy-Script"

    if ! command -v curl >/dev/null 2>&1; then
        warn "curl nicht gefunden – SMTP-Test übersprungen"
        return 0
    fi

    info "Sende Test-E-Mail an ${recipient}..."

    local protocol="smtps"
    local curl_tls_flag=""
    if [ "$SMTP_PORT" = "587" ]; then
        protocol="smtp"
        curl_tls_flag="--ssl-reqd"
    fi

    local mail_content
    mail_content="From: ${SMTP_SENDER_NAME:-Ameise} <${SMTP_ADMIN_EMAIL}>
To: ${recipient}
Subject: ${subject}
Content-Type: text/plain; charset=UTF-8

${body}"

    if echo "$mail_content" | timeout 15 curl --silent --show-error \
        $curl_tls_flag \
        --url "${protocol}://${SMTP_HOST}:${SMTP_PORT}" \
        --user "${SMTP_USER}:${SMTP_PASS}" \
        --mail-from "${SMTP_ADMIN_EMAIL}" \
        --mail-rcpt "${recipient}" \
        --upload-file - 2>&1; then
        log "Test-E-Mail erfolgreich gesendet an ${recipient}"
    else
        warn "Test-E-Mail konnte nicht gesendet werden"
        warn "SMTP-Daten prüfen: Host, Port, Benutzername, Passwort"
        info "Konfiguration wird trotzdem gespeichert – später prüfen."
    fi
}

collect_config() {
    header "Server-Konfiguration"

    # Umgebung abfragen wenn nicht per --env gesetzt
    if [ "$ENV_EXPLICIT" != true ]; then
        echo "  Welche Umgebung einrichten?"
        echo "    1) production"
        echo "    2) staging"
        echo ""
        local c; c=$(ask "Auswahl [1/2]" "1")
        case "$c" in
            2) ENV_TARGET="staging" ;;
            *) ENV_TARGET="production" ;;
        esac
        DIR_CONFIGS="${DIR_BASE}/${ENV_TARGET}/configs"
    fi
    log "Umgebung: ${ENV_TARGET}"
    echo ""

    # ── 0. Konfigurationsverzeichnis ─────────────────────────────
    # Das Repo-Verzeichnis (DIR_APP) ist immer dort wo deploy.sh liegt.
    # Hier wird nur das Verzeichnis für Secrets und Nginx-Snippets abgefragt.
    if [ -z "$CLI_BASE_DIR" ]; then
        echo "  ${DIM}Verzeichnis für Konfiguration und Secrets (nicht das Repo selbst).${NC}"
        echo "  ${DIM}Empfehlung: /opt/masitcon/ameise${NC}"
        echo ""
        local new_base; new_base=$(ask "Konfigurationsverzeichnis" "${DIR_BASE}")
        if [ -n "$new_base" ] && [ "$new_base" != "$DIR_BASE" ]; then
            DIR_BASE="$new_base"
            DIR_CONFIGS="${DIR_BASE}/${ENV_TARGET}/configs"
            DIR_BACKUPS="${DIR_BASE}/backups"
            DIR_LOGS="${DIR_BASE}/logs"
            DEPLOY_ENV_FILE="${DIR_BASE}/deploy.env"
        fi
        log "Konfigurationsverzeichnis: ${DIR_BASE}"
        log "Repo-Verzeichnis:          ${DIR_APP}"
        echo ""
    fi

    # Gespeicherte Config laden (idempotenz)
    _load_saved_config

    # ── 1. Git ───────────────────────────────────────────────────
    header "1/6  Git-Repository"

    local default_remote="${DEPLOY_GIT_REMOTE:-}"
    if [ -z "$default_remote" ] && git remote get-url origin >/dev/null 2>&1; then
        default_remote=$(git remote get-url origin 2>/dev/null)
    fi
    DEPLOY_GIT_REMOTE=$(ask "Git Remote URL" "${default_remote:-git@github.com:josefhaider/masitcon-tools-ameise.git}")
    DEPLOY_GIT_BRANCH=$(ask "Git Branch" "${DEPLOY_GIT_BRANCH:-master}")

    # ── 2. Domain & Protokoll ────────────────────────────────────
    header "2/6  Domain"

    echo "  ${DIM}Unter welcher Adresse ist die App im Browser erreichbar?${NC}"
    echo "  ${DIM}Beispiel: zeiterfassung.example.com${NC}"
    echo ""
    DEPLOY_DOMAIN=$(ask "Domain" "${DEPLOY_DOMAIN:-}")
    if [ -z "$DEPLOY_DOMAIN" ]; then
        err "Domain ist Pflicht"; exit 1
    fi

    echo ""
    echo "  Protokoll:"
    echo "    1) HTTPS  (empfohlen – Zertifikat via Certbot/Let's Encrypt)"
    echo "    2) HTTP   (nur für interne/lokale Server)"
    echo ""
    local default_proto_choice="1"
    [ "${DEPLOY_PROTOCOL:-https}" = "http" ] && default_proto_choice="2"
    local proto_choice; proto_choice=$(ask "Auswahl" "$default_proto_choice")
    [ "$proto_choice" = "2" ] && DEPLOY_PROTOCOL="http" || DEPLOY_PROTOCOL="https"

    # Abgeleitete URLs (automatisch berechnet – kein manuelles Eingreifen nötig)
    local SITE_URL="${DEPLOY_PROTOCOL}://${DEPLOY_DOMAIN}"
    local API_EXTERNAL_URL="${SITE_URL}/supabase"    # Kong via Nginx-Pfadrouting
    local VITE_SUPABASE_URL="${API_EXTERNAL_URL}"    # zur Build-Zeit eingebettet
    local SITE_HOSTNAME="${DEPLOY_DOMAIN}"

    log "App-URL:   ${SITE_URL}"
    log "API-URL:   ${API_EXTERNAL_URL}  (Kong via /supabase/*)"

    # ── 3. Supabase-Schlüssel ────────────────────────────────────
    header "3/6  Supabase-Schlüssel"

    echo "  ${DIM}Alle kryptografischen Schlüssel werden automatisch generiert.${NC}"
    echo "  ${DIM}Du kannst sie nach der Anzeige übernehmen oder manuell überschreiben.${NC}"
    echo ""

    if ! command -v openssl >/dev/null 2>&1; then
        err "openssl nicht gefunden – kann Schlüssel nicht generieren"
        info "Installation: sudo apt install openssl"
        exit 1
    fi

    # Bereits vorhandene Schlüssel aus gespeicherter .env laden
    local secrets_file="${DIR_BASE}/secrets.env"
    if [ -f "$secrets_file" ]; then
        # shellcheck source=/dev/null
        source "$secrets_file"
        # secrets.env nutzt Namen ohne DEPLOY_-Prefix → auf DEPLOY_-Variablen mappen
        # (wichtig bei erneutem Setup / Reconfigure, sonst bleibt DEPLOY_POSTGRES_PASSWORD leer)
        [ -n "${JWT_SECRET:-}"              ] && DEPLOY_JWT_SECRET="$JWT_SECRET"
        [ -n "${POSTGRES_PASSWORD:-}"       ] && DEPLOY_POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
        [ -n "${ANON_KEY:-}"                ] && DEPLOY_ANON_KEY="$ANON_KEY"
        [ -n "${SERVICE_ROLE_KEY:-}"        ] && DEPLOY_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
        [ -n "${PG_META_CRYPTO_KEY:-}"      ] && DEPLOY_PG_META_CRYPTO_KEY="$PG_META_CRYPTO_KEY"
        [ -n "${DATA_TRANSFER_PASSWORD:-}"  ] && DEPLOY_DATA_TRANSFER_PASSWORD="$DATA_TRANSFER_PASSWORD"
        [ -n "${COMPOSE_PROJECT_NAME:-}"    ] && DEPLOY_COMPOSE_PROJECT="$COMPOSE_PROJECT_NAME"
        warn "Vorhandene Schlüssel aus secrets.env geladen – NICHT neu generieren!"
        warn "(Neue Schlüssel würden alle bestehenden Sessions ungültig machen)"
        echo ""
        if ! confirm "Vorhandene Schlüssel beibehalten?" "j"; then
            generate_supabase_keys
        fi
    else
        generate_supabase_keys
    fi

    echo ""
    echo -e "  ${BOLD}Generierte Schlüssel:${NC}"
    echo -e "  ${DIM}JWT_SECRET:        ${DEPLOY_JWT_SECRET:0:8}...${NC}"
    echo -e "  ${DIM}POSTGRES_PASSWORD: ${DEPLOY_POSTGRES_PASSWORD:0:4}...${NC}"
    echo -e "  ${DIM}ANON_KEY:          ${DEPLOY_ANON_KEY:0:20}...${NC}"
    echo -e "  ${DIM}SERVICE_ROLE_KEY:  ${DEPLOY_SERVICE_ROLE_KEY:0:20}...${NC}"
    echo ""

    if confirm "Schlüssel manuell überschreiben?" "n"; then
        echo ""
        info "Enter lässt den generierten Wert unverändert."
        echo ""
        local v
        v=$(ask "JWT_SECRET" "$DEPLOY_JWT_SECRET"); [ -n "$v" ] && DEPLOY_JWT_SECRET="$v"
        v=$(ask "POSTGRES_PASSWORD" "$DEPLOY_POSTGRES_PASSWORD"); [ -n "$v" ] && DEPLOY_POSTGRES_PASSWORD="$v"
        v=$(ask "ANON_KEY" "$DEPLOY_ANON_KEY"); [ -n "$v" ] && DEPLOY_ANON_KEY="$v"
        v=$(ask "SERVICE_ROLE_KEY" "$DEPLOY_SERVICE_ROLE_KEY"); [ -n "$v" ] && DEPLOY_SERVICE_ROLE_KEY="$v"
    fi

    # Datentransfer-Passwort (Edge Function)
    echo ""
    echo "  ${DIM}Die Edge Function 'employee-data-transfer' benötigt ein Passwort${NC}"
    echo "  ${DIM}für den gesicherten Datenaustausch zwischen Mandanten.${NC}"
    echo ""
    if [ -n "${DEPLOY_DATA_TRANSFER_PASSWORD:-}" ]; then
        info "Bestehendes Datentransfer-Passwort beibehalten (Enter)"
        local dtp; dtp=$(ask_secret "Datentransfer-Passwort (Enter = beibehalten)")
        [ -n "$dtp" ] && DEPLOY_DATA_TRANSFER_PASSWORD="$dtp"
    else
        DEPLOY_DATA_TRANSFER_PASSWORD=$(ask_secret "Datentransfer-Passwort (Enter = auto)")
        if [ -z "$DEPLOY_DATA_TRANSFER_PASSWORD" ]; then
            DEPLOY_DATA_TRANSFER_PASSWORD=$(openssl rand -base64 12 | tr -d '=+/')
            log "Datentransfer-Passwort auto-generiert"
        fi
    fi

    # ── 4. E-Mail / SMTP (optional) ─────────────────────────────
    header "4/6  E-Mail (SMTP) – optional"

    echo "  ${DIM}Supabase Auth versendet E-Mails für Passwort-Reset und Einladungen.${NC}"
    echo "  ${DIM}Ohne SMTP funktioniert die App, aber E-Mails werden nicht zugestellt.${NC}"
    echo ""

    local configure_smtp=false
    if [ -n "${SMTP_HOST:-}" ]; then
        info "Vorhandene SMTP-Konfiguration: ${SMTP_HOST}:${SMTP_PORT} (${SMTP_USER})"
        configure_smtp=true
    else
        confirm "SMTP konfigurieren?" "j" && configure_smtp=true
    fi

    if $configure_smtp; then
        SMTP_HOST=$(ask "SMTP-Host" "${SMTP_HOST:-smtp.example.com}")
        SMTP_PORT=$(ask "SMTP-Port (465=SMTPS, 587=STARTTLS)" "${SMTP_PORT:-465}")
        SMTP_USER=$(ask "SMTP-Benutzername / E-Mail-Adresse" "${SMTP_USER:-}")

        local prev_pass_hint=""
        [ -n "${SMTP_PASS:-}" ] && prev_pass_hint=" (Enter = bisheriges behalten)"
        local new_pass; new_pass=$(ask_secret "SMTP-Passwort${prev_pass_hint}")
        [ -n "$new_pass" ] && SMTP_PASS="$new_pass"

        echo ""
        SMTP_ADMIN_EMAIL=$(ask "Absender-E-Mail" "${SMTP_ADMIN_EMAIL:-${SMTP_USER}}")
        SMTP_SENDER_NAME=$(ask "Absendername (erscheint in E-Mails)" "${SMTP_SENDER_NAME:-Ameise}")
        echo ""

        # SMTP-Test: echte Test-E-Mail senden via curl
        if [ -n "$SMTP_PASS" ]; then
            if confirm "Test-E-Mail senden um SMTP zu verifizieren?" "j"; then
                local test_recipient; test_recipient=$(ask "Empfänger-E-Mail für Test" "${SMTP_ADMIN_EMAIL:-${SMTP_USER}}")
                _smtp_send_test "$test_recipient"
            fi
        fi
    else
        SMTP_HOST="" SMTP_PORT="465" SMTP_USER="" SMTP_PASS="" SMTP_ADMIN_EMAIL="" SMTP_SENDER_NAME="Ameise"
        info "SMTP übersprungen. Später eintragen: ${DIR_BASE}/secrets.env → Stack neu starten."
    fi

    # ── 5. Ports ─────────────────────────────────────────────────
    header "5/6  Ports"

    echo "  ${DIM}Ports werden automatisch gesucht. Alle binden an 127.0.0.1 –${NC}"
    echo "  ${DIM}kein Internetzugriff ohne Nginx.${NC}"
    echo ""
    echo "  ${DIM}Studio-Port: nur via SSH-Tunnel erreichbar.${NC}"
    echo ""

    # Startpunkte (aus gespeicherter Config oder Defaults)
    local start_app="${DEPLOY_APP_PORT:-8080}"
    local start_api="${DEPLOY_API_PORT:-8100}"
    local start_db="${DEPLOY_DB_PORT:-5440}"
    local start_studio="${DEPLOY_STUDIO_PORT:-3100}"

    # Wenn Port von eigenem Stack belegt: behalten. Sonst freien Port suchen.
    if is_port_used_by_our_stack "$start_app"; then DEPLOY_APP_PORT="$start_app"
    else DEPLOY_APP_PORT=$(find_free_port "$start_app"); [ -z "$DEPLOY_APP_PORT" ] && DEPLOY_APP_PORT="$start_app"; fi

    if is_port_used_by_our_stack "$start_api"; then DEPLOY_API_PORT="$start_api"
    else DEPLOY_API_PORT=$(find_free_port "$start_api"); [ -z "$DEPLOY_API_PORT" ] && DEPLOY_API_PORT="$start_api"; fi

    if is_port_used_by_our_stack "$start_db"; then DEPLOY_DB_PORT="$start_db"
    else DEPLOY_DB_PORT=$(find_free_port "$start_db"); [ -z "$DEPLOY_DB_PORT" ] && DEPLOY_DB_PORT="$start_db"; fi

    if is_port_used_by_our_stack "$start_studio"; then DEPLOY_STUDIO_PORT="$start_studio"
    else DEPLOY_STUDIO_PORT=$(find_free_port "$start_studio"); [ -z "$DEPLOY_STUDIO_PORT" ] && DEPLOY_STUDIO_PORT="$start_studio"; fi

    echo "  Gefundene freie Ports:"
    printf "    %-30s %s" "App (serve):" "$DEPLOY_APP_PORT"
    is_port_free "$DEPLOY_APP_PORT" && echo -e "  ${GREEN}frei${NC}" || echo -e "  ${RED}BELEGT${NC}"
    printf "    %-30s %s" "Supabase API (Kong):" "$DEPLOY_API_PORT"
    is_port_free "$DEPLOY_API_PORT" && echo -e "  ${GREEN}frei${NC}" || echo -e "  ${RED}BELEGT${NC}"
    printf "    %-30s %s" "PostgreSQL:" "$DEPLOY_DB_PORT"
    is_port_free "$DEPLOY_DB_PORT" && echo -e "  ${GREEN}frei${NC}" || echo -e "  ${RED}BELEGT${NC}"
    printf "    %-30s %s" "Studio (SSH-Tunnel):" "$DEPLOY_STUDIO_PORT"
    is_port_free "$DEPLOY_STUDIO_PORT" && echo -e "  ${GREEN}frei${NC}" || echo -e "  ${RED}BELEGT${NC}"
    echo ""

    if ! confirm "Ports übernehmen?" "j"; then
        echo ""
        info "Ports einzeln eingeben (Enter = vorgeschlagenen Wert):"
        DEPLOY_APP_PORT=$(ask "  App (serve)" "$DEPLOY_APP_PORT")
        DEPLOY_API_PORT=$(ask "  Supabase API (Kong)" "$DEPLOY_API_PORT")
        DEPLOY_DB_PORT=$(ask "  PostgreSQL" "$DEPLOY_DB_PORT")
        DEPLOY_STUDIO_PORT=$(ask "  Studio" "$DEPLOY_STUDIO_PORT")
    fi

    # Belegte Ports prüfen – eigene Container sind erlaubt (Reconfigure/Update)
    local _prefix="${DEPLOY_COMPOSE_PROJECT:-${PROJECT_NAME}-${ENV_TARGET}}"
    for _p in "$DEPLOY_APP_PORT" "$DEPLOY_API_PORT" "$DEPLOY_DB_PORT" "$DEPLOY_STUDIO_PORT"; do
        if ! is_port_free "$_p"; then
            local _occ; _occ=$(get_port_occupant "$_p")
            # Eigenen Stack erlauben (z.B. Docker: masitcon-tools-ameise-staging-kong)
            if [[ "$_occ" == "Docker: ${_prefix}-"* ]]; then
                info "Port $_p: von eigenem Stack belegt – OK für Reconfigure/Update"
            else
                err "Port $_p ist belegt: $_occ"
                err "Stoppe den Prozess oder wähle einen anderen Port."
                exit 1
            fi
        fi
    done

    # Container-Prefix: automatisch aus Projektname + Umgebung
    local default_cpn="${PROJECT_NAME}-${ENV_TARGET}"
    DEPLOY_COMPOSE_PROJECT=$(ask "Container-Prefix (COMPOSE_PROJECT_NAME)" "${DEPLOY_COMPOSE_PROJECT:-$default_cpn}")

    # ── 6. Docker-Netzwerk ───────────────────────────────────────
    header "6/6  Docker-Netzwerk"

    echo "  ${DIM}Eigenes Subnetz für Docker-Container (vermeidet IP-Konflikte${NC}"
    echo "  ${DIM}bei mehreren Stacks auf demselben Server).${NC}"
    echo "  ${DIM}Beispiel: 172.21.0.0/16  oder  10.10.2.0/24${NC}"
    echo ""

    # Standard-Subnetz aus Umgebung ableiten (production=172.20, staging=172.21)
    local default_subnet="172.20.0.0/16"
    [ "$ENV_TARGET" = "staging" ] && default_subnet="172.21.0.0/16"
    [ -n "${DEPLOY_DOCKER_SUBNET:-}" ] && default_subnet="$DEPLOY_DOCKER_SUBNET"

    DEPLOY_DOCKER_SUBNET=$(ask "Docker-Subnetz (CIDR)" "$default_subnet")

    # Konfiguration speichern
    _save_config
    log "Konfiguration gespeichert: ${DIR_BASE}/config.env.${ENV_TARGET}"

    # Abgeleitete Variablen exportieren (für write_env_file)
    _SITE_URL="${DEPLOY_PROTOCOL}://${DEPLOY_DOMAIN}"
    _API_EXTERNAL_URL="${_SITE_URL}/supabase"
    _VITE_SUPABASE_URL="${_API_EXTERNAL_URL}"
    _SITE_HOSTNAME="${DEPLOY_DOMAIN}"
}

show_summary() {
    header "Zusammenfassung"
    echo -e "  ${BOLD}Umgebung:${NC}         ${ENV_TARGET}"
    echo -e "  ${BOLD}Verzeichnis:${NC}      ${DIR_BASE}"
    echo -e "  ${BOLD}Domain:${NC}           ${DEPLOY_PROTOCOL}://${DEPLOY_DOMAIN}"
    echo -e "  ${BOLD}API (Kong):${NC}       ${_API_EXTERNAL_URL}"
    echo -e "  ${BOLD}Git:${NC}              ${DEPLOY_GIT_REMOTE} (${DEPLOY_GIT_BRANCH})"
    echo ""
    echo -e "  ${BOLD}Ports (127.0.0.1 only):${NC}"
    printf "    %-26s %s\n" "App:" "$DEPLOY_APP_PORT"
    printf "    %-26s %s\n" "Kong (API):" "$DEPLOY_API_PORT"
    printf "    %-26s %s\n" "PostgreSQL:" "$DEPLOY_DB_PORT"
    printf "    %-26s %s\n" "Studio (SSH):" "$DEPLOY_STUDIO_PORT"
    echo ""
    printf "    %-26s %s\n" "Container-Prefix:" "$DEPLOY_COMPOSE_PROJECT"
    printf "    %-26s %s\n" "Docker-Subnetz:" "$DEPLOY_DOCKER_SUBNET"
    echo ""
    printf "    %-26s %s\n" "SMTP:" "$([ -n "$SMTP_HOST" ] && echo "${SMTP_HOST}:${SMTP_PORT}" || echo "(nicht konfiguriert)")"
    echo ""
    confirm "Korrekt? Setup starten?" "j" || exit 0
}

write_env_file() {
    # Haupt-Secrets-Datei (600 – nur root/deploy-user lesbar)
    local secrets_file="${DIR_BASE}/secrets.env"

    # Studio-Anzeigenamen aus Umgebung ableiten
    local studio_org="Masitcon"
    local studio_project
    case "$ENV_TARGET" in
        production) studio_project="Ameise Production" ;;
        staging)    studio_project="Ameise Staging"    ;;
        *)          studio_project="Ameise ${ENV_TARGET}" ;;
    esac

    cat > "$secrets_file" << SECRETSENV
# ${PROJECT_DISPLAY} – Supabase-Schlüssel
# Generiert am $(date '+%Y-%m-%d %H:%M') – NIEMALS committen!
# Wird von docker/docker-compose.yml über --env-file eingelesen.
COMPOSE_PROJECT_NAME="${DEPLOY_COMPOSE_PROJECT}"

# Supabase-Schlüssel
JWT_SECRET="${DEPLOY_JWT_SECRET}"
POSTGRES_PASSWORD="${DEPLOY_POSTGRES_PASSWORD}"
ANON_KEY="${DEPLOY_ANON_KEY}"
SERVICE_ROLE_KEY="${DEPLOY_SERVICE_ROLE_KEY}"
PG_META_CRYPTO_KEY="${DEPLOY_PG_META_CRYPTO_KEY}"

# Ports (alle 127.0.0.1)
APP_PORT="${DEPLOY_APP_PORT}"
API_PORT="${DEPLOY_API_PORT}"
DB_PORT="${DEPLOY_DB_PORT}"
STUDIO_PORT="${DEPLOY_STUDIO_PORT}"

# URLs (automatisch aus Domain berechnet)
SITE_URL="${_SITE_URL}"
SITE_HOSTNAME="${_SITE_HOSTNAME}"
API_EXTERNAL_URL="${_API_EXTERNAL_URL}"
VITE_SUPABASE_URL="${_VITE_SUPABASE_URL}"

# Build
BUILD_MODE="${ENV_TARGET}"

# Docker-Netzwerk
DOCKER_SUBNET="${DEPLOY_DOCKER_SUBNET}"

# Edge Functions
DATA_TRANSFER_PASSWORD="${DEPLOY_DATA_TRANSFER_PASSWORD}"
ALLOWED_ORIGIN="${_SITE_URL}"

# Supabase Studio – Anzeigename (Leerzeichen in Werten)
STUDIO_DEFAULT_ORGANIZATION="${studio_org}"
STUDIO_DEFAULT_PROJECT="${studio_project}"

# SMTP (leer = keine E-Mails)
SMTP_HOST="${SMTP_HOST}"
SMTP_PORT="${SMTP_PORT}"
SMTP_USER="${SMTP_USER}"
SMTP_PASS="${SMTP_PASS}"
SMTP_ADMIN_EMAIL="${SMTP_ADMIN_EMAIL}"
SMTP_SENDER_NAME="${SMTP_SENDER_NAME}"
SECRETSENV
    chmod 600 "$secrets_file"
    log "Secrets gespeichert: ${secrets_file}"

    # deploy.env.ENV für spätere --update / --status Aufrufe
    local deploy_env="${DIR_BASE}/deploy.env.${ENV_TARGET}"
    cat > "$deploy_env" << DEPLOYENV
# Deploy-Metadaten – ${ENV_TARGET}
DIR_CONFIGS=${DIR_CONFIGS}
DEPLOYENV
    chmod 600 "$deploy_env"
}

wait_for_health() {
    info "Warte auf Health-Check (max 120s)..."
    local DC="$1" compose_file="$2" env_file="$3"
    local i=0
    while [ $i -lt 120 ]; do
        local healthy running
        healthy=$($DC --env-file "$env_file" -f "$compose_file" ps 2>/dev/null | grep -c "healthy" || true)
        running=$($DC --env-file "$env_file" -f "$compose_file" ps 2>/dev/null | grep -c "Up" || true)
        if [ "${healthy:-0}" -ge 2 ] || [ "${running:-0}" -ge 4 ]; then
            log "Stack gestartet (${running} Container laufen)"
            return 0
        fi
        sleep 3
        i=$((i + 3))
        printf "."
    done
    echo ""
    warn "Timeout – Status prüfen: bash scripts/deploy.sh --status --env ${ENV_TARGET}"
}

# Generiert Nginx-Config. Optional: _generate_nginx_for_env "production"|"staging"
# nutzt config.env.${env}; ohne Parameter: aktuelle Umgebung.
generate_nginx_config() {
    local target_env="${1:-$ENV_TARGET}"
    local dir_configs="${DIR_BASE}/${target_env}/configs"
    local conf_file="${dir_configs}/nginx-${target_env}.conf"

    # Config für Ziel-Umgebung laden (garantiert richtige DEPLOY_* Variablen)
    local cfg="${DIR_BASE}/config.env.${target_env}"
    [ -f "$cfg" ] || cfg="${DIR_BASE}/config.env"
    if [ -f "$cfg" ]; then
        # shellcheck source=/dev/null
        source "$cfg"
    fi
    local log_dir="/var/log/nginx"
    mkdir -p "$dir_configs" 2>/dev/null || { sudo mkdir -p "$dir_configs"; sudo chown "$(id -u):$(id -g)" "$dir_configs"; }

    # SSL-Block nur bei HTTPS-Protokoll
    local ssl_block=""
    if [ "${DEPLOY_PROTOCOL}" = "https" ]; then
        ssl_block="    listen 443 ssl;
    listen [::]:443 ssl;
    ssl_certificate     /etc/letsencrypt/live/${DEPLOY_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DEPLOY_DOMAIN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;"
    else
        ssl_block="    listen 80;
    listen [::]:80;"
    fi

    cat > "$conf_file" << NGINX
# ${PROJECT_DISPLAY} – Nginx-Konfiguration (${target_env})
# ─────────────────────────────────────────────────────────────
# Routing:
#   ${DEPLOY_DOMAIN}             → App (Vite SPA, Port ${DEPLOY_APP_PORT})
#   ${DEPLOY_DOMAIN}/supabase/*  → Supabase Kong (Port ${DEPLOY_API_PORT})
#
# Einbinden:
#   sudo ln -s ${conf_file} /etc/nginx/sites-enabled/${NGINX_SITE_NAME}-${target_env}.conf
#   sudo nginx -t && sudo systemctl reload nginx
# ─────────────────────────────────────────────────────────────

server {
${ssl_block}
    server_name ${DEPLOY_DOMAIN};

    access_log ${log_dir}/${NGINX_SITE_NAME}-${target_env}-access.log;
    error_log  ${log_dir}/${NGINX_SITE_NAME}-${target_env}-error.log;

    # ── Supabase API (Kong) – /supabase/* → Kong ─────────────
    # Der /supabase-Präfix wird vor der Weiterleitung entfernt.
    location /supabase/ {
        proxy_pass         http://127.0.0.1:${DEPLOY_API_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # ── App (Vite SPA – statische Dateien via serve) ─────────
    location / {
        proxy_pass         http://127.0.0.1:${DEPLOY_APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }
}
NGINX

    # HTTP→HTTPS Redirect-Block nur bei HTTPS
    if [ "${DEPLOY_PROTOCOL}" = "https" ]; then
        cat >> "$conf_file" << REDIRECT

server {
    listen 80;
    listen [::]:80;
    server_name ${DEPLOY_DOMAIN};
    return 301 https://\$host\$request_uri;
}
REDIRECT
    fi

    log "Nginx-Konfiguration: ${conf_file}"
}

# ─── Server-Setup (Ersteinrichtung) ─────────────────────────────
setup_server() {
    header "Server-Setup – ${PROJECT_DISPLAY}"

    check_prerequisites
    collect_config
    show_summary

    # Konfigurationsverzeichnisse anlegen (ggf. sudo für /opt/masitcon)
    # Das Repo (DIR_APP) bleibt wo es ist – kein Symlink/Clone mehr nötig.
    if ! mkdir -p "$DIR_BASE" 2>/dev/null; then
        info "Erstelle Verzeichnisse mit sudo (Passwort kann abgefragt werden)..."
        sudo mkdir -p "$DIR_BASE"
        sudo chown "$(id -u):$(id -g)" "$DIR_BASE"
    fi
    for d in "$DIR_CONFIGS" "$DIR_BACKUPS" "$DIR_LOGS"; do
        mkdir -p "$d" 2>/dev/null || { sudo mkdir -p "$d"; sudo chown "$(id -u):$(id -g)" "$d"; }
    done
    log "Konfigurationsverzeichnisse erstellt: ${DIR_BASE}/"
    log "Repo-Verzeichnis: ${DIR_APP}"

    # Log-Verzeichnis (Nginx nutzt /var/log/nginx)
    sudo mkdir -p "/var/log/nginx" 2>/dev/null || true

    # Repo-Stand prüfen und aktualisieren
    local git_hash; git_hash=$(git -C "$DIR_APP" rev-parse --short HEAD 2>/dev/null || echo 'unbekannt')
    log "Repo: ${git_hash}"

    # Env-Datei schreiben (enthält alle Secrets)
    write_env_file

    # Nginx-Konfiguration generieren (vor Container-Start)
    generate_nginx_config

    # Container bauen und starten
    local DC; DC=$(detect_compose)
    local COMPOSE_FILE="${DIR_APP}/docker/docker-compose.yml"
    local SECRETS_FILE="${DIR_BASE}/secrets.env"
    [ -z "$DC" ] && { err "Docker Compose nicht gefunden"; exit 1; }
    [ ! -f "$COMPOSE_FILE" ] && { err "docker/docker-compose.yml nicht gefunden unter ${DIR_APP}"; exit 1; }
    [ ! -f "$SECRETS_FILE" ] && { err "secrets.env nicht gefunden – Setup fehlgeschlagen"; exit 1; }
    _check_postgres_password "$SECRETS_FILE"

    info "Baue und starte Stack (${DEPLOY_COMPOSE_PROJECT})..."
    $DC --env-file "$SECRETS_FILE" -f "$COMPOSE_FILE" up -d --build \
        || {
            err "docker compose up fehlgeschlagen"
            info "Bei 'Pool overlaps with other': Anderes Docker-Subnetz wählen: bash scripts/deploy.sh --reconfigure --env ${ENV_TARGET}"
            info "Dort z.B. 172.22.0.0/16 oder 10.10.20.0/24 eintragen (nicht 172.20/172.21 wenn schon belegt)."
            _show_db_crash_logs
            exit 1
        }

    wait_for_health "$DC" "$COMPOSE_FILE" "$SECRETS_FILE"

    # Migrationen anwenden (läuft idempotent – überspringt bereits angewendete)
    # init-migrations.sh hat sie beim ersten DB-Start bereits angewendet;
    # do_migrate() stellt sicher dass nichts fehlt und zeigt den Status an.
    info "Verifiziere Datenbankmigrationen..."
    do_migrate || { err "Migrationen fehlgeschlagen – Deployment abgebrochen"; exit 1; }

    # Zeitstempel speichern
    date '+%Y-%m-%d %H:%M:%S' > "${DIR_BASE}/.last-deploy"

    echo ""
    echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║   Deployment abgeschlossen!                          ║${NC}"
    echo -e "${BOLD}${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BOLD}App:${NC}       ${DEPLOY_PROTOCOL}://${DEPLOY_DOMAIN}"
    echo -e "  ${BOLD}API:${NC}       ${DEPLOY_PROTOCOL}://${DEPLOY_DOMAIN}/supabase"
    echo -e "  ${BOLD}Studio:${NC}    127.0.0.1:${DEPLOY_STUDIO_PORT}  (SSH-Tunnel nötig)"
    echo ""
    echo -e "  ${BOLD}Nächste Schritte:${NC}"
    echo "    1. Nginx-Konfiguration einbinden:"
    echo "       sudo ln -s ${DIR_CONFIGS}/nginx-${ENV_TARGET}.conf /etc/nginx/sites-enabled/${NGINX_SITE_NAME}-${ENV_TARGET}.conf"
    echo "       sudo nginx -t && sudo systemctl reload nginx"
    echo ""
    echo "    2. Studio via SSH-Tunnel:"
    echo "       ssh -L ${DEPLOY_STUDIO_PORT}:127.0.0.1:${DEPLOY_STUDIO_PORT} user@server"
    echo "       Browser: http://localhost:${DEPLOY_STUDIO_PORT}"
    echo ""
    echo "    3. Status: bash scripts/deploy.sh --status --env ${ENV_TARGET}"
    echo "    4. Logs:   bash scripts/deploy.sh --logs --env ${ENV_TARGET}"
    echo ""
    echo -e "  ${DIM}Schlüssel gespeichert in: ${DIR_BASE}/secrets.env  (chmod 600)${NC}"
    echo ""
}

# ─── Hilfsfunktion: Compose-Pfad und Secrets ermitteln ──────────
get_compose_file() {
    load_or_init_dirs
    # Neuer Pfad: docker/docker-compose.yml (self-hosted Supabase)
    local cf="${DIR_APP}/docker/docker-compose.yml"
    [ -f "$cf" ] && { echo "$cf"; return 0; }
    # Fallback: alter Pfad (app-only)
    local cf_old="${DIR_APP}/scripts/docker-compose.yml"
    [ -f "$cf_old" ] && { echo "$cf_old"; return 0; }
    echo ""
    return 1
}

get_secrets_file() {
    local sf="${DIR_BASE}/secrets.env"
    [ -f "$sf" ] && { echo "$sf"; return 0; }
    echo ""
    return 1
}

# ─── Server-Modi ────────────────────────────────────────────────
do_status() {
    header "Status – ${PROJECT_DISPLAY} (${ENV_TARGET})"

    # Lokal: Supabase + Docker prüfen
    if [ -d .git ] && [ -f supabase/config.toml ]; then
        info "Lokale Umgebung erkannt"
        if command -v supabase >/dev/null 2>&1; then
            echo ""
            supabase status 2>/dev/null || info "Supabase nicht gestartet"
        fi
        echo ""
        info "Docker-Container (${PROJECT_NAME}):"
        docker ps --filter "name=supabase" --filter "name=masitcon" --format "  {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
        return 0
    fi

    # Server: Compose-Status
    local cf; cf=$(get_compose_file)
    local sf; sf=$(get_secrets_file)
    local DC; DC=$(detect_compose)
    if [ -n "$cf" ] && [ -n "$sf" ]; then
        $DC --env-file "$sf" -f "$cf" ps
        echo ""
        if [ -f "${DIR_BASE}/.last-deploy" ]; then
            info "Letzter Deploy: $(cat "${DIR_BASE}/.last-deploy")"
        fi
        info "Docker Volumes:"
        docker system df -v 2>/dev/null | grep -E "(VOLUME|${PROJECT_NAME})" | head -10 || true
    elif [ -n "$cf" ]; then
        $DC -f "$cf" ps
    else
        info "Kein Server-Setup gefunden"
        info "Nutze --local für lokale Entwicklung oder starte Server-Setup ohne Flags"
    fi
}

do_logs() {
    local cf; cf=$(get_compose_file)
    local sf; sf=$(get_secrets_file)
    local DC; DC=$(detect_compose)
    if [ -n "$cf" ] && [ -n "$sf" ]; then
        $DC --env-file "$sf" -f "$cf" logs -f ${SHOW_LOGS_SERVICE:+$SHOW_LOGS_SERVICE}
    elif [ -n "$cf" ]; then
        $DC -f "$cf" logs -f ${SHOW_LOGS_SERVICE:+$SHOW_LOGS_SERVICE}
    else
        err "Kein docker-compose.yml gefunden"
        info "Server-Setup zuerst ausführen: bash scripts/deploy.sh --env ${ENV_TARGET}"
    fi
}

do_stop() {
    header "Stoppen – ${PROJECT_DISPLAY}"
    local cf; cf=$(get_compose_file)
    local sf; sf=$(get_secrets_file)
    local DC; DC=$(detect_compose)
    if [ -n "$cf" ] && [ -n "$sf" ]; then
        $DC --env-file "$sf" -f "$cf" stop
        log "Container gestoppt"
    elif [ -n "$cf" ]; then
        $DC -f "$cf" stop
        log "Container gestoppt"
    else
        err "Kein docker-compose.yml gefunden"
    fi
}

do_restart() {
    header "Neu starten – ${PROJECT_DISPLAY}"
    local cf; cf=$(get_compose_file)
    local sf; sf=$(get_secrets_file)
    local DC; DC=$(detect_compose)
    if [ -n "$cf" ] && [ -n "$sf" ]; then
        $DC --env-file "$sf" -f "$cf" restart
        log "Container neu gestartet"
    elif [ -n "$cf" ]; then
        $DC -f "$cf" restart
        log "Container neu gestartet"
    else
        err "Kein docker-compose.yml gefunden"
    fi
}

do_update() {
    header "Update – ${PROJECT_DISPLAY} (${ENV_TARGET})"
    load_or_init_dirs

    if [ ! -d "${DIR_APP}/.git" ]; then
        err "Kein Git-Repo unter ${DIR_APP}"
        info "deploy.sh muss aus dem Repo-Verzeichnis heraus ausgeführt werden"
        exit 1
    fi

    local DC; DC=$(detect_compose)
    local COMPOSE_FILE="${DIR_APP}/docker/docker-compose.yml"
    local SECRETS_FILE="${DIR_BASE}/secrets.env"
    [ -z "$DC" ] && { err "Docker Compose nicht gefunden"; exit 1; }
    [ ! -f "$COMPOSE_FILE" ] && { err "docker/docker-compose.yml nicht gefunden"; exit 1; }
    [ ! -f "$SECRETS_FILE" ] && { err "secrets.env nicht gefunden – zuerst Server-Setup ausführen"; exit 1; }
    _check_postgres_password "$SECRETS_FILE"

    # Git pull
    info "Ziehe neuesten Stand..."
    git -C "$DIR_APP" fetch origin
    git -C "$DIR_APP" pull origin "$(git -C "$DIR_APP" rev-parse --abbrev-ref HEAD 2>/dev/null || echo master)"
    log "Repo aktualisiert: $(git -C "$DIR_APP" rev-parse --short HEAD 2>/dev/null)"

    # Neue Migrationen anwenden (vor Container-Neustart)
    info "Prüfe und wende neue Datenbankmigrationen an..."
    do_migrate || { err "Migrationen fehlgeschlagen – Update abgebrochen"; exit 1; }

    # App-Container neu bauen (VITE_* aus secrets.env)
    info "Baue App-Container neu (VITE_SUPABASE_URL wird neu eingebettet)..."
    $DC --env-file "$SECRETS_FILE" -f "$COMPOSE_FILE" up -d --build app \
        || {
            err "docker compose up fehlgeschlagen"
            info "Bei 'Pool overlaps with other': Anderes Docker-Subnetz: bash scripts/deploy.sh --reconfigure --env ${ENV_TARGET}"
            _show_db_crash_logs
            exit 1
        }

    # Andere Container nur neu starten (nicht neu bauen)
    $DC --env-file "$SECRETS_FILE" -f "$COMPOSE_FILE" up -d

    wait_for_health "$DC" "$COMPOSE_FILE" "$SECRETS_FILE"

    date '+%Y-%m-%d %H:%M:%S' > "${DIR_BASE}/.last-deploy"
    log "Update abgeschlossen"
}

do_clean() {
    header "Projekt entfernen – ${PROJECT_DISPLAY} (${ENV_TARGET})"
    load_or_init_dirs

    # Lokal
    if [ -d .git ] && [ -f supabase/config.toml ]; then
        warn "Lokale Umgebung erkannt"
        if confirm "Supabase stoppen und lokale .env löschen?" "n"; then
            supabase stop 2>/dev/null || true
            rm -f .env supabase/.env
            log "Lokale Umgebung bereinigt"
        fi
        return 0
    fi

    # Server
    local cf; cf=$(get_compose_file)
    local sf; sf=$(get_secrets_file)
    local DC; DC=$(detect_compose)
    if [ -n "$cf" ]; then
        warn "Dies entfernt ALLE Container und Docker-Volumes für ${ENV_TARGET}!"
        warn "Datenbankinhalte gehen verloren!"
        confirm "Wirklich fortfahren?" "n" || return 0
        confirm "LETZTE WARNUNG – alle Daten in ${ENV_TARGET} gehen verloren. Sicher?" "n" || return 0

        if [ -n "$sf" ]; then
            $DC --env-file "$sf" -f "$cf" down -v
        else
            $DC -f "$cf" down -v
        fi
        log "Container und Volumes entfernt"

        if [ "$CLEAN_FULL" = true ]; then
            warn "Lösche ${DIR_BASE}/${ENV_TARGET}/ komplett..."
            rm -rf "${DIR_BASE:?}/${ENV_TARGET}"
            rm -f "${DIR_BASE}/deploy.env.${ENV_TARGET}"
            rm -f "${DIR_BASE}/secrets.env"
            rm -f "${DIR_BASE}/config.env" "${DIR_BASE}/config.env.production" "${DIR_BASE}/config.env.staging"
            log "Verzeichnisse und Konfiguration gelöscht"
        fi
    else
        info "Kein Server-Setup gefunden für ${ENV_TARGET}"
        info "Für lokale Bereinigung: supabase stop"
    fi
}

do_prune() {
    header "Docker aufräumen"
    if confirm "Ungenutzte Images, Container und Volumes entfernen?" "j"; then
        docker system prune -f
        docker volume prune -f
        log "Docker bereinigt"
    fi
}

do_reset_db() {
    header "DB-Volume zurücksetzen – ${PROJECT_DISPLAY} (${ENV_TARGET})"
    warn "ACHTUNG: Alle Daten in der Datenbank werden unwiderruflich gelöscht!"
    confirm "Wirklich fortfahren?" "n" || exit 0
    confirm "LETZTE WARNUNG – alle Datenbankdaten in ${ENV_TARGET} gehen verloren. Sicher?" "n" || exit 0

    load_or_init_dirs
    local sf; sf=$(get_secrets_file)
    local DC; DC=$(detect_compose)
    local cf="${DIR_APP}/docker/docker-compose.yml"

    if [ ! -f "$cf" ]; then
        err "docker-compose.yml nicht gefunden: $cf"
        info "Führe zuerst setup aus: bash scripts/deploy.sh --env ${ENV_TARGET}"
        exit 1
    fi

    local db_container="${DEPLOY_COMPOSE_PROJECT:-${COMPOSE_PROJECT_NAME:-${PROJECT_NAME}-${ENV_TARGET}}}-db"
    local db_volume="${DEPLOY_COMPOSE_PROJECT:-${COMPOSE_PROJECT_NAME:-${PROJECT_NAME}-${ENV_TARGET}}}_db-data"

    info "Stoppe DB-Container..."
    if [ -n "$sf" ]; then
        $DC --env-file "$sf" -f "$cf" stop db 2>/dev/null || true
        $DC --env-file "$sf" -f "$cf" rm -f db 2>/dev/null || true
    else
        $DC -f "$cf" stop db 2>/dev/null || true
        $DC -f "$cf" rm -f db 2>/dev/null || true
    fi

    info "Entferne DB-Volume ${db_volume}..."
    if docker volume rm "$db_volume" 2>/dev/null; then
        log "Volume entfernt"
    else
        warn "Volume '${db_volume}' nicht gefunden oder konnte nicht entfernt werden"
        info "Verfügbare Volumes: $(docker volume ls --format '{{.Name}}' | grep "${DEPLOY_COMPOSE_PROJECT:-${PROJECT_NAME}-${ENV_TARGET}}" || echo "(keine passenden)")"
    fi

    info "Starte DB-Container neu..."
    if [ -n "$sf" ]; then
        $DC --env-file "$sf" -f "$cf" up -d db
    else
        $DC -f "$cf" up -d db
    fi

    echo ""
    log "DB-Volume zurückgesetzt – Container wird neu initialisiert"
    info "Migrations werden beim nächsten Start automatisch angewendet"
    info "Logs verfolgen: docker logs -f ${db_container}"
    info "Danach vollständig starten: bash scripts/deploy.sh --update --env ${ENV_TARGET}"
}

do_check_ports() {
    check_ports_before_supabase
    echo ""
    log "Port-Check abgeschlossen"
}

do_migrate() {
    header "Migrationen"

    # Server: Migrationen direkt im DB-Container ausführen
    load_or_init_dirs
    local sf; sf=$(get_secrets_file)
    [ -z "$sf" ] && { err "secrets.env nicht gefunden – zuerst Server-Setup ausführen"; exit 1; }
    # shellcheck source=/dev/null
    source "$sf"

    local container="${COMPOSE_PROJECT_NAME:-${PROJECT_NAME}-${ENV_TARGET}}-db"
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${container}$"; then
        err "DB-Container '${container}' läuft nicht"
        info "Stack starten: bash scripts/deploy.sh --update --env ${ENV_TARGET}"
        exit 1
    fi

    # Migrations-Tracking-Tabelle sicherstellen (idempotent)
    docker exec "$container" psql -U postgres -d postgres -c \
        "CREATE TABLE IF NOT EXISTS public._applied_migrations (
            version text PRIMARY KEY,
            applied_at timestamptz DEFAULT now()
         );" > /dev/null 2>&1 \
        || { err "Konnte _applied_migrations Tabelle nicht erstellen"; exit 1; }

    local migrations_dir="${DIR_APP}/supabase/migrations"
    if [ ! -d "$migrations_dir" ]; then
        err "Migrations-Verzeichnis nicht gefunden: ${migrations_dir}"
        exit 1
    fi

    local sql_files; sql_files=$(ls "${migrations_dir}"/*.sql 2>/dev/null | sort)
    if [ -z "$sql_files" ]; then
        info "Keine SQL-Dateien in ${migrations_dir} gefunden"
        return 0
    fi

    info "Führe Migrationen im Container '${container}' aus..."
    local applied=0 skipped=0 failed=0

    for f in $sql_files; do
        local version; version=$(basename "$f")

        # Bereits angewendet?
        local already; already=$(docker exec "$container" psql -U postgres -d postgres -tAc \
            "SELECT 1 FROM public._applied_migrations WHERE version = '${version}'" 2>/dev/null || echo "")
        if [ "$already" = "1" ]; then
            echo -e "  ${DIM}  SKIP  ${version}${NC}"
            skipped=$((skipped + 1))
            continue
        fi

        echo -e "  ${CYAN}  APPLY ${NC}${version}"
        # ON_ERROR_STOP=1: psql gibt Exit-Code != 0 bei SQL-Fehlern zurück
        if docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$f"; then
            docker exec "$container" psql -U postgres -d postgres -c \
                "INSERT INTO public._applied_migrations (version) VALUES ('${version}') ON CONFLICT DO NOTHING;" \
                > /dev/null 2>&1
            echo -e "  ${GREEN}  ✓     ${version}${NC}"
            applied=$((applied + 1))
        else
            echo -e "  ${RED}  ✗     ${version} – FEHLER (Migration nicht als angewendet markiert)${NC}"
            failed=$((failed + 1))
        fi
    done

    echo ""
    if [ "$failed" -gt 0 ]; then
        err "Migrationen: ${applied} angewendet, ${skipped} übersprungen, ${failed} fehlgeschlagen"
        info "Fehlerhafte Migration manuell prüfen:"
        info "  docker exec -it ${container} psql -U postgres -d postgres"
        return 1
    else
        log "Migrationen: ${applied} angewendet, ${skipped} übersprungen – alle erfolgreich"
    fi
}

do_sync_migrations() {
    header "Migrationen synchronisieren – ${PROJECT_DISPLAY} (${ENV_TARGET})"

    load_or_init_dirs
    local sf; sf=$(get_secrets_file)
    [ -z "$sf" ] && { err "secrets.env nicht gefunden – zuerst Server-Setup ausführen"; exit 1; }
    # shellcheck source=/dev/null
    source "$sf"

    local container="${COMPOSE_PROJECT_NAME:-${PROJECT_NAME}-${ENV_TARGET}}-db"
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${container}$"; then
        err "DB-Container '${container}' läuft nicht"
        info "Stack starten: bash scripts/deploy.sh --update --env ${ENV_TARGET}"
        exit 1
    fi

    docker exec "$container" psql -U postgres -d postgres -c \
        "CREATE TABLE IF NOT EXISTS public._applied_migrations (
            version text PRIMARY KEY,
            applied_at timestamptz DEFAULT now()
         );" > /dev/null 2>&1 \
        || { err "Konnte _applied_migrations Tabelle nicht erstellen"; exit 1; }

    local migrations_dir="${DIR_APP}/supabase/migrations"
    if [ ! -d "$migrations_dir" ]; then
        err "Migrations-Verzeichnis nicht gefunden: ${migrations_dir}"
        exit 1
    fi

    local sql_files; sql_files=$(ls "${migrations_dir}"/*.sql 2>/dev/null | sort)
    if [ -z "$sql_files" ]; then
        info "Keine SQL-Dateien in ${migrations_dir} gefunden"
        return 0
    fi

    info "Markiere alle Migrationen als angewendet (ohne Ausführung)..."
    local count=0
    for f in $sql_files; do
        local version; version=$(basename "$f")
        docker exec "$container" psql -U postgres -d postgres -c \
            "INSERT INTO public._applied_migrations (version) VALUES ('${version}') ON CONFLICT DO NOTHING;" \
            > /dev/null 2>&1
        count=$((count + 1))
    done

    log "Fertig: ${count} Migrationen als angewendet markiert"
}

do_setup_nginx() {
    header "Nginx-Konfiguration einrichten – ${PROJECT_DISPLAY}"

    load_or_init_dirs

    local nginx_available="${NGINX_SITES_AVAILABLE:-/etc/nginx/sites-available}"
    local nginx_enabled="${NGINX_SITES_ENABLED:-/etc/nginx/sites-enabled}"
    local has_any=false

    for dir in "$nginx_available" "$nginx_enabled"; do
        if [ ! -d "$dir" ]; then
            info "Verzeichnis ${dir} existiert nicht – erstelle mit sudo..."
            sudo mkdir -p "$dir" || { err "Konnte ${dir} nicht anlegen"; exit 1; }
        fi
    done

    info "Prüfe sudo-Rechte für Kopieren nach ${nginx_available}..."
    if ! sudo -v 2>/dev/null; then
        warn "sudo fehlgeschlagen (Passwort nötig?). Alternativ: sudo bash scripts/deploy.sh --setup-nginx"
    fi

    for env in production staging; do
        local cfg="${DIR_BASE}/config.env.${env}"
        [ -f "$cfg" ] || cfg="${DIR_BASE}/config.env"
        if [ ! -f "$cfg" ]; then
            warn "Keine Config für ${env} – überspringe"
            info "  Zuerst Setup ausführen: bash scripts/deploy.sh --env ${env}"
            info "  Erwarteter Pfad: ${DIR_BASE}/config.env.${env}"
            continue
        fi

        generate_nginx_config "$env"
        local conf_file="${DIR_BASE}/${env}/configs/nginx-${env}.conf"
        local target_name="${NGINX_SITE_NAME}-${env}.conf"
        local file_available="${nginx_available}/${target_name}"
        local link_enabled="${nginx_enabled}/${target_name}"

        if [ ! -f "$conf_file" ]; then
            err "Nginx-Config nicht erstellt: ${conf_file}"
            continue
        fi

        # Absoluten Pfad für sudo cp verwenden
        local abs_conf
        abs_conf="$(cd "$(dirname "$conf_file")" 2>/dev/null && pwd)/$(basename "$conf_file")"
        [ -f "$abs_conf" ] && conf_file="$abs_conf"

        # 1. Kopiere nach sites-available
        info "Kopiere ${conf_file} → ${file_available}"
        if ! sudo cp -f "$conf_file" "$file_available"; then
            err "Kopieren fehlgeschlagen: ${file_available}"
            info "  Manuell: sudo cp -f ${conf_file} ${file_available}"
            continue
        fi

        if ! sudo test -f "$file_available"; then
            err "Datei nach Kopiervorgang nicht gefunden: ${file_available}"
            info "  Manuell ausführen: sudo cp -f ${conf_file} ${file_available}"
            continue
        fi

        # 2. Symlink in sites-enabled → sites-available (Ubuntu/Debian-Standard)
        if [ -L "$link_enabled" ] || [ -f "$link_enabled" ]; then
            sudo rm -f "$link_enabled"
        fi
        if sudo ln -sf "$file_available" "$link_enabled"; then
            log "Nginx ${env}: ${file_available} + Symlink in sites-enabled"
            has_any=true
        else
            warn "Symlink fehlgeschlagen – Config liegt in sites-available, manuell aktivieren: sudo ln -s ${file_available} ${link_enabled}"
            has_any=true
        fi
    done

    if [ "$has_any" = false ]; then
        err "Keine Nginx-Config kopiert."
        info "Zuerst Setup ausführen: bash scripts/deploy.sh --env production"
        info "Oder Reconfigure: bash scripts/deploy.sh --reconfigure --env production"
        info "Erwartete Config-Dateien: ${DIR_BASE}/config.env.production bzw. config.env.staging"
        exit 1
    fi

    echo ""
    if sudo nginx -t 2>/dev/null; then
        log "Nginx-Konfiguration gültig"
        if confirm "Nginx jetzt neu laden?" "j"; then
            sudo systemctl reload nginx 2>/dev/null && log "Nginx neu geladen" || warn "systemctl reload nginx fehlgeschlagen"
        fi
    else
        warn "Nginx-Test fehlgeschlagen – prüfe: sudo nginx -t"
    fi

    echo ""
    info "Configs: ${nginx_available}/${NGINX_SITE_NAME}-*.conf"
    info "Symlinks: ${nginx_enabled}/${NGINX_SITE_NAME}-*.conf → sites-available"
}

do_backup() {
    header "Backup"
    check_supabase_cli
    local ts; ts=$(date +%Y%m%d-%H%M%S)
    mkdir -p supabase/backups
    supabase db dump -f "supabase/backups/dump-${ts}.sql" 2>/dev/null \
        && log "Backup: supabase/backups/dump-${ts}.sql" \
        || err "Backup fehlgeschlagen (supabase start ausgeführt?)"
}

do_reconfigure() {
    header "Rekonfiguration – ${PROJECT_DISPLAY} (${ENV_TARGET})"

    load_or_init_dirs

    local sf; sf=$(get_secrets_file)
    if [ -z "$sf" ]; then
        err "Keine bestehende Konfiguration gefunden unter ${DIR_BASE}"
        info "Zuerst einrichten: bash scripts/deploy.sh --env ${ENV_TARGET}"
        exit 1
    fi

    # Bestehende Secrets laden damit collect_config() die Werte vorausfüllt
    # shellcheck source=/dev/null
    source "$sf"
    # secrets.env → DEPLOY_-Prefix mappen (sonst schreibt write_env_file leere Werte)
    [ -n "${JWT_SECRET:-}"              ] && DEPLOY_JWT_SECRET="$JWT_SECRET"
    [ -n "${POSTGRES_PASSWORD:-}"       ] && DEPLOY_POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
    [ -n "${ANON_KEY:-}"                ] && DEPLOY_ANON_KEY="$ANON_KEY"
    [ -n "${SERVICE_ROLE_KEY:-}"        ] && DEPLOY_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
    [ -n "${PG_META_CRYPTO_KEY:-}"      ] && DEPLOY_PG_META_CRYPTO_KEY="$PG_META_CRYPTO_KEY"
    [ -n "${DATA_TRANSFER_PASSWORD:-}"  ] && DEPLOY_DATA_TRANSFER_PASSWORD="$DATA_TRANSFER_PASSWORD"
    [ -n "${COMPOSE_PROJECT_NAME:-}"    ] && DEPLOY_COMPOSE_PROJECT="$COMPOSE_PROJECT_NAME"

    info "Bestehende Konfiguration geladen – Enter behält jeweiligen Wert."
    echo ""

    # Wizard durchlaufen (alle Felder vorausgefüllt)
    collect_config
    show_summary

    local DC; DC=$(detect_compose)
    local COMPOSE_FILE="${DIR_APP}/docker/docker-compose.yml"
    local SECRETS_FILE="${DIR_BASE}/secrets.env"
    [ -z "$DC" ] && { err "Docker Compose nicht gefunden"; exit 1; }
    [ ! -f "$COMPOSE_FILE" ] && { err "docker/docker-compose.yml nicht gefunden"; exit 1; }

    # Neue secrets.env und Nginx-Konfiguration schreiben
    write_env_file
    generate_nginx_config

    echo ""
    echo -e "  ${BOLD}Was soll neu gestartet werden?${NC}"
    echo "    1) Nur Konfiguration neu laden (docker compose up -d, kein Rebuild)"
    echo "    2) App-Container neu bauen + starten  (nötig bei Domain/URL-Änderung)"
    echo "    3) Alle Container neu bauen + starten (nötig bei grundlegenden Änderungen)"
    echo ""
    local restart_choice; restart_choice=$(ask "Auswahl" "1")

    case "$restart_choice" in
        2)
            info "Baue App-Container neu..."
            $DC --env-file "$SECRETS_FILE" -f "$COMPOSE_FILE" up -d --build app \
                || {
                    err "docker compose up fehlgeschlagen"
                    info "Bei 'Pool overlaps': bash scripts/deploy.sh --reconfigure --env ${ENV_TARGET} → anderes Docker-Subnetz"
                    _show_db_crash_logs
                    exit 1
                }
            $DC --env-file "$SECRETS_FILE" -f "$COMPOSE_FILE" up -d
            ;;
        3)
            info "Baue alle Container neu..."
            $DC --env-file "$SECRETS_FILE" -f "$COMPOSE_FILE" up -d --build \
                || {
                    err "docker compose up fehlgeschlagen"
                    info "Bei 'Pool overlaps': bash scripts/deploy.sh --reconfigure --env ${ENV_TARGET} → anderes Docker-Subnetz"
                    _show_db_crash_logs
                    exit 1
                }
            ;;
        *)
            info "Starte Container mit neuer Konfiguration..."
            $DC --env-file "$SECRETS_FILE" -f "$COMPOSE_FILE" up -d \
                || {
                    err "docker compose up fehlgeschlagen"
                    info "Bei 'Pool overlaps': bash scripts/deploy.sh --reconfigure --env ${ENV_TARGET} → anderes Docker-Subnetz"
                    _show_db_crash_logs
                    exit 1
                }
            ;;
    esac

    wait_for_health "$DC" "$COMPOSE_FILE" "$SECRETS_FILE"
    date '+%Y-%m-%d %H:%M:%S' > "${DIR_BASE}/.last-deploy"

    echo ""
    echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${GREEN}║   Rekonfiguration abgeschlossen!                     ║${NC}"
    echo -e "${BOLD}${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BOLD}App:${NC}       ${DEPLOY_PROTOCOL}://${DEPLOY_DOMAIN}"
    echo -e "  ${BOLD}API:${NC}       ${DEPLOY_PROTOCOL}://${DEPLOY_DOMAIN}/supabase"
    echo ""
    if [ "$restart_choice" != "1" ]; then
        echo "  Nginx-Konfiguration ggf. neu laden:"
        echo "    sudo nginx -t && sudo systemctl reload nginx"
        echo ""
    fi
    echo -e "  ${DIM}Secrets: ${DIR_BASE}/secrets.env${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════════════
# ─── MAIN
# ═══════════════════════════════════════════════════════════════
main() {
    echo ""
    echo -e "${BOLD}${CYAN}  ${PROJECT_DISPLAY} – Deploy Script${NC}"
    echo -e "  ${DIM}Modus: ${MODE}${NC}"
    echo ""

    # Bei --local: Prüfen ob wir im Repo sind
    if [ "$MODE" = "local" ] && [ ! -d .git ]; then
        err "Nicht im Repo – zuerst klonen (siehe README)"
        info "  git clone git@github.com:josefhaider/masitcon-tools-ameise.git"
        info "  cd masitcon-tools-ameise"
        exit 1
    fi

    # Umgebung abfragen, wenn für diesen Modus nötig und nicht per --env gesetzt
    case "$MODE" in
        update|status|logs|stop|restart|clean|backup|reconfigure|sync-migrations)
            ask_env_target
            echo -e "  ${DIM}Umgebung: ${ENV_TARGET}${NC}"
            echo ""
            ;;
    esac

    case "$MODE" in
        local)   setup_local ;;
        update)  do_update   ;;
        status)  do_status   ;;
        logs)    do_logs     ;;
        stop)    do_stop     ;;
        restart) do_restart  ;;
        clean)   do_clean    ;;
        prune)   do_prune    ;;
        migrate)      do_migrate      ;;
        backup)       do_backup       ;;
        check-ports)  do_check_ports  ;;
        reconfigure)     do_reconfigure     ;;
        sync-migrations) do_sync_migrations ;;
        setup-nginx)     do_setup_nginx    ;;
        reset-db)        do_reset_db       ;;
        setup)           setup_server       ;;
    esac
}

main
