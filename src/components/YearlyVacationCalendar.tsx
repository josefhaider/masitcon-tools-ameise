"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHolidays, getSchoolHolidays, SchoolHoliday } from "@/lib/holidays";
import { calculateWorkDaysWithHolidays } from "@/lib/workDaysCalculator";
import { format } from "date-fns";
import { de } from "date-fns/locale";

type ViewMode = "year" | "quarter" | "month";

interface Team {
  id: string;
  name: string;
  color: string | null;
}

interface Absence {
  id: string;
  user_id: string;
  type: "vacation" | "sick" | "other" | "unpaid_leave" | "comp_time" | "vocational_school";
  start_date: string;
  end_date: string;
  notes: string | null;
  is_half_day?: boolean | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_number: string | null;
}

interface EmployeeAbsences {
  employee: Employee;
  absences: Absence[];
  totalDays: number;
}

interface TeamMembership {
  user_id: string;
  team_id: string;
  team_name: string;
  team_color: string;
}

interface GroupedEmployeeAbsences {
  team: { id: string; name: string; color: string } | null;
  employees: EmployeeAbsences[];
}

const MONTHS = [
  "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"
];

const MONTH_NAMES_FULL = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

const QUARTER_NAMES = ["Q1", "Q2", "Q3", "Q4"];
const QUARTER_MONTHS = [
  [0, 1, 2],   // Q1: Jan, Feb, Mar
  [3, 4, 5],   // Q2: Apr, May, Jun
  [6, 7, 8],   // Q3: Jul, Aug, Sep
  [9, 10, 11]  // Q4: Oct, Nov, Dec
];

const WEEKDAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Einheitliche Darstellung für alle Urlaubsarten
const ABSENCE_COLOR = "bg-amber-400";
const ABSENCE_LABEL = "Urlaub";

// Berufsschule separat darstellen
const getAbsenceStyle = (type: string) => {
  if (type === 'vocational_school') {
    return { color: "bg-violet-400", label: "Berufsschule", textColor: "text-violet-900" };
  }
  return { color: ABSENCE_COLOR, label: ABSENCE_LABEL, textColor: "text-amber-900" };
};

