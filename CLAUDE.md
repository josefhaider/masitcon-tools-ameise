# CLAUDE.md

Hinweise für die Arbeit an der masitcon Zeiterfassungssuite.

## Stack (Kurzüberblick)

- **Next.js 16** (App Router), **React 19**, **TypeScript** (strict)
- **Tailwind CSS v4** + shadcn/ui, lucide-react Icons
- **Supabase** (self-hosted, PostgreSQL 15), Auth via Supabase SSR + Next.js Middleware
- Deployment: Docker Compose, `output: "standalone"`
- Migrationen unter `supabase/migrations/`, Skripte unter `scripts/`

## Changelog-Pflege

`CHANGELOG.md` (Repo-Root) ist die **einzige Quelle** für das Änderungsprotokoll.
Die In-App-Ansicht `/changelog` ([Changelog.tsx](src/components/Changelog.tsx)) wird
zur Laufzeit daraus erzeugt – über den Parser in [src/lib/changelog.ts](src/lib/changelog.ts).
**Nie** Einträge direkt in die `.tsx` schreiben, immer in `CHANGELOG.md`.

### Wann ein Eintrag ergänzt wird

Bei jeder Änderung, die **Nutzer bemerken** oder die **technisch wichtig** ist, sollte
ein Changelog-Eintrag vorgeschlagen/ergänzt werden. Vor Abschluss einer solchen Änderung
proaktiv anbieten, `CHANGELOG.md` zu aktualisieren.

**Nicht** ins Changelog (dafür gibt es die Git-Historie):
reine Refactorings, Formatierung, Tooling-/Dependency-Updates ohne sichtbaren Effekt,
Kommentar- oder Test-Änderungen.

### Wie ein Eintrag aussieht

Neueste Einträge stehen **oben**. Ein neuer Eintrag bekommt einen Versionsblock mit
lockerer Versionsnummer und Datum (`JJJJ-MM-TT`). Kein Release-Zyklus, keine semver-Pflicht –
die Version ist nur eine grobe Orientierung. Kleine Änderung → nächste Minor/Patch-Zahl,
große → neue Major-Zahl.

Vier Kategorien (genau diese Überschriften verwenden):

- **Neu** – neue Funktionen
- **Verbessert** – Verbesserungen an bestehenden Funktionen
- **Behoben** – behobene Fehler
- **Technik** – wichtige technische/infrastrukturelle Änderungen (Migration, DB, Deployment, Sicherheit)

Vorlage:

```markdown
## [1.7] – 2026-06-15

### Neu
- **Kurzer Titel** — Ein Satz, für Endnutzer verständlich.

### Behoben
- **Kurzer Titel** — Was war kaputt, was ist jetzt korrekt.
```

Format-Regeln (sonst greift der Parser nicht):
- Versionszeile: `## [version] – datum`
- Kategorie: `### Neu` / `### Verbessert` / `### Behoben` / `### Technik`
- Änderung: `- **Titel** — Beschreibung` (Trenner zwischen Titel und Text: `—`)
