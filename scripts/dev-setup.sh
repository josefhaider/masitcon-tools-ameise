#!/usr/bin/env bash
set -euo pipefail

# ===================================================================
# Ameise - LOKALES Entwicklungsumgebung-Setup
# ===================================================================
# NUR fuer die lokale Entwicklung (MacOS/Linux Arbeitsplatz).
# Einmalig nach dem Klonen ausfuehren: npm run setup
#
# ACHTUNG: Fuer Server-Deployments (Staging/Production) stattdessen:
#   bash scripts/server-setup.sh
# ===================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
NC="\033[0m"

log()   { echo -e "${GREEN}[SETUP]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# -----------------------------------------------
# 1. Voraussetzungen prüfen
# -----------------------------------------------
log "Pruefe Voraussetzungen..."

command -v node >/dev/null 2>&1 || error "Node.js ist nicht installiert."
command -v npm >/dev/null 2>&1 || error "npm ist nicht installiert."
command -v docker >/dev/null 2>&1 || error "Docker ist nicht installiert. Bitte Docker Desktop installieren."
command -v openssl >/dev/null 2>&1 || error "openssl ist nicht installiert."
command -v supabase >/dev/null 2>&1 || warn "Supabase CLI nicht installiert. Fuer db:types erforderlich. Install: brew install supabase/tap/supabase"

docker info >/dev/null 2>&1 || error "Docker laeuft nicht. Bitte Docker Desktop starten."

log "Alle Voraussetzungen erfuellt."

# -----------------------------------------------
# 2. Dependencies installieren
# -----------------------------------------------
log "Installiere npm Dependencies..."
npm install

# -----------------------------------------------
# 3. docker/.env.local erstellen (falls nicht vorhanden)
# -----------------------------------------------
ENV_FILE="docker/.env.local"
EXAMPLE_FILE="docker/.env.local.example"

if [ ! -f "$ENV_FILE" ]; then
  log "Erstelle $ENV_FILE mit generierten Keys..."

  if [ ! -f "$EXAMPLE_FILE" ]; then
    error "$EXAMPLE_FILE nicht gefunden."
  fi

  # Keys generieren und in aktuelle Shell-Session exportieren
  eval "$(bash "$SCRIPT_DIR/generate-keys.sh")"
  PG_META_CRYPTO_KEY=$(openssl rand -hex 32)

  # Aus Example-Datei kopieren und Platzhalter ersetzen
  cp "$EXAMPLE_FILE" "$ENV_FILE"

  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|HIER_GENERIERTES_PASSWORT|${POSTGRES_PASSWORD}|g" "$ENV_FILE"
    sed -i '' "s|HIER_GENERIERTER_JWT_SECRET|${JWT_SECRET}|g" "$ENV_FILE"
    sed -i '' "s|HIER_GENERIERTER_ANON_KEY|${ANON_KEY}|g" "$ENV_FILE"
    sed -i '' "s|HIER_GENERIERTER_SERVICE_ROLE_KEY|${SERVICE_ROLE_KEY}|g" "$ENV_FILE"
    sed -i '' "s|HIER_GENERIERTER_KEY|${PG_META_CRYPTO_KEY}|g" "$ENV_FILE"
    # Leere Werte direkt setzen
    sed -i '' "s|^JWT_SECRET=$|JWT_SECRET=${JWT_SECRET}|" "$ENV_FILE"
    sed -i '' "s|^POSTGRES_PASSWORD=$|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" "$ENV_FILE"
    sed -i '' "s|^ANON_KEY=$|ANON_KEY=${ANON_KEY}|" "$ENV_FILE"
    sed -i '' "s|^SERVICE_ROLE_KEY=$|SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}|" "$ENV_FILE"
    sed -i '' "s|^PG_META_CRYPTO_KEY=$|PG_META_CRYPTO_KEY=${PG_META_CRYPTO_KEY}|" "$ENV_FILE"
  else
    sed -i "s|HIER_GENERIERTES_PASSWORT|${POSTGRES_PASSWORD}|g" "$ENV_FILE"
    sed -i "s|HIER_GENERIERTER_JWT_SECRET|${JWT_SECRET}|g" "$ENV_FILE"
    sed -i "s|HIER_GENERIERTER_ANON_KEY|${ANON_KEY}|g" "$ENV_FILE"
    sed -i "s|HIER_GENERIERTER_SERVICE_ROLE_KEY|${SERVICE_ROLE_KEY}|g" "$ENV_FILE"
    sed -i "s|HIER_GENERIERTER_KEY|${PG_META_CRYPTO_KEY}|g" "$ENV_FILE"
    sed -i "s|^JWT_SECRET=$|JWT_SECRET=${JWT_SECRET}|" "$ENV_FILE"
    sed -i "s|^POSTGRES_PASSWORD=$|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" "$ENV_FILE"
    sed -i "s|^ANON_KEY=$|ANON_KEY=${ANON_KEY}|" "$ENV_FILE"
    sed -i "s|^SERVICE_ROLE_KEY=$|SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}|" "$ENV_FILE"
    sed -i "s|^PG_META_CRYPTO_KEY=$|PG_META_CRYPTO_KEY=${PG_META_CRYPTO_KEY}|" "$ENV_FILE"
  fi

  log "$ENV_FILE erstellt."
  warn "SMTP-Daten in $ENV_FILE eintragen falls echte E-Mails benoetigt werden."
  warn "Ohne SMTP landen alle Mails im Inbucket: http://localhost:9000"
else
  log "$ENV_FILE bereits vorhanden. Ueberspringe Key-Generierung."
fi

# -----------------------------------------------
# 4. Docker Compose starten (Supabase-Stack)
# -----------------------------------------------
log "Starte Supabase-Stack..."
bash "$SCRIPT_DIR/db-start.sh"

# -----------------------------------------------
# 5. .env.local fuer Next.js erstellen
# -----------------------------------------------
log "Erstelle .env.local fuer Next.js..."

get_docker_env() {
  grep "^${1}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-
}

ANON_KEY_VAL=$(get_docker_env "ANON_KEY")
SERVICE_ROLE_KEY_VAL=$(get_docker_env "SERVICE_ROLE_KEY")
API_PORT_VAL=$(get_docker_env "API_PORT")
API_PORT_VAL="${API_PORT_VAL:-8100}"
DATA_TRANSFER_PASSWORD_VAL=$(get_docker_env "DATA_TRANSFER_PASSWORD")
DATA_TRANSFER_PASSWORD_VAL="${DATA_TRANSFER_PASSWORD_VAL:-local-dev-password}"

if [ -z "$ANON_KEY_VAL" ]; then
  error "Konnte ANON_KEY nicht aus $ENV_FILE lesen."
fi

cat > .env.local << EOF
# Supabase (auto-generated by setup script)
NEXT_PUBLIC_SUPABASE_URL=http://localhost:${API_PORT_VAL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY_VAL}

# Server-seitige Secrets (fuer API Routes / Server Actions)
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY_VAL}
DATA_TRANSFER_PASSWORD=${DATA_TRANSFER_PASSWORD_VAL}
EOF

