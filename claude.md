# Claude Code – Deploy-Script Generator

## Deine Aufgabe

Analysiere dieses Projekt vollständig und generiere ein produktionsreifes `scripts/deploy.sh` im vorgegebenen Stil (siehe unten). **Zielplattform Server: Ubuntu 22.04+** (Hetzner, AWS, etc.). Lokale Entwicklung: Mac oder Linux. Port-Checks nutzen `ss` (Ubuntu-Standard) vor `lsof`.

---

## Schritt 1: Analyse (führe diese Checks durch)

**PFLICHT:** Vor jedem Supabase-Start oder Deploy: `bash scripts/deploy.sh --check-ports` ausführen. Auf dem Server laufen mehrere Docker/Supabase-Instanzen – Port-Konflikte vermeiden.

### package.json

- [ ] Framework erkennen: Next.js / Express / Fastify / Hono / reines Node?
- [ ] Node-Version (engines.node oder .nvmrc oder .node-version)
- [ ] Build-Command (`build`, `start`, `dev`)
- [ ] Alle Dependencies die besondere Dockerfile-Schritte erfordern (z.B. prisma, sharp, canvas)

### Supabase

- [ ] Liegt `supabase/config.toml` vor? → welche Services aktiv (auth, storage, edge functions, realtime)?
- [ ] Liegt `supabase/migrations/` vor? → Anzahl und Namen der Migrations
- [ ] Wird `@supabase/supabase-js` verwendet? Welche Features (auth, storage, realtime, functions)?
- [ ] Supabase Edge Functions in `supabase/functions/`?

### Environment-Variablen

- [ ] `.env.example` oder `.env.local.example` vorhanden?
- [ ] Alle `process.env.NEXT_PUBLIC_*` im Code scannen
- [ ] Alle `process.env.*` im Code scannen
- [ ] Welche sind Supabase-spezifisch (URL, ANON_KEY, SERVICE_ROLE_KEY)?
- [ ] Welche sind projektspezifisch (externe APIs, SMTP, etc.)?

### Ports & Infrastruktur

- [ ] Welchen Port nutzt die App standardmäßig?
- [ ] Braucht es einen Build-Step oder läuft es direkt (ts-node, tsx, etc.)?

### Besonderheiten

- [ ] Prisma oder anderes ORM? → Migration-Commands
- [ ] Öffentliche Uploads/Assets? → Volume-Mounts
- [ ] Cron-Jobs oder Worker-Prozesse?

---

## Schritt 2: Generiere `scripts/deploy.sh`

Verwende **exakt diesen Stil und diese Struktur** (basierend auf dem bestehenden server-setup.sh):

```bash
#!/usr/bin/env bash
# ===================================================================
# [PROJEKTNAME] - Deploy & Setup Script
# ===================================================================
# Server Setup:    bash scripts/deploy.sh
# Lokale Dev-Env:  bash scripts/deploy.sh --local
# Update:          bash scripts/deploy.sh --update [--env production|staging]
# Status:          bash scripts/deploy.sh --status
# Logs:            bash scripts/deploy.sh --logs [--env production|staging]
# Stoppen:         bash scripts/deploy.sh --stop
# Alles löschen:   bash scripts/deploy.sh --clean
# ===================================================================
```

### Pflicht-Sektionen im Skript

**1. Farben & Logging** (identisch zu server-setup.sh – copy/paste)

**2. Argument-Parsing**

```
--local         Lokale Entwicklungsumgebung einrichten
--update        Container neu bauen und neu starten
--env           production|staging (Default: production)
--status        Alle Container und deren Status anzeigen
--logs          Container-Logs anzeigen
--stop          Alle Container stoppen
--clean         Alles entfernen (mit Bestätigung!)
--migrate       Nur Datenbankmigrationen ausführen
```

**3. collect_config() – Interaktive Abfrage aller Variablen**

Für Server-Modus abfragen:

