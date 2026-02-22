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
# Port-Check:      bash scripts/deploy.sh --check-ports (lokal)
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
    local port="$1" max=$((port + 200))
    while ! is_port_free "$port" && [ "$port" -lt "$max" ]; do port=$((port + 1)); done
    [ "$port" -ge "$max" ] && { echo ""; return 1; }
    echo "$port"
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
        --migrate)     MODE="migrate"; shift ;;
        --backup)      MODE="backup";  shift ;;
        --check-ports) MODE="check-ports"; shift ;;
        --env)     ENV_TARGET="${2:-production}"; ENV_EXPLICIT=true; shift 2 ;;
        --service) SHOW_LOGS_SERVICE="${2:-}"; shift 2 ;;
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
  --check-ports      Lokale Ports prüfen – zeigt Belegung und mögliche Konflikte

Optionen:
  --env production|staging    Ziel-Umgebung (Default: production)
  --service NAME              Für --logs: nur diesen Container
  --help                      Diese Hilfe
HELP
            exit 0 ;;
        *) err "Unbekannte Option: $1"; exit 1 ;;
    esac
done

# ─── Ordnerstruktur ──────────────────────────────────────────────
DIR_BASE="/opt/projects/${PROJECT_NAME}"
DIR_APP="${DIR_BASE}/${ENV_TARGET}/app"
DIR_DATA="${DIR_BASE}/${ENV_TARGET}/data"
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
        return 0
    fi
    # Fallback: gemeinsame deploy.env
    if [ -f "$DEPLOY_ENV_FILE" ]; then
        # shellcheck source=/dev/null
        source "$DEPLOY_ENV_FILE"
        return 0
    fi
    # Noch nicht konfiguriert → Defaults aus ENV_TARGET
    DIR_APP="${DIR_BASE}/${ENV_TARGET}/app"
    DIR_DATA="${DIR_BASE}/${ENV_TARGET}/data"
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
    # Pfade aktualisieren
    DIR_APP="${DIR_BASE}/${ENV_TARGET}/app"
    DIR_DATA="${DIR_BASE}/${ENV_TARGET}/data"
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

    # PostgREST Schema-Cache neu laden (cached Schema beim Start vor Migrations-Ende)
    local proj="${COMPOSE_PROJECT_NAME:-ameise-local}"
    info "PostgREST Schema-Reload..."
    sleep 3  # kurz warten bis PostgREST gestartet ist
    docker exec "${proj}-db" psql -U postgres -d postgres -q \
        -c "NOTIFY pgrst, 'reload schema';" 2>/dev/null || true
    log "PostgREST Schema aktualisiert"

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
    printf "    %-30s %s\n" "Hono API (Functions):"  "http://localhost:${api_port}/functions/v1"
    echo ""
    echo -e "  ${BOLD}Weitere Befehle:${NC}"
    echo "    Stack stoppen:   docker compose -f docker/docker-compose.local.yml down"
    echo "    Stack neu:       docker compose -f docker/docker-compose.local.yml down -v"
    echo "    Stack-Logs:      docker compose -f docker/docker-compose.local.yml logs -f"
    echo "    API-Logs:        docker compose -f docker/docker-compose.local.yml logs -f api"
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

# Lädt gespeicherte Konfiguration (idempotenter Re-Run)
_load_saved_config() {
    local cfg="${DIR_BASE}/config.env"
    [ -f "$cfg" ] || return 0
    # shellcheck source=/dev/null
    source "$cfg"
    echo -e "  ${GREEN}✓${NC} Vorherige Konfiguration geladen."
    echo -e "  ${DIM}Enter = bisherigen Wert übernehmen.${NC}"
    echo ""
}

