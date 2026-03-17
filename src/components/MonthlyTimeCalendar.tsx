"use client";

import { Fragment, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronLeft, ChevronRight, Calendar, Check, Pencil, Coffee, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameMonth, isSameDay, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import QuickTimeEdit from './QuickTimeEdit';
import { SplitTimeDialog } from './SplitTimeDialog';
import { toast } from 'sonner';
import { getHolidays } from '@/lib/holidays';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { logAudit } from '@/lib/auditLog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useIsMobile } from '@/hooks/use-mobile';
import MobileTimeCard from './MobileTimeCard';

interface TimeEntry {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  notes?: string | null;
  template_id?: string | null;
  created_at?: string;
  updated_at?: string;
  user_id?: string;
}

interface Absence {
  id: string;
  start_date: string;
  end_date: string;
  type: 'vacation' | 'sick' | 'other' | 'unpaid_leave' | 'comp_time' | 'vocational_school';
  is_half_day?: boolean | null;
}

interface WorkSchedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  break_minutes: number;
  valid_from: string;
  valid_to: string | null;
}

interface BreakRule {
  min_work_hours: number;
  break_minutes: number;
  priority: number;
}

interface MonthlyTimeCalendarProps {
  userId: string;
}

// Dezimalstunden in "Xh Ymin" Format umwandeln
const formatHoursMinutes = (decimalHours: number): string => {
  const isNegative = decimalHours < 0;
  const absHours = Math.abs(decimalHours);
  const hours = Math.floor(absHours);
  const minutes = Math.round((absHours - hours) * 60);
  const sign = isNegative ? '-' : '';
  if (minutes === 0) {
    return `${sign}${hours}h`;
  }
  return `${sign}${hours}h ${minutes}min`;
};

// Formatiert Dezimalzahl: ganze Zahlen ohne Dezimalstellen, ansonsten max 2 Stellen
const formatDecimal = (value: number): string => {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, '');
};

