import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronLeft, ChevronRight, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { getHolidays } from '@/lib/holidays';
import { Skeleton } from '@/components/ui/skeleton';

interface TimeEntry {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  notes?: string;
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

interface ReadOnlyTimeCalendarProps {
  userId: string;
  employeeName: string;
  initialMonth?: Date;
  onBack: () => void;
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

const ReadOnlyTimeCalendar = ({ userId, employeeName, initialMonth, onBack }: ReadOnlyTimeCalendarProps) => {
  const [currentDate, setCurrentDate] = useState(initialMonth || new Date());
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [workSchedules, setWorkSchedules] = useState<WorkSchedule[]>([]);
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  useEffect(() => {
    loadMonthData();
  }, [currentDate, userId]);

  const loadMonthData = async () => {
    setLoading(true);
    try {
      const [entriesResult, absenceResult, schedulesResult, holidayMap] = await Promise.all([
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
        getHolidays(monthStart, monthEnd)
      ]);

      setTimeEntries(entriesResult.data || []);
      setAbsences(absenceResult.data || []);
      setWorkSchedules(schedulesResult.data || []);
      setHolidays(holidayMap);
    } catch (error) {
      console.error('Error loading month data:', error);
    } finally {
      setLoading(false);
    }
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

  const getEntriesForDate = (dateStr: string): TimeEntry[] => {
    return timeEntries.filter(e => e.date === dateStr);
  };

  const getDayInfo = (day: Date): { type: string; data?: any; entries: TimeEntry[]; hours: number; target: number; balance: number; holidayName?: string } => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayOfWeek = getDay(day);
    const dayEntries = getEntriesForDate(dateStr);

    // Weekend
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      if (dayEntries.length > 0) {
        const totalHours = dayEntries.reduce((sum, entry) => {
          return sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes);
        }, 0);
        const schedule = getScheduleForDate(day, dayOfWeek);
        const targetHoursForDay = schedule ? calculateTargetHours(schedule) : 0;
        return { type: 'entry', data: dayEntries[0], entries: dayEntries, hours: totalHours, target: targetHoursForDay, balance: totalHours - targetHoursForDay };
      }
      return { type: 'weekend', entries: [], hours: 0, target: 0, balance: 0 };
    }

    // Holiday
    const holidayName = holidays.get(dateStr);
    if (holidayName) {
      return { type: 'holiday', entries: [], hours: 0, target: 0, balance: 0, holidayName };
    }

    const schedule = getScheduleForDate(day, dayOfWeek);
    const target = schedule ? calculateTargetHours(schedule) : 0;

    // Absence
    const absence = absences.find(a => {
      const start = parseISO(a.start_date);
      const end = parseISO(a.end_date);
      return day >= start && day <= end;
    });

    if (absence) {
      // Bei halbem Urlaubstag: halbe SOLL-Stunden behalten
      if (absence.type === 'vacation' && absence.is_half_day) {
        const halfTarget = target / 2;
        const totalHours = dayEntries.reduce((sum, entry) => {
          return sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes);
        }, 0);
        return {
          type: 'half_vacation',
          data: absence,
          entries: dayEntries,
          hours: totalHours,
          target: halfTarget,
          balance: totalHours - halfTarget
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
      // Alle anderen Abwesenheiten: neutral (Urlaub, Krank, etc.)
      return { type: absence.type, data: absence, entries: [], hours: 0, target: 0, balance: 0 };
    }

    // Time entries
    if (dayEntries.length > 0) {
      const totalHours = dayEntries.reduce((sum, entry) => {
        return sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes);
      }, 0);
      return { type: 'entry', data: dayEntries[0], entries: dayEntries, hours: totalHours, target, balance: totalHours - target };
    }

    return { type: 'empty', entries: [], hours: 0, target, balance: -target };
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


  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const totalHours = timeEntries.reduce((sum, entry) => {
    return sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes);
  }, 0);

  const totalTarget = daysInMonth.reduce((sum, day) => {
    const dayInfo = getDayInfo(day);
    return sum + dayInfo.target;
  }, 0);

