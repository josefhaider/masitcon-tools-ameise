import { useState } from 'react';
import { format, subDays, isAfter, isBefore, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarIcon, Thermometer, AlertCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAudit } from '@/lib/auditLog';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { calculateWorkDays } from '@/lib/workDaysCalculator';

interface SickLeaveFormProps {
  onSuccess?: () => void;
}

export default function SickLeaveForm({ onSuccess }: SickLeaveFormProps) {
  const isMobile = useIsMobile();
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const minStartDate = subDays(new Date(), 7);
  const today = startOfDay(new Date());

  const handleSubmit = async () => {
    if (!startDate || !endDate) {
      toast.error('Bitte wählen Sie Start- und Enddatum aus');
      return;
    }

    if (isAfter(startDate, endDate)) {
      toast.error('Das Startdatum muss vor dem Enddatum liegen');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Nicht angemeldet');
        return;
      }

      // Arbeitstage berechnen für Attest-Status
      const workDays = await calculateWorkDays(startDate, endDate, user.id);
      // Unter 3 Arbeitstagen: Attest nicht erforderlich
      const certificateStatus = workDays < 3 ? 'not_required' : 'pending';

      const { data, error } = await supabase
        .from('absences')
        .insert({
          user_id: user.id,
          type: 'sick',
          start_date: format(startDate, 'yyyy-MM-dd'),
          end_date: format(endDate, 'yyyy-MM-dd'),
          notes: notes || null,
          status: 'approved',
          created_by: user.id,
          medical_certificate_status: certificateStatus,
        })
        .select()
        .single();

      if (error) throw error;

      await logAudit({
        action: 'INSERT',
        tableName: 'absences',
        recordId: data.id,
        newValues: {
          type: 'sick',
          start_date: format(startDate, 'yyyy-MM-dd'),
          end_date: format(endDate, 'yyyy-MM-dd'),
          notes,
        },
        description: `Krankmeldung erfasst: ${format(startDate, 'dd.MM.yyyy')} - ${format(endDate, 'dd.MM.yyyy')}`,
      });

      toast.success('Krankmeldung erfolgreich erfasst');
      setStartDate(new Date());
      setEndDate(new Date());
      setNotes('');
      onSuccess?.();
    } catch (error: any) {
      console.error('Error creating sick leave:', error);
      toast.error('Fehler beim Erfassen der Krankmeldung');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Thermometer className="h-5 w-5 text-destructive" />
          Krankmeldung erfassen
        </CardTitle>
        <CardDescription>
          Melden Sie sich krank und geben Sie das voraussichtliche Enddatum an
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Krank seit *</Label>
            {isMobile ? (
              <Drawer open={startOpen} onOpenChange={setStartOpen}>
                <DrawerTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-12",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-5 w-5" />
                    {startDate ? format(startDate, 'PPP', { locale: de }) : 'Datum wählen'}
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader>
                    <DrawerTitle>Krank seit</DrawerTitle>
                  </DrawerHeader>
                  <div className="p-4 pb-8 flex justify-center">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={(date) => { if (date) { setStartDate(date); setStartOpen(false); } }}
                      disabled={(date) => isBefore(date, minStartDate) || isAfter(date, today)}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </div>
                </DrawerContent>
              </Drawer>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, 'PPP', { locale: de }) : 'Datum wählen'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                    disabled={(date) => isBefore(date, minStartDate) || isAfter(date, today)}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="space-y-2">
            <Label>Voraussichtlich bis *</Label>
            {isMobile ? (
              <Drawer open={endOpen} onOpenChange={setEndOpen}>
                <DrawerTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-12",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-5 w-5" />
                    {endDate ? format(endDate, 'PPP', { locale: de }) : 'Datum wählen'}
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader>
                    <DrawerTitle>Voraussichtliches Ende</DrawerTitle>
                  </DrawerHeader>
                  <div className="p-4 pb-8 flex justify-center">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={(date) => { if (date) { setEndDate(date); setEndOpen(false); } }}
                      disabled={(date) => isBefore(date, startDate)}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </div>
                </DrawerContent>
              </Drawer>
            ) : (
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
                    onSelect={(date) => date && setEndDate(date)}
                    disabled={(date) => isBefore(date, startDate)}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Das Enddatum ist voraussichtlich und kann später angepasst werden, falls Sie länger oder kürzer krank sind.
          </AlertDescription>
        </Alert>

        <Alert variant="default" className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-blue-800 dark:text-blue-200">
            Bei Krankmeldungen unter 3 Arbeitstagen ist kein ärztliches Attest erforderlich.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label>Notizen (optional)</Label>
          <Textarea
            placeholder="z.B. Erkältung, Grippe, Arzttermin..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || !startDate || !endDate}
          className="w-full"
        >
          <Thermometer className="mr-2 h-4 w-4" />
          {isSubmitting ? 'Wird gespeichert...' : 'Krankmeldung speichern'}
        </Button>
      </CardContent>
    </Card>
  );
}
