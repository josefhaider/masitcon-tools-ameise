/**
 * Parser für CHANGELOG.md (Single Source of Truth für das Änderungsprotokoll).
 *
 * Erwartetes Format:
 *
 *   ## [1.7] – 2026-06-01
 *
 *   ### Neu
 *   - **Titel** — Beschreibung.
 *
 *   ### Behoben
 *   - **Titel** — Beschreibung.
 *
 * Regeln:
 * - `## [version] – datum` startet einen Eintrag (Trennzeichen `–`, `—` oder `-`).
 * - `### Kategorie` setzt die aktuelle Kategorie (Neu/Verbessert/Behoben/Technik).
 * - `- **Titel** — Beschreibung` ist eine einzelne Änderung (Titel-Trenner `—`, `–` oder ` - `).
 * - Alles vor dem ersten `##` (Intro) wird ignoriert.
 */

export type ChangeType = "feature" | "improvement" | "fix" | "technical";

export interface ChangeEntry {
  type: ChangeType;
  title: string;
  description: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: ChangeEntry[];
}

const CATEGORY_TO_TYPE: Record<string, ChangeType> = {
  neu: "feature",
  verbessert: "improvement",
  behoben: "fix",
  technik: "technical",
};

/** `## [1.6] – 2026-02-02` → version "1.6", date "2026-02-02". */
const ENTRY_HEADING = /^##\s+\[(.+?)\]\s*[–—-]\s*(.+?)\s*$/;
/** `### Behoben` → "Behoben" */
const CATEGORY_HEADING = /^###\s+(.+?)\s*$/;
/** `- **Titel** — Beschreibung` */
const CHANGE_LINE = /^[-*]\s+\*\*(.+?)\*\*\s*(?:[–—]|-)\s*(.+?)\s*$/;

export function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let currentType: ChangeType | null = null;

  for (const line of raw.split("\n")) {
    const entryMatch = line.match(ENTRY_HEADING);
    if (entryMatch) {
      current = { version: entryMatch[1].trim(), date: entryMatch[2].trim(), changes: [] };
      entries.push(current);
      currentType = null;
      continue;
    }

    if (!current) continue;

    const categoryMatch = line.match(CATEGORY_HEADING);
    if (categoryMatch) {
      currentType = CATEGORY_TO_TYPE[categoryMatch[1].trim().toLowerCase()] ?? null;
      continue;
    }

    const changeMatch = line.match(CHANGE_LINE);
    if (changeMatch && currentType) {
      current.changes.push({
        type: currentType,
        title: changeMatch[1].trim(),
        description: changeMatch[2].trim(),
      });
    }
  }

  return entries.filter((entry) => entry.changes.length > 0);
}
