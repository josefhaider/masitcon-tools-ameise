import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DashboardOverview } from './DashboardOverview';
import MonthlyTimeCalendar from './MonthlyTimeCalendar';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Mail, User, Calendar, History, Clock, Plane, TrendingUp, TrendingDown, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { logAudit } from '@/lib/auditLog';
import { calculateMonthlyHours, getBalanceCorrections } from '@/lib/targetHoursCalculator';
import { fetchHolidaysForRange, calculateWorkDaysWithHolidays } from '@/lib/workDaysCalculator';

interface EmployeeDetailViewProps {
  employeeId: string;
  onBack: () => void;
}

interface BalanceCorrection {
  id: string;
  effective_date: string;
  correction_type: string;
  hours_adjustment: number | null;
  vacation_days_adjustment: number | null;
  reason: string;
  created_at: string;
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

export const EmployeeDetailView = ({ employeeId, onBack }: EmployeeDetailViewProps) => {
  const [profile, setProfile] = useState<any>(null);
  const [teams, setTeams] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'calendar' | 'corrections'>('overview');
  
  // Korrektur-Daten
  const [corrections, setCorrections] = useState<BalanceCorrection[]>([]);
  const [balances, setBalances] = useState<EmployeeBalances | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  
  // Form state
  const [correctionType, setCorrectionType] = useState<'hours' | 'vacation'>('hours');
  const [effectiveDate, setEffectiveDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [adjustmentValue, setAdjustmentValue] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    loadEmployeeProfile();
  }, [employeeId]);

  useEffect(() => {
    if (activeTab === 'corrections' && employeeId) {
      loadCorrectionsData();
    }
  }, [activeTab, employeeId]);

  const loadEmployeeProfile = async () => {
    setLoading(true);
    try {
      // Lade Profil
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', employeeId)
        .single();

      if (profileError) throw profileError;
      setProfile(profileData);

      // Lade Teams
      const { data: teamData, error: teamError } = await supabase
        .from('team_members')
        .select('teams(name)')
        .eq('user_id', employeeId)
        .eq('is_active', true);

      if (teamError) throw teamError;
      const teamNames = teamData?.map((tm: any) => tm.teams?.name).filter(Boolean) || [];
      setTeams(teamNames);
    } catch (error) {
      console.error('Fehler beim Laden des Mitarbeiter-Profils:', error);
      toast.error('Fehler beim Laden der Mitarbeiter-Daten');
    } finally {
      setLoading(false);
    }
  };

