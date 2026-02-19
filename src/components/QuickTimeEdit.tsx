import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { logAudit } from '@/lib/auditLog';

interface QuickTimeEditProps {
  userId: string;
  date: Date;
  existingEntry?: {
    id: string;
    start_time: string;
    end_time: string;
    break_minutes: number;
    notes?: string;
  };
  suggestedData?: {
    start_time: string;
    end_time: string;
    break_minutes: number;
  };
  onClose: () => void;
  onSave: () => void;
  calculateSuggestedBreak: (startTime: string, endTime: string) => number;
}

const QuickTimeEdit = ({
  userId,
  date,
  existingEntry,
  suggestedData,
  onClose,
  onSave,
  calculateSuggestedBreak,
}: QuickTimeEditProps) => {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (existingEntry) {
      setStartTime(existingEntry.start_time.slice(0, 5));
      setEndTime(existingEntry.end_time.slice(0, 5));
      setBreakMinutes(existingEntry.break_minutes);
      setNotes(existingEntry.notes || '');
    } else if (suggestedData) {
      setStartTime(suggestedData.start_time.slice(0, 5));
      setEndTime(suggestedData.end_time.slice(0, 5));
      setBreakMinutes(suggestedData.break_minutes);
    }
  }, [existingEntry, suggestedData]);

  useEffect(() => {
    if (startTime && endTime && !existingEntry) {
      const suggested = calculateSuggestedBreak(startTime, endTime);
      setBreakMinutes(suggested);
    }
  }, [startTime, endTime]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!startTime || !endTime) {
      toast.error('Bitte Start- und Endzeit eingeben');
      return;
    }

    setLoading(true);
    try {
      const dateStr = format(date, 'yyyy-MM-dd');

      if (existingEntry) {
        // Update existing entry
        const { error } = await supabase
          .from('time_entries')
          .update({
            start_time: startTime,
            end_time: endTime,
            break_minutes: breakMinutes,
            notes: notes || null,
          })
          .eq('id', existingEntry.id);

        if (error) throw error;
        
        await logAudit({
          action: 'UPDATE',
          tableName: 'time_entries',
          recordId: existingEntry.id,
          oldValues: {
            start_time: existingEntry.start_time,
            end_time: existingEntry.end_time,
            break_minutes: existingEntry.break_minutes,
            notes: existingEntry.notes,
          },
          newValues: { start_time: startTime, end_time: endTime, break_minutes: breakMinutes, notes },
          description: `Zeiteintrag für ${format(date, 'dd.MM.yyyy')} geändert`,
        });
        
        toast.success('Zeiteintrag aktualisiert');
      } else {
        // Create new entry
        const { data: newEntry, error } = await supabase
          .from('time_entries')
          .insert({
            user_id: userId,
            date: dateStr,
            start_time: startTime,
            end_time: endTime,
            break_minutes: breakMinutes,
            notes: notes || null,
          })
          .select()
          .single();

        if (error) throw error;
        
        await logAudit({
          action: 'INSERT',
          tableName: 'time_entries',
          recordId: newEntry?.id,
          newValues: { date: dateStr, start_time: startTime, end_time: endTime, break_minutes: breakMinutes, notes },
          description: `Zeiteintrag für ${format(date, 'dd.MM.yyyy')} erstellt`,
        });
        
        toast.success('Zeiteintrag erstellt');
      }

      onSave();
    } catch (error) {
      console.error('Error saving time entry:', error);
      toast.error('Fehler beim Speichern');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!existingEntry) return;

    if (!confirm('Möchten Sie diesen Eintrag wirklich löschen?')) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('time_entries')
        .delete()
        .eq('id', existingEntry.id);

      if (error) throw error;
      
      await logAudit({
        action: 'DELETE',
        tableName: 'time_entries',
        recordId: existingEntry.id,
        oldValues: {
          date: format(date, 'yyyy-MM-dd'),
          start_time: existingEntry.start_time,
          end_time: existingEntry.end_time,
          break_minutes: existingEntry.break_minutes,
          notes: existingEntry.notes,
        },
        description: `Zeiteintrag für ${format(date, 'dd.MM.yyyy')} gelöscht`,
      });
      
      toast.success('Zeiteintrag gelöscht');
      onSave();
    } catch (error) {
      console.error('Error deleting time entry:', error);
      toast.error('Fehler beim Löschen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {existingEntry ? 'Zeiteintrag bearbeiten' : 'Zeiteintrag erstellen'}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {format(date, 'dd.MM.yyyy')}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start">Startzeit</Label>
              <Input
                id="start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="end">Endzeit</Label>
              <Input
                id="end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <Label htmlFor="break">Pause (Minuten)</Label>
            <Input
              id="break"
              type="number"
              min="0"
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(parseInt(e.target.value, 10) || 0)}
            />
          </div>

          <div>
            <Label htmlFor="notes">Notizen (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notizen zum Arbeitstag..."
              rows={3}
            />
          </div>

          <DialogFooter className="gap-2">
            {existingEntry && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={loading}
              >
                Löschen
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Speichern...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default QuickTimeEdit;