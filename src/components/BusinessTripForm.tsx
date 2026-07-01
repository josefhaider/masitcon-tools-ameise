"use client";

import { useState, useEffect, useMemo } from 'react';
import { useProfile } from '@/contexts/profile-context';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CalendarIcon, Receipt, Loader2, Utensils } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { logAudit } from '@/lib/auditLog';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  calculateTravelExpense,
  enumerateTripDates,
  formatEUR,
  travelDayKindLabel,
  type PerDiemRate,
  type MealProvision,
} from '@/lib/travelExpenses';

interface BusinessTripFormProps {
  onSubmitSuccess?: () => void;
}

type MealMap = Record<string, { breakfast: boolean; lunch: boolean; dinner: boolean }>;

const emptyMeal = { breakfast: false, lunch: false, dinner: false };

const BusinessTripForm = ({ onSubmitSuccess }: BusinessTripFormProps) => {
  const { userId } = useProfile();
  const isMobile = useIsMobile();

  const [rates, setRates] = useState<PerDiemRate[]>([]);
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  // Ausgewählter Ort als "LAND|REGION" (Region leer = Standardsatz des Landes)
  const [locationKey, setLocationKey] = useState('DE|');
  const [startDate, setStartDate] = useState<Date>();
  const [startTime, setStartTime] = useState('08:00');
  const [endDate, setEndDate] = useState<Date>();
  const [endTime, setEndTime] = useState('17:00');
  const [notes, setNotes] = useState('');
  const [meals, setMeals] = useState<MealMap>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  useEffect(() => {
    const loadRates = async () => {
      const { data, error } = await supabase
        .from('per_diem_rates')
        .select('country_code, country_name, full_day_rate, partial_day_rate, valid_from, valid_to, region')
        .order('country_name');
      if (error) {
        toast.error('Fehler beim Laden der Reisekostensätze');
        return;
      }
      setRates(data || []);
    };
    loadRates();
  }, []);

  // Auswählbare Orte: jeder Satz (Land bzw. Land+Region) ist eine Option.
  // Deutschland zuerst, dann alphabetisch; je Land der Standardsatz vor den Städten.
  const locations = useMemo(() => {
    return rates
      .map((r) => {
        const region = r.region ?? '';
        const name = r.country_name ?? r.country_code;
        return {
          key: `${r.country_code}|${region}`,
          label: region ? `${name} – ${region}` : name,
          countryName: name,
          countryCode: r.country_code,
          region,
        };
      })
      .sort((a, b) => {
        if (a.countryCode === 'DE' && b.countryCode !== 'DE') return -1;
        if (b.countryCode === 'DE' && a.countryCode !== 'DE') return 1;
        const nameCmp = a.countryName.localeCompare(b.countryName);
        if (nameCmp !== 0) return nameCmp;
        if (!a.region && b.region) return -1;
        if (a.region && !b.region) return 1;
        return a.region.localeCompare(b.region);
      });
  }, [rates]);

  const sepIdx = locationKey.indexOf('|');
  const countryCode = sepIdx >= 0 ? locationKey.slice(0, sepIdx) : locationKey;
  const region = sepIdx >= 0 ? locationKey.slice(sepIdx + 1) || null : null;

  const startStr = startDate ? format(startDate, 'yyyy-MM-dd') : '';
  const endStr = endDate ? format(endDate, 'yyyy-MM-dd') : '';

  const tripDates = useMemo(
    () => (startStr && endStr && endStr >= startStr ? enumerateTripDates(startStr, endStr) : []),
    [startStr, endStr]
  );

  // Mahlzeiten-State auf die aktuellen Reisetage begrenzen
  useEffect(() => {
    setMeals((prev) => {
      const next: MealMap = {};
      for (const d of tripDates) next[d] = prev[d] ?? { ...emptyMeal };
      return next;
    });
  }, [tripDates]);

  const preview = useMemo(() => {
    if (!startStr || !endStr || endStr < startStr) return null;
    const mealList: MealProvision[] = tripDates.map((d) => ({ date: d, ...(meals[d] ?? emptyMeal) }));
    return calculateTravelExpense({
      startDate: startStr,
      startTime,
      endDate: endStr,
      endTime,
      countryCode,
      region,
      rates,
      meals: mealList,
    });
  }, [startStr, endStr, startTime, endTime, countryCode, region, rates, meals, tripDates]);

  const toggleMeal = (date: string, key: 'breakfast' | 'lunch' | 'dinner') => {
    setMeals((prev) => ({
      ...prev,
      [date]: { ...(prev[date] ?? emptyMeal), [key]: !(prev[date] ?? emptyMeal)[key] },
    }));
  };

  const resetForm = () => {
    setPurpose('');
    setDestination('');
    setLocationKey('DE|');
    setStartDate(undefined);
    setEndDate(undefined);
    setStartTime('08:00');
    setEndTime('17:00');
    setNotes('');
    setMeals({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!purpose.trim()) {
      toast.error('Bitte geben Sie den Anlass der Reise an');
      return;
    }
    if (!startDate || !endDate) {
      toast.error('Bitte wählen Sie Start- und Enddatum');
      return;
    }
    if (endStr < startStr) {
      toast.error('Das Enddatum darf nicht vor dem Startdatum liegen');
      return;
    }
    if (startStr === endStr && endTime <= startTime) {
      toast.error('Die Endzeit muss nach der Startzeit liegen');
      return;
    }
    if (preview?.rateMissing) {
      toast.error('Für das gewählte Land ist kein gültiger Satz hinterlegt');
      return;
    }

    setIsSubmitting(true);
    try {
      // Nur Tage mit gestellter Mahlzeit speichern
      const mealsProvided = tripDates
        .map((d) => ({ date: d, ...(meals[d] ?? emptyMeal) }))
        .filter((m) => m.breakfast || m.lunch || m.dinner);

      const { data: newTrip, error } = await supabase
        .from('business_trips')
        .insert({
          user_id: userId,
          purpose: purpose.trim(),
          destination: destination.trim() || null,
          country_code: countryCode,
          region,
          start_date: startStr,
          start_time: startTime,
          end_date: endStr,
          end_time: endTime,
          meals_provided: mealsProvided,
          notes: notes.trim() || null,
          status: 'pending',
          created_by: userId,
        })
        .select()
        .single();

      if (error) throw error;

      await logAudit({
        action: 'INSERT',
        tableName: 'business_trips',
        recordId: newTrip?.id,
        newValues: {
          purpose: purpose.trim(),
          country_code: countryCode,
          region,
          start_date: startStr,
          end_date: endStr,
          status: 'pending',
          total: preview?.total ?? 0,
        },
        description: `Dienstreise erfasst: ${destination.trim() || countryCode}${region ? ` (${region})` : ''} (${startStr} – ${endStr}), Verpflegungsmehraufwand ${formatEUR(preview?.total ?? 0)}`,
      });

      toast.success('Dienstreise wurde eingereicht');
      resetForm();
      onSubmitSuccess?.();
    } catch (error) {
      console.error('Error submitting business trip:', error);
      toast.error('Fehler beim Einreichen der Dienstreise');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderDatePicker = (
    value: Date | undefined,
    onSelect: (d: Date | undefined) => void,
    open: boolean,
    setOpen: (o: boolean) => void,
    title: string
  ) => {
    const trigger = (
      <Button
        type="button"
        variant="outline"
        className={cn('w-full justify-start text-left font-normal', !value && 'text-muted-foreground')}
      >
        <CalendarIcon className="mr-2 h-4 w-4" />
        {value ? format(value, 'PPP', { locale: de }) : 'Datum wählen'}
      </Button>
    );

    if (isMobile) {
      return (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerTrigger asChild>{trigger}</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{title}</DrawerTitle>
            </DrawerHeader>
            <div className="flex justify-center p-4 pb-8">
              <Calendar
                mode="single"
                selected={value}
                onSelect={(d) => { onSelect(d); setOpen(false); }}
                initialFocus
                className="pointer-events-auto"
              />
            </div>
          </DrawerContent>
        </Drawer>
      );
    }

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => { onSelect(d); setOpen(false); }}
            initialFocus
            className="pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Dienstreise erfassen
        </CardTitle>
        <CardDescription>
          Erfassen Sie Ihre Reise. Der Verpflegungsmehraufwand wird automatisch nach den gültigen Sätzen
          berechnet und muss anschließend freigegeben werden.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="purpose">Anlass der Reise *</Label>
              <Input
                id="purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="z.B. Kundentermin, Messe, Schulung"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="destination">Reiseziel</Label>
              <Input
                id="destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="z.B. Wien"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Land / Ort *</Label>
            <Select value={locationKey} onValueChange={setLocationKey}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Land oder Ort auswählen" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.key} value={loc.key}>
                    {loc.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Für Städte mit eigenem Satz (z.B. Spanien – Palma de Mallorca) den passenden Ort wählen.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Abreise (Datum) *</Label>
              {renderDatePicker(startDate, setStartDate, startOpen, setStartOpen, 'Abreisedatum wählen')}
            </div>
            <div className="space-y-2">
              <Label htmlFor="start-time">Abreise (Uhrzeit) *</Label>
              <Input id="start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Rückkehr (Datum) *</Label>
              {renderDatePicker(endDate, setEndDate, endOpen, setEndOpen, 'Rückkehrdatum wählen')}
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-time">Rückkehr (Uhrzeit) *</Label>
              <Input id="end-time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          {/* Mahlzeiten je Reisetag */}
          {tripDates.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Utensils className="h-4 w-4 text-muted-foreground" />
                <Label>Gestellte Mahlzeiten</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Vom Arbeitgeber oder Dritten bezahlte Mahlzeiten kürzen den Tagessatz (Frühstück −20 %,
                Mittag-/Abendessen je −40 %).
              </p>
              <div className="rounded-md border divide-y">
                {(preview?.days ?? []).map((day) => (
                  <div key={day.date} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {format(new Date(`${day.date}T00:00:00`), 'EEE, dd.MM.', { locale: de })}
                      </span>
                      <Badge variant="outline" className="text-xs">{travelDayKindLabel(day.kind)}</Badge>
                    </div>
                    <div className="flex items-center gap-4">
                      {(['breakfast', 'lunch', 'dinner'] as const).map((key) => (
                        <label key={key} className="flex cursor-pointer items-center gap-1.5 text-sm">
                          <Checkbox
                            checked={meals[day.date]?.[key] ?? false}
                            onCheckedChange={() => toggleMeal(day.date, key)}
                          />
                          {key === 'breakfast' ? 'Frühstück' : key === 'lunch' ? 'Mittag' : 'Abend'}
                        </label>
                      ))}
                      <span className="w-20 text-right text-sm font-semibold tabular-nums">
                        {formatEUR(day.amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notizen (optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ergänzende Angaben zur Reise..."
              rows={2}
            />
          </div>

          {/* Live-Vorschau */}
          {preview && (
            <Alert className={preview.rateMissing ? 'border-destructive' : ''}>
              <AlertDescription>
                {preview.rateMissing ? (
                  <span className="text-destructive">
                    Für das gewählte Land ist kein gültiger Satz hinterlegt. Bitte in der Verwaltung ergänzen.
                  </span>
                ) : (
                  <span className="flex items-center justify-between gap-2">
                    <span>
                      Abwesenheit: <strong>{preview.hoursAway.toLocaleString('de-DE')} h</strong> ·{' '}
                      {preview.days.length} {preview.days.length === 1 ? 'Reisetag' : 'Reisetage'}
                    </span>
                    <span className="text-lg font-bold">{formatEUR(preview.total)}</span>
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Wird eingereicht...
              </>
            ) : (
              'Dienstreise einreichen'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default BusinessTripForm;
