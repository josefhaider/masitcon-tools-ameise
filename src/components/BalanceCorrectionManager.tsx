import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { calculateWorkDaysWithHolidays, fetchHolidaysForRange } from '@/lib/workDaysCalculator';
import { de } from 'date-fns/locale';
import { Plus, Clock, Plane, TrendingUp, TrendingDown, History } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/auditLog';
import { calculateMonthlyHours, getBalanceCorrections, getVacationCorrectionsByYear } from '@/lib/targetHoursCalculator';

interface Employee {
  id: string;
  full_name: string;
  employee_number: string | null;
  annual_vacation_days: number | null;
}

interface BalanceCorrection {
  id: string;
  user_id: string;
  effective_date: string;
  correction_type: string;
  hours_adjustment: number | null;
  vacation_days_adjustment: number | null;
  reason: string;
  created_by: string;
  created_at: string;
  applies_to_year: number | null;
  creator?: { full_name: string };
}

interface EmployeeBalances {
  calculatedHours: number;
  hoursCorrections: number;
  totalHours: number;
  vacationUsed: number;
  vacationEntitlement: number;
  vacationCorrections: number;
  vacationAvailable: number;
}

const BalanceCorrectionManager = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');
  const [corrections, setCorrections] = useState<BalanceCorrection[]>([]);
  const [balances, setBalances] = useState<EmployeeBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [correctionType, setCorrectionType] = useState<'hours' | 'vacation'>('hours');
  const [effectiveDate, setEffectiveDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [adjustmentValue, setAdjustmentValue] = useState('');
  const [reason, setReason] = useState('');
  const [appliesYear, setAppliesYear] = useState<string>(new Date().getFullYear().toString());

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    if (selectedEmployeeId) {
      loadEmployeeData();
    }
  }, [selectedEmployeeId]);

  const loadEmployees = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, employee_number, annual_vacation_days')
      .eq('is_archived', false)
      .order('full_name');

    if (error) {
      toast.error('Fehler beim Laden der Mitarbeiter');
      return;
    }

    setEmployees(data || []);
    setLoading(false);
  };

  const loadEmployeeData = async () => {
    if (!selectedEmployeeId) return;

    setLoading(true);

    try {
      // Lade Korrekturen
      const { data: correctionsData, error: corrError } = await supabase
        .from('balance_corrections')
        .select('*')
        .eq('user_id', selectedEmployeeId)
        .order('effective_date', { ascending: false });

      if (corrError) throw corrError;

      // Lade Creator-Namen für jede Korrektur
      const correctionsWithCreator = await Promise.all(
        (correctionsData || []).map(async (c) => {
          const { data: creatorData } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', c.created_by)
            .maybeSingle();
          return { ...c, creator: creatorData };
        })
      );

      setCorrections(correctionsWithCreator);

      // Berechne aktuelle Salden
      const now = new Date();
      const currentYear = now.getFullYear();

      // Berechne Stunden-Saldo (kumuliert über alle Monate des aktuellen Jahres)
      let calculatedHours = 0;
      for (let month = 1; month <= now.getMonth() + 1; month++) {
        const monthData = await calculateMonthlyHours(
          selectedEmployeeId,
          month,
          currentYear,
          month === now.getMonth() + 1 ? now : undefined
        );
        calculatedHours += monthData.balance;
      }

      // Lade Korrekturen
      const hoursCorrections = await getBalanceCorrections(selectedEmployeeId, 'hours');
      const vacationCorrections = await getVacationCorrectionsByYear(selectedEmployeeId, currentYear);

      // Lade Urlaubsanspruch aus Profil
      const { data: profileData } = await supabase
        .from('profiles')
        .select('annual_vacation_days')
        .eq('id', selectedEmployeeId)
        .single();

      const vacationEntitlement = profileData?.annual_vacation_days || 30;

      // Berechne genommenen Urlaub im aktuellen Jahr
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear}-12-31`;
      const { data: vacationData } = await supabase
        .from('absences')
        .select('start_date, end_date')
        .eq('user_id', selectedEmployeeId)
        .eq('type', 'vacation')
        .eq('status', 'approved')
        .gte('start_date', yearStart)
        .lte('end_date', yearEnd);

      // Berechne genommenen Urlaub (ohne Wochenenden UND ohne Feiertage)
      let vacationUsed = 0;
      if (vacationData && vacationData.length > 0) {
        const holidaysSet = await fetchHolidaysForRange(
          new Date(`${currentYear}-01-01`),
          new Date(`${currentYear}-12-31`)
        );
        
        for (const v of vacationData) {
          vacationUsed += calculateWorkDaysWithHolidays(v.start_date, v.end_date, holidaysSet);
        }
      }

      setBalances({
        calculatedHours: Math.round(calculatedHours * 10) / 10,
        hoursCorrections: Math.round(hoursCorrections * 10) / 10,
        totalHours: Math.round((calculatedHours + hoursCorrections) * 10) / 10,
        vacationUsed,
        vacationEntitlement,
        vacationCorrections,
        vacationAvailable: vacationEntitlement + vacationCorrections - vacationUsed
      });

    } catch (error) {
      console.error('Fehler beim Laden der Daten:', error);
      toast.error('Fehler beim Laden der Mitarbeiter-Daten');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCorrection = async () => {
    if (!selectedEmployeeId || !reason.trim() || !adjustmentValue) {
      toast.error('Bitte alle Pflichtfelder ausfüllen');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Nicht angemeldet');
      return;
    }

    const adjustment = parseFloat(adjustmentValue);
    if (isNaN(adjustment)) {
      toast.error('Ungültiger Korrekturwert');
      return;
    }

    const newCorrection = {
      user_id: selectedEmployeeId,
      effective_date: effectiveDate,
      correction_type: correctionType,
      hours_adjustment: correctionType === 'hours' ? adjustment : null,
      vacation_days_adjustment: correctionType === 'vacation' ? adjustment : null,
      reason: reason.trim(),
      created_by: user.id,
      applies_to_year: appliesYear ? parseInt(appliesYear) : null
    };

    const { data, error } = await supabase
      .from('balance_corrections')
      .insert(newCorrection)
      .select()
      .single();

    if (error) {
      console.error('Fehler:', error);
      toast.error('Fehler beim Speichern der Korrektur');
      return;
    }

    // Audit-Log
    const employee = employees.find(e => e.id === selectedEmployeeId);
    await logAudit({
      action: 'INSERT',
      tableName: 'balance_corrections',
      recordId: data.id,
      newValues: newCorrection,
      description: `${correctionType === 'hours' ? 'Stunden' : 'Urlaubs'}-Korrektur für ${employee?.full_name}: ${adjustment > 0 ? '+' : ''}${adjustment} (${reason.trim()})`
    });

    toast.success('Korrektur erfolgreich gespeichert');
    setDialogOpen(false);
    resetForm();
    loadEmployeeData();
  };

  const resetForm = () => {
    setCorrectionType('hours');
    setEffectiveDate(format(new Date(), 'yyyy-MM-dd'));
    setAdjustmentValue('');
    setReason('');
    setAppliesYear(new Date().getFullYear().toString());
  };

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Korrekturbuchungen
          </CardTitle>
          <CardDescription>
            Manuelle Korrekturen für Stunden- und Urlaubssalden
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Mitarbeiter-Auswahl */}
          <div className="mb-6">
            <Label htmlFor="employee-select">Mitarbeiter auswählen</Label>
            <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
              <SelectTrigger id="employee-select" className="w-full max-w-md mt-1">
                <SelectValue placeholder="Mitarbeiter wählen..." />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.full_name} {emp.employee_number && `(${emp.employee_number})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedEmployeeId && balances && (
            <>
              {/* Aktuelle Salden */}
              <div className="grid gap-4 md:grid-cols-2 mb-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary" />
                      Stunden-Saldo
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Berechnet (Jahr):</span>
                        <span className={balances.calculatedHours >= 0 ? 'text-green-600' : 'text-destructive'}>
                          {balances.calculatedHours >= 0 ? '+' : ''}{balances.calculatedHours}h
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Korrekturen:</span>
                        <span className={balances.hoursCorrections >= 0 ? 'text-green-600' : 'text-destructive'}>
                          {balances.hoursCorrections >= 0 ? '+' : ''}{balances.hoursCorrections}h
                        </span>
                      </div>
                      <div className="border-t pt-2 flex justify-between font-semibold">
                        <span>GESAMT:</span>
                        <span className={`flex items-center gap-1 ${balances.totalHours >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                          {balances.totalHours >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                          {balances.totalHours >= 0 ? '+' : ''}{balances.totalHours}h
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Plane className="h-4 w-4 text-primary" />
                      Urlaubs-Saldo {new Date().getFullYear()}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Jahresanspruch:</span>
                        <span>{balances.vacationEntitlement} Tage</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Korrekturen (z.B. Übertrag):</span>
                        <span className={balances.vacationCorrections >= 0 ? 'text-green-600' : 'text-destructive'}>
                          {balances.vacationCorrections >= 0 ? '+' : ''}{balances.vacationCorrections} Tage
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Genommen:</span>
                        <span className="text-destructive">-{balances.vacationUsed} Tage</span>
                      </div>
                      <div className="border-t pt-2 flex justify-between font-semibold">
                        <span>VERFÜGBAR:</span>
                        <span className={balances.vacationAvailable >= 0 ? 'text-green-600' : 'text-destructive'}>
                          {balances.vacationAvailable} Tage
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Neue Korrektur Button */}
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="mb-6">
                    <Plus className="h-4 w-4 mr-2" />
                    Neue Korrektur
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Neue Korrektur für {selectedEmployee?.full_name}</DialogTitle>
                    <DialogDescription>
                      Erfassen Sie eine manuelle Korrektur mit Begründung.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Art der Korrektur</Label>
                      <Select value={correctionType} onValueChange={(v) => setCorrectionType(v as 'hours' | 'vacation')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hours">
                            <span className="flex items-center gap-2">
                              <Clock className="h-4 w-4" />
                              Stunden-Korrektur
                            </span>
                          </SelectItem>
                          <SelectItem value="vacation">
                            <span className="flex items-center gap-2">
                              <Plane className="h-4 w-4" />
                              Urlaubs-Korrektur
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="effective-date">Stichtag</Label>
                        <Input
                          id="effective-date"
                          type="date"
                          value={effectiveDate}
                          onChange={(e) => setEffectiveDate(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="applies-year">Jahr (optional)</Label>
                        <Input
                          id="applies-year"
                          type="number"
                          placeholder="z.B. 2025"
                          value={appliesYear}
                          onChange={(e) => setAppliesYear(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="adjustment-value">
                        Korrekturwert ({correctionType === 'hours' ? 'Stunden' : 'Tage'})
                      </Label>
                      <Input
                        id="adjustment-value"
                        type="number"
                        step="0.5"
                        placeholder={correctionType === 'hours' ? 'z.B. +50 oder -8' : 'z.B. +5 oder -2'}
                        value={adjustmentValue}
                        onChange={(e) => setAdjustmentValue(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Positive Werte = Gutschrift, Negative Werte = Abzug
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reason">Begründung (Pflichtfeld)</Label>
                      <Textarea
                        id="reason"
                        placeholder="z.B. Übertrag Überstunden aus 2024, Korrektur fehlerhafte Buchung..."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={3}
                      />
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDialogOpen(false)}>
                      Abbrechen
                    </Button>
                    <Button onClick={handleSaveCorrection} disabled={!reason.trim() || !adjustmentValue}>
                      Korrektur speichern
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Korrektur-Historie */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Korrektur-Historie</CardTitle>
                </CardHeader>
                <CardContent>
                  {corrections.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Keine Korrekturen vorhanden.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Datum</TableHead>
                          <TableHead>Typ</TableHead>
                          <TableHead>Wert</TableHead>
                          <TableHead>Begründung</TableHead>
                          <TableHead>Erstellt von</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {corrections.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell>
                              {format(new Date(c.effective_date), 'dd.MM.yyyy', { locale: de })}
                            </TableCell>
                            <TableCell>
                              <Badge variant={c.correction_type === 'hours' ? 'default' : 'secondary'}>
                                {c.correction_type === 'hours' ? 'Stunden' : 'Urlaub'}
                              </Badge>
                            </TableCell>
                            <TableCell className={
                              (c.hours_adjustment || c.vacation_days_adjustment || 0) >= 0 
                                ? 'text-green-600 font-medium' 
                                : 'text-destructive font-medium'
                            }>
                              {(c.hours_adjustment || c.vacation_days_adjustment || 0) >= 0 ? '+' : ''}
                              {c.hours_adjustment ?? c.vacation_days_adjustment}
                              {c.correction_type === 'hours' ? 'h' : ' Tage'}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate" title={c.reason}>
                              {c.reason}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {c.creator?.full_name || 'Unbekannt'}
                              <br />
                              <span className="text-xs">
                                {format(new Date(c.created_at), 'dd.MM.yy HH:mm', { locale: de })}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {!selectedEmployeeId && (
            <p className="text-muted-foreground">
              Wählen Sie einen Mitarbeiter aus, um Korrekturen zu verwalten.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BalanceCorrectionManager;
