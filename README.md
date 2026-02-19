# masitcon Zeiterfassung (Ameise)

Professionelle Arbeitszeiterfassungs-Suite fuer masitcon.

**Deployment:** Ubuntu Server 22.04+ (Hetzner, AWS, etc.)

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Supabase (Auth, PostgreSQL, Edge Functions, RLS)
- **Charts**: Recharts
- **PDF**: jsPDF + AutoTable

## Repo-Zugriff (Git + SSH-Key)

Vor dem Klonen: SSH-Key einrichten.

### Lokale Entwicklung (persoenlicher Key)

1. **SSH-Key erzeugen** (falls noch keiner existiert):
   ```bash
   ssh-keygen -t ed25519 -C "dein@email.de" -f ~/.ssh/id_ed25519
   ```

2. **Public Key in GitHub hinterlegen:**
   - GitHub → Einstellungen → SSH and GPG keys → New SSH key
   - Inhalt von `~/.ssh/id_ed25519.pub` einfuegen

### Server-Deployment (Deploy-Key, read-only)

1. **Auf dem Server:** `server-init.sh` bietet an, einen Deploy-Key zu generieren.

2. **Oder manuell:**
   ```bash
   ssh-keygen -t ed25519 -C "deploy@server" -f ~/.ssh/id_ed25519_deploy -N ""
   cat ~/.ssh/id_ed25519_deploy.pub
   ```

3. **Deploy Key in GitHub hinterlegen:**
   - Repo → Settings → Deploy keys → Add deploy key
   - Public Key einfuegen, Titel z.B. „Server Ameise"
   - **Write access nicht aktivieren** (read-only reicht)

4. **SSH-Config** (falls mehrere Keys):
   ```
   Host github.com
       HostName github.com
       User git
       IdentityFile ~/.ssh/id_ed25519_deploy
       IdentitiesOnly yes
   ```

5. **Verbindung testen:**
   ```bash
   ssh -T git@github.com
   # Erwartet: "Hi josefhaider/...! You've successfully authenticated..."
   ```

## Einstieg

```bash
git clone git@github.com:josefhaider/masitcon-tools-ameise.git
cd masitcon-tools-ameise
```

Damit hast du alles – inkl. `scripts/deploy.sh` und `scripts/server-init.sh`.

## Voraussetzungen

- Node.js >= 18
- Docker (fuer lokale Supabase-Instanz)
- Supabase CLI

## Lokale Entwicklung

Nach dem Klonen:

```bash
bash scripts/deploy.sh --local
```

Die App laeuft auf http://localhost:8080.

**WICHTIG:** Vor `supabase start` Ports pruefen: `bash scripts/deploy.sh --check-ports` (oder `ss -tlnp | grep 543` auf Ubuntu)

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

### Uebersicht

| Script | Beschreibung |
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
| `bash scripts/deploy.sh --migrate` | Migrationen ausfuehren |
| `bash scripts/deploy.sh --check-ports` | Ports pruefen (bei mehreren Supabase-Instanzen) |
| `bash scripts/server-init.sh` | Frischen Ubuntu Server 22.04+ einrichten |

### Server-Deployment Flow

1. **Server vorbereiten** (einmalig auf frischem Ubuntu 22.04+):
   ```bash
   # Script per scp auf Server kopieren und ausfuehren
   scp scripts/server-init.sh user@server:~/
   ssh user@server "bash ~/server-init.sh"
   ```
   Installiert Docker, Node.js, Firewall, fail2ban, Reverse Proxy (Caddy/Nginx), klont das Repo.

2. **App deployen** (direkt nach server-init.sh oder fuer Updates):
   ```bash
   bash /opt/projects/masitcon-tools-ameise/repo/scripts/deploy.sh
   ```
   Fragt interaktiv nach Domain, Supabase-Credentials, baut Docker-Container, startet die App.

3. **Updates einspielen**:
   ```bash
   bash scripts/deploy.sh --update --env production
   ```
   Zieht den neuesten Stand vom Git, baut Container neu, startet sie.

### Staging vs. Produktion

Das Deploy-Script unterstuetzt zwei Umgebungen: `production` (default) und `staging`.

Beim interaktiven Server-Setup (`deploy.sh` ohne Flags) wird eine `.env.production` bzw. `.env.staging` mit den Supabase-Credentials generiert. Fuer manuelle Docker-Builds:

```bash
BUILD_MODE=staging docker compose -f scripts/docker-compose.yml up --build
```

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
scripts/
  deploy.sh       # Deploy & Setup Script
  server-init.sh  # Server-Initialisierung
  Dockerfile      # Multi-Stage Docker Build
  docker-compose.yml      # Produktions-Stack
  docker-compose.local.yml # Lokaler Dev-Stack
  caddy-snippet.conf      # Caddy Reverse Proxy Template
```
