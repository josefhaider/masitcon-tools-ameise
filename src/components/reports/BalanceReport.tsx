"use client";

import { useState, useEffect } from 'react';
import { format, startOfYear } from 'date-fns';
import { de } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { calculateHoursBalance } from '@/lib/balance';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { CalendarIcon, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getHolidaySet } from '@/lib/holidays';
import { generateBalanceReportPDF, BalanceReportData } from '@/lib/pdfGenerator';

interface EmployeeBalanceData {
  userId: string;
  name: string;
  employeeNumber: string | null;
  targetHours: number;
  actualHours: number;
  corrections: number;
  balance: number;
  isExempt: boolean;
}

export default function BalanceReport() {
  const [cutoffDate, setCutoffDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<EmployeeBalanceData[]>([]);
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    loadBalanceData();
  }, [cutoffDate]);

  const loadBalanceData = async () => {
    setLoading(true);
    try {
      const year = cutoffDate.getFullYear();
      const yearStart = startOfYear(cutoffDate);

      // Lade alle Mitarbeiter (ohne archivierte)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, employee_number, time_tracking_exempt')
        .eq('is_archived', false)
        .order('full_name');

      if (!profiles) {
        setEmployees([]);
        return;
      }

      // Lade Feiertage für das Jahr
      const holidaysSet = await getHolidaySet(yearStart, cutoffDate);

      // Berechne für jeden Mitarbeiter
      const results = await Promise.all(
        profiles.map(async (profile) => {
          if (profile.time_tracking_exempt) {
            return {
              userId: profile.id,
              name: profile.full_name,
              employeeNumber: profile.employee_number,
              targetHours: 0,
              actualHours: 0,
              corrections: 0,
              balance: 0,
              isExempt: true,
            };
          }

          // Lade Arbeitszeitpläne
          const { data: schedules } = await supabase
            .from('employee_work_schedules')
            .select('*')
            .eq('user_id', profile.id);

          // Lade Zeiteinträge vom Jahresanfang bis Stichtag
          const { data: timeEntries } = await supabase
            .from('time_entries')
            .select('start_time, end_time, break_minutes')
            .eq('user_id', profile.id)
            .gte('date', format(yearStart, 'yyyy-MM-dd'))
            .lte('date', format(cutoffDate, 'yyyy-MM-dd'));

          // Lade genehmigte Abwesenheiten
          const { data: absences } = await supabase
            .from('absences')
            .select('start_date, end_date, type, is_half_day')
            .eq('user_id', profile.id)
            .eq('status', 'approved')
            .lte('start_date', format(cutoffDate, 'yyyy-MM-dd'))
            .gte('end_date', format(yearStart, 'yyyy-MM-dd'));

          // Lade Stundenkorrekturen
          const { data: corrections } = await supabase
            .from('balance_corrections')
            .select('hours_adjustment, correction_type, effective_date')
            .eq('user_id', profile.id)
            .eq('correction_type', 'hours')
            .lte('effective_date', format(cutoffDate, 'yyyy-MM-dd'));

          // Saldo über geteilte Funktion berechnen (Single Source of Truth)
          const result = calculateHoursBalance({
            schedules: schedules || [],
            timeEntries: timeEntries || [],
            absences: absences || [],
            corrections: corrections || [],
            rangeStart: yearStart,
            rangeEnd: cutoffDate,
            holidays: holidaysSet,
          });

          return {
            userId: profile.id,
            name: profile.full_name,
            employeeNumber: profile.employee_number,
            targetHours: result.targetHours,
            actualHours: result.actualHours,
            corrections: result.corrections,
            balance: result.balance,
            isExempt: false,
          };
        })
      );

      setEmployees(results);
    } catch (error) {
      console.error('Fehler beim Laden der Salden:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatHours = (hours: number) => {
    if (hours === 0) return '0h';
    const h = Math.floor(Math.abs(hours));
    const m = Math.round((Math.abs(hours) - h) * 60);
    const sign = hours < 0 ? '-' : hours > 0 ? '+' : '';
    if (m === 0) return `${sign}${h}h`;
    return `${sign}${h}h ${m}min`;
  };

  const formatHoursNoSign = (hours: number) => {
    if (hours === 0) return '0h';
    const h = Math.floor(Math.abs(hours));
    const m = Math.round((Math.abs(hours) - h) * 60);
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
  };

  const totals = employees.reduce(
    (acc, emp) => {
      if (emp.isExempt) return acc;
      return {
        targetHours: acc.targetHours + emp.targetHours,
        actualHours: acc.actualHours + emp.actualHours,
        corrections: acc.corrections + emp.corrections,
        balance: acc.balance + emp.balance,
      };
    },
    { targetHours: 0, actualHours: 0, corrections: 0, balance: 0 }
  );

  const handleExportPDF = () => {
    const data: BalanceReportData = {
      cutoffDate,
      employees: employees.map((emp) => ({
        name: emp.name,
        employeeNumber: emp.employeeNumber,
        targetHours: emp.targetHours,
        actualHours: emp.actualHours,
        corrections: emp.corrections,
        balance: emp.balance,
        isExempt: emp.isExempt,
      })),
    };
    generateBalanceReportPDF(data);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Stundensaldo zum Stichtag</h2>
          <p className="text-muted-foreground">
            Kumuliertes Stundensaldo aller Mitarbeiter vom Jahresbeginn bis zum gewählten Stichtag.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn('w-[200px] justify-start text-left font-normal')}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(cutoffDate, 'dd.MM.yyyy', { locale: de })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-background" align="end">
              <Calendar
                mode="single"
                selected={cutoffDate}
                onSelect={(date) => {
                  if (date) {
                    setCutoffDate(date);
                    setCalendarOpen(false);
                  }
                }}
                locale={de}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <Button onClick={handleExportPDF} disabled={loading || employees.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Salden zum {format(cutoffDate, 'dd. MMMM yyyy', { locale: de })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mitarbeiter</TableHead>
                    <TableHead className="text-center">P.Nr.</TableHead>
                    <TableHead className="text-right">SOLL</TableHead>
                    <TableHead className="text-right">IST</TableHead>
                    <TableHead className="text-right">Korr.</TableHead>
                    <TableHead className="text-right font-semibold">SALDO</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((emp) => (
                    <TableRow key={emp.userId}>
                      <TableCell className="font-medium">{emp.name}</TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {emp.employeeNumber || '–'}
                      </TableCell>
                      <TableCell className="text-right">
                        {emp.isExempt ? '–' : formatHoursNoSign(emp.targetHours)}
                      </TableCell>
                      <TableCell className="text-right">
                        {emp.isExempt ? '–' : formatHoursNoSign(emp.actualHours)}
                      </TableCell>
                      <TableCell className="text-right">
                        {emp.isExempt ? '–' : emp.corrections !== 0 ? formatHours(emp.corrections) : '–'}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-semibold',
                          !emp.isExempt && emp.balance > 0 && 'text-green-600 dark:text-green-400',
                          !emp.isExempt && emp.balance < 0 && 'text-red-600 dark:text-red-400'
                        )}
                      >
                        {emp.isExempt ? '–' : formatHours(emp.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-bold">GESAMT ({employees.filter((e) => !e.isExempt).length} MA)</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-bold">{formatHoursNoSign(totals.targetHours)}</TableCell>
                    <TableCell className="text-right font-bold">{formatHoursNoSign(totals.actualHours)}</TableCell>
                    <TableCell className="text-right font-bold">
                      {totals.corrections !== 0 ? formatHours(totals.corrections) : '–'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-bold',
                        totals.balance > 0 && 'text-green-600 dark:text-green-400',
                        totals.balance < 0 && 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {formatHours(totals.balance)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
