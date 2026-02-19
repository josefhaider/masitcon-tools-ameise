import { supabase } from '@/integrations/supabase/client';
import { format, eachDayOfInterval, startOfMonth, endOfMonth, getDay, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { getHolidaySet } from '@/lib/holidays';
import { calculateWorkDaysWithHolidays } from '@/lib/workDaysCalculator';

interface WorkSchedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  break_minutes: number;
  valid_from: string;
  valid_to: string | null;
}

interface Absence {
  start_date: string;
  end_date: string;
  type: string;
  is_half_day?: boolean;
}

export interface MonthlyHoursData {
  targetHours: number;
  actualHours: number;
  balance: number;
  workDays: number;
  absenceDays: number;
  missingDays?: string[];
  hoursCorrections?: number;
  totalBalance?: number;
}

/**
 * Lädt die Summe aller Korrekturen für einen Benutzer
 */
export const getBalanceCorrections = async (
  userId: string,
  type: 'hours' | 'vacation',
  upToDate?: Date
): Promise<number> => {
  const dateStr = format(upToDate || new Date(), 'yyyy-MM-dd');
  
  const { data, error } = await supabase
    .from('balance_corrections')
    .select('hours_adjustment, vacation_days_adjustment')
    .eq('user_id', userId)
    .eq('correction_type', type)
    .lte('effective_date', dateStr);

  if (error) {
    console.error('Fehler beim Laden der Korrekturen:', error);
    return 0;
  }

  return data?.reduce((sum, c) => {
    const value = type === 'hours' ? c.hours_adjustment : c.vacation_days_adjustment;
    return sum + (value || 0);
  }, 0) || 0;
};

/**
 * Lädt Urlaubskorrekturen für ein spezifisches Jahr
 * Korrekturen werden nur für das Jahr berücksichtigt, für das sie gelten (applies_to_year)
 */
export const getVacationCorrectionsByYear = async (
  userId: string,
  year: number
): Promise<number> => {
  const { data, error } = await supabase
    .from('balance_corrections')
    .select('vacation_days_adjustment')
    .eq('user_id', userId)
    .eq('correction_type', 'vacation')
    .eq('applies_to_year', year);

  if (error) {
    console.error('Fehler beim Laden der Urlaubskorrekturen:', error);
    return 0;
  }

  return data?.reduce((sum, c) => sum + (c.vacation_days_adjustment || 0), 0) || 0;
};

export interface EmployeeMonthlyData {
  userId: string;
  fullName: string;
  employeeNumber?: string;
  teams: string[];
  
  // Monatliche Kennzahlen
  targetHours: number;
  actualHours: number;
  balance: number;
  
  // Abwesenheiten
  vacationDaysUsed: number;
  vacationDaysTotal: number;
  sickDays: number;
  
  // Status-Indikatoren
  hasOpenTimeEntries: boolean;
  hasNegativeBalance: boolean;
  lastEntryDate?: Date;
}

/**
 * Findet den passenden Arbeitsplan für ein bestimmtes Datum und Wochentag
 */
const getScheduleForDate = (date: Date, dayOfWeek: number, schedules: WorkSchedule[]): WorkSchedule | null => {
  const dateStr = format(date, 'yyyy-MM-dd');
  
  // Finde Schedules für diesen Wochentag
  const daySchedules = schedules.filter(s => s.day_of_week === dayOfWeek);
  
  // Finde den Schedule, der zu diesem Datum passt (valid_from <= date <= valid_to)
  const validSchedule = daySchedules.find(s => {
    const validFrom = s.valid_from;
    const validTo = s.valid_to || '9999-12-31';
    return dateStr >= validFrom && dateStr <= validTo;
  });
  
  return validSchedule || null;
};

/**
 * Berechnet die Soll-Stunden basierend auf Arbeitszeiten
 */
const calculateTargetHoursFromSchedule = (schedule: WorkSchedule): number => {
  const start = new Date(`2000-01-01T${schedule.start_time}`);
  const end = new Date(`2000-01-01T${schedule.end_time}`);
  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  const breakHours = schedule.break_minutes / 60;
  return Math.max(0, hours - breakHours);
};

/**
 * Prüft ob ein Datum in den Abwesenheiten liegt
 */
const isDateInAbsences = (date: Date, absences: Absence[]): boolean => {
  const dateStr = format(date, 'yyyy-MM-dd');
  return absences.some(absence => {
    return dateStr >= absence.start_date && dateStr <= absence.end_date;
  });
};

/**
 * Gibt die relevanteste Abwesenheit für ein bestimmtes Datum zurück.
 * Priorisierung: comp_time > halber Urlaub > andere Abwesenheiten
 * Bei überlappenden Abwesenheiten wird die spezifischere/wichtigere gewählt.
 */
