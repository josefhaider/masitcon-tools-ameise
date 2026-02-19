#!/usr/bin/env bash
# ===================================================================
# masitcon Zeiterfassung (Ameise) - Server Initialisierung
# ===================================================================
#
# Generiert für: masitcon-tools-ameise
# Tech-Stack:    Vite, React, TypeScript, Supabase, Tailwind, shadcn/ui
# Erkannte Tools: Docker, Node.js, Supabase CLI (optional)
# Node-Version:  20
# Proxy:         ask
# Datum:         2025-02-19
#
# WIE BOOTSTRAPPEN (frischer Server, noch kein Repo):
#
# Option A – direkt via curl (Script muss öffentlich erreichbar sein):
#   curl -fsSL https://raw.githubusercontent.com/josefhaider/masitcon-tools-ameise/master/scripts/server-init.sh | bash
#
# Option B – Script per scp auf den Server laden:
#   scp scripts/server-init.sh user@server:~/
#   ssh user@server "bash ~/server-init.sh"
#
# Das Script klont danach automatisch das Repo und zeigt
# den Befehl für den nächsten Schritt an:
#   bash /opt/projects/masitcon-tools-ameise/repo/scripts/deploy.sh
#
# Idempotent: Zuerst Bestandsaufnahme – nur fehlende Komponenten werden installiert.
# Kann auch zur Überprüfung/Aktualisierung erneut ausgeführt werden.
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

log()    { echo -e "  ${GREEN}✓${NC} $1"; }
skip()   { echo -e "  ${DIM}–${NC} $1 ${DIM}(bereits installiert)${NC}"; }
warn()   { echo -e "  ${YELLOW}!${NC} $1"; }
err()    { echo -e "  ${RED}✗${NC} $1"; }
info()   { echo -e "  ${CYAN}ℹ${NC} $1"; }
header() { echo -e "\n${BOLD}══ $1 ══${NC}\n"; }

trap 'echo -e "\n\n${RED}Abgebrochen.${NC}"; exit 130' INT TERM

# ─── Hilfsfunktionen ─────────────────────────────────────────────

confirm() {
    local prompt="$1" default="${2:-j}" yn
    if [ "$default" = "j" ]; then
        read -rp "  $prompt [J/n]: " yn; yn="${yn:-j}"
    else
        read -rp "  $prompt [j/N]: " yn; yn="${yn:-n}"
    fi
    [[ "$yn" =~ ^[jJyY]$ ]]
}

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

has() { command -v "$1" >/dev/null 2>&1; }
service_active() { systemctl is-active --quiet "$1" 2>/dev/null; }

# Prüft ob ein Paket installiert ist (dpkg)
pkg_installed() { dpkg -l "$1" 2>/dev/null | grep -q "^ii"; }

version_of() {
    case "$1" in
        docker)       docker --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -1 ;;
        node)         node --version 2>/dev/null | tr -d 'v' ;;
        npm)          npm --version 2>/dev/null ;;
        git)          git --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' ;;
        nginx)        nginx -v 2>&1 | grep -oP '\d+\.\d+\.\d+' ;;
        caddy)        caddy version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -1 ;;
        certbot)      certbot --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' ;;
        ufw)          ufw version 2>/dev/null | grep -oP '\d+\.\d+' | head -1 ;;
        fail2ban)     fail2ban-client --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -1 ;;
        supabase)     supabase --version 2>/dev/null ;;
        *)            echo "?" ;;
    esac
}

# ─── Projekt-Konstanten ──────────────────────────────────────────
PROJECT_NAME="masitcon-tools-ameise"
PROJECT_DISPLAY="masitcon Zeiterfassung (Ameise)"
NODE_VERSION="20"
PROXY_PREFERENCE="ask"
HAS_SUPABASE="true"
NEEDS_CERTBOT="true"
GIT_REMOTE="git@github.com:josefhaider/masitcon-tools-ameise.git"
GIT_BRANCH="master"

