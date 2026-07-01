import { describe, it, expect } from 'vitest';
import {
  calculateTravelExpense,
  enumerateTripDates,
  formatEUR,
  type PerDiemRate,
} from './travelExpenses';

const DE: PerDiemRate = {
  country_code: 'DE',
  full_day_rate: 28,
  partial_day_rate: 14,
  valid_from: '2024-01-01',
  valid_to: null,
};

const AT: PerDiemRate = {
  country_code: 'AT',
  full_day_rate: 40,
  partial_day_rate: 27,
  valid_from: '2024-01-01',
  valid_to: null,
};

describe('enumerateTripDates', () => {
  it('listet alle Kalendertage inklusive Start und Ende', () => {
    expect(enumerateTripDates('2026-03-01', '2026-03-03')).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
    ]);
  });

  it('liefert einen einzelnen Tag bei gleichem Start-/Enddatum', () => {
    expect(enumerateTripDates('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
  });
});

describe('calculateTravelExpense – eintägig', () => {
  it('gewährt den Teil-Tagessatz bei mehr als 8 Stunden Abwesenheit', () => {
    const r = calculateTravelExpense({
      startDate: '2026-03-01',
      startTime: '07:00',
      endDate: '2026-03-01',
      endTime: '18:00', // 11 h
      countryCode: 'DE',
      rates: [DE],
    });
    expect(r.hoursAway).toBe(11);
    expect(r.days).toHaveLength(1);
    expect(r.days[0].kind).toBe('single');
    expect(r.days[0].amount).toBe(14);
    expect(r.total).toBe(14);
  });

  it('gewährt nichts bei 8 Stunden oder weniger', () => {
    const r = calculateTravelExpense({
      startDate: '2026-03-01',
      startTime: '08:00',
      endDate: '2026-03-01',
      endTime: '14:00', // 6 h
      countryCode: 'DE',
      rates: [DE],
    });
    expect(r.total).toBe(0);
    expect(r.days[0].baseRate).toBe(0);
  });

  it('behandelt exakt 8 Stunden als nicht anspruchsberechtigt (Grenzfall)', () => {
    const r = calculateTravelExpense({
      startDate: '2026-03-01',
      startTime: '08:00',
      endDate: '2026-03-01',
      endTime: '16:00', // genau 8 h
      countryCode: 'DE',
      rates: [DE],
    });
    expect(r.total).toBe(0);
  });
});

describe('calculateTravelExpense – mehrtägig', () => {
  it('berechnet Anreise + voller Tag + Abreise korrekt (3-Tage-Reise DE)', () => {
    const r = calculateTravelExpense({
      startDate: '2026-03-01',
      startTime: '08:00',
      endDate: '2026-03-03',
      endTime: '20:00',
      countryCode: 'DE',
      rates: [DE],
    });
    expect(r.days.map((d) => d.kind)).toEqual(['arrival', 'full', 'departure']);
    expect(r.days.map((d) => d.amount)).toEqual([14, 28, 14]);
    expect(r.total).toBe(56);
  });

  it('berechnet eine 2-Tage-Reise als Anreise + Abreise (kein voller Tag)', () => {
    const r = calculateTravelExpense({
      startDate: '2026-03-01',
      startTime: '08:00',
      endDate: '2026-03-02',
      endTime: '10:00',
      countryCode: 'DE',
      rates: [DE],
    });
    expect(r.days.map((d) => d.kind)).toEqual(['arrival', 'departure']);
    expect(r.total).toBe(28);
  });
});

describe('calculateTravelExpense – Mahlzeitenkürzung', () => {
  it('kürzt den vollen Tag um Mittag- und Abendessen (Basis voller Satz)', () => {
    const r = calculateTravelExpense({
      startDate: '2026-03-01',
      startTime: '08:00',
      endDate: '2026-03-03',
      endTime: '20:00',
      countryCode: 'DE',
      rates: [DE],
      meals: [{ date: '2026-03-02', breakfast: false, lunch: true, dinner: true }],
    });
    // voller Tag: 28 − 11,20 (Mittag) − 11,20 (Abend) = 5,60
    const fullDay = r.days.find((d) => d.kind === 'full')!;
    expect(fullDay.reductions.lunch).toBe(11.2);
    expect(fullDay.reductions.dinner).toBe(11.2);
    expect(fullDay.amount).toBe(5.6);
    // Gesamt: 14 + 5,60 + 14 = 33,60
    expect(r.total).toBe(33.6);
  });

  it('kürzt Beträge nie unter 0 (Kürzung übersteigt Teil-Tagessatz)', () => {
    const r = calculateTravelExpense({
      startDate: '2026-03-01',
      startTime: '08:00',
      endDate: '2026-03-02',
      endTime: '10:00',
      countryCode: 'DE',
      // Anreisetag (14 €) mit allen Mahlzeiten: 5,60 + 11,20 + 11,20 = 28 € Kürzung
      rates: [DE],
      meals: [{ date: '2026-03-01', breakfast: true, lunch: true, dinner: true }],
    });
    const arrival = r.days.find((d) => d.kind === 'arrival')!;
    expect(arrival.reductions.total).toBe(28);
    expect(arrival.amount).toBe(0);
    // Abreisetag ungekürzt = 14
    expect(r.total).toBe(14);
  });
});

