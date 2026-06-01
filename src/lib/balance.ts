import { eachDayOfInterval, format, getDay } from 'date-fns';

/**
 * Geteilte, reine Berechnung des Stunden-Saldos (SOLL/IST/Korrektur).
 *
 * Single Source of Truth für die Team-Übersicht und den Salden-Report, damit
 * beide Auswertungen garantiert dieselben Werte liefern. Die Funktion arbeitet
 * ausschließlich auf bereits geladenen Daten (kein Supabase-Zugriff).
 *
 * Regeln:
 * - Arbeitszeitpläne werden allein über `valid_from`/`valid_to` gefiltert
 *   (kein `is_active`-Filter – das übernimmt das Laden der Daten bewusst nicht).
 * - Wochenenden zählen nur, wenn für den Wochentag ein Schedule existiert.
 * - Feiertage werden übersprungen.
 * - Abwesenheiten: comp_time behält die SOLL-Stunden, halber Urlaub halbiert sie,
 *   jede andere genehmigte Abwesenheit setzt die SOLL-Stunden des Tages auf 0.
 *   Bei mehreren Abwesenheiten am selben Tag wird priorisiert (siehe
 *   {@link getPrioritizedAbsence}).
 * - Korrekturen zählen nur mit `correction_type === 'hours'` und
 *   `effective_date <= rangeEnd`.
 */

export interface BalanceSchedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  break_minutes: number;
  valid_from: string;
  valid_to: string | null;
}

export interface BalanceTimeEntry {
  start_time: string;
  end_time: string;
  break_minutes: number;
}

export interface BalanceAbsence {
  start_date: string;
  end_date: string;
  type: string;
  is_half_day?: boolean | null;
}

export interface BalanceCorrection {
  hours_adjustment: number | null;
  correction_type: string;
  effective_date: string;
}

export interface HoursBalanceInput {
  schedules: BalanceSchedule[];
  timeEntries: BalanceTimeEntry[];
  absences: BalanceAbsence[];
  corrections: BalanceCorrection[];
  rangeStart: Date;
  rangeEnd: Date;
  holidays: Set<string>;
}

export interface HoursBalanceResult {
  targetHours: number;
  actualHours: number;
  corrections: number;
  balance: number;
}

/**
 * Gibt die relevanteste Abwesenheit für ein bestimmtes Datum zurück.
 * Priorisierung: comp_time > halber Urlaub > erste gefundene Abwesenheit.
 */
export const getPrioritizedAbsence = (
  dayStr: string,
  absences: BalanceAbsence[]
): BalanceAbsence | null => {
  const matching = absences.filter((a) => dayStr >= a.start_date && dayStr <= a.end_date);

  if (matching.length === 0) return null;
  if (matching.length === 1) return matching[0];

  const compTime = matching.find((a) => a.type === 'comp_time');
  if (compTime) return compTime;

  const halfDayVacation = matching.find((a) => a.type === 'vacation' && a.is_half_day);
  if (halfDayVacation) return halfDayVacation;

  return matching[0];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** SOLL-Stunden eines Schedule-Eintrags (Arbeitszeit minus Pause, nie negativ). */
const scheduleHours = (schedule: BalanceSchedule): number => {
  const [startH, startM] = schedule.start_time.split(':').map(Number);
  const [endH, endM] = schedule.end_time.split(':').map(Number);
  const workMinutes = endH * 60 + endM - (startH * 60 + startM) - schedule.break_minutes;
  return Math.max(0, workMinutes / 60);
};

export function calculateHoursBalance(input: HoursBalanceInput): HoursBalanceResult {
  const { schedules, timeEntries, absences, corrections, rangeStart, rangeEnd, holidays } = input;

  const findSchedule = (dayStr: string, dayOfWeek: number) =>
    schedules.find((s) => {
      const validTo = s.valid_to || '9999-12-31';
      return s.day_of_week === dayOfWeek && dayStr >= s.valid_from && dayStr <= validTo;
    });

  let targetHours = 0;
  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

  for (const date of days) {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayOfWeek = getDay(date);

    // Wochenenden nur mit explizitem Schedule berücksichtigen
    if ((dayOfWeek === 0 || dayOfWeek === 6) && !findSchedule(dateStr, dayOfWeek)) {
      continue;
    }

    // Feiertage überspringen
    if (holidays.has(dateStr)) continue;

    // Abwesenheiten (mit Priorisierung)
    const absenceOnDay = getPrioritizedAbsence(dateStr, absences);
    if (absenceOnDay) {
      if (absenceOnDay.type === 'vacation' && absenceOnDay.is_half_day) {
        const schedule = findSchedule(dateStr, dayOfWeek);
        if (schedule) targetHours += scheduleHours(schedule) / 2;
        continue;
      }
      // comp_time behält die SOLL-Stunden, alle anderen Abwesenheiten setzen sie auf 0
      if (absenceOnDay.type !== 'comp_time') continue;
    }

    const schedule = findSchedule(dateStr, dayOfWeek);
    if (schedule) targetHours += scheduleHours(schedule);
  }

  const actualHours = timeEntries.reduce((sum, entry) => {
    const [startH, startM] = entry.start_time.split(':').map(Number);
    const [endH, endM] = entry.end_time.split(':').map(Number);
    const workMinutes = endH * 60 + endM - (startH * 60 + startM) - entry.break_minutes;
    return sum + Math.max(0, workMinutes / 60);
  }, 0);

  const rangeEndStr = format(rangeEnd, 'yyyy-MM-dd');
  const totalCorrections = corrections.reduce((sum, c) => {
    if (c.correction_type !== 'hours') return sum;
    if (c.effective_date > rangeEndStr) return sum;
    return sum + (c.hours_adjustment || 0);
  }, 0);

  return {
    targetHours: round2(targetHours),
    actualHours: round2(actualHours),
    corrections: round2(totalCorrections),
    balance: round2(actualHours - targetHours + totalCorrections),
  };
}
