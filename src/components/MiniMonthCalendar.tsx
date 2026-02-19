import { Card } from '@/components/ui/card';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface DayStatus {
  date: Date;
  status: 'complete' | 'missing' | 'absence' | 'weekend' | 'holiday';
  hours?: number;
  target?: number;
}

interface MiniMonthCalendarProps {
  date: Date;
  dayStatuses: DayStatus[];
  onDateClick?: (date: Date) => void;
}

export const MiniMonthCalendar = ({ date, dayStatuses, onDateClick }: MiniMonthCalendarProps) => {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  
  // Fülle den Anfang mit Tagen vom vorherigen Monat auf
  const firstDayOfWeek = getDay(monthStart);
  const leadingDays = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Mo = 0
  
  const getDayStatus = (day: Date): DayStatus => {
    return dayStatuses.find(s => isSameDay(s.date, day)) || {
      date: day,
      status: 'weekend'
    };
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete':
        return 'bg-emerald-500 hover:bg-emerald-600';
      case 'missing':
        return 'bg-destructive hover:bg-destructive/90';
      case 'absence':
        return 'bg-muted hover:bg-muted/80';
      case 'weekend':
        return 'bg-muted/50 hover:bg-muted/60';
      case 'holiday':
        return 'bg-primary/20 hover:bg-primary/30';
      default:
        return 'bg-muted hover:bg-muted/80';
    }
  };

  const weekDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  return (
    <Card className="p-3 sm:p-6 overflow-hidden">
      <h3 className="text-base sm:text-lg font-semibold mb-4">
        {format(date, 'MMMM yyyy', { locale: de })}
      </h3>
      
      {/* Wochentage */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map(day => (
          <div key={day} className="text-center text-xs font-medium text-muted-foreground p-1">
            {day}
          </div>
        ))}
      </div>
      
      {/* Tage */}
      <div className="grid grid-cols-7 gap-1">
        {/* Leere Zellen am Anfang */}
        {Array.from({ length: leadingDays }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square" />
        ))}
        
        {/* Tatsächliche Tage */}
        {daysInMonth.map(day => {
          const status = getDayStatus(day);
          const isToday = isSameDay(day, new Date());
          
          return (
            <button
              key={day.toISOString()}
              onClick={() => onDateClick?.(day)}
              className={cn(
                'aspect-square rounded-md transition-all duration-200 flex items-center justify-center text-xs font-medium relative',
                getStatusColor(status.status),
                isToday && 'ring-2 ring-primary ring-offset-2',
                onDateClick && 'cursor-pointer'
              )}
              title={`${format(day, 'dd.MM.yyyy')}: ${status.status}`}
            >
              <span className={cn(
                status.status === 'weekend' || status.status === 'absence' || status.status === 'holiday'
                  ? 'text-muted-foreground' 
                  : 'text-white'
              )}>
                {format(day, 'd')}
              </span>
            </button>
          );
        })}
      </div>
      
      {/* Legende */}
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-emerald-500" />
          <span className="text-muted-foreground">Eingetragen</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-destructive" />
          <span className="text-muted-foreground">Fehlend</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-primary/20" />
          <span className="text-muted-foreground">Feiertag</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-muted" />
          <span className="text-muted-foreground">Frei/Urlaub</span>
        </div>
      </div>
    </Card>
  );
};
