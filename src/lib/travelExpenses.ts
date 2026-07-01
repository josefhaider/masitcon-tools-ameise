import { addDays, format } from 'date-fns';

/**
 * Geteilte, reine Berechnung des Verpflegungsmehraufwands (VMA) für Dienstreisen
 * nach § 9 Abs. 4a EStG.
 *
 * Single Source of Truth für Eingabemaske (Live-Vorschau), PDF-Abrechnung und
 * Steuerberater-Export, damit alle Auswertungen garantiert dieselben Beträge
 * liefern. Die Funktion arbeitet ausschließlich auf bereits geladenen Daten
 * (kein Supabase-Zugriff) – analog zu {@link ./balance.ts}.
 *
 * Regeln:
 * - Eintägige Reise (ohne Übernachtung): Abwesenheit > 8 h ⇒ Teil-Tagessatz,
 *   sonst 0 €.
 * - Mehrtägige Reise: An- und Abreisetag je Teil-Tagessatz (ohne Stundenprüfung),
 *   volle Zwischentage je voller Tagessatz.
 * - Mahlzeitenkürzung je Tag – Basis ist stets der volle Tagessatz des Landes:
 *   Frühstück −20 %, Mittag- und Abendessen je −40 %. Tagesbetrag ≥ 0.
 * - Satzauswahl: pro Tag die für das Zielland gültige Rate
 *   (`valid_from ≤ Tag ≤ valid_to`), Standardsatz (region leer) bevorzugt.
 */

export interface PerDiemRate {
  country_code: string;
  full_day_rate: number;
  partial_day_rate: number;
  valid_from: string; // 'yyyy-MM-dd'
  valid_to: string | null;
  region?: string | null;
  country_name?: string | null; // nur für Anzeige, für die Berechnung ohne Bedeutung
}

export interface MealProvision {
  date: string; // 'yyyy-MM-dd'
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
}

export type TravelDayKind = 'single' | 'arrival' | 'departure' | 'full';

export interface TravelExpenseDayReductions {
  breakfast: number;
  lunch: number;
  dinner: number;
  total: number;
}

export interface TravelExpenseDay {
  date: string; // 'yyyy-MM-dd'
  kind: TravelDayKind;
  baseRate: number; // Grundbetrag vor Mahlzeitenkürzung
  reductions: TravelExpenseDayReductions;
  amount: number; // baseRate − reductions.total, nie negativ
}

export interface TravelExpenseInput {
  startDate: string; // 'yyyy-MM-dd'
  startTime: string; // 'HH:mm' oder 'HH:mm:ss'
  endDate: string;
  endTime: string;
  countryCode: string;
  region?: string | null; // z. B. 'Palma de Mallorca'; NULL = Standardsatz des Landes
  rates: PerDiemRate[];
  meals?: MealProvision[];
}

export interface TravelExpenseResult {
  days: TravelExpenseDay[];
  total: number;
  hoursAway: number; // Gesamt-Abwesenheit in Stunden
  rateMissing: boolean; // true, wenn für mindestens einen Tag kein Satz existiert
}

// Kürzungssätze der Mahlzeitengestellung (§ 9 Abs. 4a Satz 8 EStG)
const BREAKFAST_PCT = 0.2;
const LUNCH_PCT = 0.4;
const DINNER_PCT = 0.4;

// Eintägige Reise: erst ab mehr als 8 Stunden Abwesenheit
const SINGLE_DAY_MIN_HOURS = 8;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Wandelt 'HH:mm' bzw. 'HH:mm:ss' in Minuten seit Mitternacht um. */
const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Sicheres Parsen eines 'yyyy-MM-dd'-Strings als lokales Datum (ohne TZ-Verschiebung). */
const parseDate = (dateStr: string): Date => new Date(`${dateStr}T00:00:00`);

/** Alle Kalendertage der Reise als 'yyyy-MM-dd' (inklusive Start und Ende). */
export const enumerateTripDates = (startDate: string, endDate: string): string[] => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (end < start) return [];

  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dates.push(format(d, 'yyyy-MM-dd'));
  }
  return dates;
};

