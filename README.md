# masitcon Zeiterfassung (Ameise)

Professionelle Arbeitszeiterfassungs-Suite fuer masitcon.

**Deployment:** Ubuntu Server 22.04+ (Hetzner, AWS, etc.)

## Tech Stack

- **Frontend**: Next.js 16 + App Router, React 19, TypeScript, Tailwind CSS v4, TailAdmin, shadcn/ui
- **Auth**: Supabase SSR + Server Components + Next.js Middleware
- **API**: Next.js API Routes (`src/app/api/`)
- **Backend**: Supabase (selbst gehostet via Docker Compose) – Auth, PostgreSQL 15, Storage
- **PDF**: jsPDF + AutoTable
- **Deployment**: Docker Compose + Nginx (Ubuntu 22.04+)

## Schnellstart Lokal

```bash
git clone git@github.com:josefhaider/masitcon-tools-ameise.git
cd masitcon-tools-ameise
npm run setup
npm run dev
```

Die App laeuft auf http://localhost:3000.

## Architektur

### Lokal (Entwicklung)

```
npm run dev  (Port 3000, HMR)
  ↓ NEXT_PUBLIC_SUPABASE_URL = http://localhost:8100

localhost:8100 → Kong → { auth, rest, storage }
localhost:3101 → Supabase Studio
localhost:9000 → Inbucket (E-Mail-Catch)
localhost:5433 → PostgreSQL direkt
```

### Server (Production/Staging)

```
DOMAIN       → Nginx → Next.js App-Container (Port 3000)
DOMAIN/supabase/* → Nginx → Kong → { auth, rest, storage }
```

## Lokale URLs

| Service           | URL                              |
|-------------------|----------------------------------|
| App               | http://localhost:3000            |
| Supabase API      | http://localhost:8100            |
| Studio            | http://localhost:3101            |
| Inbucket (E-Mail) | http://localhost:9000            |
| PostgreSQL        | localhost:5433                   |

## Haeufigste Befehle

```bash
# Ersteinrichtung (einmalig)
npm run setup

# Supabase-Stack starten
npm run db:start

# Next.js Dev-Server starten (separates Terminal)
npm run dev

# TypeScript-Typen nach Schema-Aenderung generieren
npm run db:types

# Migration anwenden
npm run db:apply

# Supabase-Stack stoppen (Daten bleiben erhalten)
npm run db:stop

# DB komplett zuruecksetzen (alle Daten weg!)
npm run db:reset

# Backup erstellen / wiederherstellen
npm run db:backup
npm run db:restore

# Produktion Build
npm run build
```

## Repo-Zugriff (Git + SSH-Key)

### Lokale Entwicklung

1. SSH-Key erzeugen (falls noch keiner existiert):
   ```bash
   ssh-keygen -t ed25519 -C "dein@email.de" -f ~/.ssh/id_ed25519
   ```
2. Public Key in GitHub hinterlegen: Einstellungen → SSH and GPG keys → New SSH key

### Server-Deployment (Deploy-Key, read-only)

Manuell:
```bash
ssh-keygen -t ed25519 -C "deploy@server" -f ~/.ssh/id_ed25519_deploy -N ""
cat ~/.ssh/id_ed25519_deploy.pub  # in GitHub Repo → Settings → Deploy keys eintragen
```

## Deploy & Server

### Uebersicht

| Befehl | Beschreibung |
|--------|--------------|
| `npm run setup` | Lokale Dev-Env einrichten (einmalig) |
| `npm run dev` | Next.js Dev-Server starten |
| `npm run db:start` | Supabase-Stack starten |
| `npm run db:stop` | Supabase-Stack stoppen |
| `npm run db:reset` | DB zuruecksetzen + Migrationen neu anwenden |
| `npm run db:types` | TypeScript-Typen aus DB generieren |
| `npm run db:apply` | Neue Migrationen anwenden |
| `npm run db:backup` | DB-Backup erstellen |
| `npm run db:restore` | DB-Backup wiederherstellen |
| `bash scripts/server-setup.sh` | Interaktives Server-Setup (Ersteinrichtung) |
| `bash scripts/server-setup.sh --update` | Produktions-Update (git pull + rebuild) |
| `bash scripts/server-setup.sh --status` | Status anzeigen |
| `bash scripts/server-setup.sh --doctor` | Diagnose (nur lesen) |
| `bash scripts/server-setup.sh --repair` | Bekannte Probleme beheben |
| `bash scripts/server-setup.sh --backup` | DB-Backup erstellen |
| `bash scripts/server-setup.sh --reconfigure` | Konfiguration aendern |
| `bash scripts/server-setup.sh --harden` | Firewall haerten (ufw) |
| `bash scripts/server-setup.sh --uninstall` | Deinstallieren |

### Server-Deployment Flow

1. **Server vorbereiten und App deployen** (einmalig auf frischem Ubuntu 22.04+):
   ```bash
   bash scripts/server-setup.sh
   ```
   Der interaktive Wizard fragt nach Domain, Ports, SMTP-Daten etc., generiert Secrets,
   klont das Repo, baut alle Container und startet den Stack.

2. **Nginx aktivieren** (manuell nach Setup):
   ```bash
   sudo cp /opt/ameise-production/nginx-ameise-production.conf /etc/nginx/sites-available/ameise-production.conf
   sudo ln -sf /etc/nginx/sites-available/ameise-production.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. **SSL-Zertifikat** (optional, fuer HTTPS):
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d zeiterfassung.masitcon.de
   ```

4. **Updates einspielen:**
   ```bash
   bash scripts/server-setup.sh --update
   ```

### Nginx-Routing (Server)

Der Stack laeuft komplett hinter Nginx:
- `DOMAIN` → Next.js App (inkl. API Routes)
- `DOMAIN/supabase/*` → Kong (Supabase API-Gateway)

## Projektstruktur

```
src/
  app/              # Next.js App Router (Seiten, Layouts, API Routes)
  components/       # React-Komponenten
  hooks/            # Custom React Hooks
  integrations/     # Supabase Client + generierte Types
  lib/              # Utilities (Auth, Berechnungen, PDF, Audit)
docker/
  docker-compose.yml        # Produktions-Stack (App + Supabase)
  docker-compose.local.yml  # Lokaler Dev-Stack (Supabase only)
  volumes/api/kong.yml      # Kong API-Gateway Konfiguration
  volumes/db/               # DB-Init-Scripts (Rollen, JWT, Migrationen)
  .env.local.example        # Template fuer lokale Umgebungsvariablen
  .env.example              # Template fuer Produktions-Umgebungsvariablen
supabase/
  migrations/       # SQL-Migrationen (automatisch beim Stack-Start angewendet)
scripts/
  server-setup.sh   # Server-Setup & Deployment (alle Modi)
  dev-setup.sh      # Lokale Ersteinrichtung (npm run setup)
  generate-keys.sh  # Kryptografische Schluessel generieren
  db-start.sh       # Supabase-Stack starten
  db-stop.sh        # Supabase-Stack stoppen
  db-reset.sh       # DB zuruecksetzen
  db-types.sh       # TypeScript-Typen generieren
  db-backup.sh      # Backup & Restore
  apply-migration.sh # Migrationen anwenden
Dockerfile          # Multi-Stage Docker Build (Next.js standalone)
```

## npm Scripts

| Script | Beschreibung |
|--------|--------------|
| `npm run dev` | Next.js Dev-Server starten |
| `npm run build` | Produktions-Build (standalone) |
| `npm run start` | Produktions-Server starten |
| `npm run lint` | ESLint ausfuehren |
| `npm run format` | Prettier ausfuehren |
