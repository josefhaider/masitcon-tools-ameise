import { describe, it, expect } from 'vitest';
import { calculateHoursBalance } from './balance';

// Montag 08:00–16:00, 30 min Pause => 7,5 h SOLL/Tag
const mondaySchedule = {
  day_of_week: 1,
  start_time: '08:00:00',
  end_time: '16:00:00',
  break_minutes: 30,
  valid_from: '2020-01-01',
  valid_to: null as string | null,
};

// 2026-06-01 ist ein Montag, 2026-06-06 ein Samstag
const monday = new Date(2026, 5, 1);
const saturday = new Date(2026, 5, 6);

const empty = { timeEntries: [], absences: [], corrections: [], holidays: new Set<string>() };

describe('calculateHoursBalance', () => {
  it('berechnet Saldo = IST - SOLL an einem normalen Werktag', () => {
    const r = calculateHoursBalance({
      ...empty,
      schedules: [mondaySchedule],
      timeEntries: [{ start_time: '08:00:00', end_time: '17:00:00', break_minutes: 30 }], // 8,5 h
      rangeStart: monday,
      rangeEnd: monday,
    });
    expect(r.targetHours).toBe(7.5);
    expect(r.actualHours).toBe(8.5);
    expect(r.balance).toBe(1);
  });

  it('zählt Wochenend-SOLL, wenn ein Schedule für den Tag existiert (#2)', () => {
    const r = calculateHoursBalance({
      ...empty,
      schedules: [{ ...mondaySchedule, day_of_week: 6, start_time: '08:00:00', end_time: '12:00:00', break_minutes: 0 }],
      rangeStart: saturday,
      rangeEnd: saturday,
    });
    expect(r.targetHours).toBe(4);
    expect(r.balance).toBe(-4);
  });

  it('überspringt Wochenenden ohne Schedule', () => {
    const r = calculateHoursBalance({
      ...empty,
      schedules: [mondaySchedule], // nur Montag
      rangeStart: saturday,
      rangeEnd: saturday,
    });
    expect(r.targetHours).toBe(0);
  });

  it('überspringt Feiertage', () => {
    const r = calculateHoursBalance({
      ...empty,
      schedules: [mondaySchedule],
      holidays: new Set(['2026-06-01']),
      rangeStart: monday,
      rangeEnd: monday,
    });
    expect(r.targetHours).toBe(0);
  });

  it('neutralisiert SOLL bei ganztägigem Urlaub', () => {
    const r = calculateHoursBalance({
      ...empty,
      schedules: [mondaySchedule],
      absences: [{ start_date: '2026-06-01', end_date: '2026-06-01', type: 'vacation' }],
      rangeStart: monday,
      rangeEnd: monday,
    });
    expect(r.targetHours).toBe(0);
  });

  it('behält SOLL bei comp_time (Überstundenfrei)', () => {
    const r = calculateHoursBalance({
      ...empty,
      schedules: [mondaySchedule],
      absences: [{ start_date: '2026-06-01', end_date: '2026-06-01', type: 'comp_time' }],
      rangeStart: monday,
      rangeEnd: monday,
    });
    expect(r.targetHours).toBe(7.5);
  });

  it('zieht nur halbe SOLL bei halbem Urlaubstag ab', () => {
    const r = calculateHoursBalance({
      ...empty,
      schedules: [mondaySchedule],
      absences: [{ start_date: '2026-06-01', end_date: '2026-06-01', type: 'vacation', is_half_day: true }],
      rangeStart: monday,
      rangeEnd: monday,
    });
    expect(r.targetHours).toBe(3.75);
  });

  it('priorisiert comp_time vor Urlaub bei Überlappung am selben Tag (#3)', () => {
    const r = calculateHoursBalance({
      ...empty,
      schedules: [mondaySchedule],
      absences: [
        { start_date: '2026-06-01', end_date: '2026-06-01', type: 'vacation' },
        { start_date: '2026-06-01', end_date: '2026-06-01', type: 'comp_time' },
      ],
      rangeStart: monday,
      rangeEnd: monday,
    });
    // comp_time gewinnt -> SOLL bleibt erhalten
    expect(r.targetHours).toBe(7.5);
  });

  it('zählt nur Korrekturen mit effective_date <= rangeEnd und correction_type "hours" (#4)', () => {
    const r = calculateHoursBalance({
      ...empty,
      schedules: [mondaySchedule],
      timeEntries: [{ start_time: '08:00:00', end_time: '16:00:00', break_minutes: 30 }], // 7,5 h = SOLL
      corrections: [
        { hours_adjustment: 10, correction_type: 'hours', effective_date: '2026-05-01' },
        { hours_adjustment: 5, correction_type: 'hours', effective_date: '2026-07-01' }, // nach rangeEnd
        { hours_adjustment: 99, correction_type: 'vacation', effective_date: '2026-05-01' }, // falscher Typ
      ],
      rangeStart: monday,
      rangeEnd: monday,
    });
    expect(r.corrections).toBe(10);
    expect(r.balance).toBe(10); // IST(7,5) - SOLL(7,5) + Korr(10)
  });

  it('respektiert valid_from/valid_to des Schedules', () => {
    const r = calculateHoursBalance({
      ...empty,
      schedules: [{ ...mondaySchedule, valid_from: '2026-06-02' }], // erst ab nächstem Tag gültig
      rangeStart: monday,
      rangeEnd: monday,
    });
    expect(r.targetHours).toBe(0);
  });
});
