"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { FileText, Download, Check, Loader2 } from 'lucide-react';
import { generateSickLeaveReportPDF, SickLeaveReportEntry } from '@/lib/pdfGenerator';
import { fetchHolidaysForRange, calculateWorkDaysWithHolidays } from '@/lib/workDaysCalculator';

interface SickLeave {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  medical_certificate_status: string | null;
  profile?: {
    full_name: string;
    employee_number: string | null;
  };
  [key: string]: unknown;
}

export default function SickLeaveReport() {
  const [sickLeaves, setSickLeaves] = useState<SickLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [onlyVerified, setOnlyVerified] = useState(true);
  const [workDaysMap, setWorkDaysMap] = useState<Map<string, number>>(new Map());

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
  }, [selectedMonth, selectedYear, onlyVerified]);

  const loadData = async () => {
    setLoading(true);
    try {
      const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      const endDate = new Date(selectedYear, selectedMonth, 0);
      const endDateStr = format(endDate, 'yyyy-MM-dd');

      let query = supabase
        .from('absences')
        .select('*')
        .eq('type', 'sick')
        .lte('start_date', endDateStr)  // Startdatum ≤ Monatsende
        .gte('end_date', startDate)      // Enddatum ≥ Monatsanfang
        .order('start_date');

      if (onlyVerified) {
        query = query.in('medical_certificate_status', ['received', 'not_required']);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Load profile data
      const sickLeavesWithProfiles = await Promise.all(
        (data || []).map(async (sl) => {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('full_name, employee_number')
            .eq('id', sl.user_id)
            .maybeSingle();
          
          return {
            ...sl,
            profile: profileData || undefined
          };
        })
      );

      setSickLeaves(sickLeavesWithProfiles);

      // Berechne Arbeitstage für alle Krankmeldungen
      if (sickLeavesWithProfiles.length > 0) {
        const allDates = sickLeavesWithProfiles.flatMap(sl => [new Date(sl.start_date), new Date(sl.end_date)]);
        const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
        
        const holidaySet = await fetchHolidaysForRange(minDate, maxDate);
        
        const newMap = new Map<string, number>();
        for (const sl of sickLeavesWithProfiles) {
          // Krankmeldungszeitraum auf gewählten Monat beschränken
          const effectiveStart = sl.start_date > startDate ? sl.start_date : startDate;
          const effectiveEnd = sl.end_date < endDateStr ? sl.end_date : endDateStr;
          const days = calculateWorkDaysWithHolidays(effectiveStart, effectiveEnd, holidaySet);
          newMap.set(sl.id, days);
        }
        setWorkDaysMap(newMap);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Fehler beim Laden der Daten');
    } finally {
      setLoading(false);
    }
  };

  const getWorkDays = (sickLeaveId: string): number => {
    return workDaysMap.get(sickLeaveId) ?? 0;
  };

  const getTotalWorkDays = (): number => {
    let total = 0;
    for (const sl of sickLeaves) {
      total += workDaysMap.get(sl.id) ?? 0;
    }
    return total;
  };

  const handleGeneratePDF = async () => {
    setGenerating(true);
    try {
      const entries: SickLeaveReportEntry[] = sickLeaves.map(sl => ({
        employeeName: sl.profile?.full_name || 'Unbekannt',
        employeeNumber: sl.profile?.employee_number || null,
        startDate: sl.start_date,
        endDate: sl.end_date,
        workDays: getWorkDays(sl.id),
        certificateStatus: sl.medical_certificate_status
      }));

      generateSickLeaveReportPDF(entries, selectedMonth, selectedYear, onlyVerified);
      toast.success('PDF wurde erstellt und heruntergeladen');
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Fehler beim Erstellen des PDFs');
    } finally {
      setGenerating(false);
    }
  };

  const totalDays = getTotalWorkDays();
  const monthLabel = months.find(m => m.value === selectedMonth)?.label || '';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Krankmeldungsreport für Steuerberaterin
          </CardTitle>
          <CardDescription>
            Erstellen Sie einen PDF-Report aller Krankmeldungen für die Erstattung durch die Krankenkasse.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <div className="flex gap-2">
              <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map(m => (
                    <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="only-verified"
                checked={onlyVerified}
                onCheckedChange={setOnlyVerified}
              />
              <Label htmlFor="only-verified">Nur geprüfte Krankmeldungen</Label>
            </div>

            <Button 
              onClick={handleGeneratePDF} 
              disabled={generating || sickLeaves.length === 0}
              className="ml-auto"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              PDF herunterladen
            </Button>
          </div>

          {/* Preview */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <h3 className="font-semibold mb-4">
              Vorschau: Krankmeldungsbericht {monthLabel} {selectedYear}
            </h3>

            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : sickLeaves.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Keine Krankmeldungen für den ausgewählten Zeitraum gefunden.
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mitarbeiter</TableHead>
                      <TableHead>P.Nr.</TableHead>
                      <TableHead>Von</TableHead>
                      <TableHead>Bis</TableHead>
                      <TableHead className="text-center">Arbeitstage</TableHead>
                      <TableHead className="text-center">Attest</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sickLeaves.map((sl) => (
                      <TableRow key={sl.id}>
                        <TableCell className="font-medium">{sl.profile?.full_name || 'Unbekannt'}</TableCell>
                        <TableCell>{sl.profile?.employee_number || '-'}</TableCell>
                        <TableCell>{format(parseISO(sl.start_date), 'dd.MM.yyyy')}</TableCell>
                        <TableCell>{format(parseISO(sl.end_date), 'dd.MM.yyyy')}</TableCell>
                        <TableCell className="text-center">{getWorkDays(sl.id)}</TableCell>
                        <TableCell className="text-center">
                          {sl.medical_certificate_status === 'received' && (
                            <Badge className="bg-green-100 text-green-800"><Check className="h-3 w-3" /></Badge>
                          )}
                          {sl.medical_certificate_status === 'not_required' && (
                            <Badge variant="secondary">○</Badge>
                          )}
                          {sl.medical_certificate_status === 'pending' && (
                            <Badge variant="destructive">✗</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-muted/50">
                      <TableCell colSpan={4}>GESAMT</TableCell>
                      <TableCell className="text-center">{totalDays}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>

                <div className="mt-4 text-sm text-muted-foreground">
                  <p>Legende: ✓ = Attest erhalten, ○ = Nicht erforderlich, ✗ = Ausstehend</p>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