# Speichert nicht-sensible Konfiguration für Re-Runs
_save_config() {
    local cfg="${DIR_BASE}/config.env"
    mkdir -p "$DIR_BASE"
    cat > "$cfg" << SAVEDCFG
# Gespeicherte Konfiguration – ${PROJECT_DISPLAY}
# Automatisch von deploy.sh generiert – nicht manuell bearbeiten
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
SAVEDCFG
    chmod 600 "$cfg"
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
        DIR_APP="${DIR_BASE}/${ENV_TARGET}/app"
        DIR_DATA="${DIR_BASE}/${ENV_TARGET}/data"
        DIR_CONFIGS="${DIR_BASE}/${ENV_TARGET}/configs"
    fi
    log "Umgebung: ${ENV_TARGET}"
    echo ""

    # Gespeicherte Config laden (idempotenz)
    _load_saved_config

    # ── 1. Git ───────────────────────────────────────────────────
    header "1/5  Git-Repository"

    local default_remote="${DEPLOY_GIT_REMOTE:-}"
    if [ -z "$default_remote" ] && git remote get-url origin >/dev/null 2>&1; then
        default_remote=$(git remote get-url origin 2>/dev/null)
    fi
    DEPLOY_GIT_REMOTE=$(ask "Git Remote URL" "${default_remote:-git@github.com:josefhaider/masitcon-tools-ameise.git}")
    DEPLOY_GIT_BRANCH=$(ask "Git Branch" "${DEPLOY_GIT_BRANCH:-master}")

    # ── 2. Domain & Protokoll ────────────────────────────────────
    header "2/5  Domain"

    echo "  ${DIM}Unter welcher Adresse ist die App im Browser erreichbar?${NC}"
    echo "  ${DIM}Beispiel: zeiterfassung.example.com${NC}"
    echo ""
    DEPLOY_DOMAIN=$(ask "Domain" "${DEPLOY_DOMAIN:-}")
    if [ -z "$DEPLOY_DOMAIN" ]; then
        err "Domain ist Pflicht"; exit 1
    fi

    echo ""
    echo "  Protokoll:"
    echo "    1) HTTPS  (empfohlen – Caddy holt Zertifikat automatisch)"
    echo "    2) HTTP   (nur für interne/lokale Server)"
    echo ""
    local default_proto_choice="1"
    [ "${DEPLOY_PROTOCOL:-https}" = "http" ] && default_proto_choice="2"
    local proto_choice; proto_choice=$(ask "Auswahl" "$default_proto_choice")
    [ "$proto_choice" = "2" ] && DEPLOY_PROTOCOL="http" || DEPLOY_PROTOCOL="https"

    # Abgeleitete URLs (automatisch berechnet – kein manuelles Eingreifen nötig)
    local SITE_URL="${DEPLOY_PROTOCOL}://${DEPLOY_DOMAIN}"
    local API_EXTERNAL_URL="${SITE_URL}/supabase"    # Kong via Caddy-Pfadrouting
    local VITE_SUPABASE_URL="${API_EXTERNAL_URL}"    # zur Build-Zeit eingebettet
    local SITE_HOSTNAME="${DEPLOY_DOMAIN}"

    log "App-URL:   ${SITE_URL}"
    log "API-URL:   ${API_EXTERNAL_URL}  (Kong via /supabase/*)"

    # ── 3. Supabase-Schlüssel ────────────────────────────────────
    header "3/5  Supabase-Schlüssel"

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
    header "4/5  E-Mail (SMTP) – optional"

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

        # SMTP-Verbindungstest
        if [ -n "$SMTP_PASS" ] && command -v openssl >/dev/null 2>&1; then
            info "Teste SMTP-Verbindung zu ${SMTP_HOST}:${SMTP_PORT}..."
            local test_result
            if [ "$SMTP_PORT" = "465" ]; then
                test_result=$(echo "QUIT" | timeout 8 openssl s_client \
                    -connect "${SMTP_HOST}:${SMTP_PORT}" -quiet 2>&1 || true)
            else
                test_result=$(echo "QUIT" | timeout 8 openssl s_client \
                    -connect "${SMTP_HOST}:${SMTP_PORT}" -starttls smtp -quiet 2>&1 || true)
            fi
            if echo "$test_result" | grep -qi "220\|250\|ok\|connected"; then
                log "SMTP-Verbindung erfolgreich"
            else
                warn "SMTP-Verbindung konnte nicht verifiziert werden (Firewall? Falscher Host?)"
                warn "Die Konfiguration wird trotzdem gespeichert."
            fi
        fi
    else
        SMTP_HOST="" SMTP_PORT="465" SMTP_USER="" SMTP_PASS="" SMTP_ADMIN_EMAIL="" SMTP_SENDER_NAME="Ameise"
        info "SMTP übersprungen. Später eintragen: ${DIR_BASE}/secrets.env → Stack neu starten."
    fi

    # ── 5. Ports ─────────────────────────────────────────────────
    header "5/5  Ports"

    echo "  ${DIM}Ports werden automatisch gesucht. Alle binden an 127.0.0.1 –${NC}"
    echo "  ${DIM}kein Internetzugriff ohne Caddy.${NC}"
    echo ""
    echo "  ${DIM}Studio-Port: nur via SSH-Tunnel erreichbar.${NC}"
    echo ""

    # Startpunkte (aus gespeicherter Config oder Defaults)
    local start_app="${DEPLOY_APP_PORT:-8080}"
    local start_api="${DEPLOY_API_PORT:-8100}"
    local start_db="${DEPLOY_DB_PORT:-5440}"
    local start_studio="${DEPLOY_STUDIO_PORT:-3100}"

    DEPLOY_APP_PORT=$(find_free_port "$start_app")
    [ -z "$DEPLOY_APP_PORT" ] && DEPLOY_APP_PORT="$start_app"

    DEPLOY_API_PORT=$(find_free_port "$start_api")
    [ -z "$DEPLOY_API_PORT" ] && DEPLOY_API_PORT="$start_api"

    DEPLOY_DB_PORT=$(find_free_port "$start_db")
    [ -z "$DEPLOY_DB_PORT" ] && DEPLOY_DB_PORT="$start_db"

    DEPLOY_STUDIO_PORT=$(find_free_port "$start_studio")
    [ -z "$DEPLOY_STUDIO_PORT" ] && DEPLOY_STUDIO_PORT="$start_studio"

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

    # Belegte Ports als Fehler
    for _p in "$DEPLOY_APP_PORT" "$DEPLOY_API_PORT" "$DEPLOY_DB_PORT" "$DEPLOY_STUDIO_PORT"; do
        if ! is_port_free "$_p"; then
            local _occ; _occ=$(get_port_occupant "$_p")
            err "Port $_p ist belegt: $_occ"
            err "Stoppe den Prozess oder wähle einen anderen Port."
            exit 1
        fi
    done

    # Container-Prefix: automatisch aus Projektname + Umgebung
    local default_cpn="${PROJECT_NAME}-${ENV_TARGET}"
    DEPLOY_COMPOSE_PROJECT=$(ask "Container-Prefix (COMPOSE_PROJECT_NAME)" "${DEPLOY_COMPOSE_PROJECT:-$default_cpn}")

    # Konfiguration speichern
    _save_config
    log "Konfiguration gespeichert: ${DIR_BASE}/config.env"

    # Abgeleitete Variablen exportieren (für write_env_file)
    _SITE_URL="${DEPLOY_PROTOCOL}://${DEPLOY_DOMAIN}"
    _API_EXTERNAL_URL="${_SITE_URL}/supabase"
    _VITE_SUPABASE_URL="${_API_EXTERNAL_URL}"
    _SITE_HOSTNAME="${DEPLOY_DOMAIN}"
}

