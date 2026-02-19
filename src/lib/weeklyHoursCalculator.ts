import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

/**
 * Berechnet die wöchentlichen Soll-Stunden aus dem aktiven Arbeitszeitprofil
 */
export const calculateWeeklyHoursFromSchedule = async (userId: string): Promise<number> => {
  try {
    const today = format(new Date(), 'yyyy-MM-dd');
    
    const { data: schedules, error } = await supabase
      .from('employee_work_schedules')
      .select('day_of_week, start_time, end_time, break_minutes')
      .eq('user_id', userId)
      .eq('is_active', true)
      .lte('valid_from', today)
      .or(`valid_to.is.null,valid_to.gte.${today}`);
    
    if (error || !schedules || schedules.length === 0) {
      return 0;
    }
  
  // Summiere Stunden aller Wochentage
  return schedules.reduce((total, s) => {
    const startParts = s.start_time.split(':').map(Number);
    const endParts = s.end_time.split(':').map(Number);
    
    const startMinutes = startParts[0] * 60 + startParts[1];
    const endMinutes = endParts[0] * 60 + endParts[1];
    
    const workMinutes = endMinutes - startMinutes - s.break_minutes;
    return total + Math.max(0, workMinutes / 60);
  }, 0);
  } catch (err) {
    console.error('Fehler beim Berechnen der Wochenstunden:', err);
    return 0;
  }
};

/**
 * Berechnet die wöchentlichen Soll-Stunden synchron aus bereits geladenen Schedules
 */
export const calculateWeeklyHoursFromSchedulesSync = (
  schedules: Array<{ start_time: string; end_time: string; break_minutes: number }>
): number => {
  if (!schedules || schedules.length === 0) {
    return 0;
  }
  
  return schedules.reduce((total, s) => {
    const startParts = s.start_time.split(':').map(Number);
    const endParts = s.end_time.split(':').map(Number);
    
    const startMinutes = startParts[0] * 60 + startParts[1];
    const endMinutes = endParts[0] * 60 + endParts[1];
    
    const workMinutes = endMinutes - startMinutes - s.break_minutes;
    return total + Math.max(0, workMinutes / 60);
  }, 0);
};