const getAbsenceOnDate = (date: Date, absences: Absence[]): Absence | null => {
  const dateStr = format(date, 'yyyy-MM-dd');
  const matchingAbsences = absences.filter(absence => 
    dateStr >= absence.start_date && dateStr <= absence.end_date
  );
  
  if (matchingAbsences.length === 0) return null;
  if (matchingAbsences.length === 1) return matchingAbsences[0];
  
  // Bei mehreren Abwesenheiten: Priorisierung
  // 1. comp_time hat höchste Priorität (SOLL soll bleiben)
  const compTime = matchingAbsences.find(a => a.type === 'comp_time');
  if (compTime) return compTime;
  
  // 2. Halber Urlaubstag hat zweite Priorität
  const halfDayVacation = matchingAbsences.find(a => a.type === 'vacation' && a.is_half_day);
  if (halfDayVacation) return halfDayVacation;
  
  // 3. Sonst: erste gefundene Abwesenheit
  return matchingAbsences[0];
};

/**
 * Berechnet Soll-, Ist- und Saldo-Stunden für einen Monat
 * @param upToDate - Optional: Berechnung nur bis zu diesem Datum (für tagesgenaue Berechnung im aktuellen Monat)
 */
export const calculateMonthlyHours = async (
  userId: string,
  month: number,
  year: number,
  upToDate?: Date
): Promise<MonthlyHoursData> => {
  const monthDate = new Date(year, month - 1, 1);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const today = new Date();
  
  // Verwende upToDate oder begrenze auf heute wenn im aktuellen Monat
  const calculateUntil = upToDate || (
    year === today.getFullYear() && month === today.getMonth() + 1
      ? today
      : monthEnd
  );
  
  // Alle Tage des Monats bis calculateUntil
  const daysInMonth = eachDayOfInterval({ 
    start: monthStart, 
    end: calculateUntil < monthEnd ? calculateUntil : monthEnd 
  });
  
  // Lade Daten parallel (inkl. Feiertage)
  const [schedulesData, timeEntriesData, absencesData, holidays] = await Promise.all([
    supabase
      .from('employee_work_schedules')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true),
    supabase
      .from('time_entries')
      .select('start_time, end_time, break_minutes')
      .eq('user_id', userId)
      .gte('date', format(monthStart, 'yyyy-MM-dd'))
      .lte('date', format(monthEnd, 'yyyy-MM-dd')),
    supabase
      .from('absences')
      .select('start_date, end_date, type, is_half_day')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .lte('start_date', format(monthEnd, 'yyyy-MM-dd'))
      .gte('end_date', format(monthStart, 'yyyy-MM-dd')),
    getHolidaySet(monthStart, monthEnd)
  ]);
  
  const schedules = schedulesData.data || [];
  const timeEntries = timeEntriesData.data || [];
  const absences = absencesData.data || [];
  
  let targetHours = 0;
  let workDays = 0;
  let absenceDays = 0;
  
  // Berechne Soll-Stunden pro Tag
  daysInMonth.forEach(date => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayOfWeek = getDay(date);
    
    // Überspringe Wochenenden AUSSER es gibt ein explizites Arbeitszeitprofil
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const schedule = getScheduleForDate(date, dayOfWeek, schedules);
      if (!schedule) {
        return; // Kein Profil für Wochenende -> überspringen
      }
      // Wenn Profil existiert, werden die Stunden unten berechnet
    }
    
    // Überspringe Feiertage
    if (holidays.has(dateStr)) {
      return;
    }
    
    // Prüfe ob Abwesenheit
    const absenceOnDate = getAbsenceOnDate(date, absences);
    if (absenceOnDate) {
      absenceDays++;
      
      // Bei halbem Urlaubstag: Nur halbe SOLL-Stunden neutralisieren
      if (absenceOnDate.type === 'vacation' && absenceOnDate.is_half_day) {
        const schedule = getScheduleForDate(date, dayOfWeek, schedules);
        if (schedule) {
          targetHours += calculateTargetHoursFromSchedule(schedule) / 2;
          workDays++;
        }
        return;
      }
      
      // Bei Überstundenfrei (comp_time): SOLL-Stunden bleiben bestehen,
      // damit das Stundenkonto belastet wird (IST=0, SOLL=X → Saldo=-X)
      if (absenceOnDate.type === 'comp_time') {
        const schedule = getScheduleForDate(date, dayOfWeek, schedules);
        if (schedule) {
          targetHours += calculateTargetHoursFromSchedule(schedule);
          workDays++;
        }
      }
      return;
    }
    
    // Finde passenden Schedule
    const schedule = getScheduleForDate(date, dayOfWeek, schedules);
    if (schedule) {
      targetHours += calculateTargetHoursFromSchedule(schedule);
      workDays++;
    }
  });
  
  // Berechne Ist-Stunden
  const actualHours = timeEntries.reduce((sum, entry) => {
    const start = new Date(`2000-01-01T${entry.start_time}`);
    const end = new Date(`2000-01-01T${entry.end_time}`);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const breakHours = entry.break_minutes / 60;
    return sum + Math.max(0, hours - breakHours);
  }, 0);
  
  return {
    targetHours: Math.round(targetHours * 100) / 100,
    actualHours: Math.round(actualHours * 100) / 100,
    balance: Math.round((actualHours - targetHours) * 100) / 100,
    workDays,
    absenceDays
  };
};

