/**
 * Merge-Logik für Krankmeldungen:
 * - Fasst zusammenhängende/überlappende Krankmeldungen desselben Mitarbeiters zusammen
 * - Eliminiert Duplikate
 */

interface SickLeaveEntry {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  medical_certificate_status: string | null;
  profile?: {
    full_name: string;
    employee_number: string | null;
  };
  [key: string]: unknown;
}

const CERTIFICATE_PRIORITY: Record<string, number> = {
  received: 3,
  not_required: 2,
  pending: 1,
};

function getCertificatePriority(status: string | null): number {
  return CERTIFICATE_PRIORITY[status ?? ''] ?? 0;
}

function strongerCertificate(a: string | null, b: string | null): string | null {
  return getCertificatePriority(a) >= getCertificatePriority(b) ? a : b;
}

/** Anzahl Kalendertage zwischen zwei Datumsstrings (YYYY-MM-DD) */
function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Zusammenhängende/überlappende Krankmeldungen desselben Mitarbeiters zusammenfassen.
 * Zwei Einträge werden gemergt wenn:
 * - Sie sich überlappen
 * - Sie direkt aneinander grenzen (Ende Tag X, Start Tag X+1)
 * - Maximal 2 Kalendertage Lücke (Wochenende: Freitag→Montag)
 */
export function mergeSickLeaves<T extends SickLeaveEntry>(entries: T[]): T[] {
  if (entries.length <= 1) return entries;

  // Gruppiere nach user_id
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    const group = grouped.get(entry.user_id) ?? [];
    group.push(entry);
    grouped.set(entry.user_id, group);
  }

  const result: T[] = [];

  for (const [, group] of grouped) {
    // Sortiere nach start_date
    group.sort((a, b) => a.start_date.localeCompare(b.start_date));

    // Dedupliziere exakte Duplikate (gleicher start_date + end_date)
    const deduped: T[] = [];
    for (const entry of group) {
      const last = deduped[deduped.length - 1];
      if (last && last.start_date === entry.start_date && last.end_date === entry.end_date) {
        // Duplikat: stärkeren Attest-Status übernehmen
        last.medical_certificate_status = strongerCertificate(
          last.medical_certificate_status,
          entry.medical_certificate_status
        );
        continue;
      }
      deduped.push({ ...entry });
    }

    // Merge überlappende/angrenzende Zeiträume (max 2 Tage Lücke)
    const merged: T[] = [deduped[0]];
    for (let i = 1; i < deduped.length; i++) {
      const current = deduped[i];
      const prev = merged[merged.length - 1];

      // Prüfe ob current direkt an prev anschließt oder überlappt
      // +2 Tage Toleranz für Wochenenden
      const gap = daysBetween(prev.end_date, current.start_date);

      if (gap <= 2) {
        // Merge: erweitere den Zeitraum
        if (current.end_date > prev.end_date) {
          prev.end_date = current.end_date;
        }
        prev.medical_certificate_status = strongerCertificate(
          prev.medical_certificate_status,
          current.medical_certificate_status
        );
      } else {
        merged.push(current);
      }
    }

    result.push(...merged);
  }

  // Sortiere nach Mitarbeitername, dann start_date
  result.sort((a, b) => {
    const nameA = a.profile?.full_name ?? '';
    const nameB = b.profile?.full_name ?? '';
    const nameComp = nameA.localeCompare(nameB, 'de');
    if (nameComp !== 0) return nameComp;
    return a.start_date.localeCompare(b.start_date);
  });

  return result;
}
