import { useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Calendar, ChevronDown, ChevronRight, Plus, Save, Trash2, X, Pencil } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAudit } from '@/lib/auditLog';

interface WorkSchedule {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  break_minutes: number;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
}

interface SchedulePeriod {
  valid_from: string;
  valid_to: string | null;
  days: WorkSchedule[];
}

interface WorkSchedulePeriodsProps {
  userId: string;
  periods: SchedulePeriod[];
  onUpdate: () => void;
}

const WorkSchedulePeriods = ({ userId, periods, onUpdate }: WorkSchedulePeriodsProps) => {
  const [expandedPeriods, setExpandedPeriods] = useState<string[]>(
    periods.length > 0 ? [`${periods[0].valid_from}_${periods[0].valid_to || 'unbefristet'}`] : []
  );
  const [newPeriodDialogOpen, setNewPeriodDialogOpen] = useState(false);
  const [newPeriodForm, setNewPeriodForm] = useState({
    valid_from: format(new Date(), 'yyyy-MM-dd'),
    valid_to: '',
    copyFromPeriod: '',
  });
  const [editingDay, setEditingDay] = useState<{
    periodKey: string;
    dayId: string;
    start: string;
    end: string;
    break: string;
  } | null>(null);
  const [addingDay, setAddingDay] = useState<{
    periodKey: string;
    day_of_week: number;
    start: string;
    end: string;
    break: string;
  } | null>(null);

  const weekDays = [
    { value: 1, label: 'Montag' },
    { value: 2, label: 'Dienstag' },
    { value: 3, label: 'Mittwoch' },
    { value: 4, label: 'Donnerstag' },
    { value: 5, label: 'Freitag' },
    { value: 6, label: 'Samstag' },
    { value: 0, label: 'Sonntag' },
  ];

  const getPeriodKey = (period: SchedulePeriod) => 
    `${period.valid_from}_${period.valid_to || 'unbefristet'}`;

  const togglePeriod = (key: string) => {
    setExpandedPeriods(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const getPeriodLabel = (period: SchedulePeriod) => {
    const from = format(new Date(period.valid_from), 'dd.MM.yyyy', { locale: de });
    const to = period.valid_to 
      ? format(new Date(period.valid_to), 'dd.MM.yyyy', { locale: de })
      : 'unbefristet';
    
    const isActive = !period.valid_to || new Date(period.valid_to) >= new Date();
    
    return {
      label: `${from} - ${to}`,
      isActive,
    };
  };

  const getAvailableDays = (period: SchedulePeriod) => {
    const usedDays = period.days.map(d => d.day_of_week);
    return weekDays.filter(wd => !usedDays.includes(wd.value));
  };

  const handleCreatePeriod = async () => {
    if (!newPeriodForm.valid_from) {
      toast.error('Bitte "Gültig ab" Datum angeben');
      return;
    }

    try {
      // If copying from another period
      if (newPeriodForm.copyFromPeriod) {
        const sourcePeriod = periods.find(p => getPeriodKey(p) === newPeriodForm.copyFromPeriod);
        if (sourcePeriod) {
          const inserts = sourcePeriod.days.map(day => ({
            user_id: userId,
            day_of_week: day.day_of_week,
            start_time: day.start_time,
            end_time: day.end_time,
            break_minutes: day.break_minutes,
            valid_from: newPeriodForm.valid_from,
            valid_to: newPeriodForm.valid_to || null,
            is_active: true,
          }));

          const { error } = await supabase
            .from('employee_work_schedules')
            .insert(inserts);

          if (error) throw error;
          
          toast.success('Periode mit allen Arbeitstagen erstellt');
          setNewPeriodDialogOpen(false);
          setNewPeriodForm({ valid_from: format(new Date(), 'yyyy-MM-dd'), valid_to: '', copyFromPeriod: '' });
          onUpdate();
        }
      } else {
        // Create a placeholder Monday when not copying
        const { error } = await supabase
          .from('employee_work_schedules')
          .insert({
            user_id: userId,
            day_of_week: 1, // Monday
            start_time: '08:00:00',
            end_time: '17:00:00',
            break_minutes: 60,
            valid_from: newPeriodForm.valid_from,
            valid_to: newPeriodForm.valid_to || null,
            is_active: true,
          });

        if (error) throw error;

        toast.success('Periode erstellt! Bitte passen Sie die Arbeitstage an.');
        setNewPeriodDialogOpen(false);
        setNewPeriodForm({ valid_from: format(new Date(), 'yyyy-MM-dd'), valid_to: '', copyFromPeriod: '' });
        
        // Auto-expand the new period
        const newPeriodKey = `${newPeriodForm.valid_from}_${newPeriodForm.valid_to || 'unbefristet'}`;
        setExpandedPeriods([newPeriodKey]);
        
        onUpdate();
      }
    } catch (error: unknown) {
      console.error('Error creating period:', error);
      toast.error(error instanceof Error ? error.message : 'Fehler beim Erstellen der Periode');
    }
  };

  const handleSaveDay = async () => {
    if (!editingDay) return;

    const period = periods.find(p => getPeriodKey(p) === editingDay.periodKey);
    const dayToUpdate = period?.days.find(d => d.id === editingDay.dayId);
    const weekDay = weekDays.find(wd => wd.value === dayToUpdate?.day_of_week);

    try {
      const { error } = await supabase
        .from('employee_work_schedules')
        .update({
          start_time: editingDay.start,
          end_time: editingDay.end,
          break_minutes: parseInt(editingDay.break, 10) || 0,
        })
        .eq('id', editingDay.dayId);

      if (error) throw error;

      await logAudit({
        action: 'UPDATE',
        tableName: 'employee_work_schedules',
        recordId: editingDay.dayId,
        oldValues: dayToUpdate ? {
          start_time: dayToUpdate.start_time,
          end_time: dayToUpdate.end_time,
          break_minutes: dayToUpdate.break_minutes,
        } : undefined,
        newValues: {
          start_time: editingDay.start,
          end_time: editingDay.end,
          break_minutes: parseInt(editingDay.break, 10) || 0,
        },
        description: `Arbeitszeit ${weekDay?.label || ''} aktualisiert`,
      });

      toast.success('Arbeitszeit aktualisiert');
      setEditingDay(null);
      onUpdate();
    } catch (error: unknown) {
      console.error('Error saving day:', error);
      toast.error(error instanceof Error ? error.message : 'Fehler beim Speichern');
    }
  };

  const handleAddDay = async () => {
    if (!addingDay) return;

    try {
      const period = periods.find(p => getPeriodKey(p) === addingDay.periodKey);
      if (!period) return;

      const weekDay = weekDays.find(wd => wd.value === addingDay.day_of_week);

      const { data: newSchedule, error } = await supabase
        .from('employee_work_schedules')
        .insert({
          user_id: userId,
          day_of_week: addingDay.day_of_week,
          start_time: addingDay.start,
          end_time: addingDay.end,
          break_minutes: parseInt(addingDay.break, 10) || 0,
          valid_from: period.valid_from,
          valid_to: period.valid_to,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      await logAudit({
        action: 'INSERT',
        tableName: 'employee_work_schedules',
        recordId: newSchedule?.id,
        newValues: {
          day_of_week: addingDay.day_of_week,
          start_time: addingDay.start,
          end_time: addingDay.end,
          break_minutes: parseInt(addingDay.break, 10) || 0,
          valid_from: period.valid_from,
          valid_to: period.valid_to,
        },
        description: `Arbeitstag ${weekDay?.label || ''} hinzugefügt`,
      });

      toast.success('Tag hinzugefügt');
      setAddingDay(null);
      onUpdate();
    } catch (error: unknown) {
      console.error('Error adding day:', error);
      toast.error(error instanceof Error ? error.message : 'Fehler beim Hinzufügen');
    }
  };

  const handleDeleteDay = async (dayId: string) => {
    const period = periods.find(p => p.days.some(d => d.id === dayId));
    const dayToDelete = period?.days.find(d => d.id === dayId);
    const weekDay = weekDays.find(wd => wd.value === dayToDelete?.day_of_week);

    try {
      const { error } = await supabase
        .from('employee_work_schedules')
        .delete()
        .eq('id', dayId);

      if (error) throw error;

      await logAudit({
        action: 'DELETE',
        tableName: 'employee_work_schedules',
        recordId: dayId,
        oldValues: dayToDelete ? {
          day_of_week: dayToDelete.day_of_week,
          start_time: dayToDelete.start_time,
          end_time: dayToDelete.end_time,
          break_minutes: dayToDelete.break_minutes,
        } : undefined,
        description: `Arbeitstag ${weekDay?.label || ''} gelöscht`,
      });

      toast.success('Tag gelöscht');
      onUpdate();
    } catch (error: unknown) {
      console.error('Error deleting day:', error);
      toast.error(error instanceof Error ? error.message : 'Fehler beim Löschen');
    }
  };

  const handleClosePeriod = async (period: SchedulePeriod) => {
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      
      const { error } = await supabase
        .from('employee_work_schedules')
        .update({ valid_to: today })
        .eq('user_id', userId)
        .eq('valid_from', period.valid_from)
        .is('valid_to', null);

      if (error) throw error;

      toast.success('Periode beendet');
      onUpdate();
    } catch (error: unknown) {
      console.error('Error closing period:', error);
      toast.error(error instanceof Error ? error.message : 'Fehler beim Beenden der Periode');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Arbeitszeiten mit Gültigkeitszeiträumen verwalten
        </p>
        <Button onClick={() => setNewPeriodDialogOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Neue Periode
        </Button>
      </div>

      {periods.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          Keine Arbeitszeiten definiert. Erstellen Sie eine neue Periode.
        </div>
      ) : (
        <div className="space-y-2">
          {periods.map(period => {
            const periodKey = getPeriodKey(period);
            const { label, isActive } = getPeriodLabel(period);
            const isExpanded = expandedPeriods.includes(periodKey);
            const availableDays = getAvailableDays(period);

            return (
              <Collapsible key={periodKey} open={isExpanded} onOpenChange={() => togglePeriod(periodKey)}>
                <div className="border rounded-lg">
                  <CollapsibleTrigger className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Calendar className="h-4 w-4" />
                      <span className="font-medium">{label}</span>
                      {isActive && (
                        <Badge variant="default" className="ml-2">Aktuell</Badge>
                      )}
                      <span className="text-sm text-muted-foreground">
                        ({period.days.length} {period.days.length === 1 ? 'Tag' : 'Tage'})
                      </span>
                    </div>
                    {isActive && !period.valid_to && (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClosePeriod(period);
                        }}
                      >
                        Periode beenden
                      </Button>
                    )}
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="p-4 border-t">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Wochentag</TableHead>
                            <TableHead>Start</TableHead>
                            <TableHead>Ende</TableHead>
                            <TableHead>Soll-Pause (Min)</TableHead>
                            <TableHead className="text-right">Aktionen</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {period.days.map(day => {
                            const weekDay = weekDays.find(wd => wd.value === day.day_of_week);
                            const isEditing = editingDay?.dayId === day.id;

                            return (
                              <TableRow key={day.id}>
                                <TableCell>{weekDay?.label}</TableCell>
                                <TableCell>
                                  {isEditing ? (
                                    <Input
                                      type="time"
                                      value={editingDay.start}
                                      onChange={(e) => setEditingDay({ ...editingDay, start: e.target.value })}
                                      className="w-32"
                                    />
                                  ) : (
                                    day.start_time.slice(0, 5)
                                  )}
                                </TableCell>
                                <TableCell>
                                  {isEditing ? (
                                    <Input
                                      type="time"
                                      value={editingDay.end}
                                      onChange={(e) => setEditingDay({ ...editingDay, end: e.target.value })}
                                      className="w-32"
                                    />
                                  ) : (
                                    day.end_time.slice(0, 5)
                                  )}
                                </TableCell>
                                <TableCell>
                                  {isEditing ? (
                                    <Input
                                      type="number"
                                      value={editingDay.break}
                                      onChange={(e) => setEditingDay({ ...editingDay, break: e.target.value })}
                                      className="w-24"
                                      min="0"
                                    />
                                  ) : (
                                    day.break_minutes
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  {isEditing ? (
                                    <div className="flex justify-end gap-2">
                                      <Button size="sm" onClick={handleSaveDay}>
                                        <Save className="h-4 w-4" />
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => setEditingDay(null)}>
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="flex justify-end gap-2">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setEditingDay({
                                          periodKey,
                                          dayId: day.id,
                                          start: day.start_time.slice(0, 5),
                                          end: day.end_time.slice(0, 5),
                                          break: String(day.break_minutes),
                                        })}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleDeleteDay(day.id)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          
                          {/* Add new day row */}
                          {addingDay?.periodKey === periodKey ? (
                            <TableRow>
                              <TableCell>
                                <select
                                  value={addingDay.day_of_week}
                                  onChange={(e) => setAddingDay({ ...addingDay, day_of_week: parseInt(e.target.value, 10) })}
                                  className="w-full p-2 border rounded"
                                >
                                  {availableDays.map(wd => (
                                    <option key={wd.value} value={wd.value}>{wd.label}</option>
                                  ))}
                                </select>
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="time"
                                  value={addingDay.start}
                                  onChange={(e) => setAddingDay({ ...addingDay, start: e.target.value })}
                                  className="w-32"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="time"
                                  value={addingDay.end}
                                  onChange={(e) => setAddingDay({ ...addingDay, end: e.target.value })}
                                  className="w-32"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  value={addingDay.break}
                                  onChange={(e) => setAddingDay({ ...addingDay, break: e.target.value })}
                                  className="w-24"
                                  min="0"
                                />
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" onClick={handleAddDay}>
                                    <Save className="h-4 w-4" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setAddingDay(null)}>
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : availableDays.length > 0 && (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setAddingDay({
                                    periodKey,
                                    day_of_week: availableDays[0].value,
                                    start: '08:00',
                                    end: '17:00',
                                    break: '60',
                                  })}
                                >
                                  <Plus className="h-4 w-4 mr-2" />
                                  Tag hinzufügen
                                </Button>
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      )}

      {/* New Period Dialog */}
      <Dialog open={newPeriodDialogOpen} onOpenChange={setNewPeriodDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neue Arbeitszeit-Periode erstellen</DialogTitle>
            <DialogDescription>
              Definieren Sie den Gültigkeitszeitraum für die neuen Arbeitszeiten.
              {periods.length > 0 
                ? ' Sie können optional eine bestehende Periode kopieren.'
                : ' Nach dem Erstellen können Sie die Arbeitstage festlegen.'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="valid_from">Gültig ab *</Label>
              <Input
                id="valid_from"
                type="date"
                value={newPeriodForm.valid_from}
                onChange={(e) => setNewPeriodForm({ ...newPeriodForm, valid_from: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="valid_to">Gültig bis (optional)</Label>
              <Input
                id="valid_to"
                type="date"
                value={newPeriodForm.valid_to}
                onChange={(e) => setNewPeriodForm({ ...newPeriodForm, valid_to: e.target.value })}
              />
              <p className="text-sm text-muted-foreground mt-1">
                Leer lassen für unbefristete Periode
              </p>
            </div>

            {periods.length > 0 && (
              <div>
                <Label htmlFor="copy_from">Von bestehender Periode kopieren (optional)</Label>
                <select
                  id="copy_from"
                  value={newPeriodForm.copyFromPeriod}
                  onChange={(e) => setNewPeriodForm({ ...newPeriodForm, copyFromPeriod: e.target.value })}
                  className="w-full p-2 border rounded"
                >
                  <option value="">-- Nicht kopieren --</option>
                  {periods.map(period => {
                    const key = getPeriodKey(period);
                    const { label } = getPeriodLabel(period);
                    return (
                      <option key={key} value={key}>{label}</option>
                    );
                  })}
                </select>
                <p className="text-sm text-muted-foreground mt-1">
                  Übernimmt alle Arbeitstage aus der ausgewählten Periode
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setNewPeriodDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleCreatePeriod}>Erstellen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WorkSchedulePeriods;
