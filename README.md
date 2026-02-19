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
# 1. Dependencies installieren
npm install

# 2. .env anlegen (siehe .env.example)
cp .env.example .env

# 3. Lokale Supabase starten
supabase start

# 4. Dev-Server starten
npm run dev
```

Die App laeuft auf http://localhost:8080.

## Scripts

| Script         | Beschreibung                          |
|----------------|---------------------------------------|
| `npm run dev`  | Dev-Server starten                    |
| `npm run build`| Produktions-Build                     |
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
