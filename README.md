# masitcon Zeiterfassung (Ameise)

Professionelle Arbeitszeiterfassungs-Suite fuer masitcon.

**Deployment:** Ubuntu Server 22.04+ (Hetzner, AWS, etc.)

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Supabase (selbst gehostet via Docker Compose) – Auth, PostgreSQL, Storage
- **API**: Hono.js (Node.js) – ersetzt Supabase Edge Functions
- **Charts**: Recharts
- **PDF**: jsPDF + AutoTable

## Schnellstart Lokal

```bash
git clone git@github.com:josefhaider/masitcon-tools-ameise.git
cd masitcon-tools-ameise
bash scripts/deploy.sh --local
```

Die App laeuft auf http://localhost:8080. Der Hono-API-Container ist via Kong erreichbar unter http://localhost:8100/functions/v1.

## Architektur

### Lokal (Mac)
```
npm run dev  (Port 8080, HMR)
  ↓ VITE_SUPABASE_URL = http://localhost:8100

localhost:8100 → Kong → { auth, rest, storage, /functions/v1/* → api:3200 }
localhost:3101 → Supabase Studio
localhost:9000 → Inbucket (E-Mail-Catch)
localhost:5433 → PostgreSQL direkt
```

### Server (Production/Staging)
```
DOMAIN       → Caddy → App-Container (Port 8080)
DOMAIN/supabase/* → Caddy → Kong → { auth, rest, storage, /functions/v1/* → api:3200 }
```

## Repo-Zugriff (Git + SSH-Key)

### Lokale Entwicklung

1. SSH-Key erzeugen (falls noch keiner existiert):
   ```bash
   ssh-keygen -t ed25519 -C "dein@email.de" -f ~/.ssh/id_ed25519
   ```
2. Public Key in GitHub hinterlegen: Einstellungen → SSH and GPG keys → New SSH key

### Server-Deployment (Deploy-Key, read-only)

1. `server-init.sh` generiert und registriert einen Deploy-Key automatisch.
2. Oder manuell:
   ```bash
   ssh-keygen -t ed25519 -C "deploy@server" -f ~/.ssh/id_ed25519_deploy -N ""
   cat ~/.ssh/id_ed25519_deploy.pub  # in GitHub Repo → Settings → Deploy keys eintragen
   ```

## Lokale Entwicklung

### Start

```bash
bash scripts/deploy.sh --local
```

Beim ersten Start:
- Generiert kryptografische Schluessel in `docker/.env.local`
- Startet den kompletten Supabase-Stack + Hono-API-Container via Docker Compose
- Wendet alle Migrationen aus `supabase/migrations/` automatisch an
- Schreibt `.env` fuer Vite (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- Startet `npm run dev`

### Lokale URLs

| Service           | URL                              |
|-------------------|----------------------------------|
| App               | http://localhost:8080            |
| Supabase API      | http://localhost:8100            |
| Hono API          | http://localhost:8100/functions/v1 |
| Studio            | http://localhost:3101            |
| Inbucket (E-Mail) | http://localhost:9000            |
| PostgreSQL        | localhost:5433                   |

### Stack-Verwaltung

```bash
# Stack stoppen
docker compose -f docker/docker-compose.local.yml down

# Daten komplett loeschen und neu starten (alle Migrationen neu anwenden)
docker compose -f docker/docker-compose.local.yml --env-file docker/.env.local down -v
docker compose -f docker/docker-compose.local.yml --env-file docker/.env.local up -d

# Logs ansehen
docker compose -f docker/docker-compose.local.yml logs -f
docker compose -f docker/docker-compose.local.yml logs -f api
```

### Datenmigration von Supabase Cloud

```bash
bash scripts/migrate-from-cloud.sh
```

## Deploy & Server

### Uebersicht

| Befehl | Beschreibung |
|--------|--------------|
| `bash scripts/deploy.sh --local` | Lokale Dev-Env einrichten und starten |
| `bash scripts/deploy.sh` | Interaktives Server-Setup (Ersteinrichtung) |
| `bash scripts/deploy.sh --update --env production` | Produktions-Update (git pull + rebuild) |
| `bash scripts/deploy.sh --update --env staging` | Staging-Update |
| `bash scripts/deploy.sh --status` | Container-Status anzeigen |
| `bash scripts/deploy.sh --logs` | Container-Logs (live) |
| `bash scripts/deploy.sh --stop` | Container stoppen |
| `bash scripts/deploy.sh --restart` | Container neu starten |
| `bash scripts/deploy.sh --clean` | Container + Volumes entfernen |
| `bash scripts/deploy.sh --clean --full` | Alles inkl. Verzeichnisse entfernen |
| `bash scripts/deploy.sh --backup` | DB-Dump erstellen |
| `bash scripts/deploy.sh --migrate` | Migrations-Info anzeigen |
| `bash scripts/deploy.sh --check-ports` | Lokale Ports pruefen |
| `bash scripts/server-init.sh` | Frischen Ubuntu Server 22.04+ einrichten |

### Server-Deployment Flow

1. **Server vorbereiten** (einmalig auf frischem Ubuntu 22.04+):
   ```bash
   scp scripts/server-init.sh user@server:~/
   ssh user@server "bash ~/server-init.sh"
   ```
   Installiert Docker, Node.js, Firewall, fail2ban, Caddy, klont das Repo.

2. **App deployen:**
   ```bash
   bash /opt/projects/masitcon-tools-ameise/repo/scripts/deploy.sh
   ```
   Fragt interaktiv nach Domain, Supabase-Credentials, baut alle Container (App + Supabase + Hono API), startet den Stack.

3. **Updates einspielen:**
   ```bash
   bash scripts/deploy.sh --update --env production
   ```

### Caddy-Routing (Server)

Der Stack laeuft komplett hinter Caddy:
- `DOMAIN` → App (statische Vite-SPA)
- `DOMAIN/supabase/*` → Kong (Supabase API-Gateway, inkl. `/functions/v1/*` → Hono API)

## Projektstruktur

```
api/
  src/index.ts    # Hono.js API (3 Routes: create-employee, admin-update-user, employee-data-transfer)
  Dockerfile      # Node.js 20 Alpine
  package.json
src/
  components/     # React-Komponenten
  hooks/          # Custom React Hooks
  integrations/   # Supabase Client + Types
  lib/            # Utilities (Berechnungen, PDF, Audit)
  pages/          # Seiten (Dashboard, Auth, NotFound)
docker/
  docker-compose.yml        # Produktions-Stack (App + Supabase + Hono API)
  docker-compose.local.yml  # Lokaler Dev-Stack (Supabase + Hono API, App via npm run dev)
  volumes/api/kong.yml      # Kong API-Gateway Konfiguration
  .env.local.example        # Template fuer lokale Umgebungsvariablen
supabase/
  functions/      # Originale Deno Edge Functions (Referenz, nicht mehr aktiv)
  migrations/     # SQL-Migrationen (automatisch beim Stack-Start angewendet)
scripts/
  deploy.sh         # Deploy & Setup Script
  server-init.sh    # Server-Initialisierung
  Dockerfile        # Multi-Stage Docker Build (App)
  caddy-snippet.conf # Caddy Reverse Proxy Template
```

## npm Scripts

| Script | Beschreibung |
|--------|--------------|
| `npm run dev` | Dev-Server starten |
| `npm run build` | Produktions-Build |
| `npm run lint` | ESLint ausfuehren |
| `npm run preview` | Build-Preview |