  const loadCorrectionsData = async () => {
    try {
      // Lade Korrekturen
      const { data: correctionsData, error: corrError } = await supabase
        .from('balance_corrections')
        .select('*')
        .eq('user_id', employeeId)
        .order('effective_date', { ascending: false });

      if (corrError) throw corrError;

      // Lade Creator-Namen
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

      let calculatedHours = 0;
      for (let month = 1; month <= now.getMonth() + 1; month++) {
        const monthData = await calculateMonthlyHours(
          employeeId,
          month,
          currentYear,
          month === now.getMonth() + 1 ? now : undefined
        );
        calculatedHours += monthData.balance;
      }

      const hoursCorrections = await getBalanceCorrections(employeeId, 'hours');
      const vacationCorrections = await getBalanceCorrections(employeeId, 'vacation');

      const vacationEntitlement = profile?.annual_vacation_days || 30;

      // Berechne genommenen Urlaub (nur Arbeitstage, ohne Wochenenden/Feiertage)
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear}-12-31`;
      const { data: vacationData } = await supabase
        .from('absences')
        .select('start_date, end_date')
        .eq('user_id', employeeId)
        .eq('type', 'vacation')
        .eq('status', 'approved')
        .gte('start_date', yearStart)
        .lte('end_date', yearEnd);

      // Lade Feiertage für das Jahr
      const holidaysSet = await fetchHolidaysForRange(new Date(yearStart), new Date(yearEnd));

      const vacationUsed = vacationData?.reduce((sum, v) => {
        const days = calculateWorkDaysWithHolidays(v.start_date, v.end_date, holidaysSet);
        return sum + days;
      }, 0) || 0;

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
      console.error('Fehler beim Laden der Korrekturen:', error);
      toast.error('Fehler beim Laden der Korrektur-Daten');
    }
  };

  const handleSaveCorrection = async () => {
    if (!reason.trim() || !adjustmentValue) {
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
      user_id: employeeId,
      effective_date: effectiveDate,
      correction_type: correctionType,
      hours_adjustment: correctionType === 'hours' ? adjustment : null,
      vacation_days_adjustment: correctionType === 'vacation' ? adjustment : null,
      reason: reason.trim(),
      created_by: user.id,
      applies_to_year: new Date().getFullYear()
    };

    const { data, error } = await supabase
      .from('balance_corrections')
      .insert(newCorrection)
      .select()
      .single();

    if (error) {
      toast.error('Fehler beim Speichern der Korrektur');
      return;
    }

    await logAudit({
      action: 'INSERT',
      tableName: 'balance_corrections',
      recordId: data.id,
      newValues: newCorrection,
      description: `${correctionType === 'hours' ? 'Stunden' : 'Urlaubs'}-Korrektur für ${profile?.full_name}: ${adjustment > 0 ? '+' : ''}${adjustment}`
    });

    toast.success('Korrektur erfolgreich gespeichert');
    setDialogOpen(false);
    resetForm();
    loadCorrectionsData();
  };

  const resetForm = () => {
    setCorrectionType('hours');
    setEffectiveDate(format(new Date(), 'yyyy-MM-dd'));
    setAdjustmentValue('');
    setReason('');
  };

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <User className="mx-auto h-12 w-12 animate-pulse text-primary" />
          <p className="mt-4 text-muted-foreground">Lade Mitarbeiter-Daten...</p>
        </div>
      </div>
    );
  }

  const initials = profile.full_name
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase();

  return (
    <div className="space-y-6">
      {/* Navigation zurück */}
      <Button variant="ghost" onClick={onBack} className="gap-2">
        <ArrowLeft className="h-4 w-4" />
        Zurück zur Team-Übersicht
      </Button>

      {/* Mitarbeiter-Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <CardTitle>{profile.full_name}</CardTitle>
                {profile.employee_number && (
                  <Badge variant="secondary">MA-Nr: {profile.employee_number}</Badge>
                )}
              </div>
              <CardDescription className="flex items-center gap-2">
                <Mail className="h-3 w-3" />
                {profile.email}
              </CardDescription>
              {teams.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {teams.map((team) => (
                    <Badge key={team} variant="outline">
                      {team}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <Badge variant="outline" className="bg-primary/10 text-primary">
              Admin-Ansicht
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Tab-Navigation */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'overview' | 'calendar' | 'corrections')}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview" className="gap-2">
            <User className="h-4 w-4" />
            Übersicht
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-2">
            <Calendar className="h-4 w-4" />
            Monatskalender
          </TabsTrigger>
          <TabsTrigger value="corrections" className="gap-2">
            <History className="h-4 w-4" />
            Korrekturen
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="mt-6">
          <DashboardOverview 
            userId={employeeId} 
            isAdminView={true}
            onNavigate={() => {}}
          />
        </TabsContent>
        
        <TabsContent value="calendar" className="mt-6">
          <MonthlyTimeCalendar userId={employeeId} />
        </TabsContent>

        <TabsContent value="corrections" className="mt-6 space-y-6">
          {/* Aktuelle Salden */}
          {balances && (
            <div className="grid gap-4 md:grid-cols-2">
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
                      <span className="text-muted-foreground">Korrekturen:</span>
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
          )}

          {/* Neue Korrektur Button */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Neue Korrektur
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Neue Korrektur für {profile?.full_name}</DialogTitle>
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
                    Positive Werte = Gutschrift, Negative = Abzug
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reason">Begründung (Pflichtfeld)</Label>
                  <Textarea
                    id="reason"
                    placeholder="z.B. Übertrag Überstunden 2024..."
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
        </TabsContent>
      </Tabs>
    </div>
  );
};
