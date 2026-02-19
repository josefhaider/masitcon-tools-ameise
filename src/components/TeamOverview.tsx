import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend, isBefore, isAfter } from 'date-fns';
import { de } from 'date-fns/locale';
import { FileDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { generateTeamOverviewPDF, TeamOverviewReportData } from '@/lib/pdfGenerator';
import { getHolidaysForYear } from '@/lib/holidays';
import ReadOnlyTimeCalendar from './ReadOnlyTimeCalendar';

interface TeamEmployeeData {
  userId: string;
  fullName: string;
  employeeNumber: string | null;
  targetHours: number;
  actualHours: number;
  balance: number;
  cumulativeBalance: number; // Year-to-date balance
  vacationUsed: number;
  vacationPlanned: number;
  vacationTotal: number;
  timeTrackingExempt: boolean;
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

/**
 * Gibt die relevanteste Abwesenheit für ein bestimmtes Datum zurück.
 * Priorisierung: comp_time > halber Urlaub > andere Abwesenheiten
 */
const getPrioritizedAbsence = (day: Date, absences: any[]): any | null => {
  // String-Vergleich für zeitzonen-unabhängige Prüfung
  const dayStr = format(day, 'yyyy-MM-dd');
  const matchingAbsences = absences.filter(a => 
    dayStr >= a.start_date && dayStr <= a.end_date
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

export const TeamOverview = () => {
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [employees, setEmployees] = useState<TeamEmployeeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    loadTeamData(selectedMonth, selectedYear);
  }, [selectedMonth, selectedYear]);

  const loadTeamData = async (month: number, year: number) => {
    setLoading(true);
    try {
      // Get all employees (excluding archived)
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, employee_number, annual_vacation_days, time_tracking_exempt')
        .eq('is_archived', false)
        .order('full_name');

      if (profilesError) throw profilesError;

      const monthStart = startOfMonth(new Date(year, month - 1));
      const monthEnd = endOfMonth(new Date(year, month - 1));
      const today = new Date();
      const isCurrentMonth = month === today.getMonth() + 1 && year === today.getFullYear();
      const effectiveEndDate = isCurrentMonth && today < monthEnd ? today : monthEnd;

      const monthStartStr = format(monthStart, 'yyyy-MM-dd');
      const monthEndStr = format(monthEnd, 'yyyy-MM-dd');
      const effectiveEndStr = format(effectiveEndDate, 'yyyy-MM-dd');

      // For cumulative YTD calculation: from Jan 1st to today
      const yearStart = new Date(year, 0, 1);
      const ytdEnd = today.getFullYear() === year ? today : new Date(year, 11, 31);
      const yearStartStr = format(yearStart, 'yyyy-MM-dd');
      const ytdEndStr = format(ytdEnd, 'yyyy-MM-dd');

      // Get holidays for the year
      const holidays = await getHolidaysForYear(year);
      const holidayDates = new Set(holidays.map(h => h.date));

      // Get work schedules for all users
      const { data: allSchedules } = await supabase
        .from('employee_work_schedules')
        .select('*')
        .eq('is_active', true);

      // Get time entries for the selected month only
      const { data: allTimeEntries } = await supabase
        .from('time_entries')
        .select('*')
        .gte('date', monthStartStr)
        .lte('date', effectiveEndStr);

      // Get time entries for YTD calculation (Jan 1st to today)
      const { data: allYtdTimeEntries } = await supabase
        .from('time_entries')
        .select('*')
        .gte('date', yearStartStr)
        .lte('date', ytdEndStr);

      // Get absences for the selected month
      const { data: allAbsences } = await supabase
        .from('absences')
        .select('*')
        .eq('status', 'approved')
        .or(`start_date.lte.${monthEndStr},end_date.gte.${monthStartStr}`);

      // Get absences for YTD calculation (using AND for correct overlap detection)
      const { data: allYtdAbsences } = await supabase
        .from('absences')
        .select('*')
        .eq('status', 'approved')
        .lte('start_date', ytdEndStr)
        .gte('end_date', yearStartStr);

      // Get ALL absences for the full year (approved) - for vacation yearly calculation
      const yearEndStr = format(new Date(year, 11, 31), 'yyyy-MM-dd');
      const { data: allYearAbsences } = await supabase
        .from('absences')
        .select('*')
        .eq('status', 'approved')
        .lte('start_date', yearEndStr)
        .gte('end_date', yearStartStr);

      // Get pending vacation requests for the full year (count as "planned")
      const { data: allPendingVacations } = await supabase
        .from('absences')
        .select('*')
        .eq('status', 'pending')
        .eq('type', 'vacation')
        .lte('start_date', yearEndStr)
        .gte('end_date', yearStartStr);

      // Get balance corrections up to end of month (for hours correction context)
      const { data: allCorrections } = await supabase
        .from('balance_corrections')
        .select('*')
        .lte('effective_date', effectiveEndStr);

      const employeeData: TeamEmployeeData[] = [];

      for (const profile of profiles || []) {
        const userSchedules = allSchedules?.filter(s => s.user_id === profile.id) || [];
        const userTimeEntries = allTimeEntries?.filter(t => t.user_id === profile.id) || [];
        const userYtdTimeEntries = allYtdTimeEntries?.filter(t => t.user_id === profile.id) || [];
        const userAbsences = allAbsences?.filter(a => a.user_id === profile.id) || [];
        const userYtdAbsences = allYtdAbsences?.filter(a => a.user_id === profile.id) || [];
        const userYearAbsences = allYearAbsences?.filter(a => a.user_id === profile.id) || [];
        const userPendingVacations = allPendingVacations?.filter(a => a.user_id === profile.id) || [];
        const userCorrections = allCorrections?.filter(c => c.user_id === profile.id) || [];

        // Calculate vacation days correction for the target year only
        const vacationCorrection = userCorrections
          .filter(c => c.correction_type === 'vacation' && c.applies_to_year === year)
          .reduce((sum, c) => sum + (c.vacation_days_adjustment || 0), 0);

        // Calculate hours correction for YTD balance
        const hoursCorrection = userCorrections
          .filter(c => c.correction_type === 'hours' && new Date(c.effective_date) <= ytdEnd)
          .reduce((sum, c) => sum + (c.hours_adjustment || 0), 0);

        // Calculate target hours for the selected month only
        let targetHours = 0;
        const daysToCheck = eachDayOfInterval({ start: monthStart, end: effectiveEndDate });
        
        for (const day of daysToCheck) {
          if (isWeekend(day)) continue;
          
          const dayStr = format(day, 'yyyy-MM-dd');
          if (holidayDates.has(dayStr)) continue;

          // Check if day is covered by approved absence (mit Priorisierung)
          const absenceOnDay = getPrioritizedAbsence(day, userAbsences);
          
          // Bei halbem Urlaubstag: nur halbe SOLL-Stunden neutralisieren
          if (absenceOnDay && absenceOnDay.type === 'vacation' && absenceOnDay.is_half_day) {
            // Finde Schedule um halbe SOLL-Stunden zu berechnen
            const dayOfWeek = day.getDay();
            const schedule = userSchedules.find(s => {
              if (s.day_of_week !== dayOfWeek) return false;
              const validFrom = new Date(s.valid_from);
              const validTo = s.valid_to ? new Date(s.valid_to) : null;
              return !isBefore(day, validFrom) && (!validTo || !isAfter(day, validTo));
            });
            if (schedule) {
              const startParts = schedule.start_time.split(':').map(Number);
              const endParts = schedule.end_time.split(':').map(Number);
              const startMinutes = startParts[0] * 60 + startParts[1];
              const endMinutes = endParts[0] * 60 + endParts[1];
              const workMinutes = endMinutes - startMinutes - schedule.break_minutes;
              // Nur halbe SOLL-Stunden hinzufügen
              targetHours += (workMinutes / 60) / 2;
            }
            continue;
          }
          
          // Bei Überstundenfrei (comp_time): SOLL-Stunden beibehalten
          // Alle anderen Abwesenheiten: SOLL-Stunden auf 0
          if (absenceOnDay && absenceOnDay.type !== 'comp_time') continue;

          // Find applicable schedule for this day
          const dayOfWeek = day.getDay();
          const schedule = userSchedules.find(s => {
            if (s.day_of_week !== dayOfWeek) return false;
            const validFrom = new Date(s.valid_from);
            const validTo = s.valid_to ? new Date(s.valid_to) : null;
            return !isBefore(day, validFrom) && (!validTo || !isAfter(day, validTo));
          });

          if (schedule) {
            const startParts = schedule.start_time.split(':').map(Number);
            const endParts = schedule.end_time.split(':').map(Number);
            const startMinutes = startParts[0] * 60 + startParts[1];
            const endMinutes = endParts[0] * 60 + endParts[1];
            const workMinutes = endMinutes - startMinutes - schedule.break_minutes;
            targetHours += workMinutes / 60;
          }
        }

        // Calculate actual hours from time entries (for selected month only)
        let actualHours = 0;
        for (const entry of userTimeEntries) {
          const startParts = entry.start_time.split(':').map(Number);
          const endParts = entry.end_time.split(':').map(Number);
          const startMinutes = startParts[0] * 60 + startParts[1];
          const endMinutes = endParts[0] * 60 + endParts[1];
          const workMinutes = endMinutes - startMinutes - entry.break_minutes;
          actualHours += workMinutes / 60;
        }

        // Calculate vacation days for the FULL YEAR (not just the month)
        const todayStr = format(today, 'yyyy-MM-dd');
        let vacationUsed = 0;
        let vacationPlanned = 0;

        // Count approved vacations for the year
        for (const absence of userYearAbsences) {
          if (absence.type !== 'vacation') continue;

          // Clip to year boundaries
          const absStartStr = absence.start_date < yearStartStr ? yearStartStr : absence.start_date;
          const absEndStr = absence.end_date > yearEndStr ? yearEndStr : absence.end_date;

          if (absStartStr > absEndStr) continue;

          const absStart = new Date(absStartStr);
          const absEnd = new Date(absEndStr);
          const absenceDays = eachDayOfInterval({ start: absStart, end: absEnd });

          for (const day of absenceDays) {
            if (isWeekend(day)) continue;
            const dayStr = format(day, 'yyyy-MM-dd');
            if (holidayDates.has(dayStr)) continue;

            // Half-day vacation counts as 0.5
            const dayValue = absence.is_half_day ? 0.5 : 1;

            if (dayStr <= todayStr) {
              vacationUsed += dayValue;
            } else {
              vacationPlanned += dayValue;
            }
          }
        }

        // Count pending vacation requests as "planned"
        for (const absence of userPendingVacations) {
          const absStartStr = absence.start_date < yearStartStr ? yearStartStr : absence.start_date;
          const absEndStr = absence.end_date > yearEndStr ? yearEndStr : absence.end_date;

          if (absStartStr > absEndStr) continue;

          const absStart = new Date(absStartStr);
          const absEnd = new Date(absEndStr);
          const absenceDays = eachDayOfInterval({ start: absStart, end: absEnd });

          for (const day of absenceDays) {
            if (isWeekend(day)) continue;
            const dayStr = format(day, 'yyyy-MM-dd');
            if (holidayDates.has(dayStr)) continue;

            const dayValue = absence.is_half_day ? 0.5 : 1;
            vacationPlanned += dayValue;
          }
        }

        const balance = actualHours - targetHours;
        const vacationTotal = (profile.annual_vacation_days || 30) + vacationCorrection;

        // Calculate cumulative YTD hours
        let ytdTargetHours = 0;
        const ytdDaysToCheck = eachDayOfInterval({ start: yearStart, end: ytdEnd });
        
        for (const day of ytdDaysToCheck) {
          if (isWeekend(day)) continue;
          
          const dayStr = format(day, 'yyyy-MM-dd');
          if (holidayDates.has(dayStr)) continue;

          // Check if day is covered by approved absence (mit Priorisierung)
          const absenceOnDay = getPrioritizedAbsence(day, userYtdAbsences);
          
          // Bei halbem Urlaubstag: nur halbe SOLL-Stunden neutralisieren
          if (absenceOnDay && absenceOnDay.type === 'vacation' && absenceOnDay.is_half_day) {
            const dayOfWeek = day.getDay();
            const schedule = userSchedules.find(s => {
              if (s.day_of_week !== dayOfWeek) return false;
              const validFrom = new Date(s.valid_from);
              const validTo = s.valid_to ? new Date(s.valid_to) : null;
              return !isBefore(day, validFrom) && (!validTo || !isAfter(day, validTo));
            });
            if (schedule) {
              const startParts = schedule.start_time.split(':').map(Number);
              const endParts = schedule.end_time.split(':').map(Number);
              const startMinutes = startParts[0] * 60 + startParts[1];
              const endMinutes = endParts[0] * 60 + endParts[1];
              const workMinutes = endMinutes - startMinutes - schedule.break_minutes;
              ytdTargetHours += (workMinutes / 60) / 2;
            }
            continue;
          }
          
          // Bei Überstundenfrei (comp_time): SOLL-Stunden beibehalten
          if (absenceOnDay && absenceOnDay.type !== 'comp_time') continue;

          // Find applicable schedule for this day
          const dayOfWeek = day.getDay();
          const schedule = userSchedules.find(s => {
            if (s.day_of_week !== dayOfWeek) return false;
            const validFrom = new Date(s.valid_from);
            const validTo = s.valid_to ? new Date(s.valid_to) : null;
            return !isBefore(day, validFrom) && (!validTo || !isAfter(day, validTo));
          });

          if (schedule) {
            const startParts = schedule.start_time.split(':').map(Number);
            const endParts = schedule.end_time.split(':').map(Number);
            const startMinutes = startParts[0] * 60 + startParts[1];
            const endMinutes = endParts[0] * 60 + endParts[1];
            const workMinutes = endMinutes - startMinutes - schedule.break_minutes;
            ytdTargetHours += workMinutes / 60;
          }
        }

        // Calculate YTD actual hours
        let ytdActualHours = 0;
        for (const entry of userYtdTimeEntries) {
          const startParts = entry.start_time.split(':').map(Number);
          const endParts = entry.end_time.split(':').map(Number);
          const startMinutes = startParts[0] * 60 + startParts[1];
          const endMinutes = endParts[0] * 60 + endParts[1];
          const workMinutes = endMinutes - startMinutes - entry.break_minutes;
          ytdActualHours += workMinutes / 60;
        }

        const cumulativeBalance = ytdActualHours - ytdTargetHours + hoursCorrection;

        employeeData.push({
          userId: profile.id,
          fullName: profile.full_name,
          employeeNumber: profile.employee_number,
          targetHours,
          actualHours,
          balance,
          cumulativeBalance,
          vacationUsed,
          vacationPlanned,
          vacationTotal,
          timeTrackingExempt: profile.time_tracking_exempt || false
        });
      }

      setEmployees(employeeData);
    } catch (error) {
      console.error('Error loading team data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = () => {
    const reportData: TeamOverviewReportData = {
      referenceDate: new Date(selectedYear, selectedMonth - 1),
      employees: employees.map(emp => ({
        name: emp.fullName,
        employeeNumber: emp.employeeNumber,
        targetHours: emp.targetHours,
        actualHours: emp.actualHours,
        balance: emp.balance,
        vacationUsed: emp.vacationUsed,
        vacationPlanned: emp.vacationPlanned,
        vacationRemaining: emp.vacationTotal - emp.vacationUsed - emp.vacationPlanned
      }))
    };
    generateTeamOverviewPDF(reportData);
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
  ];

  const handleEmployeeClick = (userId: string, fullName: string) => {
    setSelectedEmployee({ id: userId, name: fullName });
  };

  // Show read-only calendar if employee is selected
  if (selectedEmployee) {
    return (
      <ReadOnlyTimeCalendar
        userId={selectedEmployee.id}
        employeeName={selectedEmployee.name}
        initialMonth={new Date(selectedYear, selectedMonth - 1)}
        onBack={() => setSelectedEmployee(null)}
      />
    );
  }

  // Calculate totals
  const totals = employees.reduce(
    (acc, emp) => ({
      targetHours: acc.targetHours + emp.targetHours,
      actualHours: acc.actualHours + emp.actualHours,
      balance: acc.balance + emp.balance,
      cumulativeBalance: acc.cumulativeBalance + (emp.timeTrackingExempt ? 0 : emp.cumulativeBalance),
      vacationUsed: acc.vacationUsed + emp.vacationUsed,
      vacationPlanned: acc.vacationPlanned + emp.vacationPlanned
    }),
    { targetHours: 0, actualHours: 0, balance: 0, cumulativeBalance: 0, vacationUsed: 0, vacationPlanned: 0 }
  );

  const todayFormatted = format(new Date(), 'dd.MM.yyyy');

  const monthName = format(new Date(selectedYear, selectedMonth - 1), 'MMMM yyyy', { locale: de });

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <CardTitle>Team-Übersicht</CardTitle>
            <CardDescription>
              Monat: {monthName}
            </CardDescription>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Jahr:</span>
              <Select
                value={selectedYear.toString()}
                onValueChange={(val) => setSelectedYear(parseInt(val, 10))}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Monat:</span>
              <Select
                value={selectedMonth.toString()}
                onValueChange={(val) => setSelectedMonth(parseInt(val, 10))}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month, idx) => (
                    <SelectItem key={idx} value={(idx + 1).toString()}>{month}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleExportPDF}>
              <FileDown className="mr-2 h-4 w-4" />
              PDF exportieren
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mitarbeiter</TableHead>
                <TableHead className="text-right">SOLL</TableHead>
                <TableHead className="text-right">IST</TableHead>
                <TableHead className="text-right">Saldo (Monat)</TableHead>
                <TableHead className="text-right">
                  Saldo (bis {todayFormatted})
                </TableHead>
                <TableHead className="text-right">Urlaub genommen</TableHead>
                <TableHead className="text-right">Urlaub geplant</TableHead>
                <TableHead className="text-right">Urlaub Rest (Jahr)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map(emp => {
                const vacationRemaining = emp.vacationTotal - emp.vacationUsed - emp.vacationPlanned;
                return (
                  <TableRow key={emp.userId}>
                    <TableCell className="max-w-[250px]">
                      <button
                        onClick={() => handleEmployeeClick(emp.userId, emp.fullName)}
                        className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded text-left truncate block max-w-full"
                        title={emp.fullName}
                      >
                        {emp.fullName}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      {emp.timeTrackingExempt ? <span className="text-muted-foreground">–</span> : formatHoursMinutes(emp.targetHours)}
                    </TableCell>
                    <TableCell className="text-right">
                      {emp.timeTrackingExempt ? <span className="text-muted-foreground">–</span> : formatHoursMinutes(emp.actualHours)}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right font-medium",
                      emp.timeTrackingExempt ? "text-muted-foreground" : emp.balance < 0 ? "text-destructive" : "text-green-600"
                    )}>
                      {emp.timeTrackingExempt ? '–' : `${emp.balance > 0 ? '+' : ''}${formatHoursMinutes(emp.balance)}`}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right font-medium",
                      emp.timeTrackingExempt ? "text-muted-foreground" : emp.cumulativeBalance < 0 ? "text-destructive" : "text-green-600"
                    )}>
                      {emp.timeTrackingExempt ? '–' : `${emp.cumulativeBalance > 0 ? '+' : ''}${formatHoursMinutes(emp.cumulativeBalance)}`}
                    </TableCell>
                    <TableCell className="text-right">{emp.vacationUsed} Tage</TableCell>
                    <TableCell className="text-right">{emp.vacationPlanned} Tage</TableCell>
                    <TableCell className={cn(
                      "text-right font-medium",
                      vacationRemaining < 0 ? "text-destructive" : ""
                    )}>
                      {vacationRemaining} Tage
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold">GESAMT ({employees.length} Mitarbeiter)</TableCell>
                <TableCell className="text-right font-bold">{formatHoursMinutes(totals.targetHours)}</TableCell>
                <TableCell className="text-right font-bold">{formatHoursMinutes(totals.actualHours)}</TableCell>
                <TableCell className={cn(
                  "text-right font-bold",
                  totals.balance < 0 ? "text-destructive" : "text-green-600"
                )}>
                  {totals.balance > 0 ? '+' : ''}{formatHoursMinutes(totals.balance)}
                </TableCell>
                <TableCell className={cn(
                  "text-right font-bold",
                  totals.cumulativeBalance < 0 ? "text-destructive" : "text-green-600"
                )}>
                  {totals.cumulativeBalance > 0 ? '+' : ''}{formatHoursMinutes(totals.cumulativeBalance)}
                </TableCell>
                <TableCell className="text-right font-bold">{totals.vacationUsed} Tage</TableCell>
                <TableCell className="text-right font-bold">{totals.vacationPlanned} Tage</TableCell>
                <TableCell className="text-right">-</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
