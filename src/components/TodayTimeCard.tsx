"use client";

import { useState, useEffect } from 'react';
import { format, getDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, Check, Pencil, Coffee, Plus, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAudit } from '@/lib/auditLog';
import QuickTimeEdit from './QuickTimeEdit';
import { SplitTimeDialog } from './SplitTimeDialog';

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
  notes?: string | null;
}

interface TodayTimeCardProps {
  userId: string;
  onDataChanged?: () => void;
  timeTrackingExempt?: boolean;
}

export const TodayTimeCard = ({ userId, onDataChanged, timeTrackingExempt = false }: TodayTimeCardProps) => {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [schedule, setSchedule] = useState<any>(null);
  const [absence, setAbsence] = useState<any>(null);
  const [holiday, setHoliday] = useState<any>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<TimeEntry | undefined>(undefined);
  const [breakRules, setBreakRules] = useState<any[]>([]);

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const dayOfWeek = getDay(today);
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  useEffect(() => {
    loadTodayData();
    loadBreakRules();
  }, [userId]);

  const loadBreakRules = async () => {
    const { data } = await supabase
      .from('break_rules')
      .select('*')
      .order('priority', { ascending: false });
    setBreakRules(data || []);
  };

  const loadTodayData = async () => {
    if (!userId) return;
    setLoading(true);

    try {
      const [entriesRes, schedulesRes, absencesRes, holidaysRes] = await Promise.all([
        supabase.from('time_entries').select('*').eq('user_id', userId).eq('date', todayStr),
        supabase.from('employee_work_schedules').select('*').eq('user_id', userId).eq('day_of_week', dayOfWeek).lte('valid_from', todayStr).or(`valid_to.is.null,valid_to.gte.${todayStr}`),
        supabase.from('absences').select('*').eq('user_id', userId).eq('status', 'approved').lte('start_date', todayStr).gte('end_date', todayStr),
        supabase.from('holidays').select('*').eq('date', todayStr)
      ]);

      setEntries(entriesRes.data || []);
      setSchedule(schedulesRes.data?.[0] || null);
      setAbsence(absencesRes.data?.[0] || null);
      setHoliday(holidaysRes.data?.[0] || null);
    } catch (error) {
      console.error('Error loading today data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateHours = (startTime: string, endTime: string, breakMinutes: number) => {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM) - breakMinutes;
    return Math.max(0, totalMinutes / 60);
  };

  const calculateSuggestedBreak = (startTime: string, endTime: string) => {
    const hours = calculateHours(startTime, endTime, 0);
    const applicableRule = breakRules.find(rule => hours >= rule.min_work_hours);
    return applicableRule?.break_minutes || 0;
  };

  const totalHours = entries.reduce((sum, e) => sum + calculateHours(e.start_time, e.end_time, e.break_minutes), 0);
  
  const targetHours = schedule 
    ? calculateHours(schedule.start_time, schedule.end_time, schedule.break_minutes) 
    : 0;

  const balance = totalHours - targetHours;
  const hasEntries = entries.length > 0;
  const hasMultipleEntries = entries.length > 1;

  // Determine day type
  const getDayType = () => {
    // Wochenende nur als weekend anzeigen wenn keine Einträge und kein Schedule
    if (isWeekend && !hasEntries && !schedule) return 'weekend';
    if (holiday) return 'holiday';
    if (absence?.type === 'vacation') return 'vacation';
    if (absence?.type === 'sick') return 'sick';
    if (hasEntries) return 'entry';
    if (schedule) return 'suggested';
    // Wochenende ohne Einträge/Schedule: als empty anzeigen (erlaubt manuelle Erfassung)
    if (isWeekend) return 'empty';
    return 'empty';
  };

  const dayType = getDayType();

  const handleAccept = async () => {
    if (!schedule) return;
    
    try {
      const { data, error } = await supabase.from('time_entries').insert({
        user_id: userId,
        date: todayStr,
        start_time: schedule.start_time,
        end_time: schedule.end_time,
        break_minutes: schedule.break_minutes,
      }).select().single();

      if (error) throw error;

      await logAudit({
        action: 'INSERT',
        tableName: 'time_entries',
        recordId: data.id,
        newValues: data,
        description: `Zeit aus Vorschlag übernommen: ${format(today, 'dd.MM.yyyy')}`,
      });

      toast.success('Vorschlag übernommen');
      loadTodayData();
      onDataChanged?.();
    } catch (error) {
      console.error('Error accepting suggestion:', error);
      toast.error('Fehler beim Übernehmen');
    }
  };

  // Hilfsfunktion: Prüft ob heute ein Gleitzeittag ist
  const checkIsFreeDay = (): boolean => {
    if (entries.length !== 1) return false;
    const entry = entries[0];
    return (entry.start_time === '00:00:00' || entry.start_time === '00:00') &&
           (entry.end_time === '00:00:00' || entry.end_time === '00:00');
  };

  const isFreeDay = checkIsFreeDay();

  const handleFreeDay = async () => {
    try {
      // Wenn bereits ein Gleitzeittag → Löschen
      if (isFreeDay && entries.length === 1) {
        const { error } = await supabase
          .from('time_entries')
          .delete()
          .eq('id', entries[0].id);

        if (error) throw error;

        await logAudit({
          action: 'DELETE',
          tableName: 'time_entries',
          recordId: entries[0].id,
          description: `Gleitzeittag entfernt: ${format(today, 'dd.MM.yyyy')}`,
        });

        toast.success('Gleitzeittag entfernt');
      } else if (entries.length > 0) {
        // Alle weiteren Einträge löschen, falls mehrere existieren
        if (entries.length > 1) {
          const idsToDelete = entries.slice(1).map(e => e.id);
          await supabase.from('time_entries').delete().in('id', idsToDelete);
        }
        
        // Ersten Eintrag auf 0 Stunden aktualisieren
        const { error } = await supabase.from('time_entries')
          .update({
            start_time: '00:00:00',
            end_time: '00:00:00',
            break_minutes: 0,
            notes: 'Überstundenfrei / Gleitzeittag'
          })
          .eq('id', entries[0].id);

        if (error) throw error;

        await logAudit({
          action: 'UPDATE',
          tableName: 'time_entries',
          recordId: entries[0].id,
          description: `Als überstundenfrei markiert: ${format(today, 'dd.MM.yyyy')}`,
        });

        toast.success('Als überstundenfrei markiert');
      } else {
        // Neuen Eintrag erstellen
        const { data, error } = await supabase.from('time_entries').insert({
          user_id: userId,
          date: todayStr,
          start_time: '00:00',
          end_time: '00:00',
          break_minutes: 0,
          notes: 'Überstundenfrei / Gleitzeittag',
        }).select().single();

        if (error) throw error;

        await logAudit({
          action: 'INSERT',
          tableName: 'time_entries',
          recordId: data.id,
          newValues: data,
          description: `Als überstundenfrei markiert: ${format(today, 'dd.MM.yyyy')}`,
        });

        toast.success('Als überstundenfrei markiert');
      }

      loadTodayData();
      onDataChanged?.();
    } catch (error) {
      console.error('Error toggling free day:', error);
      toast.error('Fehler beim Speichern');
    }
  };

  const handleEditClick = (entry?: TimeEntry) => {
    setSelectedEntry(entry || entries[0]);
    setShowEditDialog(true);
  };

  const handleDialogClose = () => {
    setShowEditDialog(false);
    setSelectedEntry(undefined);
  };

  const handleSaved = () => {
    handleDialogClose();
    loadTodayData();
    onDataChanged?.();
  };

  const handleSplitSaved = () => {
    loadTodayData();
    onDataChanged?.();
  };

  if (loading) {
    return (
      <Card className="p-4 sm:p-6 border-primary bg-primary/5">
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </Card>
    );
  }

  // If time tracking exempt, show simplified view
  if (timeTrackingExempt) {
    return (
      <Card className="p-4 sm:p-6 bg-muted/30 border-dashed">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-semibold">Heute - {format(today, 'EEEE, dd. MMMM', { locale: de })}</p>
              {holiday && <p className="text-sm text-purple-600">{holiday.name}</p>}
              {absence?.type === 'vacation' && <p className="text-sm text-amber-600">Urlaub</p>}
              {absence?.type === 'sick' && <p className="text-sm text-red-600">Krank</p>}
            </div>
          </div>
          <Badge variant="outline" className="text-muted-foreground">Keine Zeiterfassung</Badge>
        </div>
      </Card>
    );
  }

  // Weekend/Holiday display
  if (dayType === 'weekend' || dayType === 'holiday') {
    return (
      <Card className="p-4 sm:p-6 bg-muted/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-semibold">Heute - {format(today, 'EEEE, dd. MMMM', { locale: de })}</p>
              {dayType === 'holiday' && <p className="text-sm text-purple-600">{holiday.name}</p>}
            </div>
          </div>
          <Badge variant="outline">{dayType === 'holiday' ? 'Feiertag' : 'Wochenende'}</Badge>
        </div>
      </Card>
    );
  }

  // Vacation/Sick display
  if (dayType === 'vacation' || dayType === 'sick') {
    return (
      <Card className={`p-4 sm:p-6 ${dayType === 'vacation' ? 'bg-yellow-50/50 dark:bg-yellow-950/20 border-yellow-200' : 'bg-red-50/50 dark:bg-red-950/20 border-red-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-semibold">Heute - {format(today, 'EEEE, dd. MMMM', { locale: de })}</p>
            </div>
          </div>
          <Badge variant={dayType === 'sick' ? 'destructive' : 'secondary'}>
            {dayType === 'vacation' ? 'Urlaub' : 'Krank'}
          </Badge>
        </div>
      </Card>
    );
  }

  // Entry display with collapsible
  if (dayType === 'entry') {
    return (
      <>
        <Card className={`border-primary bg-primary/5 ${balance >= 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : 'bg-amber-50/50 dark:bg-amber-950/20'}`}>
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="font-semibold">Heute - {format(today, 'EEEE, dd. MMMM', { locale: de })}</p>
                    {!hasMultipleEntries && entries[0] && (
                      <p className="text-sm text-muted-foreground">
                        {entries[0].start_time.slice(0, 5)} - {entries[0].end_time.slice(0, 5)} • {entries[0].break_minutes}min Pause
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xl font-bold">{formatHoursMinutes(totalHours)}</div>
                    <div className={`text-xs font-medium ${balance >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {balance >= 0 ? '+' : ''}{formatHoursMinutes(balance)}
                    </div>
                  </div>
                  <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600">
                    Erfasst
                  </Badge>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-10 w-10 p-0">
                      {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </div>
            </div>

            <CollapsibleContent>
              <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-3 border-t pt-3">
                {hasMultipleEntries ? (
                  entries.map((entry, idx) => {
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
                          <Button variant="ghost" size="sm" className="h-10 w-10 p-0" onClick={() => handleEditClick(entry)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                ) : entries[0] && (
                  <div className="text-sm text-muted-foreground">
                    {entries[0].notes && <div>{entries[0].notes}</div>}
                  </div>
                )}
                
                <div className="flex flex-wrap gap-2 pt-2">
                  {!hasMultipleEntries && (
                    <Button variant="outline" size="sm" className="flex-1 min-w-0 min-h-[44px]" onClick={() => handleEditClick()}>
                      <Pencil className="h-4 w-4 mr-1" />
                      Bearbeiten
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="flex-1 min-w-0 min-h-[44px]" onClick={() => setShowSplitDialog(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Hinzufügen
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className={`h-11 w-11 p-0 shrink-0 ${
                      isFreeDay 
                        ? 'bg-amber-200 text-amber-700 hover:bg-amber-300 dark:bg-amber-800 dark:text-amber-300 dark:hover:bg-amber-700 border-amber-300 dark:border-amber-700' 
                        : ''
                    }`}
                    onClick={handleFreeDay}
                    title={isFreeDay ? 'Gleitzeittag entfernen' : 'Überstundenfrei'}
                  >
                    <Coffee className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>

        {showEditDialog && (
          <QuickTimeEdit
            userId={userId}
            date={today}
            existingEntry={selectedEntry}
            onClose={handleDialogClose}
            onSave={handleSaved}
            calculateSuggestedBreak={calculateSuggestedBreak}
          />
        )}

        <SplitTimeDialog
          open={showSplitDialog}
          onOpenChange={setShowSplitDialog}
          date={today}
          userId={userId}
          onSaved={handleSplitSaved}
        />
      </>
    );
  }

  // Suggested entry
  if (dayType === 'suggested' && schedule) {
    const suggestedHours = calculateHours(schedule.start_time, schedule.end_time, schedule.break_minutes);
    
    return (
      <>
        <Card className="p-4 sm:p-6 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-blue-600" />
              <div>
                <p className="font-semibold">Heute - {format(today, 'EEEE, dd. MMMM', { locale: de })}</p>
                <p className="text-sm text-blue-600">
                  {schedule.start_time.slice(0, 5)} - {schedule.end_time.slice(0, 5)} • {schedule.break_minutes}min Pause
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xl font-bold text-blue-600">{formatHoursMinutes(suggestedHours)}</div>
              </div>
              <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                Vorschlag
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="flex-1 min-w-0 min-h-[44px] bg-emerald-600 hover:bg-emerald-700" onClick={handleAccept}>
              <Check className="h-4 w-4 mr-1" />
              Übernehmen
            </Button>
            <Button variant="outline" size="sm" className="h-11 w-11 p-0 shrink-0" onClick={() => {
              setSelectedEntry(undefined);
              setShowEditDialog(true);
            }}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-11 w-11 p-0 shrink-0" onClick={handleFreeDay} title="Überstundenfrei">
              <Coffee className="h-4 w-4" />
            </Button>
          </div>
        </Card>

        {showEditDialog && (
          <QuickTimeEdit
            userId={userId}
            date={today}
            suggestedData={{
              start_time: schedule.start_time,
              end_time: schedule.end_time,
              break_minutes: schedule.break_minutes,
            }}
            onClose={handleDialogClose}
            onSave={handleSaved}
            calculateSuggestedBreak={calculateSuggestedBreak}
          />
        )}
      </>
    );
  }

  // Empty day
  return (
    <>
      <Card className="p-4 sm:p-6 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-amber-600" />
            <div>
              <p className="font-semibold">Heute - {format(today, 'EEEE, dd. MMMM', { locale: de })}</p>
              {targetHours > 0 && (
                <p className="text-sm text-amber-600">Soll: {formatHoursMinutes(targetHours)}</p>
              )}
            </div>
          </div>
          <Badge variant="outline" className="text-amber-600 border-amber-300">Fehlt</Badge>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 min-w-0 min-h-[44px]" onClick={() => {
            setSelectedEntry(undefined);
            setShowEditDialog(true);
          }}>
            <Plus className="h-4 w-4 mr-1" />
            Zeit erfassen
          </Button>
          <Button variant="outline" size="sm" className="h-11 w-11 p-0 shrink-0" onClick={handleFreeDay} title="Überstundenfrei">
            <Coffee className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {showEditDialog && (
        <QuickTimeEdit
          userId={userId}
          date={today}
          onClose={handleDialogClose}
          onSave={handleSaved}
          calculateSuggestedBreak={calculateSuggestedBreak}
        />
      )}
    </>
  );
};
