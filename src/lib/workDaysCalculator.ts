import { supabase } from '@/integrations/supabase/client';
import { format, eachDayOfInterval, parseISO, isWeekend } from 'date-fns';

/**
 * Lädt alle Feiertage für einen Zeitraum aus der Datenbank
 */
const getHolidaysSet = async (startDate: Date, endDate: Date): Promise<Set<string>> => {
  const startStr = format(startDate, 'yyyy-MM-dd');
  const endStr = format(endDate, 'yyyy-MM-dd');
  
  const { data: holidays } = await supabase
    .from('holidays')
    .select('date')
    .gte('date', startStr)
    .lte('date', endStr);
  
  return new Set((holidays || []).map(h => h.date));
};

/**
 * Lädt den Arbeitsplan eines Mitarbeiters
 * Gibt zurück an welchen Wochentagen der Mitarbeiter arbeitet
 */
const getWorkScheduleDays = async (
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<Map<string, Set<number>>> => {
  const startStr = format(startDate, 'yyyy-MM-dd');
  const endStr = format(endDate, 'yyyy-MM-dd');
  
  const { data: schedules } = await supabase
    .from('employee_work_schedules')
    .select('day_of_week, valid_from, valid_to')
    .eq('user_id', userId)
    .eq('is_active', true)
    .or(`valid_from.lte.${endStr},valid_to.is.null,valid_to.gte.${startStr}`);
  
  // Map: Datum -> Set von Wochentagen an denen gearbeitet wird
  const dateToWorkDays = new Map<string, Set<number>>();
  
  if (!schedules || schedules.length === 0) {
    // Kein Arbeitsplan = Standard Mo-Fr (1-5)
    return dateToWorkDays;
  }
  
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  
  for (const day of days) {
    const dateStr = format(day, 'yyyy-MM-dd');
    const applicableSchedules = schedules.filter(s => {
      const validFrom = new Date(s.valid_from);
      const validTo = s.valid_to ? new Date(s.valid_to) : new Date('9999-12-31');
      return day >= validFrom && day <= validTo;
    });
    
    const workDaysSet = new Set(applicableSchedules.map(s => s.day_of_week));
    dateToWorkDays.set(dateStr, workDaysSet);
  }
  
  return dateToWorkDays;
};

/**
 * Berechnet die tatsächlichen Arbeitstage zwischen zwei Daten.
 * Berücksichtigt:
 * - Wochenenden (Sa, So) werden ausgeschlossen
 * - Feiertage aus der Datenbank werden ausgeschlossen
 * - Optional: Arbeitsplan des Mitarbeiters (falls userId angegeben)
 * 
 * @param startDate Start-Datum (inklusiv)
 * @param endDate End-Datum (inklusiv)
 * @param userId Optional: User-ID für mitarbeiterspezifische Berechnung
 * @returns Anzahl der tatsächlichen Arbeitstage
 */
export const calculateWorkDays = async (
  startDate: Date | string,
  endDate: Date | string,
  userId?: string
): Promise<number> => {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;
  
  // Hole Feiertage
  const holidays = await getHolidaysSet(start, end);
  
  // Hole Arbeitsplan (falls userId angegeben)
  let workScheduleMap: Map<string, Set<number>> | null = null;
  if (userId) {
    workScheduleMap = await getWorkScheduleDays(userId, start, end);
  }
  
  // Iteriere durch alle Tage
  const days = eachDayOfInterval({ start, end });
  let workDays = 0;
  
  for (const day of days) {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayOfWeek = day.getDay(); // 0 = Sonntag, 1 = Montag, ..., 6 = Samstag
    
    // Prüfe ob Wochenende
    if (isWeekend(day)) {
      continue;
    }
    
    // Prüfe ob Feiertag
    if (holidays.has(dateStr)) {
      continue;
    }
    
    // Prüfe Arbeitsplan (falls vorhanden)
    if (workScheduleMap && workScheduleMap.size > 0) {
      const workDaysForDate = workScheduleMap.get(dateStr);
      // Konvertiere JavaScript-Wochentag zu DB-Wochentag (1 = Mo, 7 = So)
      const dbDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
      if (workDaysForDate && !workDaysForDate.has(dbDayOfWeek)) {
        continue;
      }
    }
    
    workDays++;
  }
  
  return workDays;
};

/**
 * Synchrone Version für schnelle Berechnungen (nur Wochenenden, keine DB-Abfrage)
 * Achtung: Berücksichtigt KEINE Feiertage!
 */
export const calculateWorkDaysSync = (
  startDate: Date | string,
  endDate: Date | string
): number => {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;
  
  const days = eachDayOfInterval({ start, end });
  let workDays = 0;
  
  for (const day of days) {
    if (!isWeekend(day)) {
      workDays++;
    }
  }
  
  return workDays;
};

/**
 * Berechnet Arbeitstage mit vorgefertigtem Holiday-Set (für Batch-Operationen)
 */
export const calculateWorkDaysWithHolidays = (
  startDate: Date | string,
  endDate: Date | string,
  holidays: Set<string>
): number => {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;
  
  const days = eachDayOfInterval({ start, end });
  let workDays = 0;
  
  for (const day of days) {
    const dateStr = format(day, 'yyyy-MM-dd');
    
    // Prüfe ob Wochenende
    if (isWeekend(day)) {
      continue;
    }
    
    // Prüfe ob Feiertag
    if (holidays.has(dateStr)) {
      continue;
    }
    
    workDays++;
  }
  
  return workDays;
};

/**
 * Lädt Feiertage für einen Zeitraum (für Batch-Operationen)
 */
export const fetchHolidaysForRange = async (
  startDate: Date | string,
  endDate: Date | string
): Promise<Set<string>> => {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;
  return getHolidaysSet(start, end);
};