export default function YearlyVacationCalendar() {
  const [viewMode, setViewMode] = useState<ViewMode>("year");
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedQuarter, setSelectedQuarter] = useState<number>(
    Math.ceil((new Date().getMonth() + 1) / 3)
  );
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>("all");
  const [employeeAbsences, setEmployeeAbsences] = useState<EmployeeAbsences[]>([]);
  const [loading, setLoading] = useState(true);
  const [holidays, setHolidays] = useState<Map<string, string>>(new Map());
  const [schoolHolidays, setSchoolHolidays] = useState<SchoolHoliday[]>([]);
  const [teamMemberships, setTeamMemberships] = useState<TeamMembership[]>([]);
  const { toast } = useToast();

  // Lade Feiertage und Schulferien aus der Datenbank
  useEffect(() => {
    const loadHolidaysData = async () => {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31);
      
      const [holidayMap, schoolHolidaysData] = await Promise.all([
        getHolidays(startDate, endDate),
        getSchoolHolidays(startDate, endDate)
      ]);
      
      setHolidays(holidayMap);
      setSchoolHolidays(schoolHolidaysData);
    };
    loadHolidaysData();
  }, [year]);

  useEffect(() => {
    loadTeams();
  }, []);

  useEffect(() => {
    // Only load absences when holidays are loaded to ensure correct work day calculation
    if (holidays.size > 0) {
      loadAbsences();
    }
  }, [year, selectedTeam, selectedMonth, selectedQuarter, viewMode, holidays.size]);

  const loadTeams = async () => {
    try {
      const [teamsRes, membershipsRes] = await Promise.all([
        supabase.from("teams").select("*").order("name"),
        supabase.from("team_members").select("user_id, team_id, teams(id, name, color)").eq("is_active", true)
      ]);

      if (teamsRes.error) throw teamsRes.error;
      setTeams(teamsRes.data || []);
      
      // Transform memberships
      const memberships: TeamMembership[] = (membershipsRes.data || []).map((m: any) => ({
        user_id: m.user_id,
        team_id: m.team_id,
        team_name: m.teams?.name || '',
        team_color: m.teams?.color || '#3B82F6',
      }));
      setTeamMemberships(memberships);
    } catch (error: unknown) {
      toast({
        title: "Fehler",
        description: "Teams konnten nicht geladen werden: " + (error instanceof Error ? error.message : "Unbekannter Fehler"),
        variant: "destructive",
      });
    }
  };

  const loadAbsences = async () => {
    setLoading(true);
    try {
      let employeeQuery = supabase
        .from("profiles")
        .select("id, full_name, employee_number")
        .eq("is_archived", false);

      // Filter by team
      if (selectedTeam !== "all" && selectedTeam !== "none") {
        const { data: teamMembers } = await supabase
          .from("team_members")
          .select("user_id")
          .eq("team_id", selectedTeam)
          .eq("is_active", true);

        const userIds = (teamMembers || []).map((tm) => tm.user_id);
        if (userIds.length === 0) {
          setEmployeeAbsences([]);
          setLoading(false);
          return;
        }
        employeeQuery = employeeQuery.in("id", userIds);
      } else if (selectedTeam === "none") {
        const { data: teamMembers } = await supabase
          .from("team_members")
          .select("user_id")
          .eq("is_active", true);

        const userIdsWithTeam = (teamMembers || []).map((tm) => tm.user_id);
        if (userIdsWithTeam.length > 0) {
          employeeQuery = employeeQuery.not("id", "in", `(${userIdsWithTeam.join(",")})`);
        }
      }

      const { data: employees, error: empError } = await employeeQuery.order("full_name");

      if (empError) throw empError;

      if (!employees || employees.length === 0) {
        setEmployeeAbsences([]);
        setLoading(false);
        return;
      }

      // Calculate date range based on view mode
      let startDate: string;
      let endDate: string;

      if (viewMode === "year") {
        startDate = `${year}-01-01`;
        endDate = `${year}-12-31`;
      } else if (viewMode === "quarter") {
        const quarterMonths = QUARTER_MONTHS[selectedQuarter - 1];
        const firstMonth = quarterMonths[0];
        const lastMonth = quarterMonths[2];
        startDate = `${year}-${String(firstMonth + 1).padStart(2, '0')}-01`;
        endDate = `${year}-${String(lastMonth + 1).padStart(2, '0')}-${new Date(year, lastMonth + 1, 0).getDate()}`;
      } else {
        startDate = `${year}-${String(selectedMonth + 1).padStart(2, '0')}-01`;
        endDate = `${year}-${String(selectedMonth + 1).padStart(2, '0')}-${new Date(year, selectedMonth + 1, 0).getDate()}`;
      }

      const { data: absences, error: absError } = await supabase
        .from("absences")
        .select("*")
        .in("user_id", employees.map((e) => e.id))
        .eq("status", "approved")
        .in("type", ["vacation", "unpaid_leave", "comp_time", "vocational_school"])
        .lte("start_date", endDate)  // Abwesenheit beginnt vor/am Ende des Zeitraums
        .gte("end_date", startDate); // Abwesenheit endet nach/am Anfang des Zeitraums

      if (absError) throw absError;

      // Konvertiere holidays Map zu Set für calculateWorkDaysWithHolidays
      const holidaysSet = new Set<string>();
      holidays.forEach((_, dateStr) => holidaysSet.add(dateStr));

      const result: EmployeeAbsences[] = employees.map((emp) => {
        const empAbsences = (absences || []).filter((a) => a.user_id === emp.id);
        // Berechne korrekte Arbeitstage (ohne Wochenenden und Feiertage)
        // Nur echte Urlaubstage ('vacation') zählen - nicht unbezahlter Urlaub, Überstundenfrei, etc.
        const totalDays = empAbsences.reduce((sum, absence) => {
          if (absence.type !== 'vacation') return sum;
          
          // Bei halbem Tag immer 0.5 zurückgeben
          if (absence.is_half_day) return sum + 0.5;
          
          const absStart = new Date(Math.max(new Date(absence.start_date).getTime(), new Date(startDate).getTime()));
          const absEnd = new Date(Math.min(new Date(absence.end_date).getTime(), new Date(endDate).getTime()));
          const workDays = calculateWorkDaysWithHolidays(absStart, absEnd, holidaysSet);
          return sum + workDays;
        }, 0);

        return {
          employee: emp,
          absences: empAbsences,
          totalDays,
        };
      });

      setEmployeeAbsences(result);
    } catch (error: unknown) {
      toast({
        title: "Fehler",
        description: "Abwesenheiten konnten nicht geladen werden: " + (error instanceof Error ? error.message : "Unbekannter Fehler"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Horizontales Scrollen mit Mausrad
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    // Nur umwandeln wenn es vertikales Scrollen gibt
    if (e.deltaY !== 0) {
      e.preventDefault();
      container.scrollLeft += e.deltaY;
    }
  };

  const getAbsenceForDay = (absences: Absence[], dateString: string): Absence | null => {
    const checkDate = new Date(dateString);
    checkDate.setHours(0, 0, 0, 0);

    return absences.find((absence) => {
      const absStart = new Date(absence.start_date);
      const absEnd = new Date(absence.end_date);
      absStart.setHours(0, 0, 0, 0);
      absEnd.setHours(0, 0, 0, 0);
      return checkDate >= absStart && checkDate <= absEnd;
    }) || null;
  };

  const isWeekend = (dateString: string) => {
    const date = new Date(dateString);
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 || dayOfWeek === 6;
  };

  const isHoliday = (dateString: string) => {
    return holidays.has(dateString);
  };

  const getHolidayName = (dateString: string) => {
    return holidays.get(dateString) || null;
  };

  const getSchoolHolidayForDate = (dateString: string): SchoolHoliday | null => {
    const checkDate = new Date(dateString);
    checkDate.setHours(0, 0, 0, 0);
    
    return schoolHolidays.find((sh) => {
      const start = new Date(sh.start_date);
      const end = new Date(sh.end_date);
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      return checkDate >= start && checkDate <= end;
    }) || null;
  };

  const navigateQuarter = (direction: number) => {
    let newQuarter = selectedQuarter + direction;
    let newYear = year;

    if (newQuarter > 4) {
      newQuarter = 1;
      newYear++;
    } else if (newQuarter < 1) {
      newQuarter = 4;
      newYear--;
    }

    setSelectedQuarter(newQuarter);
    setYear(newYear);
  };

  const navigateMonth = (direction: number) => {
    let newMonth = selectedMonth + direction;
    let newYear = year;

    if (newMonth > 11) {
      newMonth = 0;
      newYear++;
    } else if (newMonth < 0) {
      newMonth = 11;
      newYear--;
    }

    setSelectedMonth(newMonth);
    setYear(newYear);
  };

  // Generate calendar grid for a specific month
  const getCalendarGridForMonth = (monthIndex: number) => {
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);
    const daysInMonth = lastDay.getDate();
    
    // Adjust for Monday start (0 = Monday, 6 = Sunday)
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;
    
    const weeks: (number | null)[][] = [];
    let currentWeek: (number | null)[] = [];
    
    // Add empty cells for days before the first of the month
    for (let i = 0; i < startDayOfWeek; i++) {
      currentWeek.push(null);
    }
    
    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      currentWeek.push(day);
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    
    // Fill remaining cells in the last week
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }
    
    return weeks;
  };

  // Calculate month coverage for year view
  const getAbsencesForMonth = (absences: Absence[], monthIndex: number) => {
    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = new Date(year, monthIndex + 1, 0);

    return absences.filter((absence) => {
      const absStart = new Date(absence.start_date);
      const absEnd = new Date(absence.end_date);
      return absStart <= monthEnd && absEnd >= monthStart;
    });
  };

  const calculateMonthCoverage = (absence: Absence, monthIndex: number) => {
    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = new Date(year, monthIndex + 1, 0);
    const absStart = new Date(absence.start_date);
    const absEnd = new Date(absence.end_date);

    const overlapStart = new Date(Math.max(monthStart.getTime(), absStart.getTime()));
    const overlapEnd = new Date(Math.min(monthEnd.getTime(), absEnd.getTime()));

    const startDay = overlapStart.getDate();
    const endDay = overlapEnd.getDate();
    const daysInMonth = monthEnd.getDate();

    return {
      startPercent: ((startDay - 1) / daysInMonth) * 100,
      widthPercent: ((endDay - startDay + 1) / daysInMonth) * 100
    };
  };

  // Helper: Get holidays for a specific month
  const getHolidaysInMonth = (monthIndex: number) => {
    const results: { day: number; name: string }[] = [];
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dateString = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (holidays.has(dateString)) {
        results.push({ day, name: holidays.get(dateString)! });
      }
    }
    return results;
  };

  // Helper: Get school holidays coverage for a specific month
  const getSchoolHolidaysInMonth = (monthIndex: number) => {
    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = new Date(year, monthIndex + 1, 0);
    const daysInMonth = monthEnd.getDate();
    
    return schoolHolidays
      .filter((sh) => {
        const start = new Date(sh.start_date);
        const end = new Date(sh.end_date);
        return start <= monthEnd && end >= monthStart;
      })
      .map((sh) => {
        const start = new Date(sh.start_date);
        const end = new Date(sh.end_date);
        const overlapStart = new Date(Math.max(monthStart.getTime(), start.getTime()));
        const overlapEnd = new Date(Math.min(monthEnd.getTime(), end.getTime()));
        
        const startDay = overlapStart.getDate();
        const endDay = overlapEnd.getDate();
        
        return {
          name: sh.name,
          startPercent: ((startDay - 1) / daysInMonth) * 100,
          widthPercent: ((endDay - startDay + 1) / daysInMonth) * 100
        };
      });
  };

  // Generate all days of the year for the Gantt view
  const allDaysOfYear = useMemo(() => {
    const days: Array<{
      date: Date;
      dateString: string;
      dayOfMonth: number;
      dayOfWeek: number;
      month: number;
      isFirstOfMonth: boolean;
    }> = [];
    
    const currentDate = new Date(year, 0, 1);
    while (currentDate.getFullYear() === year) {
      days.push({
        date: new Date(currentDate),
        dateString: format(currentDate, 'yyyy-MM-dd'),
        dayOfMonth: currentDate.getDate(),
        dayOfWeek: currentDate.getDay(),
        month: currentDate.getMonth(),
        isFirstOfMonth: currentDate.getDate() === 1
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }
    return days;
  }, [year]);
  
  // Group days by month for headers
  const monthGroups = useMemo(() => {
    return Array.from({ length: 12 }, (_, month) => {
      const daysInMonth = allDaysOfYear.filter(d => d.month === month);
      return {
        month,
        name: format(new Date(year, month, 1), 'MMM', { locale: de }),
        fullName: format(new Date(year, month, 1), 'MMMM', { locale: de }),
        days: daysInMonth.length
      };
    });
  }, [year, allDaysOfYear]);

  // Group employees by team
  const groupedEmployeeAbsences = useMemo(() => {
    const teamMap = new Map<string, EmployeeAbsences[]>();
    const noTeam: EmployeeAbsences[] = [];

    employeeAbsences.forEach((empAbs) => {
      const membership = teamMemberships.find((tm) => tm.user_id === empAbs.employee.id);
      
      if (membership) {
        const teamId = membership.team_id;
        if (!teamMap.has(teamId)) {
          teamMap.set(teamId, []);
        }
        teamMap.get(teamId)!.push(empAbs);
      } else {
        noTeam.push(empAbs);
      }
    });

    const grouped: GroupedEmployeeAbsences[] = [];
    
    const sortedTeams = teams
      .filter((t) => teamMap.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    sortedTeams.forEach((team) => {
      grouped.push({
        team: { id: team.id, name: team.name, color: team.color || '#3B82F6' },
        employees: teamMap.get(team.id)!,
      });
    });

    if (noTeam.length > 0) {
      grouped.push({ team: null, employees: noTeam });
    }

    return grouped;
  }, [employeeAbsences, teamMemberships, teams]);

  // Reference for scrolling to today
  const todayRef = useRef<HTMLTableCellElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const todayString = format(new Date(), 'yyyy-MM-dd');

  const scrollToToday = () => {
    if (todayRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const todayCell = todayRef.current;
      const scrollLeft = todayCell.offsetLeft - container.clientWidth / 2 + todayCell.clientWidth / 2;
      container.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
    }
  };

  const renderYearView = () => (
    <div className="space-y-3">
      {/* Scroll to Today Button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={scrollToToday}>
          Heute anzeigen
        </Button>
      </div>
      
      {/* Scrollable Container */}
      <div 
        ref={scrollContainerRef}
        className="overflow-x-auto border rounded-lg"
        style={{ maxHeight: 'calc(100vh - 300px)' }}
        onWheel={handleWheel}
      >
        <table className="border-collapse" style={{ minWidth: '3000px' }}>
          <thead className="sticky top-0 z-20 bg-background">
            {/* Month Headers Row */}
            <tr className="border-b border-border">
              <th 
                className="sticky left-0 z-30 bg-background p-2 text-left font-semibold text-sm border-r border-border"
                style={{ minWidth: '180px' }}
              >
                Mitarbeiter
              </th>
              {monthGroups.map((mg) => (
                <th 
                  key={mg.month}
                  colSpan={mg.days}
                  className={`text-center p-1.5 text-xs font-semibold border-l-2 border-primary/30 ${
                    mg.month % 2 === 0 ? 'bg-muted/30' : 'bg-muted/10'
                  }`}
                >
                  {mg.fullName}
                </th>
              ))}
              <th 
                className="sticky right-0 z-30 bg-background p-2 text-center font-semibold text-xs border-l border-border"
                style={{ minWidth: '50px' }}
              >
                Tage
              </th>
            </tr>
            
            {/* Day Numbers Row */}
            <tr className="border-b border-border">
              <th className="sticky left-0 z-40 bg-background border-r border-border" style={{ minWidth: '180px' }}></th>
              {allDaysOfYear.map((day) => {
                const isToday = day.dateString === todayString;
                const isWeekendDay = day.dayOfWeek === 0 || day.dayOfWeek === 6;
                const holiday = isHoliday(day.dateString);
                const schoolHoliday = getSchoolHolidayForDate(day.dateString);
                
                // Background colors for header
                let bgClass = '';
                if (holiday) {
                  bgClass = 'bg-primary/20';
                } else if (schoolHoliday) {
                  bgClass = 'bg-emerald-100/60 dark:bg-emerald-900/30';
                } else if (isWeekendDay) {
                  bgClass = 'bg-muted/50';
                }
                
                return (
                  <th
                    key={day.dateString}
                    ref={isToday ? todayRef : undefined}
                    className={`text-center p-0.5 text-[10px] font-normal bg-background ${
                      day.isFirstOfMonth ? 'border-l-2 border-primary/30' : ''
                    } ${bgClass}`}
                    style={{ minWidth: '22px', maxWidth: '22px' }}
                  >
                    <div className={`leading-none ${isWeekendDay || holiday ? 'text-muted-foreground' : ''}`}>
                      {day.dayOfMonth}
                    </div>
                  </th>
                );
              })}
              <th className="sticky right-0 z-40 bg-background border-l border-border" style={{ minWidth: '50px' }}></th>
            </tr>
          </thead>
          
          <tbody>
            {groupedEmployeeAbsences.map((group) => (
              <>
                {/* Team Header Row */}
                <tr key={`team-${group.team?.id || 'no-team'}`} className="bg-muted/50">
                  <td 
                    className="sticky left-0 z-10 bg-muted/50 py-1 px-2 border-r border-border font-semibold"
                    style={{ minWidth: '180px' }}
                  >
                    <div className="flex items-center gap-2">
                      {group.team && (
                        <div 
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: group.team.color }}
                        />
                      )}
                      <span className="truncate text-xs">{group.team?.name || 'Ohne Team'}</span>
                    </div>
                  </td>
                  {allDaysOfYear.map((day) => (
                    <td 
                      key={`header-${group.team?.id || 'no-team'}-${day.dateString}`}
                      className={`p-0 bg-muted/50 border-r border-border/30 ${day.isFirstOfMonth ? 'border-l-2 border-l-primary/30' : ''}`}
                      style={{ minWidth: '22px', maxWidth: '22px', height: '14px' }}
                    />
                  ))}
                  <td 
                    className="sticky right-0 z-10 bg-muted/50 py-1 px-2 border-l border-border" 
                    style={{ minWidth: '50px' }}
                  />
                </tr>
                
                {/* Employee Rows */}
                {group.employees.map((empAbs) => (
                  <tr key={empAbs.employee.id} className="border-b border-border/50 hover:bg-accent/20 transition-colors">
                    {/* Employee Name - Sticky */}
                    <td 
                      className="sticky left-0 z-10 bg-background p-2 border-r border-border pl-6"
                      style={{ minWidth: '180px' }}
                    >
                      <div className="font-medium text-sm truncate">{empAbs.employee.full_name}</div>
                      {empAbs.employee.employee_number && (
                        <div className="text-xs text-muted-foreground">{empAbs.employee.employee_number}</div>
                      )}
                    </td>
                    
                    {/* Day Cells */}
                    {allDaysOfYear.map((day) => {
                      const absence = getAbsenceForDay(empAbs.absences, day.dateString);
                      const isWeekendDay = day.dayOfWeek === 0 || day.dayOfWeek === 6;
                      const holiday = isHoliday(day.dateString);
                      const holidayName = getHolidayName(day.dateString);
                      const schoolHoliday = getSchoolHolidayForDate(day.dateString);
                      
                      let bgClass = '';
                      
                      if (holiday) {
                        bgClass = 'bg-primary/20';
                      } else if (isWeekendDay) {
                        bgClass = 'bg-muted/40';
                      } else if (absence) {
                        const absenceStyle = getAbsenceStyle(absence.type);
                        bgClass = absenceStyle.color;
                      } else if (schoolHoliday) {
                        bgClass = 'bg-emerald-100/50 dark:bg-emerald-900/20';
                      }
                      
                      const hasTooltipContent = absence || holiday || schoolHoliday;
                      
                      const cellContent = (
                        <div className="w-full h-7" />
                      );
                      
                      return (
                        <td
                          key={day.dateString}
                          className={`p-0 border-r border-border/30 ${day.isFirstOfMonth ? 'border-l-2 border-l-primary/30' : ''} ${bgClass}`}
                          style={{ minWidth: '22px', maxWidth: '22px' }}
                        >
                          {hasTooltipContent ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                {cellContent}
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-sm space-y-1">
                                  <div className="font-medium">{format(day.date, 'EEEE, d. MMMM yyyy', { locale: de })}</div>
                                  {absence && (
                                    <div className="text-amber-600 dark:text-amber-400">
                                      {getAbsenceStyle(absence.type).label}
                                      {absence.notes && <span className="text-muted-foreground"> – {absence.notes}</span>}
                                    </div>
                                  )}
                                  {holiday && <div className="text-primary">{holidayName}</div>}
                                  {schoolHoliday && <div className="text-emerald-600 dark:text-emerald-400">{schoolHoliday.name}</div>}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            cellContent
                          )}
                        </td>
                      );
                    })}
                    
                    {/* Total Days - Sticky */}
                    <td 
                      className="sticky right-0 z-10 bg-background p-2 text-center border-l border-border"
                      style={{ minWidth: '50px' }}
                    >
                      <Badge variant="secondary" className="font-mono text-xs">{empAbs.totalDays}</Badge>
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
      
    </div>
  );

  // Render a mini calendar grid for a single month
  const renderMiniCalendar = (monthIndex: number, empAbs: EmployeeAbsences, isCompact: boolean = false) => {
    const weeks = getCalendarGridForMonth(monthIndex);
    const cellSize = isCompact ? "w-5 h-5 text-[10px]" : "w-6 h-6 text-xs";
    
    return (
      <div className="flex flex-col">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-0.5 mb-0.5">
          {WEEKDAY_NAMES.map((day) => (
            <div key={day} className={`${cellSize} flex items-center justify-center text-muted-foreground font-medium`}>
              {day.charAt(0)}
            </div>
          ))}
        </div>
        {/* Calendar grid */}
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 gap-0.5">
            {week.map((day, dayIndex) => {
              if (day === null) {
                return <div key={dayIndex} className={cellSize} />;
              }
              
              const dateString = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const absence = getAbsenceForDay(empAbs.absences, dateString);
              const weekend = isWeekend(dateString);
              const holiday = isHoliday(dateString);
              const holidayName = getHolidayName(dateString);
              const schoolHoliday = getSchoolHolidayForDate(dateString);
              
              // Priority: holiday > weekend > absence (weekends/holidays are not vacation days)
              const absenceStyle = absence ? getAbsenceStyle(absence.type) : null;
              const bgClass = holiday 
                ? 'bg-primary/20' 
                : weekend 
                  ? 'bg-muted/50' 
                  : absence 
                    ? absenceStyle!.color
                    : schoolHoliday 
                      ? 'bg-emerald-100 dark:bg-emerald-900/30'
                      : 'bg-background';
              
              const textClass = absence 
                ? `${absenceStyle!.textColor} font-semibold` 
                : holiday 
                  ? 'text-primary font-medium' 
                  : weekend 
                    ? 'text-muted-foreground' 
                    : 'text-foreground';
              
              return (
                <Tooltip key={dayIndex}>
                  <TooltipTrigger asChild>
                    <div 
                      className={`${cellSize} flex items-center justify-center rounded-sm cursor-default ${bgClass} ${textClass}`}
                    >
                      {day}
                    </div>
                  </TooltipTrigger>
                  {(absence || holiday || schoolHoliday) && (
                    <TooltipContent>
                      <div className="text-sm">
                        {absence && (
                          <>
                            <div className="font-semibold">{absenceStyle!.label}</div>
                            <div>
                              {new Date(absence.start_date).toLocaleDateString("de-DE")} –{" "}
                              {new Date(absence.end_date).toLocaleDateString("de-DE")}
                            </div>
                            {absence.notes && (
                              <div className="text-muted-foreground mt-1">{absence.notes}</div>
                            )}
                          </>
                        )}
                        {holiday && <div className="font-medium text-primary">{holidayName}</div>}
                        {schoolHoliday && <div className="text-emerald-600">{schoolHoliday.name}</div>}
                      </div>
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  const renderQuarterView = () => {
    const quarterMonths = QUARTER_MONTHS[selectedQuarter - 1];

    return (
      <div className="space-y-4">
        {/* Month headers */}
        <div className="grid grid-cols-4 gap-4">
          <div className="font-semibold text-sm">Mitarbeiter</div>
          {quarterMonths.map((monthIndex) => (
            <div key={monthIndex} className="font-semibold text-sm text-center">
              {MONTH_NAMES_FULL[monthIndex]}
            </div>
          ))}
        </div>
        
        {/* Employee rows grouped by team */}
        <div className="space-y-3">
          {groupedEmployeeAbsences.map((group) => (
            <div key={`quarter-team-${group.team?.id || 'no-team'}`} className="space-y-2">
              {/* Team Header */}
              <div className="flex items-center gap-2 px-2 py-1 bg-muted/50 rounded-lg">
                {group.team && (
                  <div 
                    className="w-3 h-3 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: group.team.color }}
                  />
                )}
                <span className="font-semibold text-sm">{group.team?.name || 'Ohne Team'}</span>
              </div>
              
              {/* Employee Cards */}
              {group.employees.map((empAbs) => (
                <div 
                  key={empAbs.employee.id} 
                  className="grid grid-cols-4 gap-4 p-3 rounded-lg border border-border/50 hover:bg-accent/20 transition-colors ml-4"
                >
                  {/* Employee name */}
                  <div className="flex flex-col justify-center">
                    <div className="font-medium text-sm">{empAbs.employee.full_name}</div>
                    {empAbs.employee.employee_number && (
                      <div className="text-xs text-muted-foreground">
                        {empAbs.employee.employee_number}
                      </div>
                    )}
                    <div className="mt-1">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {empAbs.totalDays} Tage
                      </Badge>
                    </div>
                  </div>
                  
                  {/* 3 Mini calendars */}
                  {quarterMonths.map((monthIndex) => (
                    <div key={monthIndex} className="flex justify-center">
                      {renderMiniCalendar(monthIndex, empAbs, true)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMonthView = () => {
    const daysInMonth = new Date(year, selectedMonth + 1, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-2 sticky left-0 bg-background z-10 min-w-[160px] font-semibold text-sm">
                Mitarbeiter
              </th>
              {days.map((day) => {
                const dateString = `${year}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const date = new Date(dateString);
                const dayOfWeek = date.getDay();
                const isWeekendDay = dayOfWeek === 0 || dayOfWeek === 6;
                const weekdayName = WEEKDAY_NAMES[dayOfWeek === 0 ? 6 : dayOfWeek - 1];
                const holiday = isHoliday(dateString);
                
                return (
                  <th 
                    key={day} 
                    className={`text-center p-1 min-w-[32px] text-xs ${
                      holiday ? 'bg-primary/10' : isWeekendDay ? 'bg-muted/50' : ''
                    }`}
                  >
                    <div className="font-medium">{day}</div>
                    <div className={`text-[10px] ${isWeekendDay || holiday ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}>
                      {weekdayName}
                    </div>
                  </th>
                );
              })}
              <th className="text-center p-2 min-w-[50px] text-sm font-medium sticky right-0 bg-background z-10">
                Tage
              </th>
            </tr>
          </thead>
          <tbody>
            {groupedEmployeeAbsences.map((group) => (
              <>
                {/* Team Header Row */}
                <tr key={`month-team-${group.team?.id || 'no-team'}`} className="bg-muted/50">
                  <td className="p-2 sticky left-0 bg-muted/50 z-10 font-semibold">
                    <div className="flex items-center gap-2">
                      {group.team && (
                        <div 
                          className="w-3 h-3 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: group.team.color }}
                        />
                      )}
                      <span>{group.team?.name || 'Ohne Team'}</span>
                    </div>
                  </td>
                  {days.map((day) => (
                    <td key={`header-${group.team?.id || 'no-team'}-${day}`} className="p-0 bg-muted/50 border-r border-border/30" style={{ height: '24px' }} />
                  ))}
                  <td className="p-2 sticky right-0 bg-muted/50 z-10" />
                </tr>
                
                {/* Employee Rows */}
                {group.employees.map((empAbs) => (
                  <tr key={empAbs.employee.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                    <td className="p-2 sticky left-0 bg-background z-10 pl-6">
                      <div className="font-medium text-sm">{empAbs.employee.full_name}</div>
                      {empAbs.employee.employee_number && (
                        <div className="text-xs text-muted-foreground">
                          {empAbs.employee.employee_number}
                        </div>
                      )}
                    </td>
                    {days.map((day) => {
                      const dateString = `${year}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const absence = getAbsenceForDay(empAbs.absences, dateString);
                      const weekend = isWeekend(dateString);
                      const holiday = isHoliday(dateString);
                      const holidayName = getHolidayName(dateString);
                      const schoolHoliday = getSchoolHolidayForDate(dateString);
                      
                      const absenceStyle = absence ? getAbsenceStyle(absence.type) : null;
                      const bgClass = holiday 
                        ? 'bg-primary/20' 
                        : weekend 
                          ? 'bg-muted/50' 
                          : absence 
                            ? absenceStyle!.color
                            : schoolHoliday 
                              ? 'bg-emerald-100 dark:bg-emerald-900/30'
                              : '';
                      
                      return (
                        <td key={day} className={`p-0 text-center border-r border-border/30 ${bgClass}`}>
                          {(absence || holiday || schoolHoliday) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="w-full h-8 flex items-center justify-center cursor-default">
                                  {absence && <div className={`w-2 h-2 rounded-full ${absence.type === 'vocational_school' ? 'bg-violet-700' : 'bg-amber-700'}`} />}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="text-sm">
                                  {absence && (
                                    <>
                                      <div className="font-semibold">{empAbs.employee.full_name} – {absenceStyle!.label}</div>
                                      <div>
                                        {new Date(absence.start_date).toLocaleDateString("de-DE")} –{" "}
                                        {new Date(absence.end_date).toLocaleDateString("de-DE")}
                                      </div>
                                      {absence.notes && (
                                        <div className="text-muted-foreground mt-1">{absence.notes}</div>
                                      )}
                                    </>
                                  )}
                                  {holiday && <div className="font-medium text-primary">{holidayName}</div>}
                                  {schoolHoliday && <div className="text-emerald-600">{schoolHoliday.name}</div>}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <div className="w-full h-8" />
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center p-2 sticky right-0 bg-background z-10">
                      <Badge variant="secondary" className="font-mono text-xs">{empAbs.totalDays}</Badge>
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Urlaubsplanung
              </CardTitle>
              <div className="flex flex-wrap items-center gap-3">
                {/* View Mode Toggle */}
                <div className="flex gap-0.5 border rounded-lg p-1 bg-muted/30">
                  <Button
                    variant={viewMode === "year" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("year")}
                    className="px-3"
                  >
                    Jahr
                  </Button>
                  <Button
                    variant={viewMode === "quarter" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("quarter")}
                    className="px-3"
                  >
                    Quartal
                  </Button>
                  <Button
                    variant={viewMode === "month" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("month")}
                    className="px-3"
                  >
                    Monat
                  </Button>
                </div>

                {/* Year Navigation */}
                {viewMode === "year" && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setYear(year - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold text-lg min-w-[60px] text-center">
                      {year}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setYear(year + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* Quarter Navigation */}
                {viewMode === "quarter" && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateQuarter(-1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold text-lg min-w-[100px] text-center">
                      {QUARTER_NAMES[selectedQuarter - 1]} {year}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateQuarter(1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* Month Navigation */}
                {viewMode === "month" && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateMonth(-1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="font-semibold text-lg min-w-[150px] text-center">
                      {MONTH_NAMES_FULL[selectedMonth]} {year}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateMonth(1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* Team Filter */}
                <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Team wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Teams</SelectItem>
                    <SelectItem value="none">Kein Team</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: team.color ?? undefined }}
                          />
                          {team.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <div className="animate-pulse">Lade Daten...</div>
              </div>
            ) : employeeAbsences.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                Keine Mitarbeiter für die Auswahl gefunden
              </div>
            ) : (
              <>
                {viewMode === "year" && renderYearView()}
                {viewMode === "quarter" && renderQuarterView()}
                {viewMode === "month" && renderMonthView()}
              </>
            )}

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-6 mt-6 pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-sm">
                <div className="w-5 h-5 rounded bg-amber-400" />
                <span>Urlaub</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-5 h-5 rounded bg-violet-400" />
                <span>Berufsschule</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="w-5 h-5 rounded bg-muted/50 border border-border" />
                <span>Wochenende</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="w-5 h-5 rounded bg-primary/20 border border-primary/20" />
                <span>Feiertag</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="w-5 h-5 rounded bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700" />
                <span>Schulferien</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