show_summary() {
    header "Zusammenfassung"
    echo -e "  ${BOLD}Umgebung:${NC}         ${ENV_TARGET}"
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
    echo ""
    printf "    %-26s %s\n" "SMTP:" "$([ -n "$SMTP_HOST" ] && echo "${SMTP_HOST}:${SMTP_PORT}" || echo "(nicht konfiguriert)")"
    echo ""
    confirm "Korrekt? Setup starten?" "j" || exit 0
}

write_env_file() {
    # Haupt-Secrets-Datei (600 – nur root/deploy-user lesbar)
    local secrets_file="${DIR_BASE}/secrets.env"
    cat > "$secrets_file" << SECRETSENV
# ${PROJECT_DISPLAY} – Supabase-Schlüssel
# Generiert am $(date '+%Y-%m-%d %H:%M') – NIEMALS committen!
# Wird von docker/docker-compose.yml über --env-file eingelesen.
COMPOSE_PROJECT_NAME=${DEPLOY_COMPOSE_PROJECT}

# Supabase-Schlüssel
JWT_SECRET=${DEPLOY_JWT_SECRET}
POSTGRES_PASSWORD=${DEPLOY_POSTGRES_PASSWORD}
ANON_KEY=${DEPLOY_ANON_KEY}
SERVICE_ROLE_KEY=${DEPLOY_SERVICE_ROLE_KEY}
PG_META_CRYPTO_KEY=${DEPLOY_PG_META_CRYPTO_KEY}

# Ports (alle 127.0.0.1)
APP_PORT=${DEPLOY_APP_PORT}
API_PORT=${DEPLOY_API_PORT}
DB_PORT=${DEPLOY_DB_PORT}
STUDIO_PORT=${DEPLOY_STUDIO_PORT}

# URLs (automatisch aus Domain berechnet)
SITE_URL=${_SITE_URL}
SITE_HOSTNAME=${_SITE_HOSTNAME}
API_EXTERNAL_URL=${_API_EXTERNAL_URL}
VITE_SUPABASE_URL=${_VITE_SUPABASE_URL}

# Build
BUILD_MODE=${ENV_TARGET}

# Edge Functions
DATA_TRANSFER_PASSWORD=${DEPLOY_DATA_TRANSFER_PASSWORD}
ALLOWED_ORIGIN=${_SITE_URL}

# SMTP (leer = keine E-Mails)
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
SMTP_ADMIN_EMAIL=${SMTP_ADMIN_EMAIL}
SMTP_SENDER_NAME=${SMTP_SENDER_NAME}
SECRETSENV
    chmod 600 "$secrets_file"
    log "Secrets gespeichert: ${secrets_file}"

    # deploy.env.ENV für spätere --update / --status Aufrufe
    local deploy_env="${DIR_BASE}/deploy.env.${ENV_TARGET}"
    cat > "$deploy_env" << DEPLOYENV
# Deploy-Metadaten – ${ENV_TARGET}
DIR_APP=${DIR_APP}
DIR_DATA=${DIR_DATA}
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

generate_caddy_snippet() {
    local snippet_file="${DIR_CONFIGS}/caddy-snippet.conf"
    mkdir -p "$DIR_CONFIGS"
    cat > "$snippet_file" << CADDY
# ${PROJECT_DISPLAY} – ${ENV_TARGET}
# ─────────────────────────────────────────────────────────────
# Einfügen in /etc/caddy/Caddyfile  ODER  als eigene Datei:
#   sudo cp ${snippet_file} /etc/caddy/conf.d/${PROJECT_NAME}-${ENV_TARGET}.conf
#   sudo systemctl reload caddy
#
# Routing:
#   DOMAIN              → App (statische Dateien, serve)
#   DOMAIN/supabase/*   → Kong (Supabase API-Gateway)
#   DOMAIN/supabase     → Kong
# ─────────────────────────────────────────────────────────────

${DEPLOY_DOMAIN} {

    # ── Supabase API (Kong) – Pfad-Routing ──────────────────────
    # /supabase/* wird an Kong weitergeleitet.
    # Der Präfix /supabase wird vor der Weiterleitung entfernt.
    handle_path /supabase/* {
        reverse_proxy 127.0.0.1:${DEPLOY_API_PORT}
    }

    # ── App (Vite SPA – statische Dateien) ──────────────────────
    handle {
        reverse_proxy 127.0.0.1:${DEPLOY_APP_PORT}
    }

    # ── Logs ────────────────────────────────────────────────────
    log {
        output file /var/log/${PROJECT_NAME}/caddy-${ENV_TARGET}.log
        format json
    }
}
CADDY
    log "Caddy-Snippet: ${snippet_file}"
}

# ─── Server-Setup (Ersteinrichtung) ─────────────────────────────
setup_server() {
    header "Server-Setup – ${PROJECT_DISPLAY}"

    check_prerequisites
    collect_config
    show_summary

    # Verzeichnisse anlegen
    for d in "$DIR_APP" "$DIR_DATA" "$DIR_CONFIGS" "$DIR_BACKUPS" "$DIR_LOGS"; do
        mkdir -p "$d"
    done
    log "Verzeichnisse erstellt: ${DIR_BASE}/"

    # Log-Verzeichnis für Caddy
    sudo mkdir -p "/var/log/${PROJECT_NAME}" 2>/dev/null || mkdir -p "${DIR_LOGS}"

    # Repo: Bereits geklontes Repo nutzen oder neu klonen
    local SCRIPT_DIR; SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local SCRIPT_REPO_ROOT; SCRIPT_REPO_ROOT="$(dirname "$SCRIPT_DIR")"

    if [ -d "${DIR_APP}/.git" ]; then
        info "Repo unter ${DIR_APP} existiert – aktualisiere..."
        git -C "$DIR_APP" fetch origin
        git -C "$DIR_APP" checkout "$DEPLOY_GIT_BRANCH"
        git -C "$DIR_APP" pull origin "$DEPLOY_GIT_BRANCH"
    elif [ -d "${SCRIPT_REPO_ROOT}/.git" ] && [ "$SCRIPT_REPO_ROOT" != "$DIR_APP" ]; then
        info "Repo vom aktuellen Verzeichnis verlinken..."
        ln -sfn "$SCRIPT_REPO_ROOT" "$DIR_APP"
        git -C "$DIR_APP" pull origin "$DEPLOY_GIT_BRANCH" 2>/dev/null || true
    else
        info "Klone Repo: ${DEPLOY_GIT_REMOTE}..."
        git clone --branch "$DEPLOY_GIT_BRANCH" "$DEPLOY_GIT_REMOTE" "$DIR_APP" \
            || { err "git clone fehlgeschlagen – SSH-Key vorhanden?"; exit 1; }
    fi
    log "Repo: $(git -C "$DIR_APP" rev-parse --short HEAD 2>/dev/null || echo 'unbekannt')"

    # Env-Datei schreiben (enthält alle Secrets)
    write_env_file

    # Caddy-Snippet generieren (vor Container-Start)
    generate_caddy_snippet

    # Container bauen und starten
    local DC; DC=$(detect_compose)
    local COMPOSE_FILE="${DIR_APP}/docker/docker-compose.yml"
    local SECRETS_FILE="${DIR_BASE}/secrets.env"
    [ -z "$DC" ] && { err "Docker Compose nicht gefunden"; exit 1; }
    [ ! -f "$COMPOSE_FILE" ] && { err "docker/docker-compose.yml nicht gefunden unter ${DIR_APP}"; exit 1; }
    [ ! -f "$SECRETS_FILE" ] && { err "secrets.env nicht gefunden – Setup fehlgeschlagen"; exit 1; }

    info "Baue und starte Stack (${DEPLOY_COMPOSE_PROJECT})..."
    $DC --env-file "$SECRETS_FILE" -f "$COMPOSE_FILE" up -d --build \
        || { err "docker compose up fehlgeschlagen"; exit 1; }

    wait_for_health "$DC" "$COMPOSE_FILE" "$SECRETS_FILE"

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
    echo "    1. Caddy-Snippet einbinden:"
    echo "       sudo cp ${DIR_CONFIGS}/caddy-snippet.conf /etc/caddy/conf.d/${PROJECT_NAME}-${ENV_TARGET}.conf"
    echo "       sudo systemctl reload caddy"
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

    # Lokal: Docker-Stack prüfen
    if [ -d .git ] && [ -f docker/docker-compose.local.yml ]; then
        info "Lokale Umgebung erkannt"
        local proj="${COMPOSE_PROJECT_NAME:-ameise-local}"
        echo ""
        info "Docker-Container (${proj}):"
        docker ps --filter "name=${proj}" --format "  {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || true
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

    if [ ! -d "${DIR_APP}/.git" ] && [ ! -L "${DIR_APP}" ]; then
        err "Kein Repo unter ${DIR_APP} – zuerst Server-Setup ausführen"
        info "bash scripts/deploy.sh --env ${ENV_TARGET}"
        exit 1
    fi

    local DC; DC=$(detect_compose)
    local COMPOSE_FILE="${DIR_APP}/docker/docker-compose.yml"
    local SECRETS_FILE="${DIR_BASE}/secrets.env"
    [ -z "$DC" ] && { err "Docker Compose nicht gefunden"; exit 1; }
    [ ! -f "$COMPOSE_FILE" ] && { err "docker/docker-compose.yml nicht gefunden"; exit 1; }
    [ ! -f "$SECRETS_FILE" ] && { err "secrets.env nicht gefunden – zuerst Server-Setup ausführen"; exit 1; }

    # Git pull
    info "Ziehe neuesten Stand..."
    git -C "$DIR_APP" fetch origin
    git -C "$DIR_APP" pull origin "$(git -C "$DIR_APP" rev-parse --abbrev-ref HEAD 2>/dev/null || echo master)"
    log "Repo aktualisiert: $(git -C "$DIR_APP" rev-parse --short HEAD 2>/dev/null)"

    # App-Container neu bauen (VITE_* aus secrets.env)
    info "Baue App-Container neu (VITE_SUPABASE_URL wird neu eingebettet)..."
    $DC --env-file "$SECRETS_FILE" -f "$COMPOSE_FILE" up -d --build app \
        || { err "docker compose up fehlgeschlagen"; exit 1; }

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
    if [ -d .git ] && [ -f docker/docker-compose.local.yml ]; then
        warn "Lokale Umgebung erkannt"
        local DC; DC=$(detect_compose)
        if confirm "Docker-Stack stoppen und lokale .env löschen?" "n"; then
            $DC -f docker/docker-compose.local.yml --env-file "$LOCAL_ENV_FILE" down 2>/dev/null || true
            rm -f .env
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
            rm -f "${DIR_BASE}/config.env"
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

do_check_ports() {
    check_local_ports
    echo ""
    log "Port-Check abgeschlossen"
}

do_migrate() {
    header "Migrationen"

    # Lokal: Migrationen laufen automatisch beim Stack-Start
    if [ -d .git ] && [ -f docker/docker-compose.local.yml ]; then
        info "Lokale Migrationen werden beim Stack-Start automatisch angewendet."
        info "Vollständiges Reset (alle Daten löschen + Migrationen neu anwenden):"
        info "  docker compose -f docker/docker-compose.local.yml --env-file docker/.env.local down -v"
        info "  docker compose -f docker/docker-compose.local.yml --env-file docker/.env.local up -d"
        return 0
    fi

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

    info "Führe Migrationen im Container '${container}' aus..."
    local migrations_dir="${DIR_APP}/supabase/migrations"
    local applied=0

    for f in $(ls "${migrations_dir}"/*.sql 2>/dev/null | sort); do
        local version; version=$(basename "$f")
        local already; already=$(docker exec "$container" psql -U postgres -d postgres -tAc \
            "SELECT 1 FROM public._applied_migrations WHERE version = '${version}'" 2>/dev/null || echo "")
        if [ "$already" = "1" ]; then
            info "  SKIP: ${version}"
            continue
        fi
        info "  APPLY: ${version}"
        docker exec -i "$container" psql -v ON_ERROR_STOP=0 -U postgres -d postgres < "$f" > /dev/null 2>&1
        docker exec "$container" psql -U postgres -d postgres -c \
            "INSERT INTO public._applied_migrations (version) VALUES ('${version}') ON CONFLICT DO NOTHING;" \
            > /dev/null 2>&1
        applied=$((applied + 1))
    done

    log "Migrationen abgeschlossen: ${applied} neu angewendet"
}

do_backup() {
    header "Backup"
    local ts; ts=$(date +%Y%m%d-%H%M%S)

    # Lokal
    if [ -d .git ] && [ -f docker/docker-compose.local.yml ]; then
        local proj="${COMPOSE_PROJECT_NAME:-ameise-local}"
        local container="${proj}-db"
        mkdir -p backups
        docker exec "$container" pg_dump -U postgres -d postgres \
            > "backups/dump-${ts}.sql" \
            && log "Backup: backups/dump-${ts}.sql" \
            || err "Backup fehlgeschlagen (Stack läuft? docker ps | grep ${proj})"
        return 0
    fi

    # Server
    load_or_init_dirs
    local sf; sf=$(get_secrets_file)
    [ -z "$sf" ] && { err "secrets.env nicht gefunden – zuerst Server-Setup ausführen"; exit 1; }
    # shellcheck source=/dev/null
    source "$sf"
    local container="${COMPOSE_PROJECT_NAME:-${PROJECT_NAME}-production}-db"
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${container}$"; then
        err "DB-Container '${container}' läuft nicht"
        info "Stack starten: bash scripts/deploy.sh --update --env ${ENV_TARGET}"
        exit 1
    fi
    mkdir -p "$DIR_BACKUPS"
    docker exec "$container" pg_dump -U postgres -d postgres \
        > "${DIR_BACKUPS}/dump-${ts}.sql" \
        && log "Backup: ${DIR_BACKUPS}/dump-${ts}.sql" \
        || err "Backup fehlgeschlagen"
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
        update|status|logs|stop|restart|clean|backup)
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
        migrate)     do_migrate     ;;
        backup)      do_backup      ;;
        check-ports) do_check_ports ;;
        setup)       setup_server ;;
    esac
}

main