/**
 * Berechnet den kumulierten Stundensaldo vom Jahresanfang bis heute (YTD).
 * Diese Funktion berechnet alles in einem Durchlauf, identisch zur Team-Übersicht.
 */
export const calculateYtdBalance = async (
  userId: string,
  year: number = new Date().getFullYear()
): Promise<{ targetHours: number; actualHours: number; balance: number }> => {
  const today = new Date();
  const yearStart = new Date(year, 0, 1);
  const ytdEnd = today.getFullYear() === year ? today : new Date(year, 11, 31);
  
  const yearStartStr = format(yearStart, 'yyyy-MM-dd');
  const ytdEndStr = format(ytdEnd, 'yyyy-MM-dd');
  
  // Lade alle benötigten Daten parallel
  const [schedulesData, timeEntriesData, absencesData, holidays] = await Promise.all([
    supabase
      .from('employee_work_schedules')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true),
    supabase
      .from('time_entries')
      .select('start_time, end_time, break_minutes')
      .eq('user_id', userId)
      .gte('date', yearStartStr)
      .lte('date', ytdEndStr),
    supabase
      .from('absences')
      .select('start_date, end_date, type, is_half_day')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .lte('start_date', ytdEndStr)
      .gte('end_date', yearStartStr),
    getHolidaySet(yearStart, ytdEnd)
  ]);
  
  const schedules = schedulesData.data || [];
  const timeEntries = timeEntriesData.data || [];
  const absences: Absence[] = absencesData.data || [];
  
  // Iteriere durch alle Tage des Jahres bis heute
  const daysToCheck = eachDayOfInterval({ start: yearStart, end: ytdEnd });
  let targetHours = 0;
  
  for (const day of daysToCheck) {
    const dayOfWeek = getDay(day);
    const dateStr = format(day, 'yyyy-MM-dd');
    
    // Überspringe Wochenenden (außer bei explizitem Schedule)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const schedule = getScheduleForDate(day, dayOfWeek, schedules);
      if (!schedule) continue;
    }
    
    // Überspringe Feiertage
    if (holidays.has(dateStr)) continue;
    
    // Prüfe Abwesenheiten mit Priorisierung
    const absenceOnDate = getAbsenceOnDate(day, absences);
    if (absenceOnDate) {
      // Bei halbem Urlaubstag: halbe SOLL-Stunden
      if (absenceOnDate.type === 'vacation' && absenceOnDate.is_half_day) {
        const schedule = getScheduleForDate(day, dayOfWeek, schedules);
        if (schedule) {
          targetHours += calculateTargetHoursFromSchedule(schedule) / 2;
        }
        continue;
      }
      
      // Bei comp_time: SOLL-Stunden bleiben
      if (absenceOnDate.type === 'comp_time') {
        const schedule = getScheduleForDate(day, dayOfWeek, schedules);
        if (schedule) {
          targetHours += calculateTargetHoursFromSchedule(schedule);
        }
        continue;
      }
      
      // Alle anderen Abwesenheiten: SOLL = 0
      continue;
    }
    
    // Normaler Arbeitstag
    const schedule = getScheduleForDate(day, dayOfWeek, schedules);
    if (schedule) {
      targetHours += calculateTargetHoursFromSchedule(schedule);
    }
  }
  
  // Berechne IST-Stunden
  const actualHours = timeEntries.reduce((sum, entry) => {
    const start = new Date(`2000-01-01T${entry.start_time}`);
    const end = new Date(`2000-01-01T${entry.end_time}`);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const breakHours = entry.break_minutes / 60;
    return sum + Math.max(0, hours - breakHours);
  }, 0);
  
  return {
    targetHours: Math.round(targetHours * 100) / 100,
    actualHours: Math.round(actualHours * 100) / 100,
    balance: Math.round((actualHours - targetHours) * 100) / 100
  };
};

/**
 * Berechnet Daten für mehrere Monate (für Charts)
 * @param endMonth - Optional: Bis zu welchem Monat (Standard: aktueller Monat)
 * @param endYear - Optional: Jahr (Standard: aktuelles Jahr)
 */
