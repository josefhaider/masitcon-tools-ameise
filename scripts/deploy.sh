#!/usr/bin/env bash
# ===================================================================
# masitcon Zeiterfassung (Ameise) - Deploy & Setup Script
# ===================================================================
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
    if command -v lsof >/dev/null 2>&1; then
        ! lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | grep -q ":${1} "
    elif command -v ss >/dev/null 2>&1; then
        ! ss -tlnp 2>/dev/null | grep -q ":${1} "
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
  --check-ports      Ports prüfen (Supabase) – zeigt Belegung, bietet Alternativen

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

check_supabase_cli() {
    if ! command -v supabase >/dev/null 2>&1; then
        err "Supabase CLI nicht gefunden"
        info "Installation: brew install supabase/tap/supabase  (Mac)"
        info "              npm install -g supabase             (alternativ)"
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
    # lsof (Mac/Linux)
    if command -v lsof >/dev/null 2>&1; then
        local l; l=$(lsof -iTCP:${port} -sTCP:LISTEN -nP 2>/dev/null | tail -1)
        [ -n "$l" ] && { echo "Prozess: $(echo "$l" | awk '{print $1, $2}')"; return; }
    fi
    # ss (Linux)
    if command -v ss >/dev/null 2>&1; then
        local s; s=$(ss -tlnp 2>/dev/null | grep ":${port} ")
        [ -n "$s" ] && { echo "Socket: $(echo "$s" | awk '{print $6}')"; return; }
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
        (lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null || ss -tlnp 2>/dev/null) | grep -E ":54[0-9]{3}\s" | head -15 || true
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

# ─── Lokal ───────────────────────────────────────────────────────
setup_local() {
    header "Lokale Entwicklungsumgebung – ${PROJECT_DISPLAY}"

    check_supabase_cli
    check_ports_before_supabase

    info "Starte lokale Supabase-Instanz..."
    supabase start || { err "Supabase Start fehlgeschlagen"; exit 1; }

    local s; s=$(supabase status 2>/dev/null)
    local URL KEY SRV
    URL=$(echo "$s" | grep "API URL"          | awk '{print $NF}')
    KEY=$(echo "$s" | grep "anon key"         | awk '{print $NF}')
    SRV=$(echo "$s" | grep "service_role key" | awk '{print $NF}')

    log "API: $URL"

    cat > .env << LOCALENV
# ================================================================
# ${PROJECT_DISPLAY} – Lokale Entwicklung (automatisch generiert)
# ================================================================
VITE_SUPABASE_URL=${URL}
VITE_SUPABASE_ANON_KEY=${KEY}
LOCALENV
    chmod 600 .env
    log ".env geschrieben"

    if [ -n "$SRV" ]; then
        mkdir -p supabase
        cat > supabase/.env << SUPABASEENV
SUPABASE_URL=${URL}
SUPABASE_SERVICE_ROLE_KEY=${SRV}
DATA_TRANSFER_PASSWORD=ameise-local-transfer
ALLOWED_ORIGIN=http://localhost:8080
SUPABASEENV
        chmod 600 supabase/.env
        log "supabase/.env geschrieben (für Edge Functions)"
    fi

    if [ "$HAS_MIGRATIONS" = "true" ]; then
        confirm "Datenbank zurücksetzen und Migrationen ausführen?" "j" \
            && { supabase db reset; log "Migrationen ausgeführt"; }
    fi

    [ -f "package-lock.json" ] && npm ci 2>/dev/null || npm install
    log "Dependencies installiert"

    echo ""
    echo -e "  ${BOLD}Supabase Studio:${NC}  http://127.0.0.1:54333"
    echo -e "  ${BOLD}App:${NC}              http://localhost:${APP_PORT}"
    echo ""
    info "Edge Functions separat starten: supabase functions serve --env-file supabase/.env"
    echo ""
    npm run dev
}

# ─── Server-Modi (Placeholder – vollständiges Setup siehe Referenz) ─
do_status() {
    header "Status – ${PROJECT_DISPLAY} (${ENV_TARGET})"
    load_or_init_dirs
    local DC; DC=$(detect_compose)
    if [ -f "${DIR_CONFIGS}/docker-compose.yml" ]; then
        $DC -f "${DIR_CONFIGS}/docker-compose.yml" ps
    else
        info "Kein Server-Setup – nutze --local für lokale Entwicklung"
    fi
}

do_logs() {
    load_or_init_dirs
    local DC; DC=$(detect_compose)
    if [ -f "${DIR_CONFIGS}/docker-compose.yml" ]; then
        $DC -f "${DIR_CONFIGS}/docker-compose.yml" logs -f ${SHOW_LOGS_SERVICE:+$SHOW_LOGS_SERVICE}
    else
        err "Kein docker-compose.yml gefunden"
    fi
}

do_stop() {
    header "Stoppen – ${PROJECT_DISPLAY}"
    load_or_init_dirs
    local DC; DC=$(detect_compose)
    if [ -f "${DIR_CONFIGS}/docker-compose.yml" ]; then
        $DC -f "${DIR_CONFIGS}/docker-compose.yml" stop
        log "Container gestoppt"
    else
        err "Kein docker-compose.yml gefunden"
    fi
}

do_restart() {
    header "Neu starten – ${PROJECT_DISPLAY}"
    load_or_init_dirs
    local DC; DC=$(detect_compose)
    if [ -f "${DIR_CONFIGS}/docker-compose.yml" ]; then
        $DC -f "${DIR_CONFIGS}/docker-compose.yml" restart
        log "Container neu gestartet"
    else
        err "Kein docker-compose.yml gefunden"
    fi
}

do_update() {
    header "Update – ${PROJECT_DISPLAY}"
    load_or_init_dirs
    info "Für vollständiges Server-Update: siehe scripts/deploy.sh Referenz"
    warn "Aktuell: Nutze --local für lokale Entwicklung"
}

do_clean() {
    header "Projekt entfernen – ${PROJECT_DISPLAY}"
    warn "Clean-Modus: Nutze --local für lokale Entwicklung"
    info "Supabase stoppen: supabase stop"
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
    check_ports_before_supabase
    echo ""
    log "Port-Check abgeschlossen"
}

do_migrate() {
    header "Migrationen"
    check_supabase_cli
    check_ports_before_supabase
    supabase db reset 2>/dev/null && log "Migrationen ausgeführt" || err "Migrationen fehlgeschlagen"
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

# ═══════════════════════════════════════════════════════════════
# ─── MAIN
# ═══════════════════════════════════════════════════════════════
main() {
    echo ""
    echo -e "${BOLD}${CYAN}  ${PROJECT_DISPLAY} – Deploy Script${NC}"
    echo -e "  ${DIM}Modus: ${MODE}${NC}"
    echo ""

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
        setup)       info "Vollständiges Server-Setup: siehe .claude_reference/deploy.sh"; exit 0 ;;
    esac
}

main
