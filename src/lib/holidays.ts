import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';

export interface Holiday {
  id: string;
  date: string;
  name: string;
  federal_state: string;
  is_recurring: boolean;
}

export interface SchoolHoliday {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  federal_state: string;
  school_year: string | null;
}

/**
 * Lädt Feiertage für einen Zeitraum aus der Datenbank
 */
export const getHolidays = async (
  startDate: Date,
  endDate: Date,
  federalState: string = 'BY'
): Promise<Map<string, string>> => {
  const { data, error } = await supabase
    .from('holidays')
    .select('date, name')
    .eq('federal_state', federalState)
    .gte('date', format(startDate, 'yyyy-MM-dd'))
    .lte('date', format(endDate, 'yyyy-MM-dd'));

  if (error) {
    console.error('Fehler beim Laden der Feiertage:', error);
    return new Map();
  }

  const holidayMap = new Map<string, string>();
  data?.forEach(h => holidayMap.set(h.date, h.name));
  return holidayMap;
};

/**
 * Lädt alle Feiertage für ein Jahr
 */
export const getHolidaysForYear = async (
  year: number,
  federalState: string = 'BY'
): Promise<Holiday[]> => {
  const { data, error } = await supabase
    .from('holidays')
    .select('*')
    .eq('federal_state', federalState)
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)
    .order('date');

  if (error) {
    console.error('Fehler beim Laden der Feiertage:', error);
    return [];
  }

  return data || [];
};

/**
 * Prüft ob ein Datum ein Feiertag ist (Set-basiert für Performance)
 */
export const getHolidaySet = async (
  startDate: Date,
  endDate: Date,
  federalState: string = 'BY'
): Promise<Set<string>> => {
  const holidays = await getHolidays(startDate, endDate, federalState);
  return new Set(holidays.keys());
};

/**
 * Lädt Schulferien für einen Zeitraum aus der Datenbank
 */
export const getSchoolHolidays = async (
  startDate: Date,
  endDate: Date,
  federalState: string = 'BY'
): Promise<SchoolHoliday[]> => {
  const startStr = format(startDate, 'yyyy-MM-dd');
  const endStr = format(endDate, 'yyyy-MM-dd');

  const { data, error } = await supabase
    .from('school_holidays')
    .select('*')
    .eq('federal_state', federalState)
    .or(`and(start_date.lte.${endStr},end_date.gte.${startStr})`);

  if (error) {
    console.error('Fehler beim Laden der Schulferien:', error);
    return [];
  }

  return data || [];
};

/**
 * Berechnet das Osterdatum (Gauss-Algorithmus)
 */
export const getEasterDate = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month - 1, day);
};

/**
 * Generiert bayerische Feiertage für ein Jahr (inkl. bewegliche Feiertage)
 */