describe('calculateTravelExpense – Ausland & Satzauswahl', () => {
  it('nutzt den Auslandssatz des Ziellandes', () => {
    const r = calculateTravelExpense({
      startDate: '2026-03-01',
      startTime: '06:00',
      endDate: '2026-03-01',
      endTime: '20:00', // 14 h
      countryCode: 'AT',
      rates: [DE, AT],
    });
    expect(r.days[0].amount).toBe(27); // AT Teil-Tagessatz
  });

  it('wählt die für den Reisetag zeitlich gültige Rate', () => {
    const rate2024: PerDiemRate = {
      country_code: 'DE',
      full_day_rate: 24,
      partial_day_rate: 12,
      valid_from: '2020-01-01',
      valid_to: '2023-12-31',
    };
    const rate2024plus: PerDiemRate = {
      country_code: 'DE',
      full_day_rate: 28,
      partial_day_rate: 14,
      valid_from: '2024-01-01',
      valid_to: null,
    };
    const r = calculateTravelExpense({
      startDate: '2026-05-10',
      startTime: '07:00',
      endDate: '2026-05-10',
      endTime: '18:00',
      countryCode: 'DE',
      rates: [rate2024, rate2024plus],
    });
    expect(r.days[0].amount).toBe(14); // aktuelle Periode
  });

  it('nutzt den Regionssatz (Palma de Mallorca) statt des Länder-Standards', () => {
    const esDefault: PerDiemRate = {
      country_code: 'ES',
      country_name: 'Spanien',
      region: null,
      full_day_rate: 34,
      partial_day_rate: 23,
      valid_from: '2026-01-01',
      valid_to: null,
    };
    const mallorca: PerDiemRate = {
      country_code: 'ES',
      country_name: 'Spanien',
      region: 'Palma de Mallorca',
      full_day_rate: 44,
      partial_day_rate: 29,
      valid_from: '2026-01-01',
      valid_to: null,
    };
    const r = calculateTravelExpense({
      startDate: '2026-06-01',
      startTime: '06:00',
      endDate: '2026-06-03',
      endTime: '20:00',
      countryCode: 'ES',
      region: 'Palma de Mallorca',
      rates: [esDefault, mallorca],
    });
    // Anreise 29 + voller Tag 44 + Abreise 29 = 102
    expect(r.days.map((d) => d.baseRate)).toEqual([29, 44, 29]);
    expect(r.total).toBe(102);
  });

  it('fällt ohne Region auf den Länder-Standardsatz zurück', () => {
    const esDefault: PerDiemRate = {
      country_code: 'ES',
      country_name: 'Spanien',
      region: null,
      full_day_rate: 34,
      partial_day_rate: 23,
      valid_from: '2026-01-01',
      valid_to: null,
    };
    const mallorca: PerDiemRate = {
      country_code: 'ES',
      country_name: 'Spanien',
      region: 'Palma de Mallorca',
      full_day_rate: 44,
      partial_day_rate: 29,
      valid_from: '2026-01-01',
      valid_to: null,
    };
    const r = calculateTravelExpense({
      startDate: '2026-06-01',
      startTime: '06:00',
      endDate: '2026-06-01',
      endTime: '20:00', // 14 h eintägig
      countryCode: 'ES',
      rates: [esDefault, mallorca],
    });
    expect(r.days[0].amount).toBe(23); // Standard-Teil-Tagessatz, nicht Mallorca
  });

  it('markiert rateMissing, wenn für das Land kein Satz existiert', () => {
    const r = calculateTravelExpense({
      startDate: '2026-03-01',
      startTime: '07:00',
      endDate: '2026-03-01',
      endTime: '18:00',
      countryCode: 'XX',
      rates: [DE],
    });
    expect(r.rateMissing).toBe(true);
    expect(r.total).toBe(0);
  });
});

describe('formatEUR', () => {
  it('formatiert Beträge im deutschen Format', () => {
    expect(formatEUR(56)).toBe('56,00 €');
    expect(formatEUR(5.6)).toBe('5,60 €');
  });
});