log ".env.local erstellt."

# -----------------------------------------------
# 6. App-Migrationen anwenden
# -----------------------------------------------
log "Wende Migrationen an..."
bash "$SCRIPT_DIR/apply-migration.sh"

# -----------------------------------------------
# 7. TypeScript Types generieren
# -----------------------------------------------
if command -v supabase >/dev/null 2>&1; then
  log "Generiere Supabase TypeScript-Typen..."
  bash "$SCRIPT_DIR/db-types.sh"
else
  warn "Supabase CLI nicht installiert – ueberspringe Typ-Generierung."
  warn "Install: brew install supabase/tap/supabase"
fi

# -----------------------------------------------
# Fertig!
# -----------------------------------------------
echo ""
echo -e "${BOLD}${GREEN}Setup abgeschlossen!${NC}"
echo ""
echo "  Entwicklung starten:  npm run dev"
echo "  Supabase Studio:      http://localhost:3101"
echo "  Inbucket (E-Mails):   http://localhost:9000"
echo "  App:                  http://localhost:3000"
echo ""
echo -e "${YELLOW}Hinweis:${NC} Admin-Nutzer anlegen, dann in Admin > Mitarbeiter die Rolle zuweisen."
echo -e "${YELLOW}Hinweis:${NC} Stack neu starten: npm run db:stop && npm run db:start"
echo ""