export const generateBavarianHolidays = (year: number): Array<{ date: string; name: string }> => {
  const holidays: Array<{ date: string; name: string }> = [];
  
  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };
  
  const formatDate = (date: Date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  
  // Feste Feiertage
  holidays.push({ date: `${year}-01-01`, name: 'Neujahr' });
  holidays.push({ date: `${year}-01-06`, name: 'Heilige Drei Könige' });
  holidays.push({ date: `${year}-05-01`, name: 'Tag der Arbeit' });
  holidays.push({ date: `${year}-08-15`, name: 'Mariä Himmelfahrt' });
  holidays.push({ date: `${year}-10-03`, name: 'Tag der Deutschen Einheit' });
  holidays.push({ date: `${year}-11-01`, name: 'Allerheiligen' });
  holidays.push({ date: `${year}-12-25`, name: '1. Weihnachtstag' });
  holidays.push({ date: `${year}-12-26`, name: '2. Weihnachtstag' });
  
  // Bewegliche Feiertage basierend auf Ostern
  const easter = getEasterDate(year);
  holidays.push({ date: formatDate(addDays(easter, -2)), name: 'Karfreitag' });
  holidays.push({ date: formatDate(easter), name: 'Ostersonntag' });
  holidays.push({ date: formatDate(addDays(easter, 1)), name: 'Ostermontag' });
  holidays.push({ date: formatDate(addDays(easter, 39)), name: 'Christi Himmelfahrt' });
  holidays.push({ date: formatDate(addDays(easter, 49)), name: 'Pfingstsonntag' });
  holidays.push({ date: formatDate(addDays(easter, 50)), name: 'Pfingstmontag' });
  holidays.push({ date: formatDate(addDays(easter, 60)), name: 'Fronleichnam' });
  
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * Generiert bayerische Schulferien für ein Schuljahr
 * Offizielle Daten vom Bayerischen Kultusministerium
 */
export const generateBavarianSchoolHolidays = (year: number): Array<{
  name: string;
  start_date: string;
  end_date: string;
  school_year: string;
}> => {
  // Schulferien Bayern - offizielle Termine
  const allHolidays: Record<string, Array<{
    name: string;
    start_date: string;
    end_date: string;
    school_year: string;
  }>> = {
    // Schuljahr 2024/2025
    '2024': [
      { name: 'Herbstferien', start_date: '2024-10-28', end_date: '2024-10-31', school_year: '2024/2025' },
      { name: 'Weihnachtsferien', start_date: '2024-12-23', end_date: '2025-01-03', school_year: '2024/2025' },
    ],
    '2025': [
      { name: 'Winterferien', start_date: '2025-03-03', end_date: '2025-03-07', school_year: '2024/2025' },
      { name: 'Osterferien', start_date: '2025-04-14', end_date: '2025-04-25', school_year: '2024/2025' },
      { name: 'Pfingstferien', start_date: '2025-06-10', end_date: '2025-06-20', school_year: '2024/2025' },
      { name: 'Sommerferien', start_date: '2025-07-28', end_date: '2025-09-08', school_year: '2024/2025' },
      // Schuljahr 2025/2026
      { name: 'Herbstferien', start_date: '2025-10-27', end_date: '2025-10-31', school_year: '2025/2026' },
      { name: 'Weihnachtsferien', start_date: '2025-12-22', end_date: '2026-01-05', school_year: '2025/2026' },
    ],
    '2026': [
      { name: 'Winterferien', start_date: '2026-02-16', end_date: '2026-02-20', school_year: '2025/2026' },
      { name: 'Osterferien', start_date: '2026-03-30', end_date: '2026-04-10', school_year: '2025/2026' },
      { name: 'Pfingstferien', start_date: '2026-05-26', end_date: '2026-06-05', school_year: '2025/2026' },
      { name: 'Sommerferien', start_date: '2026-07-27', end_date: '2026-09-07', school_year: '2025/2026' },
      // Schuljahr 2026/2027
      { name: 'Herbstferien', start_date: '2026-11-02', end_date: '2026-11-06', school_year: '2026/2027' },
      { name: 'Weihnachtsferien', start_date: '2026-12-23', end_date: '2027-01-08', school_year: '2026/2027' },
    ],
    '2027': [
      { name: 'Winterferien', start_date: '2027-02-15', end_date: '2027-02-19', school_year: '2026/2027' },
      { name: 'Osterferien', start_date: '2027-03-22', end_date: '2027-04-02', school_year: '2026/2027' },
      { name: 'Pfingstferien', start_date: '2027-05-18', end_date: '2027-05-28', school_year: '2026/2027' },
      { name: 'Sommerferien', start_date: '2027-07-26', end_date: '2027-09-06', school_year: '2026/2027' },
    ],
  };

  // Kombiniere Ferien die im ausgewählten Jahr liegen
  const result: Array<{
    name: string;
    start_date: string;
    end_date: string;
    school_year: string;
  }> = [];

  // Füge Ferien hinzu die im Jahr beginnen oder enden
  const years = [String(year - 1), String(year), String(year + 1)];
  
  years.forEach(y => {
    const yearHolidays = allHolidays[y] || [];
    yearHolidays.forEach(h => {
      const startYear = parseInt(h.start_date.substring(0, 4));
      const endYear = parseInt(h.end_date.substring(0, 4));
      
      // Prüfe ob die Ferien im ausgewählten Jahr liegen
      if (startYear === year || endYear === year) {
        // Prüfe auf Duplikate
        if (!result.some(r => r.start_date === h.start_date && r.end_date === h.end_date)) {
          result.push(h);
        }
      }
    });
  });

  return result.sort((a, b) => a.start_date.localeCompare(b.start_date));
};
