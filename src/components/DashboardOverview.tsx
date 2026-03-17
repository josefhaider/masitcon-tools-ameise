"use client";

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TimeKPICard } from './TimeKPICard';
import { HoursComparisonChart } from './HoursComparisonChart';
import { MiniMonthCalendar } from './MiniMonthCalendar';
import { YearlyOverview } from './YearlyOverview';
import { TodayTimeCard } from './TodayTimeCard';
import { calculateMonthlyHours, calculateMultipleMonths, getBalanceCorrections, getVacationCorrectionsByYear, calculateYtdBalance } from '@/lib/targetHoursCalculator';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/contexts/profile-context';
import { Clock, CheckCircle, Scale, Plane, AlertCircle, ChevronLeft, ChevronRight, Palmtree, TrendingUp, Thermometer, Settings } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { getHolidaySet } from '@/lib/holidays';
import { calculateWorkDaysWithHolidays, fetchHolidaysForRange } from '@/lib/workDaysCalculator';
// Formatiert Dezimalstunden als "Xh Ymin" (Minuten nur wenn > 0)
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

interface DashboardOverviewProps {
  userId?: string;
  isAdminView?: boolean;
  onNavigate: (view: string) => void;
}

interface TotalBalance {
  totalHours: number;
  calculatedHours: number;
  corrections: number;
}

interface VacationBalance {
  annual: number;
  corrections: number;
  used: number;
  remaining: number;
}

