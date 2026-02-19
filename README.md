# masitcon Zeiterfassung (Ameise)

Professionelle Arbeitszeiterfassungs-Suite fuer masitcon.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Supabase (Auth, PostgreSQL, Edge Functions, RLS)
- **Charts**: Recharts
- **PDF**: jsPDF + AutoTable

## Voraussetzungen

- Node.js >= 18
- Docker (fuer lokale Supabase-Instanz)
- Supabase CLI

## Lokale Entwicklung

```bash
# Option A: Deploy-Script (empfohlen – prüft Ports, generiert .env)
bash scripts/deploy.sh --local

# Option B: Manuell
npm install
cp .env.example .env
supabase start          # Ports 54331-54337 prüfen vorher!
npm run dev
```

Die App laeuft auf http://localhost:8080.

**WICHTIG:** Vor `supabase start` Ports prüfen: `docker ps` und `lsof -iTCP -sTCP:LISTEN -nP | grep 543`

## Scripts

| Script               | Beschreibung                          |
|----------------------|---------------------------------------|
| `npm run dev`        | Dev-Server starten                    |
| `npm run build`      | Produktions-Build (default)            |
| `npm run build:production` | Produktions-Build (.env.production)   |
| `npm run build:staging`    | Staging-Build (.env.staging)          |
| `npm run lint` | ESLint ausfuehren                     |
| `npm run format`| Prettier auf src/ ausfuehren         |
| `npm run preview`| Build-Preview                       |

## Supabase

Lokale Supabase-Instanz mit Custom-Ports (siehe `supabase/config.toml`):

| Service   | Port  |
|-----------|-------|
| API       | 54331 |
| DB        | 54332 |
| Studio    | 54333 |
| Inbucket  | 54334 |
| Analytics | 54337 |

Edge Functions werden mit `supabase functions serve --env-file supabase/.env` gestartet.

## Deploy & Server

| Script | Beschreibung |
|--------|--------------|
| `bash scripts/deploy.sh --local` | Lokale Dev-Env einrichten und starten |
| `bash scripts/deploy.sh --backup` | DB-Dump erstellen |
| `bash scripts/deploy.sh --migrate` | Migrationen ausführen |
| `bash scripts/deploy.sh --check-ports` | Ports prüfen (bei mehreren Supabase-Instanzen) |
| `bash scripts/deploy.sh --update --env staging` | Staging-Update |
| `bash scripts/deploy.sh --update --env production` | Produktions-Update |
| `bash scripts/server-init.sh` | Frischen Ubuntu/Debian-Server einrichten |

**Staging vs. Produktion:** `.env.staging` und `.env.production` mit jeweiligen Supabase-URLs anlegen. Docker: `BUILD_MODE=staging docker compose up --build`

Für Server-Deployment: `scripts/server-init.sh` einmalig ausführen, danach `scripts/deploy.sh`.
Docker-Build: `scripts/Dockerfile`, `scripts/docker-compose.yml`, `scripts/caddy-snippet.conf`.

## Projektstruktur

```
src/
  components/     # React-Komponenten
  hooks/          # Custom React Hooks
  integrations/   # Supabase Client + Types
  lib/            # Utilities (Berechnungen, PDF, Audit)
  pages/          # Seiten (Dashboard, Auth, NotFound)
supabase/
  functions/      # Edge Functions (Deno)
  migrations/     # SQL-Migrationen
```
