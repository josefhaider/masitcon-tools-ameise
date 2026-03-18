#!/usr/bin/env bash
# ===================================================================
# Masitcon Ameise (Zeiterfassung) - Server Setup & Deployment
# ===================================================================
#
# Erstinstallation:  bash scripts/server-setup.sh
# Aktualisieren:     bash scripts/server-setup.sh --update
# Status:            bash scripts/server-setup.sh --status
# Diagnose:          bash scripts/server-setup.sh --doctor
# Reparatur:         bash scripts/server-setup.sh --repair
# Deinstallieren:    bash scripts/server-setup.sh --uninstall
#
# Unterstützt mehrere Instanzen auf einem Server (Production + Staging).
# Isolation via INSTANCE_NAME und BASE_DIR.
# ===================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
cleanup_on_exit() {
    local exit_code=$?
    if [ $exit_code -ne 0 ] && [ $exit_code -ne 130 ]; then
        echo ""
        echo -e "  ${YELLOW}Das Script wurde mit Fehlern beendet.${NC}"
        echo -e "  ${YELLOW}Nach Behebung des Problems:${NC}"
        echo -e "    bash scripts/server-setup.sh --repair"
    fi
}
trap cleanup_on_exit EXIT
trap 'echo -e "\n\n${RED}Abgebrochen.${NC}"; exit 130' INT TERM

# ─── Hilfsfunktionen ─────────────────────────────────────────────

ask() {
    local prompt="$1" default="$2" result
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
    echo "$result"
}

confirm() {
    local prompt="$1" default="${2:-j}" yn
    if [ "$default" = "j" ]; then
        read -rp "  $prompt [J/n]: " yn
        yn="${yn:-j}"
    else
        read -rp "  $prompt [j/N]: " yn
        yn="${yn:-n}"
    fi
    [[ "$yn" =~ ^[jJyY]$ ]]
}

is_port_free() {
    ! ss -tlnp 2>/dev/null | grep -q ":${1} "
}

find_free_port() {
    local port="$1" max=$((port + 200))
    while ! is_port_free "$port" && [ "$port" -lt "$max" ]; do
        port=$((port + 1))
    done
    if [ "$port" -ge "$max" ]; then
        echo ""
        return 1
    fi
    echo "$port"
}

is_subnet_free() {
    local subnet="$1"
    local prefix="${subnet%%.*}"
    local second="${subnet#*.}"
    second="${second%%.*}"
    # Alle existierenden Docker-Netzwerk-Subnets holen und auf Überschneidung prüfen
    docker network inspect $(docker network ls -q 2>/dev/null) \
        --format '{{range .IPAM.Config}}{{.Subnet}}{{"\n"}}{{end}}' \
        2>/dev/null | grep -q "^${prefix}\.${second}\." && return 1
    return 0
}

find_free_subnet() {
    # Sucht ein freies /16-Subnet im 172.x.0.0/16-Bereich (Docker-Standard)
    # Startet bei 172.20, geht bis 172.31
    local second
    for second in 20 21 22 23 24 25 26 27 28 29 30 31; do
        local candidate="172.${second}.0.0/16"
        if is_subnet_free "$candidate"; then
            echo "$candidate"
            return 0
        fi
    done
    # Fallback auf 192.168.x.0/24-Bereich
    local third
    for third in 100 101 102 103 104 105; do
        local candidate="192.168.${third}.0/24"
        if is_subnet_free "$candidate"; then
            echo "$candidate"
            return 0
        fi
    done
    echo ""
    return 1
}

detect_compose() {
    if docker compose version >/dev/null 2>&1; then
        echo "docker compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
    else
        echo ""
    fi
}

# ─── Setup-Log ──────────────────────────────────────────────────
SETUP_LOG=""

setup_log_init() {
    local base_dir="${1:-/opt/ameise-production}"
    local timestamp
    timestamp=$(date +%Y%m%d-%H%M%S)
    SETUP_LOG="${base_dir}/setup-log-${timestamp}.txt"
    if ! mkdir -p "$base_dir" 2>/dev/null; then
        sudo mkdir -p "$base_dir" 2>/dev/null || true
        sudo chown "$(whoami):$(id -gn)" "$base_dir" 2>/dev/null || true
    fi

    cat > "$SETUP_LOG" << LOGHEADER
================================================================================
  Masitcon Ameise (Zeiterfassung) - Setup-Protokoll
  Erstellt: $(date '+%Y-%m-%d %H:%M:%S')
  User:     $(whoami)
  Host:     $(hostname -f 2>/dev/null || hostname)
  OS:       $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -s)
================================================================================

LOGHEADER
    chmod 600 "$SETUP_LOG" 2>/dev/null || true
}

slog() {
    [ -z "$SETUP_LOG" ] && return
    echo "[$(date '+%H:%M:%S')] $1" >> "$SETUP_LOG" 2>/dev/null || true
}

slog_header() {
    [ -z "$SETUP_LOG" ] && return
    { echo ""; echo "── $1 ──────────────────────────────────────────"; echo ""; } >> "$SETUP_LOG" 2>/dev/null || true
}

slog_var() {
    [ -z "$SETUP_LOG" ] && return
    printf "  %-30s = %s\n" "$1" "$2" >> "$SETUP_LOG" 2>/dev/null || true
}

slog_secret() {
    [ -z "$SETUP_LOG" ] && return
    local display_val
    if [ -z "$2" ] || [ "$2" = "not-configured" ]; then
        display_val="(nicht gesetzt)"
    else
        display_val="${2:0:3}***${2: -2}"
    fi
    printf "  %-30s = %s\n" "$1" "$display_val" >> "$SETUP_LOG" 2>/dev/null || true
}

slog_finish() {
    [ -z "$SETUP_LOG" ] && return
    cat >> "$SETUP_LOG" << 'LOGFOOTER'

================================================================================
  SICHERHEITSHINWEIS

  Dieses Log enthält sensible Daten (Supabase-Keys, SMTP-Zugangsdaten).
  Nach Prüfung LÖSCHEN:  rm -f THIS_FILE

  Falls Sie Probleme melden: Passwörter/Keys vorher schwärzen!
================================================================================
LOGFOOTER
    sed -i "s|THIS_FILE|$SETUP_LOG|g" "$SETUP_LOG" 2>/dev/null || true
}

# ─── Argument-Parsing ────────────────────────────────────────────
MODE="setup"
BASE_DIR_OVERRIDE=""

show_help() {
    cat << 'HELP'
Masitcon Ameise (Zeiterfassung) - Server Setup & Deployment

Verwendung:
  bash server-setup.sh                   Erstinstallation (interaktiver Wizard)
  bash server-setup.sh --update          Aktualisieren (git pull + rebuild)
  bash server-setup.sh --status          Status anzeigen
  bash server-setup.sh --doctor          Diagnose (nur lesen)
  bash server-setup.sh --repair          Bekannte Probleme beheben
  bash server-setup.sh --reconfigure     Konfiguration ändern
  bash server-setup.sh --backup          Backup erstellen
  bash server-setup.sh --uninstall       Deinstallieren
  bash server-setup.sh --harden          Firewall härten (optional)
  bash server-setup.sh --unharden        Firewall deaktivieren

Optionen:
  --base-dir DIR   Installations-Verzeichnis (überschreibt Auto-Detection)
  --help, -h       Diese Hilfe anzeigen

Mehrere Instanzen (Production + Staging):
  Jede Instanz hat eigenen INSTANCE_NAME, BASE_DIR und Ports.
  Typische Namen: ameise-production, ameise-staging
  Typische Verzeichnisse: /opt/ameise-production, /opt/ameise-staging

Fehlersuche:
  1. bash server-setup.sh --doctor    → Was ist falsch?
  2. bash server-setup.sh --repair    → Automatisch beheben
  3. bash server-setup.sh --doctor    → Prüfen ob OK
HELP
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --update)    MODE="update"; shift ;;
        --clean|--uninstall) MODE="clean"; shift ;;
        --status)    MODE="status"; shift ;;
        --backup)    MODE="backup"; shift ;;
        --reconfigure) MODE="reconfigure"; shift ;;
        --harden)    MODE="harden"; shift ;;
        --unharden)  MODE="unharden"; shift ;;
        --doctor)    MODE="doctor"; shift ;;
        --repair)    MODE="repair"; shift ;;
        --base-dir)
            if [ -z "${2:-}" ]; then err "--base-dir braucht ein Verzeichnis als Argument"; exit 1; fi
            BASE_DIR_OVERRIDE="$2"; shift 2 ;;
        --help|-h)   show_help; exit 0 ;;
        *)           err "Unbekannte Option: $1"; echo ""; show_help; exit 1 ;;
    esac
done

# ─── Auto-Detection: config.env aus Script-Pfad finden ───────────
if [ -z "$BASE_DIR_OVERRIDE" ]; then
    _script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    _candidate="$(dirname "$_script_dir")"
    _candidate_parent="$(dirname "$_candidate")"
    _candidate_grandparent="$(dirname "$_candidate_parent")"
    if [ -f "${_candidate_grandparent}/config.env" ]; then
        BASE_DIR_OVERRIDE="$_candidate_grandparent"
    elif [ -f "${_candidate_parent}/config.env" ]; then
        BASE_DIR_OVERRIDE="$_candidate_parent"
    elif [ -f "${_candidate}/config.env" ]; then
        BASE_DIR_OVERRIDE="$_candidate"
    fi
    unset _script_dir _candidate _candidate_parent _candidate_grandparent
fi

# ─── Alte config.env-Variablen auf neue Namen mappen ─────────────
# Wird nach source config.env aufgerufen, damit --doctor/--update/--repair
# auch mit alten Installationen funktionieren.
migrate_old_config_vars() {
    # Fehlende Defaults sicherstellen
    [ -z "${INSTANCE_NAME:-}" ] && INSTANCE_NAME="ameise-production"
    [ -z "${GIT_BRANCH:-}" ] && GIT_BRANCH="master"
    [ -z "${PROTOCOL:-}" ] && PROTOCOL="https"
    [ -z "${SMTP_SENDER_NAME:-}" ] && SMTP_SENDER_NAME="Ameise Zeiterfassung"
    [ -z "${BACKUP_KEEP:-}" ] && BACKUP_KEEP=7
    # DOCKER_SUBNET: kein harter Default -- wird in collect_config geprüft
}

# ─── App-Verzeichnis erkennen ────────────────────────────────────
detect_app_dir() {
    local base="$1"
    if [ -d "${base}/app/.git" ]; then
        echo "${base}/app"
    elif [ -d "${base}/production/.git" ]; then
        echo "${base}/production"
    elif [ -d "${base}/app" ]; then
        echo "${base}/app"
    elif [ -d "${base}/production" ]; then
        echo "${base}/production"
    else
        echo "${base}/app"
    fi
}

# ═════════════════════════════════════════════════════════════════
# VORAUSSETZUNGEN
# ═════════════════════════════════════════════════════════════════