# ─── Protokoll ───────────────────────────────────────────────────
INIT_LOG="/var/log/${PROJECT_NAME}-server-init.log"
ilog() {
    echo "[$(date '+%H:%M:%S')] $1" | sudo tee -a "$INIT_LOG" > /dev/null 2>&1 || true
}

# ─── Betriebssystem prüfen ───────────────────────────────────────
check_os() {
    header "Betriebssystem"

    local os_id os_version
    os_id=$(. /etc/os-release 2>/dev/null && echo "$ID" || echo "unknown")
    os_version=$(. /etc/os-release 2>/dev/null && echo "$VERSION_ID" || echo "?")

    case "$os_id" in
        ubuntu)
            log "Ubuntu ${os_version}"
            if [[ "${os_version}" < "22" ]]; then
                warn "Ubuntu 22.04+ empfohlen (aktuell: ${os_version})"
                confirm "Trotzdem fortfahren?" "n" || exit 1
            fi
            ;;
        debian)
            log "Debian ${os_version}"
            ;;
        *)
            warn "Unbekanntes OS: ${os_id} ${os_version}"
            warn "Dieses Script ist für Ubuntu/Debian optimiert"
            confirm "Trotzdem fortfahren?" "n" || exit 1
            ;;
    esac

    if [ "$EUID" -eq 0 ]; then
        warn "Läuft als root – empfohlen: als normaler User mit sudo ausführen"
        confirm "Als root fortfahren?" "n" || exit 1
    elif ! sudo -n true 2>/dev/null; then
        err "Kein sudo-Zugriff. Bitte zu sudoers hinzufügen."
        exit 1
    else
        log "Sudo-Zugriff verfügbar"
    fi

    ilog "OS: ${os_id} ${os_version}"
}

# ─── Bestandsaufnahme (immer zuerst) ──────────────────────────────
# Zeigt was bereits installiert ist, bevor irgendetwas installiert wird
run_inventory() {
    header "Bestandsaufnahme – bereits installiert"

    local items=(
        "curl:$(has curl && echo "✓ $(version_of curl)" || echo "– fehlt")"
        "wget:$(has wget && echo "✓" || echo "– fehlt")"
        "git:$(has git && echo "✓ $(version_of git)" || echo "– fehlt")"
        "jq:$(has jq && echo "✓" || echo "– fehlt")"
        "lsof:$(has lsof && echo "✓" || echo "– fehlt")"
        "docker:$(has docker && echo "✓ $(version_of docker)" || echo "– fehlt")"
        "docker-compose:$(docker compose version >/dev/null 2>&1 && echo "✓" || echo "– fehlt")"
        "node:$(has node && echo "✓ $(version_of node)" || echo "– fehlt")"
        "ufw:$(has ufw && echo "✓" || echo "– fehlt")"
        "fail2ban:$(has fail2ban-client && echo "✓" || echo "– fehlt")"
        "nginx:$(has nginx && echo "✓ $(version_of nginx)" || echo "– fehlt")"
        "caddy:$(has caddy && echo "✓ $(version_of caddy)" || echo "– fehlt")"
        "certbot:$(has certbot && echo "✓" || echo "– fehlt")"
        "unattended-upgrades:$(has unattended-upgrade && echo "✓" || echo "– fehlt")"
        "swap:$(swapon --show 2>/dev/null | grep -q '/' && echo "✓ aktiv" || echo "– nicht aktiv")"
    )

    for entry in "${items[@]}"; do
        local name="${entry%%:*}"
        local status="${entry#*:}"
        printf "  %-22s %s\n" "$name" "$status"
    done

    if [ -d "/opt/projects/${PROJECT_NAME}/repo/.git" ]; then
        log "Repo bereits geklont: /opt/projects/${PROJECT_NAME}/repo"
    else
        info "Repo noch nicht geklont"
    fi

    echo ""
    ilog "Bestandsaufnahme: abgeschlossen"
}