- Projektname / Kunde (für Verzeichnisnamen und Docker-Container-Prefix)
- Domain/Hostname
- HTTP oder HTTPS
- Supabase: alle Secrets (JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, DB_PASSWORD)
- SMTP-Daten (falls im Projekt genutzt)
- Alle projektspezifischen Env-Variablen (aus Analyse oben erkannte)
- Git Remote URL + Branch

Für Local-Modus abfragen:

- Nur projektspezifische Env-Variablen
- Supabase läuft lokal, Keys werden automatisch aus `supabase status` gelesen

**4. generate_dockerfile()**

Generiere ein optimiertes Dockerfile für dieses spezifische Projekt:

```dockerfile
FROM node:[VERSION]-alpine
# Multi-stage wenn Next.js (builder + runner stage)
# Prisma generate falls nötig
# Korrekte EXPOSE für erkannten Port
```

**5. generate_compose()**

Generiere `docker-compose.yml` mit:

- App-Container
- Supabase-Stack (supabase/docker/docker-compose.yml als Basis, oder eigener Stack)
- Named Volumes für Daten-Persistenz
- Eigenes Docker-Network: `[projektname]_net`
- Health-Checks für DB und App

**6. generate_caddy_config()**

Caddyfile-Block für dieses Projekt:

```
app.[domain] {
    reverse_proxy [container]:[port]
}
supabase.[domain] {
    reverse_proxy [supabase-kong]:[port]
}
```

Ausgabe als separate Datei die in den globalen Caddyfile eingefügt werden kann.

**7. setup_local()**

Für `--local` Modus:

```bash
setup_local() {
    header "Lokale Entwicklungsumgebung"

    # 1. Supabase lokal starten
    check_supabase_cli
    supabase start

    # 2. Supabase-Credentials automatisch auslesen
    read_supabase_local_credentials

    # 3. .env.local generieren/aktualisieren
    generate_env_local

    # 4. Dependencies installieren
    npm install

    # 5. Migrationen ausführen
    supabase db reset  # oder nur neue Migrations

    # 6. Dev-Server starten
    npm run dev
}

read_supabase_local_credentials() {
    # Liest aus `supabase status` automatisch:
    # API URL, anon key, service_role key, DB URL
    local status
    status=$(supabase status 2>/dev/null)
    SUPABASE_URL=$(echo "$status" | grep "API URL" | awk '{print $NF}')
    SUPABASE_ANON_KEY=$(echo "$status" | grep "anon key" | awk '{print $NF}')
    SUPABASE_SERVICE_ROLE_KEY=$(echo "$status" | grep "service_role key" | awk '{print $NF}')
    DATABASE_URL=$(echo "$status" | grep "DB URL" | awk '{print $NF}')
}
```

**8. setup_server()**

Für Server-Modus:

```bash
setup_server() {
    check_prerequisites   # docker, docker compose, git, curl
    collect_config        # interaktive Abfrage
    show_summary          # Zusammenfassung anzeigen, bestätigen lassen

    create_directories    # /opt/[kunde]/[env]/
    clone_repo            # git clone
    generate_dockerfile   # Dockerfile schreiben
    generate_compose      # docker-compose.yml schreiben
    write_env_file        # .env schreiben (alle gesammelten Variablen)
    run_migrations        # supabase db push oder migrate
    start_containers      # docker compose up -d --build
    wait_for_health       # Health-Checks bis alle Container grün
    generate_caddy_config # Caddyfile-Snippet ausgeben
    show_final_summary    # URLs, nächste Schritte, Log-Pfad
}
```

**9. do_update()**

```bash
do_update() {
    # git pull
    # docker compose pull (Images updaten)
    # docker compose build --no-cache app
    # Neue Migrationen ausführen
    # docker compose up -d
    # Health-Check
}
```

**10. do_status()**

```bash
do_status() {
    # docker ps für alle projektspezifischen Container
    # Zeige Ports, Status, Health
    # Zeige Disk-Usage der Volumes
    # Zeige letzten Deploy-Zeitstempel
}
```

**11. Setup-Log** (identisch zu server-setup.sh – alle Variablen mit slog_var/slog_secret loggen)

---

