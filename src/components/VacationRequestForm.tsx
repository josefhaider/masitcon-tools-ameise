import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { CalendarIcon, Plane, Clock, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { logAudit } from '@/lib/auditLog';
import { useIsMobile } from '@/hooks/use-mobile';
import { Database } from '@/integrations/supabase/types';
import { calculateWorkDays } from '@/lib/workDaysCalculator';

type AbsenceType = Database['public']['Enums']['absence_type'];

interface VacationRequestFormProps {
  onSubmitSuccess?: () => void;
}

const VacationRequestForm = ({ onSubmitSuccess }: VacationRequestFormProps) => {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [vacationType, setVacationType] = useState<AbsenceType>('vacation');
  const [calculatedDays, setCalculatedDays] = useState<number | null>(null);
  const [calculatingDays, setCalculatingDays] = useState(false);
  const [isHalfDay, setIsHalfDay] = useState(false);

  // Prüfen ob Einzeltag (für halben Tag Option)
  const isSingleDay = startDate && endDate && format(startDate, 'yyyy-MM-dd') === format(endDate, 'yyyy-MM-dd');
  const canBeHalfDay = isSingleDay && vacationType === 'vacation';

  // Reset isHalfDay wenn nicht mehr anwendbar
  useEffect(() => {
    if (!canBeHalfDay) {
      setIsHalfDay(false);
    }
  }, [canBeHalfDay]);

const getVacationTypeLabel = (type: AbsenceType): string => {
    switch (type) {
      case 'vacation': return 'Bezahlter Urlaub';
      case 'comp_time': return 'Überstundenfrei';
      default: return type;
    }
  };

  const getVacationTypeDescription = (type: AbsenceType): string => {
    switch (type) {
      case 'vacation': return 'Wird von Ihren Urlaubstagen abgezogen';
      case 'comp_time': return 'Wird von Ihren Überstunden abgezogen';
      default: return '';
    }
  };

  // Berechne Arbeitstage wenn Start- und Enddatum gesetzt sind
  useEffect(() => {
    const calculateDays = async () => {
      if (startDate && endDate && user) {
        setCalculatingDays(true);
        try {
          const days = await calculateWorkDays(startDate, endDate, user.id);
          setCalculatedDays(days);
        } catch (error) {
          console.error('Error calculating work days:', error);
          setCalculatedDays(null);
        } finally {
          setCalculatingDays(false);
        }
      } else {
        setCalculatedDays(null);
      }
    };
    calculateDays();
  }, [startDate, endDate, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!startDate || !endDate) {
      toast.error('Bitte wählen Sie Start- und Enddatum');
      return;
    }

    if (startDate > endDate) {
      toast.error('Startdatum muss vor Enddatum liegen');
      return;
    }

    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (startDate < tomorrow) {
      toast.error('Urlaubsantrag muss mindestens für morgen sein');
      return;
    }

    setIsSubmitting(true);

    try {
      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');
      const displayDays = isHalfDay ? 0.5 : (calculatedDays || 1);
      
      const { data: newRequest, error } = await supabase.from('absences').insert({
        user_id: user!.id,
        type: vacationType,
        start_date: startDateStr,
        end_date: endDateStr,
        notes,
        status: 'pending',
        is_half_day: isHalfDay,
      }).select().single();

      if (error) throw error;

      await logAudit({
        action: 'INSERT',
        tableName: 'absences',
        recordId: newRequest?.id,
        newValues: { type: vacationType, start_date: startDateStr, end_date: endDateStr, status: 'pending', is_half_day: isHalfDay },
        description: `${getVacationTypeLabel(vacationType)} beantragt: ${startDateStr} - ${endDateStr} (${displayDays} Arbeitstage${isHalfDay ? ', halber Tag' : ''})`,
      });

      toast.success(`${getVacationTypeLabel(vacationType)} wurde eingereicht`);
      setStartDate(undefined);
      setEndDate(undefined);
      setNotes('');
      setVacationType('vacation');
      setIsHalfDay(false);
      
      // Notify parent component to refresh the list
      if (onSubmitSuccess) {
        onSubmitSuccess();
      }
    } catch (error) {
      console.error('Error submitting vacation request:', error);
      toast.error('Fehler beim Einreichen des Urlaubsantrags');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Abwesenheit beantragen</CardTitle>
        <CardDescription>
          Beantragen Sie Urlaub oder Überstundenfrei. Der Antrag muss von einem Genehmiger bestätigt werden.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Urlaubsart Auswahl */}
          <div className="space-y-3">
            <Label>Art der Abwesenheit *</Label>
            <Select value={vacationType} onValueChange={(value) => setVacationType(value as AbsenceType)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Urlaubsart auswählen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vacation">
                  <div className="flex items-center gap-2">
                    <Plane className="h-4 w-4 text-amber-500" />
                    <span>Bezahlter Urlaub</span>
                  </div>
                </SelectItem>
                <SelectItem value="comp_time">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-sky-500" />
                    <span>Überstundenfrei</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {getVacationTypeDescription(vacationType)}
            </p>
          </div>

          <div className="grid gap-4 sm:gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Von *</Label>
              {isMobile ? (
                <Drawer open={startOpen} onOpenChange={setStartOpen}>
                  <DrawerTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal h-12',
                        !startDate && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-5 w-5" />
                      {startDate ? format(startDate, 'PPP', { locale: de }) : 'Datum wählen'}
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent>
                    <DrawerHeader>
                      <DrawerTitle>Startdatum wählen</DrawerTitle>
                    </DrawerHeader>
                    <div className="p-4 pb-8 flex justify-center">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={(date) => { setStartDate(date); setStartOpen(false); }}
                        disabled={(date) => date < new Date()}
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
                        'w-full justify-start text-left font-normal',
                        !startDate && 'text-muted-foreground'
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
                      onSelect={setStartDate}
                      disabled={(date) => date < new Date()}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div className="space-y-2">
              <Label>Bis *</Label>
              {isMobile ? (
                <Drawer open={endOpen} onOpenChange={setEndOpen}>
                  <DrawerTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal h-12',
                        !endDate && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-5 w-5" />
                      {endDate ? format(endDate, 'PPP', { locale: de }) : 'Datum wählen'}
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent>
                    <DrawerHeader>
                      <DrawerTitle>Enddatum wählen</DrawerTitle>
                    </DrawerHeader>
                    <div className="p-4 pb-8 flex justify-center">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={(date) => { setEndDate(date); setEndOpen(false); }}
                        disabled={(date) => date < (startDate || new Date())}
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
                        'w-full justify-start text-left font-normal',
                        !endDate && 'text-muted-foreground'
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
                      disabled={(date) => date < (startDate || new Date())}
                      initialFocus
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>

          {/* Halber Tag Checkbox - nur bei Einzeltag + vacation */}
          {canBeHalfDay && (
            <div className="flex items-center space-x-2 rounded-md bg-muted/50 p-3">
              <Checkbox
                id="halfDay"
                checked={isHalfDay}
                onCheckedChange={(checked) => setIsHalfDay(checked === true)}
              />
              <Label htmlFor="halfDay" className="text-sm cursor-pointer">
                Halber Urlaubstag (0,5 Tage)
              </Label>
            </div>
          )}

          {startDate && endDate && (
            <div className="rounded-md bg-muted p-4">
              <p className="text-sm font-medium">
                Arbeitstage:{' '}
                {calculatingDays ? (
                  <Loader2 className="inline h-4 w-4 animate-spin ml-1" />
                ) : (
                  <span className="text-lg font-bold">
                    {isHalfDay ? '0,5' : (calculatedDays ?? '-')}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {isHalfDay 
                  ? '(Halber Tag - 50% der Sollstunden werden neutralisiert)'
                  : '(Wochenenden und Feiertage werden nicht gezählt)'}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Begründung / Notizen (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="z.B. Sommerurlaub, Familienfeier..."
              rows={3}
            />
          </div>

          <Button type="submit" disabled={isSubmitting || !startDate || !endDate} className="w-full">
            {isSubmitting ? 'Wird eingereicht...' : 'Urlaubsantrag einreichen'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default VacationRequestForm;