# ─── System-Updates ──────────────────────────────────────────────
install_system_updates() {
    header "System aktualisieren"

    # Zuerst prüfen ob Updates verfügbar sind (ohne zu installieren)
    info "Prüfe verfügbare Updates..."
    sudo apt-get update -qq 2>/dev/null
    local upgradable; upgradable=$(apt list --upgradable 2>/dev/null | grep -c -v "Listing" || echo "0")

    if [ "${upgradable:-0}" -eq 0 ]; then
        skip "Keine Updates verfügbar – System ist aktuell"
        ilog "System-Updates: bereits aktuell"
        return 0
    fi

    info "Es sind ${upgradable} Paket(e) aktualisierbar."
    if confirm "Sicherheitsupdates jetzt installieren?" "j"; then
        sudo apt-get upgrade -y -q
        log "System aktualisiert"
    else
        skip "System-Updates übersprungen"
    fi

    ilog "System-Updates: erledigt"
}

# ─── Basis-Tools ─────────────────────────────────────────────────
install_base_tools() {
    header "Basis-Tools"

    local tools=(
        "curl:curl"
        "wget:wget"
        "git:git"
        "unzip:unzip"
        "htop:htop"
        "jq:jq"
        "bc:bc"
        "net-tools:net-tools"
        "lsof:lsof"
    )

    local to_install=()
    for entry in "${tools[@]}"; do
        local cmd="${entry%%:*}"
        local pkg="${entry##*:}"
        if has "$cmd"; then
            skip "$cmd $(version_of "$cmd")"
        else
            to_install+=("$pkg")
        fi
    done

    if [ ${#to_install[@]} -eq 0 ]; then
        log "Alle Basis-Tools bereits vorhanden – keine Installation nötig"
        ilog "Basis-Tools: bereits vollständig"
        return 0
    fi

    info "Fehlende Tools: ${to_install[*]}"
    info "Installiere nur diese Pakete..."
    sudo apt-get update -qq
    sudo apt-get install -y -q "${to_install[@]}"
    log "Basis-Tools installiert: ${to_install[*]}"
    ilog "Basis-Tools: installiert ${to_install[*]}"
}

# ─── Automatische Sicherheitsupdates ─────────────────────────────
install_auto_updates() {
    header "Automatische Sicherheitsupdates"

    if has unattended-upgrade || pkg_installed unattended-upgrades; then
        skip "unattended-upgrades bereits installiert und konfiguriert"
        ilog "unattended-upgrades: bereits vorhanden"
        return 0
    fi

    info "Installiere unattended-upgrades..."
    sudo apt-get update -qq
    sudo apt-get install -y -q unattended-upgrades
    sudo dpkg-reconfigure --priority=low unattended-upgrades
    log "Automatische Sicherheitsupdates aktiviert"
    ilog "unattended-upgrades: installiert"
}

# ─── Swap ────────────────────────────────────────────────────────
setup_swap() {
    header "Swap"

    if swapon --show | grep -q '/'; then
        local current_swap; current_swap=$(swapon --show --bytes | grep -v NAME | awk '{sum+=$3} END {printf "%.0f", sum/1073741824}')
        skip "Swap bereits aktiv (${current_swap} GB)"
        return 0
    fi

    local ram_gb; ram_gb=$(free -g | awk '/^Mem:/{print $2}')
    local suggested_swap=$((ram_gb < 4 ? 4 : ram_gb))

    info "RAM: ${ram_gb} GB – empfohlener Swap: ${suggested_swap} GB"

    if confirm "Swap-Datei anlegen (${suggested_swap} GB)?" "j"; then
        local swap_size; swap_size=$(ask "Swap-Größe in GB" "$suggested_swap")
        sudo fallocate -l "${swap_size}G" /swapfile
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
        sudo swapon /swapfile
        grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
        grep -q 'vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf > /dev/null
        sudo sysctl -p > /dev/null
        log "Swap: ${swap_size} GB angelegt und aktiviert"
        ilog "Swap: ${swap_size}G"
    else
        skip "Swap übersprungen"
    fi
}

# ─── SSH absichern ───────────────────────────────────────────────
SSH_PORT="22"

harden_ssh() {
    header "SSH absichern"

    local sshd_config="/etc/ssh/sshd_config"
    local changed=false

    if grep -qE "^PermitRootLogin yes" "$sshd_config" 2>/dev/null; then
        warn "Root-Login ist erlaubt"
        if confirm "Root-Login deaktivieren?" "j"; then
            sudo sed -i 's/^PermitRootLogin yes/PermitRootLogin no/' "$sshd_config"
            changed=true
            log "Root-Login deaktiviert"
        fi
    else
        skip "Root-Login bereits deaktiviert"
    fi

    if grep -qE "^PasswordAuthentication yes" "$sshd_config" 2>/dev/null; then
        warn "Passwort-Authentifizierung ist aktiv"
        info "ACHTUNG: Nur deaktivieren wenn SSH-Key bereits hinterlegt!"
        if confirm "Passwort-Auth deaktivieren (nur Keys)?" "n"; then
            sudo sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' "$sshd_config"
            changed=true
            log "Passwort-Auth deaktiviert"
        fi
    else
        skip "Passwort-Auth bereits deaktiviert oder nicht konfiguriert"
    fi

    local current_port; current_port=$(grep -E "^Port " "$sshd_config" 2>/dev/null | awk '{print $2}' || echo "22")
    SSH_PORT="${current_port}"
    info "Aktueller SSH-Port: ${current_port}"

    if $changed; then
        sudo systemctl restart sshd
        log "SSH-Konfiguration aktualisiert und neugestartet"
        ilog "SSH: gehärtet, Port ${SSH_PORT}"
    else
        log "SSH-Konfiguration unverändert"
    fi
}

# ─── Firewall (UFW) ──────────────────────────────────────────────
setup_firewall() {
    header "Firewall (UFW)"

    if ! has ufw && ! pkg_installed ufw; then
        info "UFW nicht installiert – installiere..."
        sudo apt-get update -qq
        sudo apt-get install -y -q ufw
        log "UFW installiert"
    elif has ufw; then
        skip "UFW bereits installiert"
    fi

    local ufw_status; ufw_status=$(sudo ufw status 2>/dev/null | head -1)

    if echo "$ufw_status" | grep -q "Status: active"; then
        skip "UFW bereits aktiv"
        info "Aktuelle Regeln:"
        sudo ufw status numbered 2>/dev/null | head -20 || true

        if confirm "Regeln für dieses Projekt ergänzen?" "j"; then
            _add_ufw_rules
        fi
        return 0
    fi

    info "UFW ist nicht aktiv – wird eingerichtet"
    if confirm "Firewall jetzt konfigurieren und aktivieren?" "j"; then
        sudo ufw --force reset > /dev/null
        _add_ufw_rules
        sudo ufw --force enable
        log "Firewall aktiviert"
        sudo ufw status numbered
        ilog "UFW: aktiviert, SSH-Port ${SSH_PORT}"
    else
        warn "Firewall nicht aktiviert – Server ungeschützt!"
    fi
}

_add_ufw_rules() {
    sudo ufw allow "${SSH_PORT}/tcp" comment "SSH" > /dev/null
    log "SSH (Port ${SSH_PORT}) erlaubt"

    sudo ufw allow 80/tcp  comment "HTTP"  > /dev/null
    sudo ufw allow 443/tcp comment "HTTPS" > /dev/null
    log "HTTP (80) + HTTPS (443) erlaubt"

    if [ "${HAS_SUPABASE:-false}" = "true" ]; then
        info "Supabase-Ports sind intern – kein öffentlicher Zugriff"
        sudo ufw deny 5432/tcp comment "PostgreSQL – nur intern" > /dev/null
        sudo ufw deny 8000/tcp comment "Supabase API – via Proxy" > /dev/null
        sudo ufw deny 3001/tcp comment "Supabase Studio – via Proxy" > /dev/null
        sudo ufw deny 54321/tcp comment "Supabase intern" > /dev/null
        log "Supabase-Ports nach außen gesperrt"
    fi
}

# ─── fail2ban ────────────────────────────────────────────────────
install_fail2ban() {
    header "fail2ban (Brute-Force-Schutz)"

    if has fail2ban-client && service_active fail2ban; then
        skip "fail2ban $(version_of fail2ban) läuft bereits"
        ilog "fail2ban: bereits installiert"
        return 0
    fi

    if pkg_installed fail2ban && ! service_active fail2ban; then
        info "fail2ban installiert aber nicht aktiv – starte Service..."
        sudo systemctl enable fail2ban
        sudo systemctl start fail2ban
        log "fail2ban gestartet"
        return 0
    fi

    info "Installiere fail2ban..."
    sudo apt-get update -qq
    sudo apt-get install -y -q fail2ban

    sudo tee /etc/fail2ban/jail.local > /dev/null << FAIL2BAN
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled  = true
port     = ${SSH_PORT}
maxretry = 3
bantime  = 86400

[nginx-http-auth]
enabled  = true

[nginx-limit-req]
enabled  = true
FAIL2BAN

    sudo systemctl enable fail2ban
    sudo systemctl restart fail2ban
    log "fail2ban installiert und konfiguriert"
    ilog "fail2ban: installiert"
}

# ─── Docker ──────────────────────────────────────────────────────
install_docker() {
    header "Docker"

    if has docker; then
        skip "Docker $(version_of docker) bereits installiert"

        if docker compose version >/dev/null 2>&1; then
            skip "Docker Compose Plugin verfügbar"
        else
            warn "Docker Compose Plugin fehlt – installiere nur Plugin..."
            sudo apt-get update -qq
            sudo apt-get install -y -q docker-compose-plugin
            log "Docker Compose Plugin installiert"
        fi

        if ! groups "$(whoami)" | grep -q docker; then
            sudo usermod -aG docker "$(whoami)"
            warn "User zur docker-Gruppe hinzugefügt – bitte neu einloggen oder: newgrp docker"
        else
            skip "User bereits in docker-Gruppe"
        fi
        ilog "Docker: bereits installiert"
        return 0
    fi

    info "Docker nicht gefunden – installiere via offizielles Install-Script..."
    curl -fsSL https://get.docker.com | sudo sh

    sudo usermod -aG docker "$(whoami)"
    sudo systemctl enable docker
    sudo systemctl start docker

    if [ ! -f /etc/docker/daemon.json ]; then
        sudo tee /etc/docker/daemon.json > /dev/null << DOCKERDAEMON
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true
}
DOCKERDAEMON
        sudo systemctl restart docker
    fi

    log "Docker $(version_of docker) installiert"
    warn "Neu einloggen erforderlich damit docker ohne sudo funktioniert"
    warn "Oder temporär: newgrp docker"
    ilog "Docker: installiert"
}

# ─── Node.js ─────────────────────────────────────────────────────
install_node() {
    header "Node.js"

    local required_version="${NODE_VERSION:-20}"

    if has node; then
        local current; current=$(version_of node)
        local current_major; current_major=$(echo "$current" | cut -d. -f1)

        if [ "${current_major:-0}" -ge "$required_version" ] 2>/dev/null; then
            skip "Node.js ${current} (>= ${required_version} erforderlich)"
            ilog "Node.js: bereits ${current}"
            return 0
        else
            warn "Node.js ${current} zu alt – benötigt: ${required_version}+"
            info "Upgrade via nvm..."
        fi
    fi

    if ! has nvm && [ ! -f "$HOME/.nvm/nvm.sh" ]; then
        info "nvm nicht gefunden – installiere nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        # shellcheck source=/dev/null
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        log "nvm installiert"
    else
        export NVM_DIR="$HOME/.nvm"
        # shellcheck source=/dev/null
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        skip "nvm bereits vorhanden"
    fi

    if nvm which "${required_version}" >/dev/null 2>&1; then
        skip "Node.js ${required_version} bereits via nvm installiert"
        nvm use "${required_version}"
        ilog "Node.js: bereits ${required_version}"
        return 0
    fi

    info "Installiere Node.js ${required_version} LTS..."
    nvm install "${required_version}"
    nvm alias default "${required_version}"
    nvm use "${required_version}"

    log "Node.js $(version_of node) installiert"
    log "npm $(version_of npm)"
    ilog "Node.js: ${required_version}"
}

# ─── Git konfigurieren ───────────────────────────────────────────
setup_git() {
    header "Git"

    if ! has git; then
        info "Git nicht gefunden – installiere..."
        sudo apt-get update -qq
        sudo apt-get install -y -q git
        log "Git installiert"
    else
        skip "Git $(version_of git) bereits installiert"
    fi

    local key_file="$HOME/.ssh/id_ed25519_deploy"
    if [ -f "$key_file" ]; then
        skip "Deploy-Key bereits vorhanden: $key_file"
    else
        if confirm "Deploy-Key für GitHub generieren (read-only Repo-Zugriff)?" "j"; then
            local email; email=$(ask "E-Mail für den Key" "deploy@$(hostname -f 2>/dev/null || hostname)")
            ssh-keygen -t ed25519 -C "$email" -f "$key_file" -N ""
            log "Deploy-Key generiert: $key_file"
            echo ""
            echo -e "  ${BOLD}Public Key (in GitHub → Repo → Settings → Deploy Keys eintragen):${NC}"
            echo ""
            cat "${key_file}.pub" | sed 's/^/    /'
            echo ""
            warn "Key in GitHub hinterlegen bevor deploy.sh ausgeführt wird!"
            confirm "Key wurde hinterlegt?" "n" || warn "Denk daran den Key zu hinterlegen!"

            if ! grep -q "Host github.com" "$HOME/.ssh/config" 2>/dev/null; then
                cat >> "$HOME/.ssh/config" << SSHCONF

Host github.com
    HostName github.com
    User git
    IdentityFile ${key_file}
    IdentitiesOnly yes
SSHCONF
                chmod 600 "$HOME/.ssh/config"
                log "SSH-Config für GitHub ergänzt"
            fi
        fi
    fi

    ilog "Git: konfiguriert"
}

# ─── Repository klonen ───────────────────────────────────────────
REPO_DIR="/opt/projects/${PROJECT_NAME}/repo"

clone_repo() {
    header "Repository klonen"

    if [ -z "${GIT_REMOTE}" ] || [ "${GIT_REMOTE}" = "%%GIT_REMOTE%%" ]; then
        GIT_REMOTE=$(ask "GitHub Repository URL (SSH)" "git@github.com:josefhaider/masitcon-tools-ameise.git")
    fi
    if [ -z "${GIT_BRANCH}" ] || [ "${GIT_BRANCH}" = "%%GIT_BRANCH%%" ]; then
        GIT_BRANCH=$(ask "Branch" "master")
    fi
    REPO_DIR=$(ask "Ziel-Verzeichnis für das Repo" "${REPO_DIR}")

    if [ -d "${REPO_DIR}/.git" ]; then
        skip "Repo bereits vorhanden: ${REPO_DIR}"
        info "Aktualisiere auf neuesten Stand..."
        git -C "${REPO_DIR}" fetch origin
        git -C "${REPO_DIR}" checkout "${GIT_BRANCH}"
        git -C "${REPO_DIR}" pull origin "${GIT_BRANCH}"
        log "Repo aktualisiert ($(git -C ${REPO_DIR} rev-parse --short HEAD))"
        ilog "Repo: aktualisiert"
        return 0
    fi

    info "Teste SSH-Verbindung zu GitHub..."
    if ssh -T git@github.com -o StrictHostKeyChecking=no -o ConnectTimeout=5 2>&1 | grep -q "successfully authenticated"; then
        log "SSH-Verbindung zu GitHub OK"
    else
        warn "SSH-Verbindung zu GitHub fehlgeschlagen"
        warn "Deploy-Key in GitHub hinterlegt? (Repo → Settings → Deploy Keys)"
        echo ""
        if ! confirm "Trotzdem klonen versuchen?" "n"; then
            info "Abgebrochen. Manuell klonen mit:"
            echo "    git clone ${GIT_REMOTE} ${REPO_DIR}"
            return 1
        fi
    fi

    info "Klone ${GIT_REMOTE} nach ${REPO_DIR}..."
    mkdir -p "$(dirname "${REPO_DIR}")"
    if git clone --branch "${GIT_BRANCH}" "${GIT_REMOTE}" "${REPO_DIR}"; then
        local commit; commit=$(git -C "${REPO_DIR}" rev-parse --short HEAD)
        log "Repo geklont: ${REPO_DIR} (${commit})"
        ilog "Repo: geklont ${GIT_REMOTE} -> ${REPO_DIR}"
        echo ""
        echo -e "  ${BOLD}deploy.sh ist jetzt verfügbar:${NC}"
        echo "    bash ${REPO_DIR}/scripts/deploy.sh"
    else
        err "Klonen fehlgeschlagen!"
        info "Häufige Ursachen:"
        echo "    - Deploy-Key nicht in GitHub hinterlegt"
        echo "    - Falscher Repository-Pfad"
        echo "    - Keine Internetverbindung"
        return 1
    fi
}

# ─── Reverse Proxy ───────────────────────────────────────────────
install_proxy() {
    header "Reverse Proxy"

    local pref="${PROXY_PREFERENCE:-ask}"

    # Zuerst prüfen was bereits läuft
    if has nginx && service_active nginx; then
        skip "Nginx $(version_of nginx) läuft bereits"
        [ "$pref" = "caddy" ] && warn "Caddy bevorzugt – aber Nginx läuft bereits"
        ilog "Proxy: Nginx bereits aktiv"
        return 0
    fi
    if has caddy && service_active caddy; then
        skip "Caddy $(version_of caddy) läuft bereits"
        [ "$pref" = "nginx" ] && warn "Nginx bevorzugt – aber Caddy läuft bereits"
        ilog "Proxy: Caddy bereits aktiv"
        return 0
    fi

    # Prüfen ob installiert aber nicht gestartet
    if pkg_installed nginx; then
        info "Nginx installiert aber nicht aktiv – starte Service..."
        sudo systemctl enable nginx
        sudo systemctl start nginx
        log "Nginx gestartet"
        ilog "Proxy: Nginx gestartet"
        return 0
    fi
    if pkg_installed caddy; then
        info "Caddy installiert aber nicht aktiv – starte Service..."
        sudo systemctl enable caddy
        sudo systemctl start caddy
        log "Caddy gestartet"
        ilog "Proxy: Caddy gestartet"
        return 0
    fi

    local choice="$pref"
    if [ "$pref" = "ask" ]; then
        echo ""
        echo "    1) Nginx  + Certbot  (weit verbreitet, manuelles SSL)"
        echo "    2) Caddy             (automatisches SSL via Let's Encrypt)"
        echo ""
        local c; read -rp "  Auswahl [1/2]: " c
        [ "$c" = "2" ] && choice="caddy" || choice="nginx"
    fi

    case "$choice" in
        caddy)
            info "Installiere Caddy (noch nicht vorhanden)..."
            sudo apt-get update -qq
            sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
                | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
                | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
            sudo apt-get update -qq
            sudo apt-get install -y caddy
            sudo systemctl enable caddy
            sudo systemctl start caddy
            log "Caddy $(version_of caddy) installiert"
            ilog "Proxy: Caddy"
            ;;
        nginx)
            info "Installiere Nginx (noch nicht vorhanden)..."
            sudo apt-get update -qq
            sudo apt-get install -y -q nginx
            sudo systemctl enable nginx
            sudo systemctl start nginx
            log "Nginx $(version_of nginx) installiert"

            if [ "${NEEDS_CERTBOT:-true}" = "true" ]; then
                if has certbot || pkg_installed certbot; then
                    skip "Certbot $(version_of certbot) bereits vorhanden"
                else
                    info "Installiere Certbot..."
                    sudo apt-get install -y -q certbot python3-certbot-nginx
                    log "Certbot $(version_of certbot) installiert"
                fi
            fi
            ilog "Proxy: Nginx + Certbot"
            ;;
    esac
}