  const totalBalance = totalHours - totalTarget;

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück
          </Button>
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-96 w-full" />
      </Card>
    );
  }

  return (
    <Card className="p-2 sm:p-6 overflow-hidden w-full max-w-full">
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Zurück
          </Button>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">{employeeName}</h2>
            <p className="text-muted-foreground">{format(currentDate, 'MMMM yyyy', { locale: de })}</p>
          </div>
        </div>
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
                <>
                  <TableRow
                    key={day.toISOString()}
                    className={`
                      ${isToday ? 'bg-primary/5' : ''}
                      ${dayInfo.type === 'weekend' ? 'bg-muted/50' : ''}
                      ${dayInfo.type === 'holiday' ? 'bg-purple-50/50 dark:bg-purple-950/20' : ''}
                      ${dayInfo.type === 'vacation' ? 'bg-yellow-50/50 dark:bg-yellow-950/20' : ''}
                      ${dayInfo.type === 'half_vacation' ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}
                      ${dayInfo.type === 'sick' ? 'bg-red-50/50 dark:bg-red-950/20' : ''}
                      ${dayInfo.type === 'comp_time' ? 'bg-sky-50/50 dark:bg-sky-950/20' : ''}
                      ${dayInfo.type === 'vocational_school' ? 'bg-violet-50/50 dark:bg-violet-950/20' : ''}
                      ${dayInfo.type === 'unpaid_leave' ? 'bg-slate-50/50 dark:bg-slate-950/20' : ''}
                      ${dayInfo.type === 'entry' && dayInfo.balance > 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : ''}
                      ${dayInfo.type === 'entry' && dayInfo.balance < 0 ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}
                    `}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1">
                        {hasMultipleEntries && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0"
                            onClick={() => toggleDayExpanded(dateStr)}
                          >
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
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

                    {/* Zeiteinträge */}
                    {dayInfo.type === 'entry' && (
                      <>
                        <TableCell>
                          {hasMultipleEntries ? <span className="text-muted-foreground text-xs">Mehrere</span> : dayInfo.data.start_time.slice(0, 5)}
                        </TableCell>
                        <TableCell>
                          {hasMultipleEntries ? <span className="text-muted-foreground text-xs">Einträge</span> : dayInfo.data.end_time.slice(0, 5)}
                        </TableCell>
                        <TableCell>
                          {hasMultipleEntries
                            ? <span className="text-muted-foreground text-xs">{dayInfo.entries.reduce((sum, e) => sum + e.break_minutes, 0)} Min</span>
                            : `${dayInfo.data.break_minutes} Min`}
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
                          {!hasMultipleEntries && 'notes' in dayInfo.data ? (dayInfo.data.notes || '-') : '-'}
                        </TableCell>
                      </>
                    )}

                    {/* Urlaub */}
                    {dayInfo.type === 'vacation' && (
                      <>
                        <TableCell colSpan={3} className="text-center text-yellow-600 dark:text-yellow-400">
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
                      </>
                    )}

                    {/* Halber Urlaubstag */}
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
                      </>
                    )}

                    {/* Krank */}
                    {dayInfo.type === 'sick' && (
                      <>
                        <TableCell colSpan={3} className="text-center text-red-600 dark:text-red-400">
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
                      </>
                    )}

                    {/* Überstundenfrei (comp_time) - mit SOLL und SALDO */}
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
                      </>
                    )}

                    {/* Berufsschule */}
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
                      </>
                    )}

                    {/* Unbezahlter Urlaub */}
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
                      </>
                    )}

                    {/* Sonstiges */}
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
                      </>
                    )}

                    {/* Wochenende */}
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
                      </>
                    )}

                    {/* Feiertag */}
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
                      </>
                    )}

                    {/* Keine Erfassung (empty) - mit SOLL und SALDO */}
                    {dayInfo.type === 'empty' && (
                      <>
                        <TableCell colSpan={3} className="text-center text-muted-foreground">
                          Keine Erfassung
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">-</TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          {dayInfo.target > 0 ? formatHoursMinutes(dayInfo.target) : '-'}
                        </TableCell>
                        <TableCell className={`text-center ${dayInfo.target > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                          {dayInfo.target > 0 ? `-${formatHoursMinutes(dayInfo.target)}` : '-'}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                            Nicht erfasst
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">-</TableCell>
                      </>
                    )}
                  </TableRow>

                  {/* Expanded sub-rows */}
                  {isExpanded && dayInfo.entries.map((entry, idx) => (
                    <TableRow key={entry.id} className="bg-muted/30">
                      <TableCell className="pl-10 text-muted-foreground text-sm">
                        Block {idx + 1}
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell>{entry.start_time.slice(0, 5)}</TableCell>
                      <TableCell>{entry.end_time.slice(0, 5)}</TableCell>
                      <TableCell>{entry.break_minutes} Min</TableCell>
                      <TableCell className="font-semibold">
                        {formatHoursMinutes(calculateHours(entry.start_time, entry.end_time, entry.break_minutes))}
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{entry.notes || '-'}</TableCell>
                    </TableRow>
                  ))}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Monthly summary */}
      <div className="mt-4 flex flex-wrap gap-4 justify-end text-sm">
        <div className="bg-muted/50 rounded-lg px-4 py-2">
          <span className="text-muted-foreground">Gesamt IST:</span>{' '}
          <span className="font-semibold">{formatHoursMinutes(totalHours)}</span>
        </div>
        <div className="bg-muted/50 rounded-lg px-4 py-2">
          <span className="text-muted-foreground">Gesamt SOLL:</span>{' '}
          <span className="font-semibold">{formatHoursMinutes(totalTarget)}</span>
        </div>
        <div className={`rounded-lg px-4 py-2 ${totalBalance >= 0 ? 'bg-emerald-100 dark:bg-emerald-900' : 'bg-amber-100 dark:bg-amber-900'}`}>
          <span className="text-muted-foreground">Saldo:</span>{' '}
          <span className={`font-semibold ${totalBalance >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {totalBalance >= 0 ? '+' : ''}{formatHoursMinutes(totalBalance)}
          </span>
        </div>
      </div>
    </Card>
  );
};

export default ReadOnlyTimeCalendar;