## Schritt 3: Generiere weitere Dateien

### `scripts/Dockerfile` (projektspezifisch)

Basierend auf Framework und Node-Version aus der Analyse.

### `scripts/docker-compose.yml`

Vollständiger Stack für Server-Deployment.

### `scripts/docker-compose.local.yml`

Nur App-Container für lokale Entwicklung (Supabase läuft via CLI).

### `.env.example` (aktualisiert)

Alle gefundenen Env-Variablen dokumentiert mit Beschreibung und Beispielwerten.

### `scripts/caddy-snippet.conf`

Caddyfile-Snippet das in den globalen Caddyfile auf dem Server eingefügt wird.

---

## Schritt 4: Validierung

Bevor du fertig bist, prüfe:

- [ ] Alle erkannten Env-Variablen werden im Skript abgefragt
- [ ] Supabase-Migrations-Pfad korrekt gesetzt
- [ ] Docker-Network-Name eindeutig (keine Konflikte mit anderen Projekten)
- [ ] Port-Check vor Supabase-Start: `--check-ports`, automatisch bei `--local` und `--migrate`; zeigt Belegung (Docker/Prozess), bietet freie Alternativ-Ports
- [ ] `--clean` fragt zweimal nach Bestätigung
- [ ] Skript ist executable: `chmod +x scripts/deploy.sh` im README erwähnt
- [ ] Alle generierten Dateien sind in `.gitignore` geprüft (`.env` aber nicht `.env.example`)

---

## Stil-Regeln (zwingend einhalten)

1. Gleiche Farb-Variablen wie server-setup.sh (BOLD, DIM, GREEN, YELLOW, RED, CYAN, NC)
2. Gleiche log/warn/err/info/header Funktionen
3. Gleiche ask/ask_secret/confirm Hilfsfunktionen
4. Fehler sofort abfangen mit aussagekräftigen Meldungen
5. Jeder wichtige Schritt wird geloggt (slog)
6. Am Ende immer: URLs, nächste Schritte, Log-Pfad anzeigen
7. Deutsche Kommentare und Benutzerführung
8. `set -uo pipefail` am Anfang

---

## Output

Erstelle folgende Dateien direkt im Projekt:

- `scripts/deploy.sh` (ausführbar)
- `scripts/Dockerfile`
- `scripts/docker-compose.yml`
- `scripts/docker-compose.local.yml`
- `scripts/caddy-snippet.conf`
- `.env.example` (aktualisiert)

Committe sie **nicht** automatisch – zeige mir zuerst eine Zusammenfassung was du erkannt hast und was du generiert hast.

---

## Schritt 5: `scripts/server-init.sh` generieren

Zusätzlich zu den anderen Dateien generiere immer ein `scripts/server-init.sh`.
Verwende das Template-Skript als Basis und befülle alle `%%PLACEHOLDER%%` projektspezifisch.

### Was Claude Code analysieren und eintragen muss:

**`PROJECT_NAME` / `PROJECT_DISPLAY`**
Aus Repo-Name und package.json `name`-Feld.

**`NODE_VERSION`**
Exakte Major-Version aus `engines.node`, `.nvmrc`, oder `.node-version`.
Fallback: `20`.

**`PROXY_PREFERENCE`**

- `nginx` wenn im Repo bereits nginx-Configs vorhanden sind
- `caddy` wenn Caddyfile vorhanden ist
- `ask` (Default) wenn unklar

**`HAS_SUPABASE`**
`true` wenn `@supabase/supabase-js` in package.json oder `supabase/` Verzeichnis vorhanden.

**`NEEDS_CERTBOT`**
`true` wenn `PROXY_PREFERENCE=nginx` und HTTPS benötigt wird.

**Projektspezifische Tools erkennen und aktivieren:**

Scanne `package.json` dependencies und den Code auf folgende Patterns:

