"use client";

import { useState } from 'react';
import { format, isBefore } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAudit } from '@/lib/auditLog';
import { cn } from '@/lib/utils';
import { calculateWorkDays } from '@/lib/workDaysCalculator';

interface SickLeave {
  id: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  user_id: string;
  medical_certificate_status?: string | null;
}

interface EditSickLeaveDialogProps {
  sickLeave: SickLeave | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function EditSickLeaveDialog({ 
  sickLeave, 
  open, 
  onOpenChange, 
  onSuccess 
}: EditSickLeaveDialogProps) {
  const [endDate, setEndDate] = useState<Date | undefined>(
    sickLeave ? new Date(sickLeave.end_date) : undefined
  );
  const [notes, setNotes] = useState(sickLeave?.notes || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state when dialog opens with new data
  useState(() => {
    if (sickLeave) {
      setEndDate(new Date(sickLeave.end_date));
      setNotes(sickLeave.notes || '');
    }
  });

  const handleSave = async () => {
    if (!sickLeave || !endDate) return;

    const startDate = new Date(sickLeave.start_date);
    if (isBefore(endDate, startDate)) {
      toast.error('Das Enddatum muss nach dem Startdatum liegen');
      return;
    }

    setIsSubmitting(true);

    try {
      const oldEndDate = sickLeave.end_date;
      const newEndDate = format(endDate, 'yyyy-MM-dd');

      // Arbeitstage berechnen für Attest-Status
      const workDays = await calculateWorkDays(startDate, endDate, sickLeave.user_id);
      
      // Attest-Status nur auf 'not_required' setzen, wenn unter 3 Tage
      // Nicht zurück auf 'pending' setzen, falls bereits 'received'
      const currentStatus = sickLeave.medical_certificate_status;
      let newCertificateStatus: string | undefined;
      if (workDays < 3) {
        newCertificateStatus = 'not_required';
      } else if (currentStatus === 'not_required') {
        // War vorher unter 3 Tage, jetzt nicht mehr -> pending
        newCertificateStatus = 'pending';
      }
      // Wenn 'received' oder schon 'pending', nicht ändern

      const { error } = await supabase
        .from('absences')
        .update({
          end_date: newEndDate,
          notes: notes || null,
          ...(newCertificateStatus && { medical_certificate_status: newCertificateStatus }),
        })
        .eq('id', sickLeave.id);

      if (error) throw error;

      await logAudit({
        action: 'UPDATE',
        tableName: 'absences',
        recordId: sickLeave.id,
        oldValues: { end_date: oldEndDate, notes: sickLeave.notes },
        newValues: { end_date: newEndDate, notes },
        description: `Krankmeldung angepasst: Enddatum von ${format(new Date(oldEndDate), 'dd.MM.yyyy')} auf ${format(endDate, 'dd.MM.yyyy')}`,
      });

      toast.success('Krankmeldung aktualisiert');
      onOpenChange(false);
      onSuccess();
    } catch (error: unknown) {
      console.error('Error updating sick leave:', error);
      toast.error('Fehler beim Aktualisieren der Krankmeldung');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!sickLeave) return null;

  const startDate = new Date(sickLeave.start_date);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Krankmeldung anpassen</DialogTitle>
          <DialogDescription>
            Startdatum: {format(startDate, 'PPP', { locale: de })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Neues Enddatum</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !endDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {endDate ? format(endDate, 'PPP', { locale: de }) : 'Datum wählen'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={endDate}
                  onSelect={setEndDate}
                  disabled={(date) => isBefore(date, startDate)}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>Notizen</Label>
            <Textarea
              placeholder="z.B. Verlängerung aufgrund..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting || !endDate}>
            {isSubmitting ? 'Wird gespeichert...' : 'Speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