check_prerequisites() {
    header "Voraussetzungen prüfen"

    local ok=true

    if command -v docker >/dev/null 2>&1; then
        log "Docker $(docker --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    else
        err "Docker ist nicht installiert"
        err "  Installation: https://docs.docker.com/engine/install/"
        ok=false
    fi

    if docker info >/dev/null 2>&1; then
        log "Docker Daemon läuft"
    else
        err "Docker Daemon läuft nicht oder keine Berechtigung"
        err "  Starten: sudo systemctl start docker"
        err "  Benutzer zur docker-Gruppe: sudo usermod -aG docker \$(whoami)"
        ok=false
    fi

    local compose_cmd
    compose_cmd=$(detect_compose)
    if [ -n "$compose_cmd" ]; then
        log "Docker Compose verfügbar ($compose_cmd)"
    else
        err "Docker Compose nicht gefunden"
        ok=false
    fi

    if command -v openssl >/dev/null 2>&1; then
        log "OpenSSL verfügbar"
    else
        err "OpenSSL nicht installiert (wird für Schlüssel-Generierung benötigt)"
        err "  Installation: sudo apt install openssl"
        ok=false
    fi

    if command -v git >/dev/null 2>&1; then
        log "Git $(git --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    else
        err "Git nicht installiert"
        err "  Installation: sudo apt install git"
        ok=false
    fi

    if command -v nginx >/dev/null 2>&1; then
        log "Nginx verfügbar"
    else
        warn "Nginx nicht gefunden (wird am Ende erklärt)"
    fi

    # sudo-Zugriff prüfen
    if sudo -n true 2>/dev/null; then
        log "sudo-Zugriff verfügbar"
    else
        info "sudo-Zugriff wird für einige Schritte benötigt (Verzeichnisse, Nginx)."
        if ! sudo -v 2>/dev/null; then
            warn "sudo nicht verfügbar -- einige Schritte müssen manuell ausgeführt werden"
        else
            log "sudo-Zugriff bestätigt"
        fi
    fi

    if ! $ok; then
        echo ""
        err "Fehlende Voraussetzungen. Bitte zuerst installieren."
        exit 1
    fi
}

# ═════════════════════════════════════════════════════════════════
# INTERAKTIVER WIZARD (5 Schritte)
# ═════════════════════════════════════════════════════════════════

INSTANCE_NAME=""
BASE_DIR=""
GIT_REMOTE=""
GIT_BRANCH=""
APP_HOSTNAME=""
PROTOCOL=""
APP_PORT=""
API_PORT=""
DB_PORT=""
STUDIO_PORT=""
SMTP_HOST=""
SMTP_PORT=""
SMTP_USER=""
SMTP_PASS=""
SMTP_ADMIN_EMAIL=""
SMTP_SENDER_NAME=""
DATA_TRANSFER_PASSWORD=""
JWT_SECRET=""
POSTGRES_PASSWORD=""
ANON_KEY=""
SERVICE_ROLE_KEY=""
BACKUP_DIR=""
BACKUP_KEEP=7
DOCKER_SUBNET=""