| Pattern im Code / package.json        | Tool aktivieren                                   |
| ------------------------------------- | ------------------------------------------------- |
| `sharp`, `jimp`, `canvas`, `@squoosh` | `NEEDS_IMAGEMAGICK=true` → Kommentar entfernen    |
| `fluent-ffmpeg`, `ffmpeg`             | `NEEDS_FFMPEG=true` → Kommentar entfernen         |
| `ioredis`, `redis`, `@upstash/redis`  | `NEEDS_REDIS=true` → Kommentar entfernen          |
| `puppeteer`, `playwright`             | Chromium-Dependencies → eigenen Block einfügen    |
| `wkhtmltopdf`, `pdf-lib`              | `NEEDS_WKHTMLTOPDF=true` → eigenen Block einfügen |
| `python`, `@python-bridge`            | Python3 + pip → eigenen Block einfügen            |
| `prisma`                              | Prisma CLI global → eigenen Block einfügen        |

**Für jeden erkannten Tool-Block:**

1. Kommentare im Template entfernen (Block aktivieren)
2. Oder neuen Block nach gleichem Muster einfügen
3. Immer: erst prüfen ob vorhanden (`has` / `service_active`), dann installieren

**`%%ADDITIONAL_UFW_RULES%%`**
Nur Ports eintragen die wirklich öffentlich erreichbar sein müssen.
Redis, PostgreSQL, interne Services → niemals öffnen.

### Pflicht-Kommentar am Anfang des generierten Scripts:

```bash
# Generiert für: [PROJEKTNAME]
# Tech-Stack:    [erkannte Frameworks und Tools]
# Erkannte Tools: [Liste]
# Node-Version:  [VERSION]
# Proxy:         [nginx|caddy]
# Datum:         [DATUM]
```

### Reihenfolge der Ausführung (immer so):

1. `server-init.sh` – einmalig auf frischem Server
2. `deploy.sh` – erstmalig und bei jedem Update

---

## Lokale Entwicklungsumgebung (Supabase Local)

### Port-Konfiguration (WICHTIG!)

Dieses Projekt verwendet **eigene Ports** in `supabase/config.toml`, damit es nicht mit anderen lokalen Supabase-Projekten kollidiert:

| Service    | Port  |
| ---------- | ----- |
| API (Kong) | 54331 |
| PostgreSQL | 54332 |
| Studio     | 54333 |
| Mailpit    | 54334 |
| Analytics  | 54337 |

**PFLICHT vor jedem `supabase start`:** Ports prüfen! Auf dem Server laufen mehrere Docker/Supabase-Instanzen.

```bash
# Port-Check ausführen (zeigt Belegung, bietet freie Alternativen)
bash scripts/deploy.sh --check-ports
```

Das Deploy-Script prüft automatisch vor `--local`, `--migrate` und bei `--check-ports`. Bei Konflikten werden belegte Ports mit Prozess/Container angezeigt; optional kann `supabase/config.toml` mit freien Alternativ-Ports aktualisiert werden.

Manuell: `docker ps` und `lsof -iTCP -sTCP:LISTEN -nP | grep 543`

### Lokale URLs und Keys

Nach `supabase start` die aktuellen Credentials mit `supabase status` auslesen und in `.env` eintragen:

```
VITE_SUPABASE_URL=http://127.0.0.1:54331
VITE_SUPABASE_ANON_KEY=<aus supabase status>
```

Edge Functions brauchen eine eigene `supabase/.env`:

```
SUPABASE_URL=http://127.0.0.1:54331
SUPABASE_SERVICE_ROLE_KEY=<aus supabase status>
DATA_TRANSFER_PASSWORD=<beliebig>
```

### Lokale Supabase starten/stoppen

```bash
supabase start          # Startet alle Container + wendet Migrations an
supabase functions serve # Edge Functions lokal bereitstellen
supabase stop           # Stoppt alle Container
supabase db reset       # DB zuruecksetzen und alle Migrations neu anwenden
```

### Projekt-Info

- **Supabase Project-ID:** `masitcon-tools-ameise-db`
- **Docker-Container-Prefix:** `supabase_*_masitcon-tools-ameise-db`
- **Keine Cloud-Anbindung** -- alles laeuft lokal