export const calculateMultipleMonths = async (
  userId: string,
  monthsCount: number = 6,
  endMonth?: number,
  endYear?: number
): Promise<Array<{ month: string; target: number; actual: number; balance: number }>> => {
  const results = [];
  const now = new Date();
  const targetMonth = endMonth || now.getMonth() + 1;
  const targetYear = endYear || now.getFullYear();
  
  for (let i = monthsCount - 1; i >= 0; i--) {
    const date = new Date(targetYear, targetMonth - 1 - i, 1);
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    
    // Tagesgenaue Berechnung nur für aktuellen Monat
    const upToDate = (
      month === now.getMonth() + 1 && year === now.getFullYear()
    ) ? now : undefined;
    
    const data = await calculateMonthlyHours(userId, month, year, upToDate);
    
    results.push({
      month: format(date, 'MMM yyyy', { locale: de }),
      target: data.targetHours,
      actual: data.actualHours,
      balance: data.balance
    });
  }
  
  return results;
};

/**
 * Berechnet aggregierte Monatsdaten für alle Mitarbeiter (Team-Übersicht)
 */
export const calculateTeamMonthlyHours = async (
  month: number,
  year: number
): Promise<EmployeeMonthlyData[]> => {
  // 1. Lade alle aktiven (nicht archivierten) Mitarbeiter mit Teams
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select(`
      id,
      full_name,
      employee_number,
      team_members(
        team_id,
        teams(name)
      )
    `)
    .eq('is_archived', false)
    .order('full_name');

  if (profilesError) {
    console.error('Error loading profiles:', profilesError);
    return [];
  }

  if (!profiles || profiles.length === 0) {
    return [];
  }

  // 2. Für jeden Mitarbeiter: Berechne Monatsdaten parallel
  const results = await Promise.all(
    profiles.map(async (profile) => {
      const isCurrentMonth = 
        month === new Date().getMonth() + 1 && 
        year === new Date().getFullYear();
      const upToDate = isCurrentMonth ? new Date() : undefined;

      // Berechne Monatsdaten
      const monthData = await calculateMonthlyHours(
        profile.id,
        month,
        year,
        upToDate
      );

      // Lade Abwesenheiten parallel
      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const { data: absences } = await supabase
        .from('absences')
        .select('type, start_date, end_date')
        .eq('user_id', profile.id)
        .eq('status', 'approved')
        .or(`and(start_date.gte.${monthStart},start_date.lte.${monthEnd}),and(end_date.gte.${monthStart},end_date.lte.${monthEnd}),and(start_date.lte.${monthStart},end_date.gte.${monthEnd})`);

      // Lade Feiertage für den Monat
      const holidaysSet = await getHolidaySet(new Date(monthStart), new Date(monthEnd));

      // Berechne Urlaubstage und Krankheitstage (nur Arbeitstage)
      const vacationDays = absences
        ?.filter((a) => a.type === 'vacation')
        .reduce((sum, a) => {
          const start = new Date(Math.max(new Date(a.start_date).getTime(), new Date(monthStart).getTime()));
          const end = new Date(Math.min(new Date(a.end_date).getTime(), new Date(monthEnd).getTime()));
          return sum + calculateWorkDaysWithHolidays(start, end, holidaysSet);
        }, 0) || 0;

      const sickDays = absences
        ?.filter((a) => a.type === 'sick')
        .reduce((sum, a) => {
          const start = new Date(Math.max(new Date(a.start_date).getTime(), new Date(monthStart).getTime()));
          const end = new Date(Math.min(new Date(a.end_date).getTime(), new Date(monthEnd).getTime()));
          return sum + calculateWorkDaysWithHolidays(start, end, holidaysSet);
        }, 0) || 0;

      // Prüfe letzte Zeiterfassung
      const { data: lastEntry } = await supabase
        .from('time_entries')
        .select('date')
        .eq('user_id', profile.id)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Extrahiere Team-Namen
      const teamNames = Array.isArray(profile.team_members)
        ? profile.team_members
            .map((tm: any) => tm.teams?.name)
            .filter(Boolean)
        : [];

      return {
        userId: profile.id,
        fullName: profile.full_name,
        employeeNumber: profile.employee_number || undefined,
        teams: teamNames,
        targetHours: monthData.targetHours,
        actualHours: monthData.actualHours,
        balance: monthData.balance,
        vacationDaysUsed: vacationDays,
        vacationDaysTotal: 30, // TODO: Aus Profil oder Einstellungen laden
        sickDays,
        hasOpenTimeEntries: (monthData.missingDays?.length || 0) > 0,
        hasNegativeBalance: monthData.balance < 0,
        lastEntryDate: lastEntry?.date ? new Date(lastEntry.date) : undefined,
      };
    })
  );

  // 3. Sortiere nach Balance (höchste zuerst)
  return results.sort((a, b) => b.balance - a.balance);
};
