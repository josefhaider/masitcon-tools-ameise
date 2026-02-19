import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Calendar, Wand2, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { generateBavarianHolidays, Holiday } from '@/lib/holidays';

export default function HolidayManager() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });

  useEffect(() => {
    loadHolidays();
  }, [selectedYear]);

  const loadHolidays = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .eq('federal_state', 'BY')
        .gte('date', `${selectedYear}-01-01`)
        .lte('date', `${selectedYear}-12-31`)
        .order('date');

      if (error) throw error;
      setHolidays(data || []);
    } catch (error: unknown) {
      toast.error('Fehler beim Laden: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'));
    } finally {
      setLoading(false);
    }
  };

  const addHoliday = async () => {
    if (!newHoliday.date || !newHoliday.name) {
      toast.error('Bitte Datum und Name eingeben');
      return;
    }

    try {
      const { error } = await supabase
        .from('holidays')
        .insert({
          date: newHoliday.date,
          name: newHoliday.name,
          federal_state: 'BY'
        });

      if (error) throw error;
      toast.success('Feiertag hinzugefügt');
      setNewHoliday({ date: '', name: '' });
      setIsDialogOpen(false);
      loadHolidays();
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === '23505') {
        toast.error('Feiertag für dieses Datum existiert bereits');
      } else {
        toast.error('Fehler: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'));
      }
    }
  };

  const deleteHoliday = async (id: string) => {
    try {
      const { error } = await supabase
        .from('holidays')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Feiertag gelöscht');
      loadHolidays();
    } catch (error: unknown) {
      toast.error('Fehler: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'));
    }
  };

  const generateHolidays = async () => {
    const generatedHolidays = generateBavarianHolidays(selectedYear);
    
    try {
      // Prüfe welche schon existieren
      const { data: existing } = await supabase
        .from('holidays')
        .select('date')
        .eq('federal_state', 'BY')
        .gte('date', `${selectedYear}-01-01`)
        .lte('date', `${selectedYear}-12-31`);

      const existingDates = new Set(existing?.map(h => h.date) || []);
      const newHolidays = generatedHolidays.filter(h => !existingDates.has(h.date));

      if (newHolidays.length === 0) {
        toast.info('Alle Feiertage für dieses Jahr existieren bereits');
        return;
      }

      const { error } = await supabase
        .from('holidays')
        .insert(newHolidays.map(h => ({
          ...h,
          federal_state: 'BY'
        })));

      if (error) throw error;
      toast.success(`${newHolidays.length} Feiertage generiert`);
      loadHolidays();
    } catch (error: unknown) {
      toast.error('Fehler beim Generieren: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'));
    }
  };

  const formatDateDisplay = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return format(date, 'EEEE, dd. MMMM yyyy', { locale: de });
  };

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() + i - 1);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Feiertage verwalten
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSelectedYear(y => y - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Select
                value={selectedYear.toString()}
                onValueChange={(v) => setSelectedYear(parseInt(v, 10))}
              >
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map(year => (
                    <SelectItem key={year} value={year.toString()}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSelectedYear(y => y + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-6">
            <Button onClick={generateHolidays} variant="secondary">
              <Wand2 className="h-4 w-4 mr-2" />
              Bayern {selectedYear} generieren
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Feiertag hinzufügen
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Neuer Feiertag</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Datum</Label>
                    <Input
                      type="date"
                      value={newHoliday.date}
                      onChange={(e) => setNewHoliday(h => ({ ...h, date: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={newHoliday.name}
                      onChange={(e) => setNewHoliday(h => ({ ...h, name: e.target.value }))}
                      placeholder="z.B. Reformationstag"
                    />
                  </div>
                  <Button onClick={addHoliday} className="w-full">
                    Speichern
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Lade Feiertage...
            </div>
          ) : holidays.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Keine Feiertage für {selectedYear} definiert.
              <br />
              <Button 
                variant="link" 
                onClick={generateHolidays}
                className="mt-2"
              >
                Jetzt generieren
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Feiertag</TableHead>
                  <TableHead className="w-[100px]">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((holiday) => (
                  <TableRow key={holiday.id}>
                    <TableCell className="font-medium">
                      {formatDateDisplay(holiday.date)}
                    </TableCell>
                    <TableCell>{holiday.name}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteHoliday(holiday.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