export const DashboardOverview = ({ userId: propUserId, isAdminView = false, onNavigate }: DashboardOverviewProps) => {
  const { userId: profileUserId } = useProfile();
  const userId = propUserId || profileUserId;
  const [currentMonthData, setCurrentMonthData] = useState({
    targetHours: 0,
    actualHours: 0,
    balance: 0,
    workDays: 0,
    absenceDays: 0
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [dayStatuses, setDayStatuses] = useState<any[]>([]);
  const [upcomingVacation, setUpcomingVacation] = useState<any>(null);
  const [missingDays, setMissingDays] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');
  const [yearlyData, setYearlyData] = useState<any[]>([]);
  
  // New state for total balances
  const [totalHoursBalance, setTotalHoursBalance] = useState<TotalBalance>({ totalHours: 0, calculatedHours: 0, corrections: 0 });
  const [vacationBalance, setVacationBalance] = useState<VacationBalance>({ annual: 30, corrections: 0, used: 0, remaining: 30 });
  const [timeTrackingExempt, setTimeTrackingExempt] = useState(false);

  useEffect(() => {
    loadDashboardData();
    loadTotalBalances();
  }, [userId, selectedMonth, selectedYear, viewMode]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      if (viewMode === 'month') {
        const now = new Date();
        const isCurrentMonth = selectedMonth === now.getMonth() + 1 && selectedYear === now.getFullYear();
        const upToDate = isCurrentMonth ? now : undefined;
        
        const monthData = await calculateMonthlyHours(userId, selectedMonth, selectedYear, upToDate);
        setCurrentMonthData(monthData);

        const multiMonthData = await calculateMultipleMonths(userId, 6, selectedMonth, selectedYear);
        setChartData(multiMonthData);

        await loadMiniCalendarData(selectedMonth, selectedYear);
        await loadUpcomingVacation();
        await findMissingDays(selectedMonth, selectedYear);
      } else {
        await loadYearData();
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
      toast.error('Fehler beim Laden des Dashboards');
    } finally {
      setLoading(false);
    }
  };

  const loadTotalBalances = async () => {
    if (!userId) return;
    
    try {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      
      // Calculate cumulative hours balance for the year using YTD function (identical to TeamOverview)
      const ytdData = await calculateYtdBalance(userId, currentYear);
      const calculatedBalance = ytdData.balance;
      
      // Get hours corrections
      const hoursCorrections = await getBalanceCorrections(userId, 'hours', new Date());
      
      setTotalHoursBalance({
        totalHours: calculatedBalance + hoursCorrections,
        calculatedHours: calculatedBalance,
        corrections: hoursCorrections
      });
      
      // Load vacation balance and time tracking exempt status
      const { data: profile } = await supabase
        .from('profiles')
        .select('annual_vacation_days, time_tracking_exempt')
        .eq('id', userId)
        .single();
      
      const annualDays = profile?.annual_vacation_days || 30;
      setTimeTrackingExempt(profile?.time_tracking_exempt || false);
      
      // Get vacation corrections for the current year only
      const vacationCorrections = await getVacationCorrectionsByYear(userId, currentYear);
      
      // Get used vacation days this year
      const { data: absences } = await supabase
        .from('absences')
        .select('start_date, end_date, is_half_day')
        .eq('user_id', userId)
        .eq('type', 'vacation')
        .eq('status', 'approved')
        .gte('start_date', `${currentYear}-01-01`)
        .lte('start_date', `${currentYear}-12-31`);
      
      // Calculate used vacation days (excluding weekends AND holidays)
      let usedDays = 0;
      if (absences && absences.length > 0) {
        const holidaysSet = await fetchHolidaysForRange(
          new Date(`${currentYear}-01-01`),
          new Date(`${currentYear}-12-31`)
        );
        
        for (const absence of absences) {
          if (absence.is_half_day) {
            // Halber Urlaubstag = 0.5 Tage
            usedDays += 0.5;
          } else {
            usedDays += calculateWorkDaysWithHolidays(
              absence.start_date,
              absence.end_date,
              holidaysSet
            );
          }
        }
      }
      
      setVacationBalance({
        annual: annualDays,
        corrections: vacationCorrections,
        used: usedDays,
        remaining: annualDays + vacationCorrections - usedDays
      });
    } catch (error) {
      console.error('Error loading total balances:', error);
    }
  };

  const loadYearData = async () => {
    const yearData = [];
    for (let month = 1; month <= 12; month++) {
      const now = new Date();
      const upToDate = (month === now.getMonth() + 1 && selectedYear === now.getFullYear()) ? now : undefined;
      
      const data = await calculateMonthlyHours(userId, month, selectedYear, upToDate);
      yearData.push({
        month,
        monthName: format(new Date(selectedYear, month - 1), 'MMMM', { locale: de }),
        target: data.targetHours,
        actual: data.actualHours,
        balance: data.balance
      });
    }
    setYearlyData(yearData);
  };

  const loadMiniCalendarData = async (month: number, year: number) => {
    const targetDate = new Date(year, month - 1, 1);
    const monthStart = startOfMonth(targetDate);
    const monthEnd = endOfMonth(targetDate);
    const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

    const [entriesData, schedulesData, absencesData, holidaysSet] = await Promise.all([
      supabase.from('time_entries').select('date, start_time, end_time, break_minutes').eq('user_id', userId).gte('date', format(monthStart, 'yyyy-MM-dd')).lte('date', format(monthEnd, 'yyyy-MM-dd')),
      supabase.from('employee_work_schedules').select('*').eq('user_id', userId),
      supabase.from('absences').select('start_date, end_date').eq('user_id', userId).eq('status', 'approved').lte('start_date', format(monthEnd, 'yyyy-MM-dd')).gte('end_date', format(monthStart, 'yyyy-MM-dd')),
      getHolidaySet(monthStart, monthEnd)
    ]);

    const entries = entriesData.data || [];
    const schedules = schedulesData.data || [];
    const absences = absencesData.data || [];

    const statuses = daysInMonth.map(day => {
      const dayOfWeek = getDay(day);
      const dateStr = format(day, 'yyyy-MM-dd');

      if (dayOfWeek === 0 || dayOfWeek === 6) return { date: day, status: 'weekend' };

      if (holidaysSet.has(dateStr)) return { date: day, status: 'holiday' };

      const isAbsent = absences.some(a => dateStr >= a.start_date && dateStr <= a.end_date);
      if (isAbsent) return { date: day, status: 'absence' };

      const entry = entries.find(e => e.date === dateStr);
      if (entry) {
        // If any entry exists, mark as complete (no partial status)
        return { date: day, status: 'complete' };
      }

      return { date: day, status: 'missing' };
    });

    setDayStatuses(statuses);
  };

  const loadUpcomingVacation = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const { data } = await supabase.from('absences').select('*').eq('user_id', userId).eq('status', 'approved').eq('type', 'vacation').gte('start_date', today).order('start_date').limit(1);
    if (data && data.length > 0) setUpcomingVacation(data[0]);
  };

  const findMissingDays = async (month: number, year: number) => {
    const targetDate = new Date(year, month - 1, 1);
    const monthStart = startOfMonth(targetDate);
    const monthEnd = endOfMonth(targetDate);
    const today = new Date();

    const daysToCheck = eachDayOfInterval({ start: monthStart, end: today }).filter(day => {
      const dayOfWeek = getDay(day);
      return dayOfWeek !== 0 && dayOfWeek !== 6;
    });

    const [entriesData, absencesData, holidays] = await Promise.all([
      supabase.from('time_entries').select('date').eq('user_id', userId).gte('date', format(monthStart, 'yyyy-MM-dd')).lte('date', format(today, 'yyyy-MM-dd')),
      supabase.from('absences').select('start_date, end_date').eq('user_id', userId).eq('status', 'approved').lte('start_date', format(monthEnd, 'yyyy-MM-dd')).gte('end_date', format(monthStart, 'yyyy-MM-dd')),
      getHolidaySet(monthStart, monthEnd)
    ]);

    const entries = entriesData.data || [];
    const absences = absencesData.data || [];

    const missing = daysToCheck.filter(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      if (holidays.has(dateStr)) return false;
      const hasEntry = entries.some(e => e.date === dateStr);
      if (hasEntry) return false;
      const isAbsent = absences.some(a => dateStr >= a.start_date && dateStr <= a.end_date);
      return !isAbsent;
    }).map(day => format(day, 'dd.MM.yyyy'));

    setMissingDays(missing);
  };

  const navigatePeriod = (direction: number) => {
    if (viewMode === 'month') {
      const newDate = new Date(selectedYear, selectedMonth - 1 + direction);
      setSelectedMonth(newDate.getMonth() + 1);
      setSelectedYear(newDate.getFullYear());
    } else {
      setSelectedYear(selectedYear + direction);
    }
  };

  const resetToToday = () => {
    const today = new Date();
    setSelectedMonth(today.getMonth() + 1);
    setSelectedYear(today.getFullYear());
    setViewMode('month');
  };

  const jumpToMonth = (month: number) => {
    setSelectedMonth(month);
    setViewMode('month');
  };

  const isCurrentPeriod = () => {
    const now = new Date();
    if (viewMode === 'month') return selectedMonth === now.getMonth() + 1 && selectedYear === now.getFullYear();
    return selectedYear === now.getFullYear();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Clock className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-full overflow-hidden">
      {/* Total Balance Cards - Always visible at top */}
      <div className={`grid gap-4 ${timeTrackingExempt ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
        <Card className="p-4 sm:p-6 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20 overflow-hidden">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Palmtree className="h-5 w-5 text-emerald-600 shrink-0" />
                <span className="text-sm font-medium text-muted-foreground">RESTURLAUB</span>
              </div>
              <p className={`text-2xl sm:text-4xl font-bold ${vacationBalance.remaining >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                {vacationBalance.remaining} <span className="text-base sm:text-lg font-normal">Tage</span>
              </p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border/50 space-y-1 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Jahresanspruch:</span>
              <span className="font-medium text-foreground">{vacationBalance.annual} Tage</span>
            </div>
            <div className="flex justify-between">
              <span>Genommen:</span>
              <span className="font-medium text-foreground">-{vacationBalance.used} Tage</span>
            </div>
            {vacationBalance.corrections !== 0 && (
              <div className="flex justify-between">
                <span>Korrekturen/Übertrag:</span>
                <span className={`font-medium ${vacationBalance.corrections >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                  {vacationBalance.corrections >= 0 ? '+' : ''}{vacationBalance.corrections} Tage
                </span>
              </div>
            )}
          </div>
        </Card>

        {!timeTrackingExempt && (
          <Card className={`p-4 sm:p-6 overflow-hidden ${totalHoursBalance.totalHours >= 0 ? 'bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20' : 'bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20'}`}>
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-5 w-5 text-blue-600 shrink-0" />
                  <span className="text-sm font-medium text-muted-foreground">STUNDENSALDO</span>
                </div>
                <p className={`text-2xl sm:text-4xl font-bold ${totalHoursBalance.totalHours >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                  {totalHoursBalance.totalHours >= 0 ? '+' : ''}{formatHoursMinutes(totalHoursBalance.totalHours)}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border/50 space-y-1 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>Berechnet ({new Date().getFullYear()}):</span>
                <span className={`font-medium ${totalHoursBalance.calculatedHours >= 0 ? 'text-foreground' : 'text-orange-600'}`}>
                  {totalHoursBalance.calculatedHours >= 0 ? '+' : ''}{formatHoursMinutes(totalHoursBalance.calculatedHours)}
                </span>
              </div>
              {totalHoursBalance.corrections !== 0 && (
                <div className="flex justify-between">
                  <span>Korrekturen/Übertrag:</span>
                  <span className={`font-medium ${totalHoursBalance.corrections >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                    {totalHoursBalance.corrections >= 0 ? '+' : ''}{formatHoursMinutes(totalHoursBalance.corrections)}
                  </span>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <Card className="p-3 sm:p-4 overflow-hidden">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-4 w-full">
          <div className="flex gap-2">
            <Button variant={viewMode === 'month' ? 'default' : 'outline'} onClick={() => setViewMode('month')} size="sm">Monat</Button>
            <Button variant={viewMode === 'year' ? 'default' : 'outline'} onClick={() => setViewMode('year')} size="sm">Jahr</Button>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-center">
            <Button variant="outline" size="icon" onClick={() => navigatePeriod(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="px-2 sm:px-4 py-2 bg-muted rounded-md min-w-0 sm:min-w-[200px] text-center flex items-center justify-center gap-1 sm:gap-2">
              <span className="font-medium text-sm sm:text-base">{viewMode === 'month' ? format(new Date(selectedYear, selectedMonth - 1), 'MMMM yyyy', { locale: de }) : selectedYear}</span>
              {isCurrentPeriod() && <Badge variant="outline" className="bg-primary/10 text-primary text-xs">Aktuell</Badge>}
            </div>
            <Button variant="outline" size="icon" onClick={() => navigatePeriod(1)}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" onClick={resetToToday} size="sm">Heute</Button>
          </div>
        </div>
      </Card>

      {viewMode === 'month' ? (
        <>
          {/* Today Card + Quick Actions at top */}
          <TodayTimeCard userId={userId} onDataChanged={loadDashboardData} timeTrackingExempt={timeTrackingExempt} />
          
          <Card className="p-4 sm:p-6 overflow-hidden">
            <h3 className="text-lg font-semibold mb-4">Schnellzugriff</h3>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <Button onClick={() => onNavigate('vacation-request')} variant="outline" className="w-full">
                <Plane className="mr-1 h-4 w-4 shrink-0" />
                <span className="truncate">Urlaub</span>
              </Button>
              <Button onClick={() => onNavigate('sick-leave')} variant="outline" className="w-full">
                <Thermometer className="mr-1 h-4 w-4 shrink-0" />
                <span className="truncate">Krankmeldung</span>
              </Button>
              <Button onClick={() => onNavigate('profile')} variant="outline" className="w-full">
                <Settings className="mr-1 h-4 w-4 shrink-0" />
                <span className="truncate">Einstellungen</span>
              </Button>
            </div>
          </Card>

          {!timeTrackingExempt && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <TimeKPICard label="SOLL-Stunden (inkl. heute)" value={currentMonthData.targetHours} icon={Clock} variant="default" subtitle={`${currentMonthData.workDays} Arbeitstage`} />
                <TimeKPICard label="IST-Stunden (inkl. heute)" value={currentMonthData.actualHours} icon={CheckCircle} variant="success" subtitle="Erfasste Stunden" />
                <TimeKPICard label="SALDO" value={Math.abs(currentMonthData.balance)} icon={Scale} variant={currentMonthData.balance >= 0 ? 'success' : 'warning'} subtitle={currentMonthData.balance >= 0 ? 'Überstunden' : 'Minderstunden'} />
              </div>
              <HoursComparisonChart data={chartData} />
            </>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <MiniMonthCalendar date={new Date(selectedYear, selectedMonth - 1, 1)} dayStatuses={dayStatuses} onDateClick={() => onNavigate('calendar')} />
            <Card className="p-4 sm:p-6 overflow-hidden">
              <div className="flex items-center gap-3 mb-4"><Plane className="h-5 w-5 text-primary shrink-0" /><h3 className="font-semibold">Nächster Urlaub</h3></div>
              {upcomingVacation ? (
                <div>
                  <p className="text-2xl font-bold mb-1">{format(parseISO(upcomingVacation.start_date), 'dd.MM.yyyy', { locale: de })}</p>
                  <p className="text-sm text-muted-foreground">bis {format(parseISO(upcomingVacation.end_date), 'dd.MM.yyyy', { locale: de })}</p>
                </div>
              ) : (
                <div>
                  <p className="text-muted-foreground mb-3">Kein Urlaub geplant</p>
                  <Button variant="outline" size="sm" onClick={() => onNavigate('vacation-request')}>Urlaub beantragen</Button>
                </div>
              )}
            </Card>
          </div>
          {!timeTrackingExempt && missingDays.length > 0 && (
            <Card className="p-4 sm:p-6 border-destructive overflow-hidden">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive mt-1 shrink-0" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold mb-2">Fehlende Zeiteinträge</h3>
                  <p className="text-sm text-muted-foreground mb-3 break-words">Für folgende Tage fehlen noch Einträge: {missingDays.join(', ')}</p>
                  <Button variant="outline" size="sm" onClick={() => onNavigate('calendar')}>Jetzt erfassen</Button>
                </div>
              </div>
            </Card>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TimeKPICard label="JAHRES-SOLL" value={yearlyData.reduce((sum, m) => sum + m.target, 0)} unit="Stunden" icon={Clock} variant="default" />
            <TimeKPICard label="JAHRES-IST" value={yearlyData.reduce((sum, m) => sum + m.actual, 0)} unit="Stunden" icon={CheckCircle} variant="success" />
            <TimeKPICard label="JAHRES-SALDO" value={yearlyData.reduce((sum, m) => sum + m.balance, 0)} unit="Stunden" icon={Scale} variant={yearlyData.reduce((sum, m) => sum + m.balance, 0) >= 0 ? 'success' : 'warning'} />
          </div>
          <YearlyOverview data={yearlyData} year={selectedYear} onMonthClick={jumpToMonth} />
          <Card className="p-4 sm:p-6 overflow-hidden">
            <h3 className="text-lg font-semibold mb-4">Jahresverlauf</h3>
            <HoursComparisonChart data={yearlyData.map(m => ({ month: m.monthName, target: m.target, actual: m.actual, balance: m.balance }))} />
          </Card>
        </>
      )}
    </div>
  );
};
