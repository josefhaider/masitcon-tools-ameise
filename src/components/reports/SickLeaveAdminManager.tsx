"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Check, X, Circle, FileCheck, Loader2, Trash2, Filter, ChevronDown } from 'lucide-react';
import { logAudit } from '@/lib/auditLog';
import { fetchHolidaysForRange, calculateWorkDaysWithHolidays } from '@/lib/workDaysCalculator';
import { useIsMobile } from '@/hooks/use-mobile';
import MobileAbsenceCard from '@/components/MobileAbsenceCard';

interface SickLeave {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  medical_certificate_status: string | null;
  medical_certificate_path?: string | null;
  created_at: string;
  created_by?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  status?: string | null;
  type?: string;
  is_half_day?: boolean | null;
  half_day_type?: string | null;
  updated_at?: string | null;
  profile?: {
    full_name: string;
    employee_number: string | null;
  };
}

export default function SickLeaveAdminManager() {
  const [sickLeaves, setSickLeaves] = useState<SickLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([]);
  const [workDaysMap, setWorkDaysMap] = useState<Map<string, number>>(new Map());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isMobile = useIsMobile();

  const months = [
    { value: 1, label: 'Januar' },
    { value: 2, label: 'Februar' },
    { value: 3, label: 'März' },
    { value: 4, label: 'April' },
    { value: 5, label: 'Mai' },
    { value: 6, label: 'Juni' },
    { value: 7, label: 'Juli' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'Oktober' },
    { value: 11, label: 'November' },
    { value: 12, label: 'Dezember' },
  ];

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  useEffect(() => {
    loadData();
  }, [selectedMonth, selectedYear, statusFilter, employeeFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('is_archived', false)
        .order('full_name');
      
      setEmployees(profilesData || []);

      const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      const endDate = new Date(selectedYear, selectedMonth, 0);
      const endDateStr = format(endDate, 'yyyy-MM-dd');

      let query = supabase
        .from('absences')
        .select('*')
        .eq('type', 'sick')
        .or(`start_date.lte.${endDateStr},end_date.gte.${startDate}`)
        .order('start_date', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('medical_certificate_status', statusFilter);
      }

      if (employeeFilter !== 'all') {
        query = query.eq('user_id', employeeFilter);
      }

      const { data, error } = await query;

      if (error) throw error;

      const sickLeavesWithProfiles = await Promise.all(
        (data || []).map(async (sl) => {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('full_name, employee_number')
            .eq('id', sl.user_id)
            .maybeSingle();
          
          return { ...sl, profile: profileData || undefined };
        })
      );

      setSickLeaves(sickLeavesWithProfiles);

      if (sickLeavesWithProfiles.length > 0) {
        const allDates = sickLeavesWithProfiles.flatMap(sl => [new Date(sl.start_date), new Date(sl.end_date)]);
        const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
        
        const holidaySet = await fetchHolidaysForRange(minDate, maxDate);
        
        const newMap = new Map<string, number>();
        for (const sl of sickLeavesWithProfiles) {
          const days = calculateWorkDaysWithHolidays(sl.start_date, sl.end_date, holidaySet);
          newMap.set(sl.id, days);
        }
        setWorkDaysMap(newMap);
      }
    } catch (error) {
      console.error('Error loading sick leaves:', error);
      toast.error('Fehler beim Laden der Krankmeldungen');
    } finally {
      setLoading(false);
    }
  };

  const updateCertificateStatus = async (id: string, status: string) => {
    setUpdating(id);
    try {
      const { error } = await supabase
        .from('absences')
        .update({ medical_certificate_status: status })
        .eq('id', id);

      if (error) throw error;

      await logAudit({
        action: 'UPDATE',
        tableName: 'absences',
        recordId: id,
        description: `Attest-Status geändert auf: ${status === 'received' ? 'Erhalten' : status === 'not_required' ? 'Nicht erforderlich' : 'Ausstehend'}`,
        newValues: { medical_certificate_status: status }
      });

      toast.success('Status aktualisiert');
      loadData();
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Fehler beim Aktualisieren');
    } finally {
      setUpdating(null);
    }
  };

  const handleDelete = async (id: string, sickLeave: SickLeave) => {
    if (!confirm(`Krankmeldung von ${sickLeave.profile?.full_name || 'Mitarbeiter'} wirklich löschen?`)) return;
    
    setUpdating(id);
    try {
      const { error } = await supabase.from('absences').delete().eq('id', id);

      if (error) throw error;

      await logAudit({
        action: 'DELETE',
        tableName: 'absences',
        recordId: id,
        oldValues: { type: 'sick', start_date: sickLeave.start_date, end_date: sickLeave.end_date },
        description: `Krankmeldung von ${sickLeave.profile?.full_name || 'Mitarbeiter'} gelöscht`,
      });

      toast.success('Krankmeldung gelöscht');
      loadData();
    } catch (error) {
      console.error('Error deleting sick leave:', error);
      toast.error('Fehler beim Löschen der Krankmeldung');
    } finally {
      setUpdating(null);
    }
  };

  const getWorkDays = (sickLeaveId: string): number => workDaysMap.get(sickLeaveId) ?? 0;
  const getTotalWorkDays = (): number => sickLeaves.reduce((total, sl) => total + (workDaysMap.get(sl.id) ?? 0), 0);

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'received':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><Check className="h-3 w-3 mr-1" /> Erhalten</Badge>;
      case 'not_required':
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"><Circle className="h-3 w-3 mr-1" /> Nicht nötig</Badge>;
      default:
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"><X className="h-3 w-3 mr-1" /> Ausstehend</Badge>;
    }
  };

  const stats = {
    total: sickLeaves.length,
    received: sickLeaves.filter(s => s.medical_certificate_status === 'received').length,
    pending: sickLeaves.filter(s => s.medical_certificate_status === 'pending').length,
    notRequired: sickLeaves.filter(s => s.medical_certificate_status === 'not_required').length,
    totalDays: getTotalWorkDays()
  };

  const FilterUI = () => {
    if (isMobile) {
      return (
        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} className="mb-4">
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filter
              </div>
              <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-4">
            <div className="grid grid-cols-2 gap-2">
              <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {months.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Status</SelectItem>
                <SelectItem value="pending">Ausstehend</SelectItem>
                <SelectItem value="received">Attest erhalten</SelectItem>
                <SelectItem value="not_required">Nicht erforderlich</SelectItem>
              </SelectContent>
            </Select>
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Mitarbeiter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Mitarbeiter</SelectItem>
                {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CollapsibleContent>
        </Collapsible>
      );
    }

    return (
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex gap-2">
          <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{months.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            <SelectItem value="pending">Ausstehend</SelectItem>
            <SelectItem value="received">Attest erhalten</SelectItem>
            <SelectItem value="not_required">Nicht erforderlich</SelectItem>
          </SelectContent>
        </Select>
        <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Mitarbeiter" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Mitarbeiter</SelectItem>
            {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Krankmeldungen verwalten
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FilterUI />

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card className="p-4"><div className="text-sm text-muted-foreground">Gesamt</div><div className="text-2xl font-bold">{stats.total}</div></Card>
            <Card className="p-4"><div className="text-sm text-muted-foreground">Mit Attest</div><div className="text-2xl font-bold text-green-600">{stats.received}</div></Card>
            <Card className="p-4"><div className="text-sm text-muted-foreground">Ausstehend</div><div className="text-2xl font-bold text-red-600">{stats.pending}</div></Card>
            <Card className="p-4"><div className="text-sm text-muted-foreground">Nicht nötig</div><div className="text-2xl font-bold text-gray-600">{stats.notRequired}</div></Card>
            <Card className="p-4"><div className="text-sm text-muted-foreground">Krankheitstage</div><div className="text-2xl font-bold">{stats.totalDays}</div></Card>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : sickLeaves.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Keine Krankmeldungen für den ausgewählten Zeitraum gefunden.</div>
          ) : isMobile ? (
            <div className="space-y-4">
              {sickLeaves.map((sl) => (
                <MobileAbsenceCard
                  key={sl.id}
                  type="sick"
                  startDate={sl.start_date}
                  endDate={sl.end_date}
                  workDays={getWorkDays(sl.id)}
                  employeeName={sl.profile?.full_name}
                  employeeNumber={sl.profile?.employee_number}
                  notes={sl.notes}
                  certificateStatus={sl.medical_certificate_status}
                  onCertificateStatusChange={(status) => updateCertificateStatus(sl.id, status)}
                  onDelete={() => handleDelete(sl.id, sl)}
                  isProcessing={updating === sl.id}
                />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mitarbeiter</TableHead>
                  <TableHead>P.Nr.</TableHead>
                  <TableHead>Von</TableHead>
                  <TableHead>Bis</TableHead>
                  <TableHead>Tage</TableHead>
                  <TableHead>Notizen</TableHead>
                  <TableHead>Attest-Status</TableHead>
                  <TableHead>Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sickLeaves.map((sl) => (
                  <TableRow key={sl.id}>
                    <TableCell className="font-medium">{sl.profile?.full_name || 'Unbekannt'}</TableCell>
                    <TableCell>{sl.profile?.employee_number || '-'}</TableCell>
                    <TableCell>{format(parseISO(sl.start_date), 'dd.MM.yyyy')}</TableCell>
                    <TableCell>{format(parseISO(sl.end_date), 'dd.MM.yyyy')}</TableCell>
                    <TableCell>{getWorkDays(sl.id)}</TableCell>
                    <TableCell className="max-w-xs truncate">{sl.notes || '-'}</TableCell>
                    <TableCell>{getStatusBadge(sl.medical_certificate_status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant={sl.medical_certificate_status === 'received' ? 'default' : 'outline'} onClick={() => updateCertificateStatus(sl.id, 'received')} disabled={updating === sl.id}>
                          {updating === sl.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant={sl.medical_certificate_status === 'not_required' ? 'default' : 'outline'} onClick={() => updateCertificateStatus(sl.id, 'not_required')} disabled={updating === sl.id}>
                          {updating === sl.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Circle className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant={sl.medical_certificate_status === 'pending' ? 'default' : 'outline'} onClick={() => updateCertificateStatus(sl.id, 'pending')} disabled={updating === sl.id}>
                          {updating === sl.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(sl.id, sl)} disabled={updating === sl.id} title="Krankmeldung löschen">
                          {updating === sl.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                      </div>
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