/**
 * Wählt für ein Datum den passenden Satz. Priorität:
 * 1. exakte Regionsübereinstimmung (z. B. 'Palma de Mallorca'),
 * 2. Standardsatz des Landes (region leer),
 * 3. sonst der erste gültige Satz.
 * Innerhalb einer Stufe gilt die Periode mit dem jüngsten Gültigkeitsbeginn.
 */
const pickRate = (
  rates: PerDiemRate[],
  countryCode: string,
  targetRegion: string | null | undefined,
  dateStr: string
): PerDiemRate | null => {
  const valid = rates.filter(
    (r) =>
      r.country_code === countryCode &&
      dateStr >= r.valid_from &&
      dateStr <= (r.valid_to ?? '9999-12-31')
  );
  if (valid.length === 0) return null;

  const target = (targetRegion ?? '').trim();
  const norm = (r: PerDiemRate) => (r.region ?? '').trim();

  const exact = target ? valid.filter((r) => norm(r) === target) : [];
  const defaults = valid.filter((r) => norm(r) === '');
  const pool = exact.length ? exact : defaults.length ? defaults : valid;

  pool.sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  return pool[0];
};

export function calculateTravelExpense(input: TravelExpenseInput): TravelExpenseResult {
  const dates = enumerateTripDates(input.startDate, input.endDate);
  if (dates.length === 0) {
    return { days: [], total: 0, hoursAway: 0, rateMissing: false };
  }

  const mealByDate = new Map((input.meals ?? []).map((m) => [m.date, m]));

  // Gesamt-Abwesenheit: volle Tage zwischen Start und Ende plus Zeitdifferenz.
  const startMin = toMinutes(input.startTime);
  const endMin = toMinutes(input.endTime);
  const hoursAway = round2(((dates.length - 1) * 1440 + (endMin - startMin)) / 60);

  const isSingleDay = dates.length === 1;
  let rateMissing = false;

  const days: TravelExpenseDay[] = dates.map((dateStr, index) => {
    const rate = pickRate(input.rates, input.countryCode, input.region, dateStr);
    if (!rate) rateMissing = true;

    const fullRate = rate?.full_day_rate ?? 0;
    const partialRate = rate?.partial_day_rate ?? 0;

    let kind: TravelDayKind;
    let baseRate: number;

    if (isSingleDay) {
      kind = 'single';
      baseRate = hoursAway > SINGLE_DAY_MIN_HOURS ? partialRate : 0;
    } else if (index === 0) {
      kind = 'arrival';
      baseRate = partialRate;
    } else if (index === dates.length - 1) {
      kind = 'departure';
      baseRate = partialRate;
    } else {
      kind = 'full';
      baseRate = fullRate;
    }

    const meal = mealByDate.get(dateStr);
    const breakfast = meal?.breakfast ? round2(fullRate * BREAKFAST_PCT) : 0;
    const lunch = meal?.lunch ? round2(fullRate * LUNCH_PCT) : 0;
    const dinner = meal?.dinner ? round2(fullRate * DINNER_PCT) : 0;
    const totalReduction = round2(breakfast + lunch + dinner);
    const amount = Math.max(0, round2(baseRate - totalReduction));

    return {
      date: dateStr,
      kind,
      baseRate: round2(baseRate),
      reductions: { breakfast, lunch, dinner, total: totalReduction },
      amount,
    };
  });

  const total = round2(days.reduce((sum, d) => sum + d.amount, 0));
  return { days, total, hoursAway, rateMissing };
}

/** Formatiert einen Betrag als deutschen Euro-String, z. B. "56,00 €". */
export function formatEUR(amount: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}

/** Ort-Label aus Land + optionaler Region, z. B. "Spanien – Palma de Mallorca". */
export function locationLabel(countryName: string, region?: string | null): string {
  return region ? `${countryName} – ${region}` : countryName;
}

/** Menschlich lesbares Label für die Art eines Reisetags. */
export function travelDayKindLabel(kind: TravelDayKind): string {
  switch (kind) {
    case 'single':
      return 'Eintägig';
    case 'arrival':
      return 'Anreisetag';
    case 'departure':
      return 'Abreisetag';
    case 'full':
      return 'Voller Tag';
  }
}