const MonthlyTimeCalendar = ({ userId }: MonthlyTimeCalendarProps) => {
  const isMobile = useIsMobile();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [workSchedules, setWorkSchedules] = useState<WorkSchedule[]>([]);
  const [breakRules, setBreakRules] = useState<BreakRule[]>([]);
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [splitTimeDate, setSplitTimeDate] = useState<Date | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSavedDate, setLastSavedDate] = useState<string | null>(null);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  useEffect(() => {
    loadMonthData();
  }, [currentDate, userId]);

  const loadMonthData = async () => {
    setLoading(true);
    try {
      // Load time entries, absences, schedules, break rules, and holidays in parallel
      const [entriesResult, absenceResult, schedulesResult, rulesResult, holidayMap] = await Promise.all([
        supabase
          .from('time_entries')
          .select('*')
          .eq('user_id', userId)
          .gte('date', format(monthStart, 'yyyy-MM-dd'))
          .lte('date', format(monthEnd, 'yyyy-MM-dd'))
          .order('date'),
        supabase
          .from('absences')
          .select('*')
          .eq('user_id', userId)
          .or(`start_date.lte.${format(monthEnd, 'yyyy-MM-dd')},end_date.gte.${format(monthStart, 'yyyy-MM-dd')}`),
        supabase
          .from('employee_work_schedules')
          .select('*')
          .eq('user_id', userId),
        supabase
          .from('break_rules')
          .select('*')
          .order('priority'),
        getHolidays(monthStart, monthEnd)
      ]);

      setTimeEntries(entriesResult.data || []);
      setAbsences(absenceResult.data || []);
      setWorkSchedules(schedulesResult.data || []);
      setBreakRules(rulesResult.data || []);
      setHolidays(holidayMap);
    } catch (error) {
      console.error('Error loading month data:', error);
      toast.error('Fehler beim Laden der Daten');
    } finally {
      setLoading(false);
    }
  };

  // Hierarchie: 1. Schedule.break_minutes, 2. break_rules Fallback
  const calculateSuggestedBreak = (date: Date, startTime: string, endTime: string): number => {
    const dayOfWeek = getDay(date);
    const schedule = getScheduleForDate(date, dayOfWeek);
    
    // 1. Individuelle geplante Pause aus Schedule (hat Vorrang)
    if (schedule && schedule.break_minutes > 0) {
      return schedule.break_minutes;
    }
    
    // 2. Fallback: Gesetzliche Pausenregeln basierend auf Arbeitszeit
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    // Sortiert nach Priorität, finde erste passende Regel
    const sortedRules = [...breakRules].sort((a, b) => a.priority - b.priority);
    const applicableRule = sortedRules.find(rule => hours >= rule.min_work_hours);
    return applicableRule?.break_minutes || 0;
  };

  const calculateHours = (startTime: string, endTime: string, breakMinutes: number): number => {
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    return (totalMinutes - breakMinutes) / 60;
  };

  const getScheduleForDate = (date: Date, dayOfWeek: number): WorkSchedule | null => {
    const dateStr = format(date, 'yyyy-MM-dd');
    
    const daySchedules = workSchedules.filter(s => s.day_of_week === dayOfWeek);
    
    const validSchedule = daySchedules.find(s => {
      const validFrom = s.valid_from;
      const validTo = s.valid_to || '9999-12-31';
      return dateStr >= validFrom && dateStr <= validTo;
    });
    
    return validSchedule || null;
  };

  const calculateTargetHours = (schedule: WorkSchedule): number => {
    const start = new Date(`2000-01-01T${schedule.start_time}`);
    const end = new Date(`2000-01-01T${schedule.end_time}`);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const breakHours = schedule.break_minutes / 60;
    return Math.max(0, hours - breakHours);
  };

  // Holt alle Einträge für einen Tag
  const getEntriesForDate = (dateStr: string): TimeEntry[] => {
    return timeEntries.filter(e => e.date === dateStr);
  };

  const getDayInfo = (day: Date): { type: string; data?: any; entries: TimeEntry[]; hours: number; target: number; balance: number; holidayName?: string } => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayOfWeek = getDay(day);
    const dayEntries = getEntriesForDate(dateStr);

    // Wochenende - prüfe ob Einträge existieren oder Arbeitszeit geplant ist
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      // Wenn Einträge für diesen Tag existieren, zeige sie an
      if (dayEntries.length > 0) {
        const totalHours = dayEntries.reduce((sum, entry) => {
          return sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes);
        }, 0);
        const schedule = getScheduleForDate(day, dayOfWeek);
        const targetHoursForDay = schedule ? calculateTargetHours(schedule) : 0;
        return { 
          type: 'entry' as const, 
          data: dayEntries[0],
          entries: dayEntries, 
          hours: totalHours, 
          target: targetHoursForDay, 
          balance: totalHours - targetHoursForDay 
        };
      }
      // Prüfe ob ein Arbeitszeitprofil für diesen Wochentag existiert
      const schedule = getScheduleForDate(day, dayOfWeek);
      if (schedule) {
        const suggestedBreak = calculateSuggestedBreak(day, schedule.start_time, schedule.end_time);
        const hours = calculateHours(schedule.start_time, schedule.end_time, suggestedBreak);
        const targetHoursForDay = calculateTargetHours(schedule);
        return { 
          type: 'suggested' as const, 
          data: {
            start_time: schedule.start_time,
            end_time: schedule.end_time,
            break_minutes: suggestedBreak,
          },
          entries: [], 
          hours, 
          target: targetHoursForDay, 
          balance: 0
        };
      }
      // Sonst als normales Wochenende anzeigen (aber klickbar für manuelle Erfassung)
      return { type: 'weekend' as const, entries: [], hours: 0, target: 0, balance: 0 };
    }

    // Feiertag prüfen
    const holidayName = holidays.get(dateStr);
    if (holidayName) {
      return { type: 'holiday' as const, entries: [], hours: 0, target: 0, balance: 0, holidayName };
    }

    // Finde Schedule für diesen Tag
    const schedule = getScheduleForDate(day, dayOfWeek);
    const target = schedule ? calculateTargetHours(schedule) : 0;

    // Prüfe auf Abwesenheit
    const absence = absences.find(a => {
      const start = parseISO(a.start_date);
      const end = parseISO(a.end_date);
      return day >= start && day <= end;
    });

    if (absence) {
      // Bei halbem Urlaubstag: halbe SOLL-Stunden behalten
      if (absence.type === 'vacation' && absence.is_half_day) {
        const halfTarget = target / 2;
        return {
          type: 'half_vacation',
          data: absence,
          entries: dayEntries,
          hours: dayEntries.reduce((sum, entry) => sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes), 0),
          target: halfTarget,
          balance: dayEntries.reduce((sum, entry) => sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes), 0) - halfTarget
        };
      }
      // Bei Überstundenfrei (comp_time): SOLL-Stunden beibehalten für Saldo-Berechnung
      // IST=0, SOLL=X → Saldo=-X (Stundenkonto wird belastet)
      if (absence.type === 'comp_time') {
        return {
          type: 'comp_time',
          data: absence,
          entries: [],
          hours: 0,
          target: target,
          balance: -target
        };
      }
      // Alle anderen Abwesenheiten: neutral
      return {
        type: absence.type,
        data: absence,
        entries: [],
        hours: 0,
        target: 0,
        balance: 0
      };
    }

    // Prüfe auf Zeiteinträge (kann mehrere sein)
    if (dayEntries.length > 0) {
      const totalHours = dayEntries.reduce((sum, entry) => {
        return sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes);
      }, 0);
      return {
        type: 'entry' as const,
        data: dayEntries[0], // Erster Eintrag für Rückwärtskompatibilität
        entries: dayEntries,
        hours: totalHours,
        target,
        balance: totalHours - target
      };
    }

    // Vorschlag basierend auf Schedule
    if (schedule) {
      const suggestedBreak = calculateSuggestedBreak(day, schedule.start_time, schedule.end_time);
      const hours = calculateHours(schedule.start_time, schedule.end_time, suggestedBreak);
      return {
        type: 'suggested' as const,
        data: {
          start_time: schedule.start_time,
          end_time: schedule.end_time,
          break_minutes: suggestedBreak,
        },
        entries: [],
        hours,
        target,
        balance: 0
      };
    }

    return { type: 'empty' as const, entries: [], hours: 0, target, balance: -target };
  };

  const toggleDayExpanded = (dateStr: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(dateStr)) {
        next.delete(dateStr);
      } else {
        next.add(dateStr);
      }
      return next;
    });
  };

  const getDayColor = (type: string) => {
    switch (type) {
      case 'entry': return 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800';
      case 'suggested': return 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800';
      case 'vacation': return 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800';
      case 'half_vacation': return 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800';
      case 'sick': return 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800';
      case 'holiday': return 'bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800';
      case 'weekend': return 'bg-muted border-border';
      case 'vocational_school': return 'bg-violet-50 dark:bg-violet-950 border-violet-200 dark:border-violet-800';
      case 'comp_time': return 'bg-sky-50 dark:bg-sky-950 border-sky-200 dark:border-sky-800';
      case 'unpaid_leave': return 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800';
      case 'other': return 'bg-gray-50 dark:bg-gray-950 border-gray-200 dark:border-gray-800';
      default: return 'bg-card border-border hover:border-primary';
    }
  };

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const handleDayClick = (day: Date) => {
    const dayInfo = getDayInfo(day);
    // Nur echte Abwesenheiten blockieren - Wochenenden und Feiertage erlauben für manuelle Erfassung
    if (['vacation', 'half_vacation', 'sick', 'vocational_school', 'comp_time', 'unpaid_leave', 'other'].includes(dayInfo.type)) return;
    setSelectedDate(day);
  };

  const refreshMonthData = async () => {
    setRefreshing(true);
    try {
      const [entriesResult, absenceResult, schedulesResult, rulesResult, holidayMap] = await Promise.all([
        supabase
          .from('time_entries')
          .select('*')
          .eq('user_id', userId)
          .gte('date', format(monthStart, 'yyyy-MM-dd'))
          .lte('date', format(monthEnd, 'yyyy-MM-dd'))
          .order('date'),
        supabase
          .from('absences')
          .select('*')
          .eq('user_id', userId)
          .or(`start_date.lte.${format(monthEnd, 'yyyy-MM-dd')},end_date.gte.${format(monthStart, 'yyyy-MM-dd')}`),
        supabase
          .from('employee_work_schedules')
          .select('*')
          .eq('user_id', userId),
        supabase
          .from('break_rules')
          .select('*')
          .order('priority'),
        getHolidays(monthStart, monthEnd)
      ]);

      setTimeEntries(entriesResult.data || []);
      setAbsences(absenceResult.data || []);
      setWorkSchedules(schedulesResult.data || []);
      setBreakRules(rulesResult.data || []);
      setHolidays(holidayMap);
    } catch (error) {
      console.error('Error refreshing month data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const scrollToSavedRow = (dateStr: string) => {
    requestAnimationFrame(() => {
      const row = document.getElementById(`time-row-${dateStr}`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
        setTimeout(() => {
          row.classList.remove('ring-2', 'ring-primary', 'ring-offset-2');
        }, 2000);
      }
    });
  };

  const handleSave = async () => {
    const savedDateStr = selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null;
    setSelectedDate(null);
    setEditingEntry(null);
    
    await refreshMonthData();
    
    if (savedDateStr) {
      setLastSavedDate(savedDateStr);
      scrollToSavedRow(savedDateStr);
    }
  };

  const acceptSuggestion = async (day: Date, dayInfo: ReturnType<typeof getDayInfo>) => {
    if (dayInfo.type !== 'suggested' || !dayInfo.data) return;
    
    const dateStr = format(day, 'yyyy-MM-dd');
    try {
      const { error } = await supabase
        .from('time_entries')
        .insert({
          user_id: userId,
          date: dateStr,
          start_time: dayInfo.data.start_time,
          end_time: dayInfo.data.end_time,
          break_minutes: dayInfo.data.break_minutes,
          notes: null
        });

      if (error) throw error;

      await logAudit({
        action: 'INSERT',
        tableName: 'time_entries',
        description: `Vorschlag übernommen für ${format(day, 'dd.MM.yyyy', { locale: de })}`,
        newValues: { date: dateStr, start_time: dayInfo.data.start_time, end_time: dayInfo.data.end_time }
      });

      toast.success('Vorschlag übernommen');
      await refreshMonthData();
      scrollToSavedRow(dateStr);
    } catch (error) {
      console.error('Error accepting suggestion:', error);
      toast.error('Fehler beim Speichern');
    }
  };

  // Hilfsfunktion: Prüft ob ein Tag als Gleitzeittag markiert ist
  const isFreeDay = (entries: TimeEntry[]): boolean => {
    if (entries.length !== 1) return false;
    const entry = entries[0];
    return (entry.start_time === '00:00:00' || entry.start_time === '00:00') &&
           (entry.end_time === '00:00:00' || entry.end_time === '00:00');
  };

  const toggleFreeDay = async (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayEntries = timeEntries.filter(e => e.date === dateStr);
    
    try {
      // Prüfen, ob bereits ein Gleitzeittag
      if (isFreeDay(dayEntries)) {
        // Eintrag löschen
        const { error } = await supabase
          .from('time_entries')
          .delete()
          .eq('id', dayEntries[0].id);

        if (error) throw error;

        await logAudit({
          action: 'DELETE',
          tableName: 'time_entries',
          recordId: dayEntries[0].id,
          description: `Gleitzeittag entfernt: ${format(day, 'dd.MM.yyyy', { locale: de })}`,
          oldValues: { date: dateStr, notes: dayEntries[0].notes }
        });

        toast.success('Gleitzeittag entfernt');
        await refreshMonthData();
        scrollToSavedRow(dateStr);
        return;
      } else if (dayEntries.length > 0) {
        // Update existing entry to 0 hours
        const { error } = await supabase
          .from('time_entries')
          .update({
            start_time: '00:00:00',
            end_time: '00:00:00',
            break_minutes: 0,
            notes: 'Überstundenfrei / Gleitzeittag'
          })
          .eq('id', dayEntries[0].id);

        if (error) throw error;

        await logAudit({
          action: 'UPDATE',
          tableName: 'time_entries',
          recordId: dayEntries[0].id,
          description: `Als überstundenfrei markiert: ${format(day, 'dd.MM.yyyy', { locale: de })}`,
          oldValues: { start_time: dayEntries[0].start_time, end_time: dayEntries[0].end_time },
          newValues: { start_time: '00:00:00', end_time: '00:00:00', notes: 'Überstundenfrei / Gleitzeittag' }
        });

        toast.success('Als überstundenfrei markiert');
        await refreshMonthData();
        scrollToSavedRow(dateStr);
        return;
      } else {
        // Create new entry with 0 hours
        const { error } = await supabase
          .from('time_entries')
          .insert({
            user_id: userId,
            date: dateStr,
            start_time: '00:00:00',
            end_time: '00:00:00',
            break_minutes: 0,
            notes: 'Überstundenfrei / Gleitzeittag'
          });

        if (error) throw error;

        await logAudit({
          action: 'INSERT',
          tableName: 'time_entries',
          description: `Als überstundenfrei markiert: ${format(day, 'dd.MM.yyyy', { locale: de })}`,
          newValues: { date: dateStr, notes: 'Überstundenfrei / Gleitzeittag' }
        });

        toast.success('Als überstundenfrei markiert');
        await refreshMonthData();
        scrollToSavedRow(dateStr);
      }
    } catch (error) {
      console.error('Error toggling free day:', error);
      toast.error('Fehler beim Speichern');
    }
  };

  const handleEditClick = (e: React.MouseEvent, day: Date, entry?: TimeEntry) => {
    e.stopPropagation();
    if (entry) {
      setEditingEntry(entry);
    }
    setSelectedDate(day);
  };

  const handleAcceptClick = async (e: React.MouseEvent, day: Date, dayInfo: ReturnType<typeof getDayInfo>) => {
    e.stopPropagation();
    await acceptSuggestion(day, dayInfo);
  };

  const handleFreeClick = async (e: React.MouseEvent, day: Date) => {
    e.stopPropagation();
    await toggleFreeDay(day);
  };

  const handleSplitTimeClick = (e: React.MouseEvent, day: Date) => {
    e.stopPropagation();
    setSplitTimeDate(day);
  };

  const totalHours = timeEntries.reduce((sum, entry) => {
    return sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes);
  }, 0);

  // Berechne Gesamt-Soll
  const totalTarget = daysInMonth.reduce((sum, day) => {
    const dayInfo = getDayInfo(day);
    return sum + dayInfo.target;
  }, 0);

  const totalBalance = totalHours - totalTarget;

  const weekDays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Calendar className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="p-2 sm:p-6 overflow-hidden w-full max-w-full">
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-xl sm:text-2xl font-bold">
          {format(currentDate, 'MMMM yyyy', { locale: de })}
        </h2>
        <div className="flex gap-2 justify-between sm:justify-end">
          <Button variant="outline" size="sm" onClick={goToToday} className="flex-1 sm:flex-none">
            Heute
          </Button>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" onClick={previousMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Card View */}
      {isMobile ? (
        <div className="space-y-3 pb-4">
          {daysInMonth.map(day => {
            const dayInfo = getDayInfo(day);
            const isToday = isSameDay(day, new Date());
            const dateStr = format(day, 'yyyy-MM-dd');
            const isExpanded = expandedDays.has(dateStr);

            return (
              <MobileTimeCard
                key={day.toISOString()}
                day={day}
                dayInfo={dayInfo}
                isToday={isToday}
                isExpanded={isExpanded}
                onToggleExpanded={() => toggleDayExpanded(dateStr)}
                isFreeDay={isFreeDay(dayInfo.entries)}
                onEditClick={(entry) => {
                  if (entry) setEditingEntry(entry);
                  setSelectedDate(day);
                }}
                onAcceptClick={() => acceptSuggestion(day, dayInfo)}
                onFreeClick={() => toggleFreeDay(day)}
                onSplitClick={() => setSplitTimeDate(day)}
                calculateHours={calculateHours}
              />
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Datum</TableHead>
              <TableHead className="w-24">Wochentag</TableHead>
              <TableHead>Startzeit</TableHead>
              <TableHead>Endzeit</TableHead>
              <TableHead>Pause</TableHead>
              <TableHead>IST</TableHead>
              <TableHead>SOLL</TableHead>
              <TableHead>SALDO</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notizen</TableHead>
              <TableHead className="w-28">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {daysInMonth.map(day => {
              const dayInfo = getDayInfo(day);
              const isToday = isSameDay(day, new Date());
              const dateStr = format(day, 'yyyy-MM-dd');
              const hasMultipleEntries = dayInfo.entries.length > 1;
              const isExpanded = expandedDays.has(dateStr);

              return (
                <Fragment key={day.toISOString()}>
                  <TableRow
                    id={`time-row-${dateStr}`}
                    className={`
                      transition-all duration-300
                      ${isToday ? 'bg-primary/5' : ''}
                      ${dayInfo.type === 'weekend' ? 'bg-muted/50' : ''}
                      ${dayInfo.type === 'holiday' ? 'bg-purple-50/50 dark:bg-purple-950/20' : ''}
                      ${dayInfo.type === 'entry' && dayInfo.balance > 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}
                      ${dayInfo.type === 'entry' && dayInfo.balance < 0 ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}
                      ${!['vacation', 'sick', 'vocational_school', 'comp_time', 'unpaid_leave', 'other'].includes(dayInfo.type) ? 'cursor-pointer hover:bg-muted/50' : ''}
                    `}
                    onClick={() => handleDayClick(day)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1">
                        {hasMultipleEntries && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleDayExpanded(dateStr);
                            }}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                        {format(day, 'dd.MM.yyyy')}
                        {hasMultipleEntries && (
                          <span className="text-xs text-muted-foreground">({dayInfo.entries.length})</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(day, 'EEEE', { locale: de })}
                    </TableCell>
                    
                    {dayInfo.type === 'entry' && (
                      <>
                        <TableCell>
                          {hasMultipleEntries ? (
                            <span className="text-muted-foreground text-xs">Mehrere</span>
                          ) : (
                            dayInfo.data.start_time.slice(0, 5)
                          )}
                        </TableCell>
                        <TableCell>
                          {hasMultipleEntries ? (
                            <span className="text-muted-foreground text-xs">Einträge</span>
                          ) : (
                            dayInfo.data.end_time.slice(0, 5)
                          )}
                        </TableCell>
                        <TableCell>
                          {hasMultipleEntries ? (
                            <span className="text-muted-foreground text-xs">
                              {dayInfo.entries.reduce((sum, e) => sum + e.break_minutes, 0)} Min
                            </span>
                          ) : (
                            `${dayInfo.data.break_minutes} Min`
                          )}
                        </TableCell>
                        <TableCell className="font-semibold">{formatHoursMinutes(dayInfo.hours)}</TableCell>
                        <TableCell className="font-medium text-muted-foreground">{formatHoursMinutes(dayInfo.target)}</TableCell>
                        <TableCell className={`font-semibold ${dayInfo.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {dayInfo.balance >= 0 ? '+' : ''}{formatHoursMinutes(dayInfo.balance)}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                            {hasMultipleEntries ? `${dayInfo.entries.length} Blöcke` : 'Erfasst'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {hasMultipleEntries ? (
                            <span className="text-xs">Aufklappen für Details</span>
                          ) : (
                            'notes' in dayInfo.data ? (dayInfo.data.notes || '-') : '-'
                          )}
                        </TableCell>
                        <TableCell>
                          <TooltipProvider>
                            <div className="flex gap-1">
                              {!hasMultipleEntries && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                      onClick={(e) => handleEditClick(e, day)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Anpassen</TooltipContent>
                                </Tooltip>
                              )}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-violet-600 hover:text-violet-700 hover:bg-violet-100 dark:text-violet-400 dark:hover:bg-violet-900"
                                    onClick={(e) => handleSplitTimeClick(e, day)}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Splitterzeit erfassen</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className={`h-7 w-7 p-0 ${
                                      isFreeDay(dayInfo.entries)
                                        ? 'bg-amber-200 text-amber-700 hover:bg-amber-300 dark:bg-amber-800 dark:text-amber-300 dark:hover:bg-amber-700'
                                        : 'text-orange-600 hover:text-orange-700 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900'
                                    }`}
                                    onClick={(e) => handleFreeClick(e, day)}
                                  >
                                    <Coffee className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {isFreeDay(dayInfo.entries) ? 'Gleitzeittag entfernen' : 'Überstundenfrei'}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TooltipProvider>
                        </TableCell>
                      </>
                    )}

                  {dayInfo.type === 'suggested' && (
                    <>
                      <TableCell className="text-blue-600 dark:text-blue-400">
                        {dayInfo.data.start_time.slice(0, 5)}
                      </TableCell>
                      <TableCell className="text-blue-600 dark:text-blue-400">
                        {dayInfo.data.end_time.slice(0, 5)}
                      </TableCell>
                      <TableCell className="text-blue-600 dark:text-blue-400">
                        {dayInfo.data.break_minutes} Min
                      </TableCell>
                      <TableCell className="font-semibold text-blue-600 dark:text-blue-400">
                        {formatHoursMinutes(dayInfo.hours)}
                      </TableCell>
                      <TableCell className="font-medium text-muted-foreground">{formatHoursMinutes(dayInfo.target)}</TableCell>
                      <TableCell className="text-muted-foreground">±0h 0min</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          Vorschlag
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">-</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900"
                                  onClick={(e) => handleAcceptClick(e, day, dayInfo)}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Vorschlag übernehmen</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                  onClick={(e) => handleEditClick(e, day)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Anpassen</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-orange-600 hover:text-orange-700 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900"
                                  onClick={(e) => handleFreeClick(e, day)}
                                >
                                  <Coffee className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Überstundenfrei</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </>
                  )}

                  {dayInfo.type === 'vacation' && (
                    <>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        Urlaub
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                          Urlaub
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">-</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                  onClick={(e) => handleEditClick(e, day)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Zeit erfassen</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </>
                  )}

                  {dayInfo.type === 'half_vacation' && (
                    <>
                      <TableCell colSpan={3} className="text-center text-amber-600 dark:text-amber-400">
                        Halber Urlaubstag
                      </TableCell>
                      <TableCell className="font-semibold">{formatHoursMinutes(dayInfo.hours)}</TableCell>
                      <TableCell className="font-medium text-muted-foreground">{formatHoursMinutes(dayInfo.target)}</TableCell>
                      <TableCell className={`font-semibold ${dayInfo.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {dayInfo.balance >= 0 ? '+' : ''}{formatHoursMinutes(dayInfo.balance)}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                          ½ Urlaub
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">50% SOLL-Stunden</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                  onClick={(e) => handleEditClick(e, day)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Zeit erfassen</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </>
                  )}

                  {dayInfo.type === 'sick' && (
                    <>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        Krank
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                          Krank
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">-</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                  onClick={(e) => handleEditClick(e, day)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Zeit erfassen</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </>
                  )}

                  {dayInfo.type === 'comp_time' && (
                    <>
                      <TableCell colSpan={3} className="text-center text-sky-600 dark:text-sky-400">
                        Geplantes Überstundenfrei
                      </TableCell>
                      <TableCell className="font-semibold text-center">0h</TableCell>
                      <TableCell className="text-center font-medium text-muted-foreground">
                        {formatHoursMinutes(dayInfo.target)}
                      </TableCell>
                      <TableCell className="text-center font-semibold text-amber-600 dark:text-amber-400">
                        -{formatHoursMinutes(dayInfo.target)}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300">
                          Überstundenfrei
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">Abwesenheitsantrag</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                  onClick={(e) => handleEditClick(e, day)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Zeit erfassen</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </>
                  )}

                  {dayInfo.type === 'vocational_school' && (
                    <>
                      <TableCell colSpan={3} className="text-center text-violet-600 dark:text-violet-400">
                        Berufsschule
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300">
                          Berufsschule
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">-</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                  onClick={(e) => handleEditClick(e, day)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Zeit erfassen</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </>
                  )}

                  {dayInfo.type === 'unpaid_leave' && (
                    <>
                      <TableCell colSpan={3} className="text-center text-slate-600 dark:text-slate-400">
                        Unbezahlter Urlaub
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                          Unbezahlt
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">-</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                  onClick={(e) => handleEditClick(e, day)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Zeit erfassen</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </>
                  )}

                  {dayInfo.type === 'other' && (
                    <>
                      <TableCell colSpan={3} className="text-center text-gray-600 dark:text-gray-400">
                        Sonstige Abwesenheit
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                          Sonstiges
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">-</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                  onClick={(e) => handleEditClick(e, day)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Zeit erfassen</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </>
                  )}

                  {dayInfo.type === 'weekend' && (
                    <>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        Wochenende
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          Frei
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">-</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                  onClick={(e) => handleEditClick(e, day)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Zeit erfassen</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </>
                  )}

                  {dayInfo.type === 'holiday' && (
                    <>
                      <TableCell colSpan={3} className="text-center text-purple-600 dark:text-purple-400">
                        {dayInfo.holidayName}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                          Feiertag
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">-</TableCell>
                      <TableCell>
                        <TooltipProvider>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                  onClick={(e) => handleEditClick(e, day)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Zeit erfassen</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </TableCell>
                    </>
                  )}

                  {dayInfo.type === 'empty' && (
                    <>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        Keine Erfassung
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">-</TableCell>
                      <TableCell className="text-center text-muted-foreground">{dayInfo.target > 0 ? formatHoursMinutes(dayInfo.target) : '-'}</TableCell>
                      <TableCell className="text-center font-semibold text-amber-600 dark:text-amber-400">
                        {dayInfo.target > 0 ? `-${formatHoursMinutes(dayInfo.target)}` : '-'}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          Fehlt
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">-</TableCell>
                      <TableCell>
                        {dayInfo.target > 0 && (
                          <TooltipProvider>
                            <div className="flex gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                    onClick={(e) => handleEditClick(e, day)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Anpassen</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-7 p-0 text-orange-600 hover:text-orange-700 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900"
                                    onClick={(e) => handleFreeClick(e, day)}
                                  >
                                    <Coffee className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Überstundenfrei</TooltipContent>
                              </Tooltip>
                            </div>
                          </TooltipProvider>
                        )}
                      </TableCell>
                    </>
                  )}
                  </TableRow>
                  
                  {/* Unterzeilen für Splitterzeiten */}
                  {dayInfo.type === 'entry' && hasMultipleEntries && isExpanded && (
                    dayInfo.entries.map((entry, idx) => {
                      const entryHours = calculateHours(entry.start_time, entry.end_time, entry.break_minutes);
                      return (
                        <TableRow 
                          key={`${day.toISOString()}-sub-${entry.id}`}
                          className="bg-muted/30 hover:bg-muted/50"
                        >
                          <TableCell className="pl-10 text-sm text-muted-foreground">
                            ↳ Block {idx + 1}
                          </TableCell>
                          <TableCell></TableCell>
                          <TableCell className="text-sm">{entry.start_time.slice(0, 5)}</TableCell>
                          <TableCell className="text-sm">{entry.end_time.slice(0, 5)}</TableCell>
                          <TableCell className="text-sm">{entry.break_minutes} Min</TableCell>
                          <TableCell className="text-sm font-medium">{formatHoursMinutes(entryHours)}</TableCell>
                          <TableCell></TableCell>
                          <TableCell></TableCell>
                          <TableCell></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {entry.notes || '-'}
                          </TableCell>
                          <TableCell>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                                    onClick={(e) => handleEditClick(e, day, entry)}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Bearbeiten</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        </div>
      )}
      {/* Monthly Summary */}
      <div className="mt-4 sm:mt-6 p-4 sm:p-6 bg-muted rounded-lg">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
          <div>
            <span className="text-xs sm:text-sm text-muted-foreground block mb-1">Erfasste Tage</span>
            <span className="text-xl sm:text-2xl font-bold">{timeEntries.length}</span>
          </div>
          <div>
            <span className="text-xs sm:text-sm text-muted-foreground block mb-1">IST-Stunden</span>
            <span className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatHoursMinutes(totalHours)}
            </span>
          </div>
          <div>
            <span className="text-xs sm:text-sm text-muted-foreground block mb-1">SOLL-Stunden</span>
            <span className="text-xl sm:text-2xl font-bold">
              {formatHoursMinutes(totalTarget)}
            </span>
          </div>
          <div>
            <span className="text-xs sm:text-sm text-muted-foreground block mb-1">GESAMT-SALDO</span>
            <span className={`text-2xl sm:text-3xl font-bold ${totalBalance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {totalBalance >= 0 ? '+' : ''}{formatHoursMinutes(totalBalance)}
            </span>
          </div>
        </div>
      </div>

      {selectedDate && (
        <QuickTimeEdit
          userId={userId}
          date={selectedDate}
          existingEntry={editingEntry || timeEntries.find(e => e.date === format(selectedDate, 'yyyy-MM-dd'))}
          suggestedData={(() => {
            const dayInfo = getDayInfo(selectedDate);
            return dayInfo.type === 'suggested' ? dayInfo.data : undefined;
          })()}
          onClose={() => {
            setSelectedDate(null);
            setEditingEntry(null);
          }}
          onSave={handleSave}
          calculateSuggestedBreak={(startTime, endTime) => calculateSuggestedBreak(selectedDate, startTime, endTime)}
        />
      )}

      {splitTimeDate && (
        <SplitTimeDialog
          open={!!splitTimeDate}
          onOpenChange={(open) => !open && setSplitTimeDate(null)}
          date={splitTimeDate}
          userId={userId}
          onSaved={loadMonthData}
        />
      )}
    </Card>
  );
};

export default MonthlyTimeCalendar;