# ─── Projektspezifische Tools ────────────────────────────────────
install_project_tools() {
    header "Projektspezifische Tools"

    # jspdf läuft im Browser – keine Server-Tools nötig
    log "Alle projektspezifischen Tools geprüft"
}

# ─── Verzeichnisse vorbereiten ───────────────────────────────────
prepare_directories() {
    header "Verzeichnisse vorbereiten"

    local dirs=(
        "/opt/projects"
        "/opt/projects/${PROJECT_NAME}"
        "/var/log/${PROJECT_NAME}"
    )

    for d in "${dirs[@]}"; do
        if [ -d "$d" ]; then
            skip "$d"
        else
            if ! mkdir -p "$d" 2>/dev/null; then
                sudo mkdir -p "$d"
                sudo chown "$(whoami):$(whoami)" "$d"
            fi
            log "Erstellt: $d"
        fi
    done

    ilog "Verzeichnisse: vorbereitet"
}

# ─── Abschluss-Check ─────────────────────────────────────────────
final_check() {
    header "Abschluss-Überprüfung"

    local all_ok=true

    _check() {
        local label="$1" cmd="$2"
        if has "$cmd" || service_active "$cmd"; then
            log "${label}: OK"
        else
            err "${label}: FEHLT"
            all_ok=false
        fi
    }

    _check "Git"            git
    _check "Docker"         docker
    _check "curl"           curl
    _check "UFW"            ufw

    if has nginx; then _check "Nginx" nginx; fi
    if has caddy; then _check "Caddy" caddy; fi
    if [ "${NEEDS_CERTBOT:-false}" = "true" ]; then _check "Certbot" certbot; fi

    if docker compose version >/dev/null 2>&1; then
        log "Docker Compose: OK"
    else
        err "Docker Compose Plugin: FEHLT"
        all_ok=false
    fi

    if has node; then
        local nv; nv=$(version_of node)
        local nm; nm=$(echo "$nv" | cut -d. -f1)
        if [ "${nm:-0}" -ge "${NODE_VERSION:-18}" ] 2>/dev/null; then
            log "Node.js ${nv}: OK"
        else
            warn "Node.js ${nv} – benötigt ${NODE_VERSION}+"
        fi
    fi

    echo ""
    if $all_ok; then
        echo -e "${BOLD}${GREEN}╔═══════════════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}${GREEN}║   Server-Initialisierung abgeschlossen!              ║${NC}"
        echo -e "${BOLD}${GREEN}╚═══════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  ${BOLD}Nächster Schritt:${NC}"
        echo ""
        echo "    bash ${REPO_DIR}/scripts/deploy.sh"
        echo ""
    else
        echo -e "${BOLD}${YELLOW}╔═══════════════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}${YELLOW}║   Initialisierung mit Warnungen abgeschlossen        ║${NC}"
        echo -e "${BOLD}${YELLOW}╚═══════════════════════════════════════════════════════╝${NC}"
        echo ""
        warn "Einige Tools fehlen – bitte oben stehende Fehler prüfen"
        echo ""
    fi

    echo -e "  ${BOLD}Protokoll:${NC} ${INIT_LOG}"
    echo ""

    if groups "$(whoami)" 2>/dev/null | grep -q docker && ! docker ps >/dev/null 2>&1; then
        echo ""
        warn "Neu einloggen oder 'newgrp docker' ausführen damit Docker ohne sudo funktioniert"
    fi
}

# ─── MAIN ────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}${CYAN}║   ${PROJECT_DISPLAY} – Server-Initialisierung$(printf '%*s' $((20 - ${#PROJECT_DISPLAY})) '')║${NC}"
    echo -e "${BOLD}${CYAN}║   Frischer Server → Produktionsbereit                ║${NC}"
    echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${DIM}Zuerst Bestandsaufnahme – nur fehlende Komponenten werden installiert${NC}"
    echo ""

    check_os
    run_inventory
    install_system_updates
    install_base_tools
    install_auto_updates
    setup_swap
    harden_ssh
    setup_firewall
    install_fail2ban
    install_docker
    install_node
    setup_git
    clone_repo
    install_proxy
    install_project_tools
    prepare_directories
    final_check
}

main
