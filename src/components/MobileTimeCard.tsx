import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Pencil, Coffee, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

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

// Formatiert Dezimalzahl: ganze Zahlen ohne Dezimalstellen, ansonsten max 2 Stellen
const formatDecimal = (value: number): string => {
  if (Number.isInteger(value)) {
    return value.toString();
  }
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/\.?0+$/, '');
};

interface TimeEntry {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  notes?: string;
}

interface DayInfo {
  type: string;
  data?: any;
  entries: TimeEntry[];
  hours: number;
  target: number;
  balance: number;
  holidayName?: string;
}

interface MobileTimeCardProps {
  day: Date;
  dayInfo: DayInfo;
  isToday: boolean;
  isExpanded: boolean;
  isFreeDay?: boolean;
  onToggleExpanded: () => void;
  onEditClick: (entry?: TimeEntry) => void;
  onAcceptClick: () => void;
  onFreeClick: () => void;
  onSplitClick: () => void;
  calculateHours: (startTime: string, endTime: string, breakMinutes: number) => number;
}

const MobileTimeCard = ({
  day,
  dayInfo,
  isToday,
  isExpanded,
  isFreeDay = false,
  onToggleExpanded,
  onEditClick,
  onAcceptClick,
  onFreeClick,
  onSplitClick,
  calculateHours,
}: MobileTimeCardProps) => {
  const hasMultipleEntries = dayInfo.entries.length > 1;

  const getStatusBadge = () => {
    switch (dayInfo.type) {
      case 'entry':
        return (
          <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600">
            Erfasst
          </Badge>
        );
      case 'suggested':
        return <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">Vorschlag</Badge>;
      case 'vacation':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">Urlaub</Badge>;
      case 'sick':
        return <Badge variant="destructive">Krank</Badge>;
      case 'holiday':
        return <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">Feiertag</Badge>;
      case 'weekend':
        return <Badge variant="outline">Frei</Badge>;
      case 'vocational_school':
        return <Badge variant="secondary" className="bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300">Berufsschule</Badge>;
      case 'comp_time':
        return <Badge variant="secondary" className="bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300">Überstundenfrei</Badge>;
      case 'unpaid_leave':
        return <Badge variant="secondary" className="bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300">Unbezahlt</Badge>;
      case 'other':
        return <Badge variant="secondary" className="bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300">Sonstiges</Badge>;
      case 'empty':
        return dayInfo.target > 0 ? <Badge variant="outline" className="text-amber-600">Fehlt</Badge> : null;
      default:
        return null;
    }
  };

  const getCardBackground = () => {
    if (isToday) return 'border-primary bg-primary/5';
    switch (dayInfo.type) {
      case 'entry':
        return dayInfo.balance >= 0 
          ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
          : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800';
      case 'weekend':
      case 'holiday':
        return 'bg-muted/50 border-border';
      default:
        return '';
    }
  };

  // Weekend/Holiday - Simple display
  if (dayInfo.type === 'weekend' || dayInfo.type === 'holiday') {
    return (
      <Card className={`p-3 w-full max-w-full ${getCardBackground()}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">{format(day, 'dd.MM', { locale: de })}</div>
            <div className="text-xs text-muted-foreground">{format(day, 'EEEE', { locale: de })}</div>
            {dayInfo.type === 'holiday' && (
              <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">{dayInfo.holidayName}</div>
            )}
          </div>
          {getStatusBadge()}
        </div>
      </Card>
    );
  }

  // Überstundenfrei (comp_time) - Zeigt SOLL und negatives Saldo
  if (dayInfo.type === 'comp_time') {
    return (
      <Card className={`p-3 w-full max-w-full bg-sky-50/50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-800`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-medium">{format(day, 'dd.MM', { locale: de })}</div>
            <div className="text-xs text-muted-foreground">{format(day, 'EEEE', { locale: de })}</div>
            <div className="text-xs text-sky-600 dark:text-sky-400 mt-1">Geplantes Überstundenfrei</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm text-muted-foreground">SOLL: {formatHoursMinutes(dayInfo.target)}</div>
              <div className="text-sm font-semibold text-amber-600">-{formatHoursMinutes(dayInfo.target)}</div>
            </div>
            {getStatusBadge()}
          </div>
        </div>
        <Button variant="outline" size="sm" className="w-full min-h-[44px] touch-manipulation" onClick={() => onEditClick()}>
          <Pencil className="h-4 w-4 mr-1" />
          Zeit erfassen
        </Button>
      </Card>
    );
  }

  // Half vacation (halber Urlaubstag)
  if (dayInfo.type === 'half_vacation') {
    return (
      <Card className={`p-3 w-full max-w-full bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-medium">{format(day, 'dd.MM', { locale: de })}</div>
            <div className="text-xs text-muted-foreground">{format(day, 'EEEE', { locale: de })}</div>
            <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">Halber Urlaubstag</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-lg font-bold">{formatHoursMinutes(dayInfo.hours)}</div>
              <div className="text-sm text-muted-foreground">SOLL: {formatHoursMinutes(dayInfo.target)}</div>
              <div className={`text-xs font-medium ${dayInfo.balance >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {dayInfo.balance >= 0 ? '+' : ''}{formatHoursMinutes(dayInfo.balance)}
              </div>
            </div>
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">½ Urlaub</Badge>
          </div>
        </div>
        <Button variant="outline" size="sm" className="w-full min-h-[44px] touch-manipulation" onClick={() => onEditClick()}>
          <Pencil className="h-4 w-4 mr-1" />
          Zeit erfassen
        </Button>
      </Card>
    );
  }

  // Other absence types - with edit button
  if (['vacation', 'sick', 'vocational_school', 'unpaid_leave', 'other'].includes(dayInfo.type)) {
    return (
      <Card className={`p-3 w-full max-w-full ${getCardBackground()}`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-medium">{format(day, 'dd.MM', { locale: de })}</div>
            <div className="text-xs text-muted-foreground">{format(day, 'EEEE', { locale: de })}</div>
          </div>
          {getStatusBadge()}
        </div>
        <Button variant="outline" size="sm" className="w-full min-h-[44px] touch-manipulation" onClick={() => onEditClick()}>
          <Pencil className="h-4 w-4 mr-1" />
          Zeit erfassen
        </Button>
      </Card>
    );
  }

  // Entry with collapsible details
  if (dayInfo.type === 'entry') {
    return (
      <Card className={`w-full max-w-full ${getCardBackground()}`}>
        <Collapsible open={isExpanded} onOpenChange={onToggleExpanded}>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-medium">{format(day, 'dd.MM', { locale: de })}</div>
                  <div className="text-xs text-muted-foreground">{format(day, 'EEEE', { locale: de })}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-lg font-bold">{formatHoursMinutes(dayInfo.hours)}</div>
                  <div className={`text-xs font-medium ${dayInfo.balance >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {dayInfo.balance >= 0 ? '+' : ''}{formatHoursMinutes(dayInfo.balance)}
                  </div>
                </div>
                {getStatusBadge()}
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-11 w-11 p-0 touch-manipulation">
                    {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
          </div>

          <CollapsibleContent>
            <div className="px-4 pb-4 space-y-3 border-t pt-3">
              {hasMultipleEntries ? (
                dayInfo.entries.map((entry, idx) => {
                  const entryHours = calculateHours(entry.start_time, entry.end_time, entry.break_minutes);
                  return (
                    <div key={entry.id} className="flex items-center justify-between text-sm bg-muted/50 rounded-lg p-3">
                      <div>
                        <div className="font-medium">Block {idx + 1}</div>
                        <div className="text-muted-foreground">
                          {entry.start_time.slice(0, 5)} - {entry.end_time.slice(0, 5)} • {entry.break_minutes}min Pause
                        </div>
                        {entry.notes && <div className="text-xs text-muted-foreground mt-1">{entry.notes}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{formatHoursMinutes(entryHours)}</span>
                        <Button variant="ghost" size="sm" className="h-11 w-11 p-0 touch-manipulation" onClick={() => onEditClick(entry)}>
                          <Pencil className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-sm text-muted-foreground">
                  <div>{dayInfo.data.start_time.slice(0, 5)} - {dayInfo.data.end_time.slice(0, 5)} • {dayInfo.data.break_minutes}min Pause</div>
                  {dayInfo.data.notes && <div className="mt-1">{dayInfo.data.notes}</div>}
                </div>
              )}
              
              <div className="flex flex-wrap gap-2 pt-2">
                {!hasMultipleEntries && (
                  <Button variant="outline" size="sm" className="flex-1 min-w-0 min-h-[44px] touch-manipulation" onClick={() => onEditClick()}>
                    <Pencil className="h-4 w-4 mr-1" />
                    Bearbeiten
                  </Button>
                )}
                <Button variant="outline" size="sm" className="flex-1 min-w-0 min-h-[44px] touch-manipulation" onClick={onSplitClick}>
                  <Plus className="h-4 w-4 mr-1" />
                  Hinzufügen
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className={`h-11 w-11 p-0 shrink-0 touch-manipulation ${
                    isFreeDay 
                      ? 'bg-amber-200 text-amber-700 hover:bg-amber-300 dark:bg-amber-800 dark:text-amber-300 dark:hover:bg-amber-700 border-amber-300 dark:border-amber-700' 
                      : ''
                  }`}
                  onClick={onFreeClick}
                  title={isFreeDay ? 'Gleitzeittag entfernen' : 'Überstundenfrei'}
                >
                  <Coffee className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    );
  }

  // Suggested entry
  if (dayInfo.type === 'suggested') {
    return (
      <Card className={`p-3 w-full max-w-full ${getCardBackground()} border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-medium">{format(day, 'dd.MM', { locale: de })}</div>
            <div className="text-xs text-muted-foreground">{format(day, 'EEEE', { locale: de })}</div>
          </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-lg font-bold text-blue-600">{formatHoursMinutes(dayInfo.hours)}</div>
              </div>
              {getStatusBadge()}
            </div>
        </div>
        
        <div className="text-sm text-blue-600 dark:text-blue-400 mb-3">
          {dayInfo.data.start_time.slice(0, 5)} - {dayInfo.data.end_time.slice(0, 5)} • {dayInfo.data.break_minutes}min Pause
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="flex-1 min-w-0 min-h-[44px] bg-emerald-600 hover:bg-emerald-700 touch-manipulation" onClick={onAcceptClick}>
            <Check className="h-4 w-4 mr-1" />
            Übernehmen
          </Button>
          <Button variant="outline" size="sm" className="h-11 w-11 p-0 shrink-0 touch-manipulation" onClick={() => onEditClick()}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-11 w-11 p-0 shrink-0 touch-manipulation" onClick={onFreeClick} title="Überstundenfrei">
            <Coffee className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    );
  }

  // Empty day - always show action buttons for weekdays
  return (
    <Card className={`p-3 w-full max-w-full ${getCardBackground()}`} onClick={() => onEditClick()}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="font-medium">{format(day, 'dd.MM', { locale: de })}</div>
          <div className="text-xs text-muted-foreground">{format(day, 'EEEE', { locale: de })}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {dayInfo.target > 0 && (
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Soll: {formatHoursMinutes(dayInfo.target)}</div>
              <div className="text-xs text-amber-600">-{formatHoursMinutes(dayInfo.target)}</div>
            </div>
          )}
          {getStatusBadge()}
        </div>
      </div>
      
      <div className="flex gap-2 mt-3">
        <Button variant="outline" size="sm" className="flex-1 min-w-0 min-h-[44px] touch-manipulation" onClick={(e) => { e.stopPropagation(); onEditClick(); }}>
          <Plus className="h-4 w-4 mr-1" />
          Zeit erfassen
        </Button>
        <Button variant="outline" size="sm" className="h-11 w-11 p-0 shrink-0 touch-manipulation" onClick={(e) => { e.stopPropagation(); onFreeClick(); }} title="Überstundenfrei">
          <Coffee className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
};

export default MobileTimeCard;
