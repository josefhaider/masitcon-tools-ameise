import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { FileText, Download, Loader2 } from 'lucide-react';
import { generateMonthlyHoursReportPDF, MonthlyHoursReportData, TimeEntryReportData } from '@/lib/pdfGenerator';
import { getHolidays } from '@/lib/holidays';
import { getBalanceCorrections } from '@/lib/targetHoursCalculator';

interface Employee {
  id: string;
  full_name: string;
  employee_number: string | null;
}

interface MonthlyHoursReportProps {
  isAdmin?: boolean;
}

export default function MonthlyHoursReport({ isAdmin = false }: MonthlyHoursReportProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [employees, setEmployees] = useState<Employee[]>([]);

  const months = [
    { value: 1, label: 'Januar' },
    { value: 2, label: 'Februar' },
    { value: 3, label: 'März' },
    { value: 4, label: 'April' },
    { value: 5, label: 'Mai' },
    { value: 6, label: 'Juni' },
    { value: 7, label: 'Juli' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'Oktober' },
    { value: 11, label: 'November' },
    { value: 12, label: 'Dezember' },
  ];

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  useEffect(() => {
    if (isAdmin) {
      loadEmployees();
    } else if (user) {
      setSelectedEmployee(user.id);
    }
  }, [isAdmin, user]);

  const loadEmployees = async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, employee_number')
        .eq('is_archived', false)
        .order('full_name');
      
      setEmployees(data || []);
      if (data && data.length > 0 && !selectedEmployee) {
        setSelectedEmployee(data[0].id);
      }
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  const handleGeneratePDF = async () => {
    if (!selectedEmployee) {
      toast.error('Bitte wählen Sie einen Mitarbeiter aus');
      return;
    }

    setGenerating(true);
    try {
      // Load employee profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, employee_number')
        .eq('id', selectedEmployee)
        .maybeSingle();

      if (!profile) {
        throw new Error('Mitarbeiter nicht gefunden');
      }

      // Calculate date range
      const monthStart = startOfMonth(new Date(selectedYear, selectedMonth - 1));
      const monthEnd = endOfMonth(new Date(selectedYear, selectedMonth - 1));
      const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

      // Load all data in parallel
      const [timeEntriesResult, absencesResult, schedulesResult, holidayMap] = await Promise.all([
        supabase
          .from('time_entries')
          .select('*')
          .eq('user_id', selectedEmployee)
          .gte('date', format(monthStart, 'yyyy-MM-dd'))
          .lte('date', format(monthEnd, 'yyyy-MM-dd')),
        supabase
          .from('absences')
          .select('*')
          .eq('user_id', selectedEmployee)
          .or(`start_date.lte.${format(monthEnd, 'yyyy-MM-dd')},end_date.gte.${format(monthStart, 'yyyy-MM-dd')}`),
        supabase
          .from('employee_work_schedules')
          .select('*')
          .eq('user_id', selectedEmployee),
        getHolidays(monthStart, monthEnd),
        getBalanceCorrections(selectedEmployee, 'hours', monthStart)
      ]);

      const timeEntries = timeEntriesResult.data || [];
      const absences = absencesResult.data || [];
      const schedules = schedulesResult.data || [];

      // Get previous balance (already fetched above)
      const previousBalance = await getBalanceCorrections(selectedEmployee, 'hours', monthStart);

      // Build entries for each day
      const entries: TimeEntryReportData[] = [];
      let totalActualHours = 0;
      let totalTargetHours = 0;
      let workDays = 0;
      let vacationDays = 0;
      let sickDays = 0;
      let holidayDays = 0;

      for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayOfWeek = getDay(day);
        const weekDayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

        // Check for weekend
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          entries.push({
            date: format(day, 'dd.MM.'),
            weekday: weekDayNames[dayOfWeek],
            timeRange: '',
            breakMinutes: 0,
            actualHours: 0,
            targetHours: 0,
            type: 'weekend'
          });
          continue;
        }

        // Check for holiday
        const holidayName = holidayMap.get(dateStr);
        if (holidayName) {
          holidayDays++;
          entries.push({
            date: format(day, 'dd.MM.'),
            weekday: weekDayNames[dayOfWeek],
            timeRange: '',
            breakMinutes: 0,
            actualHours: 0,
            targetHours: 0,
            type: 'holiday',
            notes: holidayName
          });
          continue;
        }

        // Check for absence
        const absence = absences.find(a => {
          const start = parseISO(a.start_date);
          const end = parseISO(a.end_date);
          return day >= start && day <= end;
        });

        if (absence) {
          if (absence.type === 'vacation') vacationDays += (absence as any).is_half_day ? 0.5 : 1;
          if (absence.type === 'sick') sickDays++;
          
          // Bei halbem Urlaubstag: halbe SOLL-Stunden + mögliche Zeiteinträge anzeigen
          if ((absence as any).is_half_day) {
            const schedule = schedules.find(s => {
              if (s.day_of_week !== dayOfWeek) return false;
              const validFrom = s.valid_from;
              const validTo = s.valid_to || '9999-12-31';
              return dateStr >= validFrom && dateStr <= validTo;
            });
            const halfTargetHours = schedule ? calculateHoursFromSchedule(schedule.start_time, schedule.end_time, schedule.break_minutes) / 2 : 0;
            
            const dayEntries = timeEntries.filter(e => e.date === dateStr);
            const totalHours = dayEntries.reduce((sum, entry) => 
              sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes), 0
            );
            totalActualHours += totalHours;
            totalTargetHours += halfTargetHours;
            entries.push({
              date: format(day, 'dd.MM.'),
              weekday: weekDayNames[dayOfWeek],
              timeRange: dayEntries.length > 0 ? dayEntries.map(e => `${e.start_time.slice(0, 5)}-${e.end_time.slice(0, 5)}`).join(', ') : '',
              breakMinutes: dayEntries.reduce((sum, e) => sum + e.break_minutes, 0),
              actualHours: totalHours,
              targetHours: halfTargetHours,
              type: 'vacation' as const,
              notes: 'Halber Urlaubstag'
            });
            continue;
          }
          
          // Bei Überstundenfrei (comp_time): SOLL-Stunden beibehalten, IST = 0
          if (absence.type === 'comp_time') {
            const schedule = schedules.find(s => {
              if (s.day_of_week !== dayOfWeek) return false;
              const validFrom = s.valid_from;
              const validTo = s.valid_to || '9999-12-31';
              return dateStr >= validFrom && dateStr <= validTo;
            });
            const targetHours = schedule ? calculateHoursFromSchedule(schedule.start_time, schedule.end_time, schedule.break_minutes) : 0;
            totalTargetHours += targetHours;
            // IST bleibt 0 → Saldo wird negativ (reduziert Überstundenkonto)
            entries.push({
              date: format(day, 'dd.MM.'),
              weekday: weekDayNames[dayOfWeek],
              timeRange: '',
              breakMinutes: 0,
              actualHours: 0,
              targetHours,
              type: 'vacation' as const,
              notes: 'Überstundenfrei'
            });
            continue;
          }
          
          entries.push({
            date: format(day, 'dd.MM.'),
            weekday: weekDayNames[dayOfWeek],
            timeRange: '',
            breakMinutes: 0,
            actualHours: 0,
            targetHours: 0,
            type: absence.type as 'vacation' | 'sick'
          });
          continue;
        }

        // Get schedule for this day
        const schedule = schedules.find(s => {
          if (s.day_of_week !== dayOfWeek) return false;
          const validFrom = s.valid_from;
          const validTo = s.valid_to || '9999-12-31';
          return dateStr >= validFrom && dateStr <= validTo;
        });

        const targetHours = schedule ? calculateHoursFromSchedule(schedule.start_time, schedule.end_time, schedule.break_minutes) : 0;
        totalTargetHours += targetHours;

        // Get ALL time entries for this day (including split times)
        const dayEntries = timeEntries.filter(e => e.date === dateStr);

        if (dayEntries.length > 0) {
          // Sort entries by start time
          const sortedEntries = [...dayEntries].sort((a, b) => 
            a.start_time.localeCompare(b.start_time)
          );
          
          // Sum all hours and breaks
          const totalDayHours = dayEntries.reduce((sum, entry) => 
            sum + calculateHours(entry.start_time, entry.end_time, entry.break_minutes), 0
          );
          const totalBreakMinutes = dayEntries.reduce((sum, e) => sum + e.break_minutes, 0);
          
          // Create combined time range: "08:00-12:00, 14:00-17:00"
          const timeRange = sortedEntries.map(e => 
            `${e.start_time.slice(0, 5)}-${e.end_time.slice(0, 5)}`
          ).join(', ');
          
          // Combine all notes
          const allNotes = dayEntries.map(e => e.notes).filter(Boolean).join('; ');
          
          totalActualHours += totalDayHours;
          workDays++;
          
          entries.push({
            date: format(day, 'dd.MM.'),
            weekday: weekDayNames[dayOfWeek],
            timeRange,
            breakMinutes: totalBreakMinutes,
            actualHours: totalDayHours,
            targetHours,
            type: 'work',
            notes: allNotes || undefined
          });
        } else {
          entries.push({
            date: format(day, 'dd.MM.'),
            weekday: weekDayNames[dayOfWeek],
            timeRange: '',
            breakMinutes: 0,
            actualHours: 0,
            targetHours,
            type: 'work'
          });
        }
      }

      const monthBalance = totalActualHours - totalTargetHours;
      const monthName = months.find(m => m.value === selectedMonth)?.label || '';

      const reportData: MonthlyHoursReportData = {
        employeeName: profile.full_name,
        employeeNumber: profile.employee_number,
        month: monthName,
        year: selectedYear,
        entries,
        summary: {
          workDays,
          vacationDays,
          sickDays,
          holidayDays,
          targetHours: totalTargetHours,
          actualHours: totalActualHours,
          monthBalance,
          totalBalance: previousBalance + monthBalance
        }
      };

      generateMonthlyHoursReportPDF(reportData);
      toast.success('PDF wurde erstellt und heruntergeladen');
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Fehler beim Erstellen des PDFs');
    } finally {
      setGenerating(false);
    }
  };

  const calculateHours = (startTime: string, endTime: string, breakMinutes: number): number => {
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    return (totalMinutes - breakMinutes) / 60;
  };

  const calculateHoursFromSchedule = (startTime: string, endTime: string, breakMinutes: number): number => {
    return calculateHours(startTime, endTime, breakMinutes);
  };

  const monthLabel = months.find(m => m.value === selectedMonth)?.label || '';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Stundennachweis herunterladen
          </CardTitle>
          <CardDescription>
            Erstellen Sie einen detaillierten Stundennachweis als PDF-Dokument.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            {isAdmin && (
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Mitarbeiter wählen" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map(m => (
                  <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button 
              onClick={handleGeneratePDF} 
              disabled={generating || !selectedEmployee}
            >
              {generating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              PDF herunterladen
            </Button>
          </div>

          <div className="mt-6 p-4 bg-muted/30 rounded-lg">
            <h4 className="font-medium mb-2">Der Stundennachweis enthält:</h4>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
              <li>Tägliche Zeiteinträge inkl. Splitterzeiten (kombinierte Zeiträume)</li>
              <li>Ist- und Soll-Stunden pro Tag</li>
              <li>Markierung von Urlaub, Krankheit und Feiertagen</li>
              <li>Zusammenfassung mit Monatssaldo und Gesamtsaldo</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