collect_config() {
    local prev_config="${BASE_DIR_OVERRIDE:-}/config.env"
    local has_prev_config=false

    if [ -f "$prev_config" ]; then
        has_prev_config=true
        # shellcheck disable=SC1090
        source "$prev_config"
        migrate_old_config_vars
        echo -e "  ${GREEN}✓${NC} Vorherige Konfiguration geladen: $prev_config"
        echo -e "  ${DIM}Drücke Enter um den bisherigen Wert zu übernehmen.${NC}"
        echo ""
    fi

    # ── 1/5: Installation ─────────────────────────────────────────
    header "Schritt 1/5 -- Installation"

    echo "  ${DIM}Der Instanz-Name wird als Verzeichnisname und Container-Prefix verwendet.${NC}"
    echo "  ${DIM}Typische Namen: ameise-production, ameise-staging${NC}"
    echo ""
    INSTANCE_NAME=$(ask "Instanz-Name" "${INSTANCE_NAME:-ameise-production}")

    local default_base="${BASE_DIR:-/opt/${INSTANCE_NAME}}"
    BASE_DIR=$(ask "Installations-Verzeichnis" "$default_base")

    local default_remote="${GIT_REMOTE:-}"
    if [ -z "$default_remote" ] && git remote get-url origin >/dev/null 2>&1; then
        default_remote=$(git remote get-url origin 2>/dev/null)
    fi
    GIT_REMOTE=$(ask "Git-Repository URL" "$default_remote")
    GIT_BRANCH=$(ask "Git-Branch" "${GIT_BRANCH:-master}")

    # ── 2/5: Server & Zugang ──────────────────────────────────────
    header "Schritt 2/5 -- Server & Zugang"

    echo "  Protokoll:"
    echo "    1) HTTP   (internes Netz / Entwicklung -- IP-Adresse reicht)"
    echo "    2) HTTPS  (Produktion -- Domain-Name nötig für SSL-Zertifikat)"
    echo ""

    local default_proto_choice="2"
    if [ "${PROTOCOL:-}" = "http" ]; then
        default_proto_choice="1"
    fi

    local proto_choice
    proto_choice=$(ask "Auswahl" "$default_proto_choice")
    PROTOCOL="https"
    if [ "$proto_choice" = "1" ]; then
        PROTOCOL="http"
    fi
    echo ""

    local default_host="${APP_HOSTNAME:-}"
    if [ -z "$default_host" ]; then
        default_host=$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "")
    fi

    if [ "$PROTOCOL" = "https" ]; then
        echo -e "  ${BOLD}Domain-Name eingeben${NC} (z.B. zeiterfassung.masitcon.de)"
        echo -e "  ${DIM}Dieser Name erscheint in der Browser-URL: https://zeiterfassung.masitcon.de${NC}"
        echo -e "  ${DIM}DNS muss auf die IP dieses Servers zeigen. SSL-Zertifikat wird${NC}"
        echo -e "  ${DIM}nach der Installation per Certbot eingerichtet (Anleitung am Ende).${NC}"
        echo ""
        APP_HOSTNAME=$(ask "Domain-Name" "$default_host")

        # Warnung bei IP-Adresse statt Domain
        if [[ "$APP_HOSTNAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo ""
            warn "Du hast eine IP-Adresse eingegeben ($APP_HOSTNAME)."
            warn "HTTPS braucht einen Domain-Namen für das SSL-Zertifikat!"
            warn "Certbot kann kein Zertifikat für eine IP ausstellen."
            echo ""
            if confirm "Trotzdem mit IP weitermachen? (HTTPS wird nicht funktionieren)" "n"; then
                warn "OK -- du musst SSL selbst konfigurieren."
            else
                APP_HOSTNAME=$(ask "Domain-Name" "")
            fi
        fi
    else
        echo -e "  ${BOLD}Hostname oder IP-Adresse eingeben${NC}"
        echo -e "  ${DIM}Unter dieser Adresse ist die App im Browser erreichbar: http://...${NC}"
        echo ""
        APP_HOSTNAME=$(ask "Hostname / IP" "$default_host")
    fi

    # ── 3/5: Ports ────────────────────────────────────────────────
    header "Schritt 3/5 -- Ports"

    echo "  ${DIM}Alle Ports binden auf 127.0.0.1 (nur via Nginx/SSH-Tunnel erreichbar).${NC}"
    echo "  ${DIM}Belegte Ports werden automatisch erkannt.${NC}"
    echo ""

    # Smart defaults: Staging bekommt andere Ports als Production
    local default_app="${APP_PORT:-3000}"
    local default_api="${API_PORT:-8000}"
    local default_db="${DB_PORT:-5432}"
    local default_studio="${STUDIO_PORT:-3100}"

    if ! $has_prev_config && [[ "$INSTANCE_NAME" == *staging* ]]; then
        default_app="${APP_PORT:-3010}"
        default_api="${API_PORT:-8010}"
        default_db="${DB_PORT:-5442}"
        default_studio="${STUDIO_PORT:-3110}"
    fi

    # Auto-detect freie Ports wenn Defaults belegt
    if ! $has_prev_config; then
        if ! is_port_free "$default_app"; then
            default_app=$(find_free_port "$default_app") || default_app=3000
        fi
        if ! is_port_free "$default_api"; then
            default_api=$(find_free_port "$default_api") || default_api=8000
        fi
        if ! is_port_free "$default_db"; then
            default_db=$(find_free_port "$default_db") || default_db=5432
        fi
        if ! is_port_free "$default_studio"; then
            default_studio=$(find_free_port "$default_studio") || default_studio=3100
        fi
    fi

    local port_label
    for port_info in "APP_PORT:App (Next.js):$default_app" "API_PORT:API (Supabase):$default_api" "DB_PORT:Datenbank:$default_db" "STUDIO_PORT:Studio:$default_studio"; do
        local var_name="${port_info%%:*}"
        local rest="${port_info#*:}"
        port_label="${rest%%:*}"
        local port_default="${rest##*:}"

        local port_val
        port_val=$(ask "$port_label" "$port_default")

        if is_port_free "$port_val"; then
            echo -e "    ${GREEN}✓${NC} Port $port_val frei"
        else
            echo -e "    ${YELLOW}!${NC} Port $port_val BELEGT -- suche Alternative..."
            local alt
            alt=$(find_free_port "$port_val")
            if [ -n "$alt" ]; then
                echo -e "    ${GREEN}→${NC} Verwende Port $alt stattdessen"
                port_val="$alt"
            else
                warn "Kein freier Port gefunden! Bitte manuell wählen."
                port_val=$(ask "$port_label (manuell)" "$port_val")
            fi
        fi

        eval "${var_name}=\"$port_val\""
    done

    # Docker-Subnet: erst Kandidat wählen, dann auf Konflikt prüfen
    local subnet_candidate="${DOCKER_SUBNET:-}"
    if [ -z "$subnet_candidate" ]; then
        if [[ "$INSTANCE_NAME" == *staging* ]]; then
            subnet_candidate="172.21.0.0/16"
        else
            subnet_candidate="172.20.0.0/16"
        fi
    fi

    if ! is_subnet_free "$subnet_candidate"; then
        echo ""
        warn "Subnet ${subnet_candidate} wird bereits von einem anderen Docker-Netzwerk verwendet."
        local free_subnet
        free_subnet=$(find_free_subnet)
        if [ -n "$free_subnet" ]; then
            echo -e "    ${GREEN}→${NC} Verwende freies Subnet: $free_subnet"
            subnet_candidate="$free_subnet"
        else
            warn "Kein freies Subnet gefunden! Bitte manuell eingeben."
            subnet_candidate=""
        fi
    fi
    DOCKER_SUBNET=$(ask "Docker-Subnet" "${subnet_candidate:-172.20.0.0/16}")

    # ── 4/5: E-Mail (SMTP) ────────────────────────────────────────
    header "Schritt 4/5 -- E-Mail (SMTP)"

    echo "  ${DIM}Für Passwort-Reset und Einladungs-E-Mails.${NC}"
    echo -e "  ${DIM}Port 587 (STARTTLS) verwenden -- Port 465 (SMTPS) funktioniert nicht aus Docker.${NC}"
    echo ""

    SMTP_HOST=$(ask "SMTP-Host" "${SMTP_HOST:-smtp.strato.de}")
    SMTP_PORT=$(ask "SMTP-Port (587=STARTTLS)" "${SMTP_PORT:-587}")
    SMTP_USER=$(ask "SMTP-Benutzername" "${SMTP_USER:-}")

    local prev_smtp_hint=""
    if [ -n "${SMTP_PASS:-}" ] && [ "${SMTP_PASS}" != "not-configured" ]; then
        prev_smtp_hint=" (Enter = bisheriges behalten)"
    fi
    local new_smtp_pass
    new_smtp_pass=$(ask_secret "SMTP-Passwort${prev_smtp_hint}")
    if [ -n "$new_smtp_pass" ]; then
        SMTP_PASS="$new_smtp_pass"
    fi
    echo ""
    SMTP_ADMIN_EMAIL=$(ask "Absender-E-Mail" "${SMTP_ADMIN_EMAIL:-$SMTP_USER}")
    SMTP_SENDER_NAME=$(ask "Absendername" "${SMTP_SENDER_NAME:-Ameise Zeiterfassung}")
    echo ""

    if [ -z "$SMTP_PASS" ]; then
        warn "Kein SMTP-Passwort angegeben. E-Mail-Versand wird nicht funktionieren."
    else
        if confirm "SMTP-Verbindung jetzt testen?" "j"; then
            echo ""
            info "Teste Verbindung zu ${SMTP_HOST}:${SMTP_PORT}..."

            local smtp_test_ok=false

            if command -v openssl >/dev/null 2>&1; then
                local openssl_result
                if [ "$SMTP_PORT" = "465" ]; then
                    openssl_result=$(echo "QUIT" | timeout 8 openssl s_client \
                        -connect "${SMTP_HOST}:${SMTP_PORT}" \
                        -quiet 2>&1 || true)
                else
                    openssl_result=$(echo "QUIT" | timeout 8 openssl s_client \
                        -connect "${SMTP_HOST}:${SMTP_PORT}" \
                        -starttls smtp -quiet 2>&1 || true)
                fi

                if echo "$openssl_result" | grep -qi "220\|250\|ok\|connected"; then
                    log "Verbindung zu ${SMTP_HOST}:${SMTP_PORT} erfolgreich"
                    smtp_test_ok=true
                else
                    err "Verbindung fehlgeschlagen"
                fi
            fi

            if ! $smtp_test_ok; then
                echo ""
                warn "SMTP-Test fehlgeschlagen. Mögliche Ursachen:"
                warn "  - Falscher Host/Port"
                warn "  - Firewall blockiert ausgehende Verbindung"
                echo ""
                if ! confirm "Trotzdem mit diesen SMTP-Daten weitermachen?" "j"; then
                    SMTP_HOST=$(ask "SMTP-Host" "$SMTP_HOST")
                    SMTP_PORT=$(ask "SMTP-Port" "$SMTP_PORT")
                    SMTP_USER=$(ask "SMTP-Benutzername" "$SMTP_USER")
                    SMTP_PASS=$(ask_secret "SMTP-Passwort")
                    echo ""
                    SMTP_ADMIN_EMAIL=$(ask "Absender-E-Mail" "$SMTP_USER")
                fi
            fi
        fi
    fi

    # ── 5/5: App-Konfiguration ────────────────────────────────────
    header "Schritt 5/5 -- App-Konfiguration"

    echo -e "  ${BOLD}Datentransfer-Passwort:${NC}"
    echo "  ${DIM}Passwort für die geschützte Datentransfer-API-Route.${NC}"
    echo "  ${DIM}Wird automatisch generiert wenn leer gelassen.${NC}"
    echo ""

    local prev_dt_hint=""
    if [ -n "${DATA_TRANSFER_PASSWORD:-}" ] && [ "${DATA_TRANSFER_PASSWORD}" != "sicheres-passwort-hier" ]; then
        prev_dt_hint=" (Enter = bisheriges behalten)"
    fi
    local new_dt_pass
    new_dt_pass=$(ask_secret "Datentransfer-Passwort${prev_dt_hint}")
    if [ -n "$new_dt_pass" ]; then
        DATA_TRANSFER_PASSWORD="$new_dt_pass"
    elif [ -z "${DATA_TRANSFER_PASSWORD:-}" ] || [ "${DATA_TRANSFER_PASSWORD}" = "sicheres-passwort-hier" ]; then
        DATA_TRANSFER_PASSWORD=$(openssl rand -base64 24 | tr -d '=+/\n' | head -c 24)
        info "Datentransfer-Passwort automatisch generiert."
    fi
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# ZUSAMMENFASSUNG
# ═════════════════════════════════════════════════════════════════

show_summary() {
    header "Zusammenfassung"

    printf "  %-24s %s\n" "Instanz:" "$INSTANCE_NAME"
    printf "  %-24s %s\n" "Verzeichnis:" "${BASE_DIR}/app"
    printf "  %-24s %s\n" "Browser-URL:" "${PROTOCOL}://${APP_HOSTNAME}"
    printf "  %-24s %s\n" "Docker-Subnet:" "$DOCKER_SUBNET"
    echo ""
    echo -e "  ${BOLD}Ports (alle auf 127.0.0.1, nur via Nginx erreichbar):${NC}"
    printf "    %-22s %s\n" "App (Next.js):" "Port ${APP_PORT}"
    printf "    %-22s %s\n" "API (Supabase Kong):" "Port ${API_PORT}"
    printf "    %-22s %s\n" "Datenbank (Postgres):" "Port ${DB_PORT}"
    printf "    %-22s %s\n" "Studio:" "Port ${STUDIO_PORT} (SSH-Tunnel)"
    echo ""
    printf "  %-24s %s\n" "SMTP:" "${SMTP_HOST}:${SMTP_PORT}"
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# SECRETS GENERIEREN
# ═════════════════════════════════════════════════════════════════

generate_secrets() {
    if [ -n "${JWT_SECRET:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ] && \
       [ -n "${ANON_KEY:-}" ] && [ -n "${SERVICE_ROLE_KEY:-}" ]; then
        log "Secrets bereits vorhanden -- unverändert."
        return 0
    fi

    info "Generiere Secrets..."

    if [ -z "${JWT_SECRET:-}" ]; then
        JWT_SECRET=$(openssl rand -hex 40)
        POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/\n' | head -c 32)

        local iat exp hdr pld sig
        iat=$(date +%s); exp=4102444800
        hdr=$(printf '{"alg":"HS256","typ":"JWT"}' | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')

        pld=$(printf '{"role":"anon","iss":"supabase","iat":%d,"exp":%d}' "$iat" "$exp" | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
        sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
        ANON_KEY="${hdr}.${pld}.${sig}"

        pld=$(printf '{"role":"service_role","iss":"supabase","iat":%d,"exp":%d}' "$iat" "$exp" | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
        sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
        SERVICE_ROLE_KEY="${hdr}.${pld}.${sig}"

        log "Alle Secrets generiert."
    else
        if [ -z "${POSTGRES_PASSWORD:-}" ]; then
            POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/\n' | head -c 32)
        fi
        if [ -z "${ANON_KEY:-}" ]; then
            local iat exp hdr pld sig
            iat=$(date +%s); exp=4102444800
            hdr=$(printf '{"alg":"HS256","typ":"JWT"}' | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
            pld=$(printf '{"role":"anon","iss":"supabase","iat":%d,"exp":%d}' "$iat" "$exp" | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
            sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
            ANON_KEY="${hdr}.${pld}.${sig}"
        fi
        if [ -z "${SERVICE_ROLE_KEY:-}" ]; then
            local iat exp hdr pld sig
            iat=$(date +%s); exp=4102444800
            hdr=$(printf '{"alg":"HS256","typ":"JWT"}' | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
            pld=$(printf '{"role":"service_role","iss":"supabase","iat":%d,"exp":%d}' "$iat" "$exp" | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
            sig=$(printf '%s.%s' "$hdr" "$pld" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
            SERVICE_ROLE_KEY="${hdr}.${pld}.${sig}"
        fi
        log "Fehlende Secrets ergänzt."
    fi

    # PG_META_CRYPTO_KEY nur generieren wenn nicht bereits vorhanden
    if [ -z "${PG_META_CRYPTO_KEY:-}" ]; then
        PG_META_CRYPTO_KEY=$(openssl rand -hex 32)
        log "PG_META_CRYPTO_KEY generiert."
    fi
}

# ═════════════════════════════════════════════════════════════════
# DATEI-GENERATOREN
# ═════════════════════════════════════════════════════════════════

_safe_val() {
    local v="$1"
    v="${v//\\/\\\\}"
    v="${v//\"/\\\"}"
    v="${v//\$/\\\$}"
    v="${v//\`/\\\`}"
    echo "\"$v\""
}

save_config() {
    local file="$1"
    local today
    today=$(date +%Y-%m-%d)

    {
        echo "# Masitcon Ameise (Zeiterfassung) -- Deployment-Konfiguration"
        echo "# Erzeugt: $today von server-setup.sh"
        echo "# NICHT MANUELL BEARBEITEN -- verwende: bash scripts/server-setup.sh --reconfigure"
        echo ""
        echo "SETUP_DATE=\"$today\""
        echo "INSTANCE_NAME=\"$INSTANCE_NAME\""
        echo "BASE_DIR=\"$BASE_DIR\""
        echo "GIT_REMOTE=\"$GIT_REMOTE\""
        echo "GIT_BRANCH=\"$GIT_BRANCH\""
        echo ""
        echo "APP_HOSTNAME=\"$APP_HOSTNAME\""
        echo "PROTOCOL=\"$PROTOCOL\""
        echo ""
        echo "APP_PORT=\"$APP_PORT\""
        echo "API_PORT=\"$API_PORT\""
        echo "DB_PORT=\"$DB_PORT\""
        echo "STUDIO_PORT=\"$STUDIO_PORT\""
        echo "DOCKER_SUBNET=\"$DOCKER_SUBNET\""
        echo ""
        echo "SMTP_HOST=\"$SMTP_HOST\""
        echo "SMTP_PORT=\"$SMTP_PORT\""
        echo "SMTP_USER=\"$SMTP_USER\""
        printf "SMTP_PASS=%s\n" "$(_safe_val "$SMTP_PASS")"
        echo "SMTP_ADMIN_EMAIL=\"$SMTP_ADMIN_EMAIL\""
        echo "SMTP_SENDER_NAME=\"$SMTP_SENDER_NAME\""
        echo ""
        printf "DATA_TRANSFER_PASSWORD=%s\n" "$(_safe_val "$DATA_TRANSFER_PASSWORD")"
        echo ""
        echo "BACKUP_DIR=\"${BACKUP_DIR:-${BASE_DIR}/backups}\""
        echo "BACKUP_KEEP=\"${BACKUP_KEEP:-7}\""
        echo ""
        echo "# Secrets (automatisch generiert -- NICHT ÄNDERN!)"
        echo "JWT_SECRET=\"$JWT_SECRET\""
        echo "POSTGRES_PASSWORD=\"$POSTGRES_PASSWORD\""
        echo "ANON_KEY=\"$ANON_KEY\""
        echo "SERVICE_ROLE_KEY=\"$SERVICE_ROLE_KEY\""
        echo "PG_META_CRYPTO_KEY=\"${PG_META_CRYPTO_KEY}\""
    } > "$file"

    chmod 600 "$file"
    log "Konfiguration gespeichert: $file"
}

generate_docker_env() {
    local file="$1"

    local supabase_url="${PROTOCOL}://${APP_HOSTNAME}/supabase"
    local api_external_url="${PROTOCOL}://${APP_HOSTNAME}/supabase"
    local site_url="${PROTOCOL}://${APP_HOSTNAME}"
    local redirect_urls="http://127.0.0.1:3000,https://127.0.0.1:3000,${site_url}"
    local pg_meta_crypto_key="${PG_META_CRYPTO_KEY}"
    local docker_subnet="${DOCKER_SUBNET:-172.20.0.0/16}"

    cat > "$file" << EOF
# ═══════════════════════════════════════════════════════════════
# Ameise Zeiterfassung - Docker Compose Environment
# Instanz  : ${INSTANCE_NAME}
# Generiert: $(date +%Y-%m-%d) von server-setup.sh
# ACHTUNG  : Enthält Secrets! Niemals committen.
# ═══════════════════════════════════════════════════════════════

# Stack
COMPOSE_PROJECT_NAME=${INSTANCE_NAME}

# PostgreSQL
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=postgres

# JWT / API Keys
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRY=3600
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}

# Ports
API_PORT=${API_PORT}
DB_PORT=${DB_PORT}
APP_PORT=${APP_PORT}
STUDIO_PORT=${STUDIO_PORT}

# Studio / pg-meta
PG_META_CRYPTO_KEY=${pg_meta_crypto_key}
STUDIO_DEFAULT_ORGANIZATION=Masitcon
STUDIO_DEFAULT_PROJECT=Ameise

# Auth
SITE_URL=${site_url}
SITE_HOSTNAME=${APP_HOSTNAME}
API_EXTERNAL_URL=${api_external_url}
ADDITIONAL_REDIRECT_URLS=${redirect_urls}
DISABLE_SIGNUP=true
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=false

# SMTP
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS="${SMTP_PASS}"
SMTP_ADMIN_EMAIL=${SMTP_ADMIN_EMAIL}
SMTP_SENDER_NAME=${SMTP_SENDER_NAME}

# Mailer (App Router: /auth/confirm statt /auth/v1/verify)
MAILER_URLPATHS_INVITE=/auth/confirm
MAILER_URLPATHS_CONFIRMATION=/auth/confirm
MAILER_URLPATHS_RECOVERY=/auth/confirm
MAILER_URLPATHS_EMAIL_CHANGE=/auth/confirm

# PKCE Flow State (24h für E-Mail-Bestätigungs-Links)
FLOW_STATE_EXPIRY_DURATION=86400

# PostgREST
PGRST_DB_SCHEMAS=public,storage

# Next.js (NEXT_PUBLIC_SUPABASE_URL wird zur BUILD-ZEIT eingebettet)
NEXT_PUBLIC_SUPABASE_URL=${supabase_url}

# Interne Supabase-URL für Server-Side-Requests (kein TLS, kein DNS-Lookup)
INTERNAL_SUPABASE_URL=http://127.0.0.1:${API_PORT}

# App-Konfiguration
DATA_TRANSFER_PASSWORD=${DATA_TRANSFER_PASSWORD}

# Docker-Netzwerk (Production und Staging brauchen unterschiedliche Subnets)
DOCKER_SUBNET=${docker_subnet}
EOF

    chmod 600 "$file"
    log "docker/.env generiert"
}

# ═════════════════════════════════════════════════════════════════
# BESTEHENDE docker/.env AUTOMATISCH PATCHEN (idempotent)
# ═════════════════════════════════════════════════════════════════

apply_env_migrations() {
    local app_dir="$1"
    local compose_cmd="${2:-}"
    local env_file="${app_dir}/docker/.env"

    if [ ! -f "$env_file" ]; then
        warn "docker/.env nicht gefunden in $app_dir -- überspringe."
        return
    fi

    local changed=false

    # MAILER_URLPATHS: alte /auth/v1/verify → neue /auth/confirm (App Router)
    if grep -q 'MAILER_URLPATHS.*=/auth/v1/verify' "$env_file" 2>/dev/null; then
        sed -i 's|MAILER_URLPATHS_INVITE=/auth/v1/verify|MAILER_URLPATHS_INVITE=/auth/confirm|g' "$env_file"
        sed -i 's|MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify|MAILER_URLPATHS_CONFIRMATION=/auth/confirm|g' "$env_file"
        sed -i 's|MAILER_URLPATHS_RECOVERY=/auth/v1/verify|MAILER_URLPATHS_RECOVERY=/auth/confirm|g' "$env_file"
        sed -i 's|MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify|MAILER_URLPATHS_EMAIL_CHANGE=/auth/confirm|g' "$env_file"
        log "MAILER_URLPATHS aktualisiert."
        changed=true
    fi

    # MAILER_URLPATHS hinzufügen wenn komplett fehlend
    if ! grep -q 'MAILER_URLPATHS_INVITE' "$env_file" 2>/dev/null; then
        {
            echo ""
            echo "MAILER_URLPATHS_INVITE=/auth/confirm"
            echo "MAILER_URLPATHS_CONFIRMATION=/auth/confirm"
            echo "MAILER_URLPATHS_RECOVERY=/auth/confirm"
            echo "MAILER_URLPATHS_EMAIL_CHANGE=/auth/confirm"
        } >> "$env_file"
        log "MAILER_URLPATHS ergänzt."
        changed=true
    fi

    # FLOW_STATE_EXPIRY_DURATION (24h für E-Mail-Links)
    if ! grep -q 'FLOW_STATE_EXPIRY_DURATION' "$env_file" 2>/dev/null; then
        { echo ""; echo "FLOW_STATE_EXPIRY_DURATION=86400"; } >> "$env_file"
        log "FLOW_STATE_EXPIRY_DURATION ergänzt."
        changed=true
    fi

    # SITE_HOSTNAME aus SITE_URL ableiten
    if ! grep -q 'SITE_HOSTNAME' "$env_file" 2>/dev/null; then
        local site_url_val site_hostname
        site_url_val=$(grep '^SITE_URL=' "$env_file" | cut -d= -f2-)
        if [ -n "$site_url_val" ]; then
            site_hostname=$(echo "$site_url_val" | sed 's|https\?://||' | sed 's|/.*||' | sed 's|:.*||')
            sed -i "/^SITE_URL=/a SITE_HOSTNAME=${site_hostname}" "$env_file"
            log "SITE_HOSTNAME ergänzt."
            changed=true
        fi
    fi

    # PG_META_CRYPTO_KEY
    if ! grep -q 'PG_META_CRYPTO_KEY' "$env_file" 2>/dev/null; then
        local pg_meta_key curr_project_id
        pg_meta_key=$(openssl rand -hex 32)
        curr_project_id=$(grep '^COMPOSE_PROJECT_NAME=' "$env_file" 2>/dev/null | cut -d= -f2)
        { echo ""; echo "PG_META_CRYPTO_KEY=${pg_meta_key}"; echo "STUDIO_DEFAULT_ORGANIZATION=Masitcon"; echo "STUDIO_DEFAULT_PROJECT=${curr_project_id:-Ameise}"; } >> "$env_file"
        log "PG_META_CRYPTO_KEY ergänzt."
        changed=true
    fi

    # STUDIO_PORT
    if ! grep -q 'STUDIO_PORT' "$env_file" 2>/dev/null; then
        local curr_app_port
        curr_app_port=$(grep '^APP_PORT=' "$env_file" | cut -d= -f2)
        sed -i "/^APP_PORT=/a STUDIO_PORT=$(( ${curr_app_port:-3000} + 100 ))" "$env_file"
        log "STUDIO_PORT ergänzt."
        changed=true
    fi

    # DATA_TRANSFER_PASSWORD
    if ! grep -q 'DATA_TRANSFER_PASSWORD' "$env_file" 2>/dev/null; then
        local dt_pass
        dt_pass=$(openssl rand -base64 24 | tr -d '=+/\n' | head -c 24)
        { echo ""; echo "DATA_TRANSFER_PASSWORD=${dt_pass}"; } >> "$env_file"
        log "DATA_TRANSFER_PASSWORD ergänzt."
        changed=true
    fi

    # DOCKER_SUBNET
    if ! grep -q 'DOCKER_SUBNET' "$env_file" 2>/dev/null; then
        { echo ""; echo "DOCKER_SUBNET=172.20.0.0/16"; } >> "$env_file"
        log "DOCKER_SUBNET ergänzt."
        changed=true
    fi

    # INTERNAL_SUPABASE_URL
    if ! grep -q 'INTERNAL_SUPABASE_URL' "$env_file" 2>/dev/null; then
        local api_port_val
        api_port_val=$(grep '^API_PORT=' "$env_file" | cut -d= -f2)
        if [ -n "$api_port_val" ]; then
            { echo ""; echo "INTERNAL_SUPABASE_URL=http://127.0.0.1:${api_port_val}"; } >> "$env_file"
            log "INTERNAL_SUPABASE_URL ergänzt."
            changed=true
        fi
    fi

    # Doppelte STUDIO_PORT bereinigen
    local duplicates
    duplicates=$(grep -c '^STUDIO_PORT=' "$env_file" 2>/dev/null || echo "0")
    if [ "$duplicates" -gt 1 ]; then
        local first_val
        first_val=$(grep '^STUDIO_PORT=' "$env_file" | head -1 | cut -d= -f2)
        sed -i '/^STUDIO_PORT=/d' "$env_file"
        echo "STUDIO_PORT=${first_val}" >> "$env_file"
        changed=true
    fi

    if [ "$changed" = true ]; then
        log "docker/.env wurde aktualisiert."
    else
        info "docker/.env ist aktuell."
    fi

    # Passwort-Check wenn Stack läuft
    if [ -n "$compose_cmd" ]; then
        if ! check_db_password_sync "$app_dir" "$compose_cmd" 2>/dev/null; then
            warn "DB-Passwort nicht synchron -- führe Sync durch..."
            sync_db_passwords "$app_dir" "$compose_cmd" || true
        else
            info "DB-Passwörter sind synchron."
        fi
    fi
}

# ═════════════════════════════════════════════════════════════════
# MIGRATIONEN
# ═════════════════════════════════════════════════════════════════

apply_new_migrations() {
    local app_dir="$1"
    local compose_cmd="$2"

    # supabase_admin über TCP (127.0.0.1 = trust in pg_hba.conf)
    local PSQL_CMD="psql -U supabase_admin -h 127.0.0.1 -d postgres"

    info "Prüfe auf neue Migrationen..."
    cd "$app_dir"

    $compose_cmd -f docker/docker-compose.yml exec -T db \
        $PSQL_CMD -c \
        "CREATE TABLE IF NOT EXISTS public._applied_migrations (
            version text PRIMARY KEY,
            applied_at timestamptz DEFAULT now()
        );" > /dev/null 2>&1 || true

    local new_count=0 applied_count=0

    for f in $(ls supabase/migrations/*.sql 2>/dev/null | sort); do
        [ -f "$f" ] || continue
        local version
        version=$(basename "$f")

        local already
        already=$($compose_cmd -f docker/docker-compose.yml exec -T db \
            $PSQL_CMD -tAc \
            "SELECT 1 FROM public._applied_migrations WHERE version = '$version'" 2>/dev/null || echo "")

        [ "$already" = "1" ] && continue

        new_count=$((new_count + 1))
        info "Wende Migration an: $version"

        if $compose_cmd -f docker/docker-compose.yml exec -T db \
                $PSQL_CMD -f "/app-migrations/$version" > /dev/null 2>&1; then
            $compose_cmd -f docker/docker-compose.yml exec -T db \
                $PSQL_CMD -c \
                "INSERT INTO public._applied_migrations (version) VALUES ('$version') ON CONFLICT DO NOTHING;" \
                > /dev/null 2>&1
            applied_count=$((applied_count + 1))
            log "Migration OK: $version"
        else
            warn "Migration hatte Warnungen: $version"
            applied_count=$((applied_count + 1))
        fi
    done

    if [ "$new_count" -eq 0 ]; then
        info "Keine neuen Migrationen -- DB ist aktuell."
    else
        log "$applied_count von $new_count Migrationen angewendet."
    fi
}

# ═════════════════════════════════════════════════════════════════
# DB-PASSWORT-SYNCHRONISATION
# ═════════════════════════════════════════════════════════════════

sync_db_passwords() {
    local app_dir="$1"
    local compose_cmd="$2"
    local env_file="${app_dir}/docker/.env"

    if [ ! -f "$env_file" ]; then
        warn "docker/.env nicht gefunden -- überspringe Passwort-Sync."
        return 1
    fi

    local pg_pass
    pg_pass=$(grep '^POSTGRES_PASSWORD=' "$env_file" | cut -d= -f2-)

    if [ -z "$pg_pass" ]; then
        warn "POSTGRES_PASSWORD nicht gefunden -- überspringe."
        return 1
    fi

    info "Synchronisiere DB-Passwörter..."

    # Dollar-Quoting ($pwd$...$pwd$) statt einfache Quotes -- sicher bei Sonderzeichen im Passwort
    local sql
    sql="ALTER USER authenticator            WITH PASSWORD \$pwd\$${pg_pass}\$pwd\$;
         ALTER USER supabase_auth_admin      WITH PASSWORD \$pwd\$${pg_pass}\$pwd\$;
         ALTER USER supabase_storage_admin   WITH PASSWORD \$pwd\$${pg_pass}\$pwd\$;
         ALTER USER supabase_functions_admin WITH PASSWORD \$pwd\$${pg_pass}\$pwd\$;
         ALTER USER pgbouncer                WITH PASSWORD \$pwd\$${pg_pass}\$pwd\$;"

    # -h 127.0.0.1: TCP statt Unix-Socket → pg_hba.conf "trust" greift
    local output
    if output=$($compose_cmd -f docker/docker-compose.yml exec -T db \
            psql -U supabase_admin -h 127.0.0.1 -c "$sql" 2>&1); then
        log "DB-Passwörter synchronisiert."
        return 0
    else
        warn "Passwort-Sync: $output"
        return 1
    fi
}

check_db_password_sync() {
    local app_dir="$1"
    local compose_cmd="$2"
    local env_file="${app_dir}/docker/.env"

    local pg_pass db_name
    pg_pass=$(grep '^POSTGRES_PASSWORD=' "$env_file" | cut -d= -f2-)
    db_name=$(grep '^POSTGRES_DB=' "$env_file" | cut -d= -f2- 2>/dev/null || echo "postgres")
    db_name="${db_name:-postgres}"

    # TCP-Verbindung (127.0.0.1) mit explizitem Passwort testen
    $compose_cmd -f docker/docker-compose.yml exec -T \
        -e PGPASSWORD="${pg_pass}" db \
        psql -U supabase_auth_admin -h 127.0.0.1 -d "${db_name}" \
        -c "SELECT 1" > /dev/null 2>&1
}

# ═════════════════════════════════════════════════════════════════
# NGINX
# ═════════════════════════════════════════════════════════════════

generate_nginx_conf() {
    local file="$1"

    cat > "$file" << CONF
# Masitcon Ameise (Zeiterfassung) - Nginx Reverse Proxy (${INSTANCE_NAME:-ameise-production})
# Generiert von server-setup.sh
#
# HTTPS nachrüsten:
#   sudo apt install certbot python3-certbot-nginx
#   sudo certbot --nginx -d ${APP_HOSTNAME}

server {
    listen 80;
    server_name ${APP_HOSTNAME};

    client_max_body_size 200M;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    location /supabase/ {
        proxy_pass http://127.0.0.1:${API_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}
CONF

    log "Nginx-Config generiert: $file"
}

install_nginx_conf() {
    local src_file="$1"
    local name="${INSTANCE_NAME:-ameise-production}"
    local dest="/etc/nginx/sites-available/${name}.conf"
    local link="/etc/nginx/sites-enabled/${name}.conf"

    if ! command -v nginx >/dev/null 2>&1; then
        return 1
    fi

    if ! sudo cp "$src_file" "$dest" 2>/dev/null; then
        err "Konnte Nginx-Config nicht kopieren: $src_file → $dest"
        return 1
    fi

    sudo ln -sf "$dest" "$link" 2>/dev/null || true

    if sudo nginx -t >/dev/null 2>&1; then
        sudo systemctl reload nginx >/dev/null 2>&1 || sudo service nginx reload >/dev/null 2>&1 || true
        log "Nginx-Config aktiviert: $dest"
        return 0
    else
        err "nginx -t fehlgeschlagen! Config prüfen: sudo nginx -t"
        return 1
    fi
}

# ═════════════════════════════════════════════════════════════════
# PORT-CHECK VOR DOCKER-START
# ═════════════════════════════════════════════════════════════════

preflight_port_check() {
    local ok=true

    echo -e "  ${BOLD}Port-Check:${NC}"
    for port_info in "${APP_PORT}:App" "${API_PORT}:API" "${DB_PORT}:Datenbank" "${STUDIO_PORT}:Studio"; do
        local port="${port_info%%:*}"
        local label="${port_info##*:}"
        printf "    %-20s Port %-6s" "$label" "$port"
        if is_port_free "$port"; then
            echo -e "  ${GREEN}frei${NC}"
        else
            echo -e "  ${RED}BELEGT!${NC}"
            ok=false
        fi
    done

    if ! $ok; then
        echo ""
        err "Belegte Ports gefunden! Docker-Stack kann nicht starten."
        err "Bitte Ports ändern: bash scripts/server-setup.sh --reconfigure"
        return 1
    fi
    return 0
}

# ═════════════════════════════════════════════════════════════════
# INSTALLATION
# ═════════════════════════════════════════════════════════════════

do_install() {
    local app_dir="${BASE_DIR}/app"
    local total_steps=7
    local step=0

    # ── [1/7] Verzeichnis anlegen ─────────────────────────────────
    step=$((step + 1))
    echo -e "  ${BOLD}[${step}/${total_steps}] Verzeichnis anlegen...${NC}"
    if ! mkdir -p "$app_dir" 2>/dev/null; then
        info "Benötige sudo für $app_dir..."
        if sudo mkdir -p "$app_dir" && sudo chown "$(whoami):$(id -gn)" "$BASE_DIR" "$app_dir"; then
            log "Verzeichnis angelegt: $app_dir"
        else
            err "Verzeichnis konnte nicht angelegt werden: $app_dir"
            err "Bitte manuell: sudo mkdir -p $app_dir && sudo chown \$(whoami):\$(id -gn) $app_dir"
            return 1
        fi
    else
        log "Verzeichnis OK"
    fi

    if [ ! -w "$app_dir" ]; then
        err "Verzeichnis nicht beschreibbar: $app_dir"
        err "  Bitte manuell: sudo chown $(whoami):$(id -gn) $BASE_DIR $app_dir"
        return 1
    fi

    # ── [2/7] Repository klonen ───────────────────────────────────
    step=$((step + 1))
    echo -e "  ${BOLD}[${step}/${total_steps}] Repository klonen...${NC}"
    if [ -d "$app_dir/.git" ]; then
        info "Repository existiert. Aktualisiere..."
        cd "$app_dir"
        git pull origin "$GIT_BRANCH" || {
            err "git pull fehlgeschlagen!"
            err "  Lösung: cd $app_dir && git status"
            return 1
        }
    else
        git clone --branch "$GIT_BRANCH" "$GIT_REMOTE" "$app_dir" || {
            err "git clone fehlgeschlagen!"
            err "  Prüfe: Git-URL und Branch korrekt? SSH-Key vorhanden?"
            return 1
        }
    fi
    cd "$app_dir"
    log "Repository OK"

    # ── [3/7] Secrets generieren ──────────────────────────────────
    step=$((step + 1))
    echo -e "  ${BOLD}[${step}/${total_steps}] Secrets generieren...${NC}"
    if ! generate_secrets; then
        err "Secret-Generierung fehlgeschlagen!"
        return 1
    fi

    # ── [4/7] Konfiguration schreiben ─────────────────────────────
    step=$((step + 1))
    echo -e "  ${BOLD}[${step}/${total_steps}] Konfiguration schreiben...${NC}"
    save_config "${BASE_DIR}/config.env"
    generate_docker_env "${app_dir}/docker/.env"

    # ── [5/7] Docker-Stack starten ────────────────────────────────
    step=$((step + 1))
    echo -e "  ${BOLD}[${step}/${total_steps}] Docker-Stack starten...${NC}"

    if ! preflight_port_check; then
        return 1
    fi

    local compose_cmd
    compose_cmd=$(detect_compose)

    cd "$app_dir"
    info "Starte Stack (kann beim ersten Mal einige Minuten dauern)..."
    local compose_output
    if ! compose_output=$($compose_cmd -f docker/docker-compose.yml up -d --build 2>&1); then
        echo ""
        err "Docker-Stack konnte nicht gestartet werden!"
        echo ""

        # Spezifische Fehlerdiagnose
        if echo "$compose_output" | grep -q "Pool overlaps"; then
            err "Docker-Netzwerk-Konflikt: Subnet ${DOCKER_SUBNET} wird bereits verwendet!"
            echo ""
            echo "  Lösung A -- Anderes Subnet wählen (empfohlen):"
            echo "    bash scripts/server-setup.sh --reconfigure"
            echo "    → Bei 'Docker-Subnet' z.B. 172.22.0.0/16 oder 172.23.0.0/16 eingeben"
            echo ""
            echo "  Lösung B -- Konflikt-Netzwerk anzeigen + entfernen:"
            echo "    docker network ls"
            echo "    docker network inspect <NETZWERK-NAME>"
            echo "    docker network rm <NETZWERK-NAME>"
            echo "    bash scripts/server-setup.sh --repair"
        elif echo "$compose_output" | grep -q "address already in use\|port is already allocated\|bind:"; then
            err "Port bereits belegt!"
            echo ""
            echo "  Belegter Port anzeigen:"
            echo "    sudo ss -tlnp | grep -E '${APP_PORT}|${API_PORT}|${DB_PORT}'"
            echo ""
            echo "  Anderen Port konfigurieren:"
            echo "    bash scripts/server-setup.sh --reconfigure"
        else
            echo "  Häufige Ursachen:"
            echo "    - Port bereits belegt"
            echo "    - Nicht genügend Arbeitsspeicher"
            echo "    - Docker-Daemon nicht laufend"
            echo ""
            echo "  Fehlermeldung:"
            echo "$compose_output" | tail -5 | sed 's/^/    /'
            echo ""
            echo "  Debugging:"
            echo "    cd $app_dir"
            echo "    $compose_cmd -f docker/docker-compose.yml up -d --build"
        fi
        echo ""
        echo "  Nach Behebung:"
        echo "    bash scripts/server-setup.sh --repair"
        return 1
    fi
    log "Docker-Stack gestartet"

    # ── [6/7] Datenbank einrichten ────────────────────────────────
    step=$((step + 1))
    echo -e "  ${BOLD}[${step}/${total_steps}] Datenbank einrichten...${NC}"

    info "Warte auf Datenbank..."
    local db_retries=0
    while ! $compose_cmd -f docker/docker-compose.yml exec -T db pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do
        db_retries=$((db_retries + 1))
        if [ "$db_retries" -gt 30 ]; then
            err "Datenbank nicht bereit nach 30 Sekunden!"
            err "  Logs: $compose_cmd -f docker/docker-compose.yml logs db"
            return 1
        fi
        sleep 1
    done
    log "Datenbank bereit"

    sync_db_passwords "$app_dir" "$compose_cmd" || true

    info "Starte Auth-abhängige Services neu..."
    local project="${INSTANCE_NAME:-ameise-production}"
    docker restart "${project}-auth" "${project}-rest" "${project}-storage" >/dev/null 2>&1 || true

    local auth_ok=false auth_wait=0
    echo -n "  Warte auf Auth-Service..."
    while [ "$auth_wait" -lt 30 ]; do
        if curl -sf "http://localhost:${API_PORT}/auth/v1/health" > /dev/null 2>&1; then
            auth_ok=true; break
        fi
        sleep 1; auth_wait=$((auth_wait + 1)); echo -n "."
    done
    echo ""
    if [ "$auth_ok" = true ]; then
        log "Auth-Service läuft"
    else
        warn "Auth-Service antwortet noch nicht -- prüfe mit: bash scripts/server-setup.sh --doctor"
    fi

    apply_new_migrations "$app_dir" "$compose_cmd"

    # ── [7/7] Nginx-Konfiguration ─────────────────────────────────
    step=$((step + 1))
    echo -e "  ${BOLD}[${step}/${total_steps}] Nginx-Konfiguration...${NC}"
    local nginx_file="${BASE_DIR}/nginx-${INSTANCE_NAME}.conf"
    generate_nginx_conf "$nginx_file"

    if command -v nginx >/dev/null 2>&1; then
        if install_nginx_conf "$nginx_file"; then
            log "Nginx-Config installiert und aktiviert"
        else
            warn "Nginx-Config konnte nicht automatisch installiert werden"
        fi
    else
        warn "Nginx nicht installiert (wird am Ende erklärt)"
    fi

    return 0
}

# ═════════════════════════════════════════════════════════════════
# UPDATE
# ═════════════════════════════════════════════════════════════════

do_update() {
    local config_file="${BASE_DIR_OVERRIDE:-/opt/ameise-production}/config.env"

    if [ ! -f "$config_file" ]; then
        err "Keine Konfiguration gefunden: $config_file"
        err "Bitte zuerst installieren: bash scripts/server-setup.sh"
        exit 1
    fi

    # shellcheck disable=SC1090
    source "$config_file"
    migrate_old_config_vars

    header "Update"

    local app_dir
    app_dir=$(detect_app_dir "$BASE_DIR")

    if [ ! -d "$app_dir" ]; then
        err "App-Verzeichnis nicht gefunden: $app_dir"
        exit 1
    fi

    local compose_cmd
    compose_cmd=$(detect_compose)

    # Backup anbieten
    if confirm "Backup vor dem Update erstellen?" "j"; then
        do_backup
    fi
    echo ""

    cd "$app_dir"

    # 1. Git update
    info "Aktualisiere Code (git pull)..."
    if ! git pull origin "$GIT_BRANCH"; then
        err "git pull fehlgeschlagen!"
        err "  Prüfe: cd $app_dir && git status"
        if ! confirm "Trotzdem weitermachen?" "n"; then
            exit 1
        fi
    fi

    # 2. docker/.env patchen + Passwort-Check
    apply_env_migrations "$app_dir" "$compose_cmd"

    # 3. Migrationen anwenden
    apply_new_migrations "$app_dir" "$compose_cmd"

    # 4. App-Container neu bauen
    info "Baue App-Container neu..."
    if ! $compose_cmd -f docker/docker-compose.yml up -d --build; then
        err "Docker-Build fehlgeschlagen!"
        err "  Debugging: cd $app_dir && $compose_cmd -f docker/docker-compose.yml up -d --build"
    else
        log "Erfolgreich aktualisiert!"
    fi

    sync_db_passwords "$app_dir" "$compose_cmd" || true
    local project="${INSTANCE_NAME:-ameise-production}"
    docker restart "${project}-auth" "${project}-rest" "${project}-storage" >/dev/null 2>&1 || true

    # 5. Nginx regenerieren
    local nginx_file="${BASE_DIR}/nginx-${INSTANCE_NAME:-ameise-production}.conf"
    generate_nginx_conf "$nginx_file"
    install_nginx_conf "$nginx_file" 2>/dev/null || true

    echo ""
}

# ═════════════════════════════════════════════════════════════════
# BACKUP
# ═════════════════════════════════════════════════════════════════

do_backup() {
    local config_file="${BASE_DIR_OVERRIDE:-/opt/ameise-production}/config.env"

    if [ ! -f "$config_file" ]; then
        err "Keine Konfiguration gefunden: $config_file"
        exit 1
    fi

    # shellcheck disable=SC1090
    source "$config_file"
    migrate_old_config_vars

    local backup_base="${BACKUP_DIR:-${BASE_DIR}/backups}"
    local timestamp
    timestamp=$(date +%Y-%m-%d_%H%M%S)
    local backup_dir="${backup_base}/${timestamp}"
    local backup_keep="${BACKUP_KEEP:-7}"

    local compose_cmd
    compose_cmd=$(detect_compose)

    local app_dir
    app_dir=$(detect_app_dir "$BASE_DIR")

    header "Backup erstellen"
    info "Backup-Verzeichnis: $backup_dir"

    if ! mkdir -p "$backup_dir" 2>/dev/null; then
        sudo mkdir -p "$backup_dir" 2>/dev/null && sudo chown "$(whoami):$(id -gn)" "$backup_dir"
    fi

    local backup_ok=true

    if [ -d "$app_dir" ]; then
        cd "$app_dir"
        info "Erstelle Datenbank-Dump..."

        if $compose_cmd -f docker/docker-compose.yml ps db 2>/dev/null | grep -qiE 'running|up'; then
            if $compose_cmd -f docker/docker-compose.yml exec -T db \
                    pg_dump -U postgres --format=plain 2>/dev/null \
                    > "${backup_dir}/db.sql"; then
                local dump_size
                dump_size=$(du -sh "${backup_dir}/db.sql" 2>/dev/null | cut -f1)
                log "Datenbank-Dump OK (${dump_size})"
            else
                warn "Datenbank-Dump fehlgeschlagen!"
                backup_ok=false
            fi
        else
            warn "DB-Container läuft nicht -- überspringe Dump."
        fi

        [ -f "docker/.env" ] && cp "docker/.env" "${backup_dir}/docker.env" && chmod 600 "${backup_dir}/docker.env"
    fi

    [ -f "$config_file" ] && cp "$config_file" "${backup_dir}/config.env" && chmod 600 "${backup_dir}/config.env"

    # Rotation
    local backup_count
    backup_count=$(find "$backup_base" -maxdepth 1 -mindepth 1 -type d -name "????-??-??_*" 2>/dev/null | wc -l)
    if [ "$backup_count" -gt "$backup_keep" ]; then
        local to_delete=$(( backup_count - backup_keep ))
        info "Bereinige $to_delete alte Backup(s)..."
        find "$backup_base" -maxdepth 1 -mindepth 1 -type d -name "????-??-??_*" | sort | head -n "$to_delete" | xargs rm -rf
    fi

    echo ""
    if $backup_ok; then
        log "Backup erfolgreich: $backup_dir"
    else
        warn "Backup mit Warnungen: $backup_dir"
    fi
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# DOCTOR (nur lesend)
# ═════════════════════════════════════════════════════════════════

do_doctor() {
    local config_file="${BASE_DIR_OVERRIDE:-/opt/ameise-production}/config.env"

    if [ ! -f "$config_file" ]; then
        err "Keine Konfiguration gefunden: $config_file"
        exit 1
    fi

    # shellcheck disable=SC1090
    source "$config_file"
    migrate_old_config_vars

    header "Doctor -- Diagnose"

    local compose_cmd
    compose_cmd=$(detect_compose)

    local app_dir
    app_dir=$(detect_app_dir "$BASE_DIR")
    local env_file="${app_dir}/docker/.env"
    local project="${INSTANCE_NAME:-ameise-production}"

    local all_ok=true

    if [ ! -f "$env_file" ]; then
        err "docker/.env nicht gefunden: $env_file"
        exit 1
    fi

    cd "$app_dir"

    local site_hostname api_port smtp_host smtp_port flow_state
    site_hostname=$(grep '^SITE_HOSTNAME=' "$env_file" | cut -d= -f2-)
    api_port=$(grep '^API_PORT=' "$env_file" | cut -d= -f2-)
    smtp_host=$(grep '^SMTP_HOST=' "$env_file" | cut -d= -f2-)
    smtp_port=$(grep '^SMTP_PORT=' "$env_file" | cut -d= -f2-)
    flow_state=$(grep '^FLOW_STATE_EXPIRY_DURATION=' "$env_file" | cut -d= -f2-)

    # Container-Check
    echo -e "  ${BOLD}Container:${NC}"
    local containers=("db" "auth" "kong" "rest" "storage" "meta" "studio" "app")
    for svc in "${containers[@]}"; do
        local cname="${project}-${svc}"
        local state health
        if docker inspect "$cname" >/dev/null 2>&1; then
            state=$(docker inspect --format '{{.State.Status}}' "$cname" 2>/dev/null)
            health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$cname" 2>/dev/null)
        else
            state="nicht gefunden"
            health=""
        fi

        if [ "$state" = "running" ]; then
            if [ "$health" = "unhealthy" ]; then
                echo -e "  ${YELLOW}!${NC} ${cname} läuft aber UNHEALTHY"
                all_ok=false
            else
                echo -e "  ${GREEN}✓${NC} ${cname} läuft${health:+ ($health)}"
            fi
        else
            echo -e "  ${RED}✗${NC} ${cname} NICHT laufend ($state)"
            echo -e "      → Fix: cd $app_dir && $compose_cmd -f docker/docker-compose.yml up -d"
            all_ok=false
        fi
    done
    echo ""

    # DB-Passwort
    if check_db_password_sync "$app_dir" "$compose_cmd" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} DB-Passwort synchron"
    else
        echo -e "  ${RED}✗${NC} DB-Passwort STIMMT NICHT ÜBEREIN"
        echo -e "      → Fix: bash scripts/server-setup.sh --repair"
        all_ok=false
    fi
    echo ""

    # .env Pflichtfelder
    echo -e "  ${BOLD}Konfiguration:${NC}"

    local site_url_val
    site_url_val=$(grep '^SITE_URL=' "$env_file" | cut -d= -f2-)
    [ -n "$site_url_val" ] && echo -e "  ${GREEN}✓${NC} SITE_URL = ${site_url_val}" || { echo -e "  ${RED}✗${NC} SITE_URL FEHLT"; all_ok=false; }
    [ -n "$site_hostname" ] && echo -e "  ${GREEN}✓${NC} SITE_HOSTNAME = ${site_hostname}" || { echo -e "  ${YELLOW}!${NC} SITE_HOSTNAME fehlt"; all_ok=false; }
    [ -n "$flow_state" ] && echo -e "  ${GREEN}✓${NC} FLOW_STATE_EXPIRY_DURATION = ${flow_state}" || { echo -e "  ${YELLOW}!${NC} FLOW_STATE_EXPIRY_DURATION fehlt"; all_ok=false; }

    local dt_pass_val
    dt_pass_val=$(grep '^DATA_TRANSFER_PASSWORD=' "$env_file" | cut -d= -f2-)
    [ -n "$dt_pass_val" ] && echo -e "  ${GREEN}✓${NC} DATA_TRANSFER_PASSWORD gesetzt" || { echo -e "  ${YELLOW}!${NC} DATA_TRANSFER_PASSWORD fehlt"; all_ok=false; }

    local docker_subnet_val
    docker_subnet_val=$(grep '^DOCKER_SUBNET=' "$env_file" | cut -d= -f2-)
    [ -n "$docker_subnet_val" ] && echo -e "  ${GREEN}✓${NC} DOCKER_SUBNET = ${docker_subnet_val}" || { echo -e "  ${YELLOW}!${NC} DOCKER_SUBNET fehlt"; all_ok=false; }
    echo ""

    # Nginx
    echo -e "  ${BOLD}Nginx:${NC}"
    if command -v nginx &>/dev/null; then
        if sudo nginx -t >/dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} Nginx Config gültig"
        else
            echo -e "  ${RED}✗${NC} Nginx Config FEHLERHAFT"
            all_ok=false
        fi
    else
        echo -e "  ${DIM}  Nginx nicht installiert${NC}"
    fi
    echo ""

    # DNS
    echo -e "  ${BOLD}DNS & Netzwerk:${NC}"
    if [ -n "$site_hostname" ]; then
        if getent hosts "$site_hostname" > /dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} DNS für ${site_hostname} OK"
        else
            echo -e "  ${YELLOW}!${NC} DNS für ${site_hostname} FEHLGESCHLAGEN"
            echo -e "      → Fix: echo \"127.0.0.1 ${site_hostname}\" | sudo tee -a /etc/hosts"
            all_ok=false
        fi
    fi

    # SMTP
    if [ -n "$smtp_host" ] && [ -n "$smtp_port" ]; then
        if command -v nc &>/dev/null && nc -z -w3 "$smtp_host" "$smtp_port" 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} SMTP ${smtp_host}:${smtp_port} erreichbar"
        elif command -v nc &>/dev/null; then
            echo -e "  ${YELLOW}!${NC} SMTP ${smtp_host}:${smtp_port} NICHT erreichbar"
            all_ok=false
        fi
    fi
    echo ""

    if [ "$all_ok" = true ]; then
        echo -e "  ${GREEN}${BOLD}Alle Checks bestanden. System ist healthy.${NC}"
    else
        echo -e "  ${YELLOW}${BOLD}Es gibt Warnungen oder Fehler.${NC}"
        echo -e "  → bash scripts/server-setup.sh --repair"
    fi
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# REPAIR
# ═════════════════════════════════════════════════════════════════

do_repair() {
    local config_file="${BASE_DIR_OVERRIDE:-/opt/ameise-production}/config.env"

    if [ ! -f "$config_file" ]; then
        err "Keine Konfiguration gefunden: $config_file"
        exit 1
    fi

    # shellcheck disable=SC1090
    source "$config_file"
    migrate_old_config_vars

    header "Repair -- Bekannte Probleme beheben"

    local compose_cmd
    compose_cmd=$(detect_compose)

    local app_dir
    app_dir=$(detect_app_dir "$BASE_DIR")
    local project="${INSTANCE_NAME:-ameise-production}"

    if [ ! -f "${app_dir}/docker/.env" ]; then
        err "docker/.env nicht gefunden in $app_dir"
        exit 1
    fi

    cd "$app_dir"

    echo -e "  ${BOLD}[1/5] .env-Variablen prüfen${NC}"
    apply_env_migrations "$app_dir"
    echo ""

    echo -e "  ${BOLD}[2/5] DB-Passwörter synchronisieren${NC}"
    if sync_db_passwords "$app_dir" "$compose_cmd"; then
        echo -e "        ${GREEN}✓${NC} DB-Passwörter synchronisiert"
    else
        echo -e "        ${YELLOW}!${NC} Sync nicht möglich (Stack läuft nicht?)"
    fi
    echo ""

    echo -e "  ${BOLD}[3/5] Auth-Container neu starten${NC}"
    if docker restart "${project}-auth" 2>/dev/null; then
        echo -e "        ${GREEN}✓${NC} Auth-Container neu gestartet"
    else
        echo -e "        ${YELLOW}!${NC} Auth-Container nicht gefunden"
    fi
    echo ""

    echo -e "  ${BOLD}[4/5] Auth-Health-Check${NC}"
    local auth_port
    auth_port=$(grep '^API_PORT=' "${app_dir}/docker/.env" | cut -d= -f2)
    auth_port="${auth_port:-8000}"
    local auth_ok=false retries=0
    echo -n "        Warte auf Auth-Service (max. 30s)..."
    while [ "$retries" -lt 30 ]; do
        if curl -sf "http://localhost:${auth_port}/auth/v1/health" > /dev/null 2>&1; then
            auth_ok=true; break
        fi
        sleep 1; retries=$((retries + 1)); echo -n "."
    done
    echo ""
    if [ "$auth_ok" = true ]; then
        echo -e "        ${GREEN}✓${NC} Auth-Service erreichbar"
    else
        echo -e "        ${YELLOW}!${NC} Auth-Service antwortet nicht"
        echo -e "        Logs: cd $app_dir && $compose_cmd -f docker/docker-compose.yml logs --tail=50 auth"
    fi
    echo ""

    echo -e "  ${BOLD}[5/5] Nginx-Konfiguration${NC}"
    if command -v nginx &>/dev/null; then
        local nginx_file="${BASE_DIR}/nginx-${INSTANCE_NAME:-ameise-production}.conf"
        generate_nginx_conf "$nginx_file"
        if install_nginx_conf "$nginx_file"; then
            echo -e "        ${GREEN}✓${NC} Nginx aktualisiert"
        else
            echo -e "        ${YELLOW}!${NC} Nginx konnte nicht aktualisiert werden"
        fi
    else
        echo -e "        ${DIM}(Nginx nicht installiert)${NC}"
    fi
    echo ""

    echo -e "  ${GREEN}${BOLD}Repair abgeschlossen.${NC}"
    echo -e "  Prüfe: bash scripts/server-setup.sh --doctor"
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# STATUS
# ═════════════════════════════════════════════════════════════════

do_status() {
    local config_file="${BASE_DIR_OVERRIDE:-/opt/ameise-production}/config.env"

    if [ ! -f "$config_file" ]; then
        err "Keine Konfiguration gefunden: $config_file"
        exit 1
    fi

    # shellcheck disable=SC1090
    source "$config_file"
    migrate_old_config_vars

    header "Masitcon Ameise (Zeiterfassung) - Status"

    local app_dir
    app_dir=$(detect_app_dir "$BASE_DIR")
    local project="${INSTANCE_NAME:-ameise-production}"

    printf "  %-22s %s\n" "Instanz:" "$INSTANCE_NAME"
    printf "  %-22s %s\n" "Verzeichnis:" "$app_dir"
    printf "  %-22s %s\n" "Protokoll:" "$PROTOCOL"
    echo ""

    echo -e "  ${BOLD}Container (${project}):${NC}"
    local services="app db kong rest auth storage meta studio"
    for svc in $services; do
        local container="${project}-${svc}"
        if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "${container}"; then
            log "${svc} läuft"
        else
            err "${svc} gestoppt"
        fi
    done

    if [ -d "$app_dir/.git" ]; then
        local branch last_commit
        branch=$(cd "$app_dir" && git branch --show-current 2>/dev/null || echo "?")
        last_commit=$(cd "$app_dir" && git log -1 --format='%h %s' 2>/dev/null || echo "?")
        info "Git: $branch ($last_commit)"
    fi

    echo ""
    printf "  %-20s %s\n" "App:" "${PROTOCOL}://${APP_HOSTNAME}"
    printf "  %-20s %s\n" "API (Kong):" "127.0.0.1:${API_PORT}"
    printf "  %-20s %s\n" "PostgreSQL:" "127.0.0.1:${DB_PORT}"
    printf "  %-20s %s\n" "Studio:" "127.0.0.1:${STUDIO_PORT} (SSH-Tunnel)"
    echo ""

    echo "  ${BOLD}Befehle:${NC}"
    echo "    bash scripts/server-setup.sh --update    Aktualisieren"
    echo "    bash scripts/server-setup.sh --doctor    Diagnose"
    echo "    bash scripts/server-setup.sh --backup    Backup erstellen"
    echo "    cd $app_dir && docker compose -f docker/docker-compose.yml logs -f"
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# UNINSTALL
# ═════════════════════════════════════════════════════════════════

do_clean() {
    local config_file="${BASE_DIR_OVERRIDE:-/opt/ameise-production}/config.env"

    if [ ! -f "$config_file" ]; then
        err "Keine Konfiguration gefunden: $config_file"
        exit 1
    fi

    # shellcheck disable=SC1090
    source "$config_file"
    migrate_old_config_vars

    header "Deinstallation"

    local compose_cmd
    compose_cmd=$(detect_compose)

    local app_dir
    app_dir=$(detect_app_dir "$BASE_DIR")
    local project="${INSTANCE_NAME:-ameise-production}"

    echo -e "  ${RED}${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "  ${RED}${BOLD}║   ACHTUNG: Deinstallation                            ║${NC}"
    echo -e "  ${RED}${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "  Instanz: ${project}"
    echo "  Verzeichnis: $app_dir"
    echo ""
    echo "  Folgendes wird entfernt:"
    echo "    - Docker Stack (alle Container + Volumes)"
    echo "    - App-Verzeichnis ($app_dir)"
    echo "    - Konfiguration ($config_file)"
    echo ""

    if ! confirm "Wirklich deinstallieren? ALLE DATEN GEHEN VERLOREN!" "n"; then
        info "Abgebrochen."
        exit 0
    fi

    echo ""
    echo -e "  ${RED}${BOLD}Zweite Bestätigung:${NC} Tippe '${project}' und drücke Enter:"
    local confirm_word
    read -rp "  > " confirm_word
    if [ "$confirm_word" != "$project" ]; then
        err "Eingabe stimmt nicht. Abgebrochen."
        exit 1
    fi

    if confirm "Vorher ein Backup erstellen?" "j"; then
        do_backup
    fi

    echo ""
    echo "  Stufe:"
    echo "    1) Nur Services stoppen (Daten bleiben)"
    echo "    2) Services + Daten löschen"
    echo "    3) Alles entfernen (inkl. Nginx-Config)"
    echo "    4) Abbrechen"
    echo ""
    local level
    read -rp "  Auswahl [1-4]: " level
    level="${level:-4}"

    case "$level" in
        1)
            if [ -d "$app_dir" ]; then
                cd "$app_dir"
                $compose_cmd -f docker/docker-compose.yml down --remove-orphans 2>/dev/null || true
            fi
            log "Services gestoppt. Daten bleiben erhalten."
            ;;
        2|3)
            if [ -d "$app_dir" ]; then
                cd "$app_dir"
                $compose_cmd -f docker/docker-compose.yml down --remove-orphans -v 2>/dev/null || true
            fi
            rm -rf "$app_dir"
            rm -f "$config_file"
            rm -f "${BASE_DIR}"/setup-log-*.txt

            if [ "$level" = "3" ]; then
                local nginx_name="${INSTANCE_NAME:-ameise-production}"
                sudo rm -f "/etc/nginx/sites-enabled/${nginx_name}.conf" 2>/dev/null || true
                sudo rm -f "/etc/nginx/sites-available/${nginx_name}.conf" 2>/dev/null || true
                rm -f "${BASE_DIR}/nginx-${nginx_name}.conf"
                command -v nginx &>/dev/null && sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx 2>/dev/null || true

                [ -d "$BASE_DIR" ] && [ -z "$(ls -A "$BASE_DIR" 2>/dev/null)" ] && rmdir "$BASE_DIR" 2>/dev/null || true
            fi

            log "Deinstallation abgeschlossen."
            ;;
        *)
            info "Abgebrochen."
            ;;
    esac
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# RECONFIGURE
# ═════════════════════════════════════════════════════════════════

do_reconfigure() {
    local config_file="${BASE_DIR_OVERRIDE:-/opt/ameise-production}/config.env"

    if [ ! -f "$config_file" ]; then
        err "Keine Konfiguration gefunden: $config_file"
        exit 1
    fi

    # shellcheck disable=SC1090
    source "$config_file"
    migrate_old_config_vars

    header "Konfiguration ändern"
    info "Bisherige Werte werden als Defaults angezeigt."
    echo ""

    collect_config
    show_summary

    if ! confirm "Konfiguration mit diesen Einstellungen speichern?" "j"; then
        info "Abgebrochen."
        exit 0
    fi

    save_config "$config_file"

    local app_dir
    app_dir=$(detect_app_dir "$BASE_DIR")
    generate_docker_env "${app_dir}/docker/.env"

    local nginx_file="${BASE_DIR}/nginx-${INSTANCE_NAME:-ameise-production}.conf"
    generate_nginx_conf "$nginx_file"

    echo ""
    info "docker/.env wurde aktualisiert."
    info "Nginx-Config: $nginx_file"
    info "Zum Anwenden: bash scripts/server-setup.sh --update"
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# FIREWALL
# ═════════════════════════════════════════════════════════════════

do_harden() {
    header "Firewall-Härtung (ufw)"

    if ! command -v ufw >/dev/null 2>&1; then
        err "ufw nicht installiert. Installation: sudo apt install -y ufw"
        return 1
    fi

    # Config laden falls nötig (für PROTOCOL)
    if [ -z "${PROTOCOL:-}" ]; then
        local config_file="${BASE_DIR_OVERRIDE:-/opt/ameise-production}/config.env"
        [ -f "$config_file" ] && source "$config_file" && migrate_old_config_vars
    fi

    local ufw_status
    ufw_status=$(sudo ufw status 2>/dev/null || true)
    if echo "$ufw_status" | grep -q "Status: active"; then
        info "ufw ist bereits aktiv:"
        sudo ufw status numbered 2>/dev/null | sed 's/^/    /'
        echo ""
        if ! confirm "Firewall-Regeln neu konfigurieren?" "n"; then
            return 0
        fi
    fi

    echo ""
    echo "  Folgende Ports werden geöffnet:"
    echo "    SSH (22):   IMMER OFFEN"
    echo "    HTTP (80):  Offen (Nginx)"
    [ "${PROTOCOL:-}" = "https" ] && echo "    HTTPS (443): Offen (SSL)"
    echo ""
    echo "  Alle anderen Ports: GESPERRT"
    echo ""

    if ! confirm "Firewall aktivieren?" "n"; then
        return 0
    fi

    sudo ufw --force reset >/dev/null 2>&1
    sudo ufw default deny incoming >/dev/null 2>&1
    sudo ufw default allow outgoing >/dev/null 2>&1
    sudo ufw allow 22/tcp comment "SSH" >/dev/null 2>&1
    sudo ufw allow 80/tcp comment "HTTP" >/dev/null 2>&1
    [ "${PROTOCOL:-}" = "https" ] && sudo ufw allow 443/tcp comment "HTTPS" >/dev/null 2>&1
    sudo ufw --force enable >/dev/null 2>&1

    if sudo ufw status | grep -q "Status: active"; then
        log "Firewall aktiviert!"
        sudo ufw status verbose 2>/dev/null | sed 's/^/    /'
    else
        err "Firewall konnte nicht aktiviert werden!"
    fi
    echo ""
}

do_unharden() {
    header "Firewall deaktivieren"

    if ! command -v ufw >/dev/null 2>&1; then
        err "ufw nicht installiert."
        return 1
    fi

    if ! sudo ufw status 2>/dev/null | grep -q "Status: active"; then
        info "Firewall ist bereits deaktiviert."
        return 0
    fi

    warn "ALLE Ports werden wieder offen sein!"
    if ! confirm "Firewall deaktivieren?" "n"; then
        return 0
    fi

    sudo ufw --force disable >/dev/null 2>&1
    log "Firewall deaktiviert."
    echo ""
}

# ═════════════════════════════════════════════════════════════════
# HAUPTPROGRAMM
# ═════════════════════════════════════════════════════════════════

main() {
    echo ""
    echo -e "${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║   Masitcon Ameise (Zeiterfassung) - Server Setup     ║${NC}"
    echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""

    case "$MODE" in
        status)      do_status ;;
        backup)      do_backup ;;
        clean)       do_clean ;;
        update)      do_update ;;
        harden)      do_harden ;;
        unharden)    do_unharden ;;
        doctor)      do_doctor ;;
        repair)      do_repair ;;
        reconfigure) do_reconfigure ;;

        setup)
            # Prüfe ob bereits installiert
            local existing_config="${BASE_DIR_OVERRIDE:-}/config.env"
            if [ -n "$BASE_DIR_OVERRIDE" ] && [ -f "$existing_config" ]; then
                warn "Es existiert bereits eine Installation!"
                echo "  Konfiguration: $existing_config"
                echo ""
                echo "  Optionen:"
                echo "    --update       Aktualisieren"
                echo "    --reconfigure  Konfiguration ändern"
                echo "    --uninstall    Deinstallieren"
                echo ""
                if ! confirm "Trotzdem ein neues Setup starten?" "n"; then
                    exit 0
                fi
            fi

            check_prerequisites
            collect_config
            show_summary

            if ! confirm "Installation mit diesen Einstellungen starten?" "j"; then
                info "Abgebrochen."
                exit 0
            fi

            # Setup-Log starten
            setup_log_init "$BASE_DIR"
            slog "Setup gestartet"
            slog_var "Instanz" "$INSTANCE_NAME"
            slog_var "Verzeichnis" "$BASE_DIR"
            slog_var "Hostname" "$APP_HOSTNAME"
            slog_var "Protokoll" "$PROTOCOL"
            slog_var "Git Remote" "$GIT_REMOTE"

            echo ""
            if do_install; then
                echo ""
                echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
                echo -e "${GREEN}${BOLD}║   Installation erfolgreich abgeschlossen!            ║${NC}"
                echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"
                echo ""
                echo "  App:     ${PROTOCOL}://${APP_HOSTNAME}"
                echo "  Studio:  ssh -L ${STUDIO_PORT}:127.0.0.1:${STUDIO_PORT} $(whoami)@$(hostname)"
                echo ""

                # Nginx-Hinweise
                if ! command -v nginx >/dev/null 2>&1; then
                    echo -e "  ${BOLD}Nächste Schritte:${NC}"
                    echo ""
                    echo "  1. Nginx installieren:"
                    echo "     sudo apt install nginx"
                    echo ""
                    echo "  2. Nginx-Config aktivieren:"
                    echo "     sudo cp ${BASE_DIR}/nginx-${INSTANCE_NAME}.conf /etc/nginx/sites-available/"
                    echo "     sudo ln -sf /etc/nginx/sites-available/nginx-${INSTANCE_NAME}.conf /etc/nginx/sites-enabled/"
                    echo "     sudo nginx -t && sudo systemctl reload nginx"
                    echo ""
                fi

                if [ "$PROTOCOL" = "https" ]; then
                    echo "  SSL-Zertifikat einrichten:"
                    echo "     sudo apt install certbot python3-certbot-nginx"
                    echo "     sudo certbot --nginx -d ${APP_HOSTNAME}"
                    echo ""
                fi

                local server_ip
                server_ip=$(hostname -I 2>/dev/null | awk '{print $1}')

                echo -e "  ${BOLD}DNS konfigurieren:${NC}"
                if [ -n "$server_ip" ]; then
                    echo "     Beim Domain-Anbieter einen A-Record anlegen:"
                    echo "       ${APP_HOSTNAME}  →  ${server_ip}"
                else
                    echo "     Beim Domain-Anbieter einen A-Record anlegen:"
                    echo "       ${APP_HOSTNAME}  →  <Server-IP>"
                fi
                echo ""
                echo "     Zusätzlich auf dem Server selbst (für interne Auflösung):"
                echo "       echo \"127.0.0.1 ${APP_HOSTNAME}\" | sudo tee -a /etc/hosts"
                echo ""

                echo "  Admin-User anlegen:"
                echo "     Unter /login mit einem Admin-Account einloggen,"
                echo "     dann unter Admin → Mitarbeiter einen neuen Benutzer anlegen."
                echo ""

                echo -e "  ${BOLD}Befehle:${NC}"
                echo "    bash scripts/server-setup.sh --status     Status anzeigen"
                echo "    bash scripts/server-setup.sh --update     Aktualisieren"
                echo "    bash scripts/server-setup.sh --doctor     Diagnose"
                echo ""

                # Firewall anbieten
                if command -v ufw >/dev/null 2>&1; then
                    if confirm "Firewall jetzt härten? (empfohlen)" "n"; then
                        do_harden
                    fi
                fi
            else
                echo ""
                echo -e "${YELLOW}${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
                echo -e "${YELLOW}${BOLD}║   Installation mit Fehlern beendet                   ║${NC}"
                echo -e "${YELLOW}${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"
                echo ""
                echo "  Nach Behebung der Fehler:"
                echo "    bash scripts/server-setup.sh --repair"
                echo ""
            fi

            slog "Setup beendet"
            slog_finish

            if [ -n "$SETUP_LOG" ] && [ -f "$SETUP_LOG" ]; then
                echo -e "  ${DIM}Setup-Protokoll: $SETUP_LOG${NC}"
                echo ""
            fi
            ;;
    esac
}

main
