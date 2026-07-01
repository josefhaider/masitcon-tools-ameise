"use client";

import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { FileText, Download } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { Database } from '@/integrations/supabase/types';
import {
  calculateTravelExpense,
  formatEUR,
  locationLabel,
  type PerDiemRate,
  type MealProvision,
} from '@/lib/travelExpenses';
import { generateTravelExpenseSummaryPDF, type TravelExpenseSummaryRow } from '@/lib/pdfGenerator';

type BusinessTrip = Database['public']['Tables']['business_trips']['Row'];
type Profile = { id: string; full_name: string; employee_number: string | null };
type StatusFilter = 'approved' | 'pending' | 'rejected' | 'all';

const parseMeals = (json: unknown): MealProvision[] =>
  Array.isArray(json) ? (json as MealProvision[]) : [];

/** CSV-Wert für Excel absichern (Semikolon/Anführungszeichen/Zeilenumbruch). */
const csvCell = (value: string) =>
  /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const downloadCsv = (filename: string, content: string) => {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export default function TravelExpenseReport() {
  const currentYear = new Date().getFullYear();
  const [from, setFrom] = useState(`${currentYear}-01-01`);
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('approved');
  const [employeeFilter, setEmployeeFilter] = useState('all');

  const [trips, setTrips] = useState<BusinessTrip[]>([]);
  const [rates, setRates] = useState<PerDiemRate[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('business_trips')
        .select('*')
        .gte('start_date', from)
        .lte('start_date', to)
        .order('start_date', { ascending: true });
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (employeeFilter !== 'all') query = query.eq('user_id', employeeFilter);

      const [tripsRes, ratesRes, profilesRes] = await Promise.all([
        query,
        supabase
          .from('per_diem_rates')
          .select('country_code, country_name, full_day_rate, partial_day_rate, valid_from, valid_to, region'),
        supabase.from('profiles').select('id, full_name, employee_number').order('full_name'),
      ]);
      if (tripsRes.error) throw tripsRes.error;
      if (ratesRes.error) throw ratesRes.error;
      if (profilesRes.error) throw profilesRes.error;

      setTrips(tripsRes.data || []);
      setRates(ratesRes.data || []);
      setProfiles(new Map((profilesRes.data || []).map((p) => [p.id, p as Profile])));
    } catch (error) {
      console.error('Error loading report data:', error);
      toast.error('Fehler beim Laden der Daten');
    } finally {
      setLoading(false);
    }
  }, [from, to, statusFilter, employeeFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const countryName = (code: string) => rates.find((r) => r.country_code === code)?.country_name ?? code;

  const rows = useMemo(
    () =>
      trips.map((trip) => {
        const emp = profiles.get(trip.user_id);
        const result = calculateTravelExpense({
          startDate: trip.start_date,
          startTime: trip.start_time,
          endDate: trip.end_date,
          endTime: trip.end_time,
          countryCode: trip.country_code,
          region: trip.region,
          rates,
          meals: parseMeals(trip.meals_provided),
        });
        return {
          trip,
          employeeName: emp?.full_name ?? 'Unbekannt',
          employeeNumber: emp?.employee_number ?? null,
          countryName: locationLabel(countryName(trip.country_code), trip.region),
          total: result.total,
        };
      }),
    [trips, profiles, rates]
  );

  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);

  const fromLabel = format(new Date(`${from}T00:00:00`), 'dd.MM.yyyy', { locale: de });
  const toLabel = format(new Date(`${to}T00:00:00`), 'dd.MM.yyyy', { locale: de });

  const handlePdf = () => {
    if (rows.length === 0) {
      toast.error('Keine Reisen im gewählten Zeitraum');
      return;
    }
    const summaryRows: TravelExpenseSummaryRow[] = rows.map((r) => ({
      employeeName: r.employeeName,
      employeeNumber: r.employeeNumber,
      purpose: r.trip.purpose,
      destination: r.trip.destination,
      countryName: r.countryName,
      startLabel: format(new Date(`${r.trip.start_date}T00:00:00`), 'dd.MM.yyyy', { locale: de }),
      endLabel: format(new Date(`${r.trip.end_date}T00:00:00`), 'dd.MM.yyyy', { locale: de }),
      total: r.total,
    }));
    generateTravelExpenseSummaryPDF({ fromLabel, toLabel, rows: summaryRows });
  };

  const handleCsv = () => {
    if (rows.length === 0) {
      toast.error('Keine Reisen im gewählten Zeitraum');
      return;
    }
    const header = ['Mitarbeiter', 'Personalnummer', 'Anlass', 'Ziel', 'Land', 'Von', 'Bis', 'Betrag (EUR)'];
    const lines = rows.map((r) =>
      [
        r.employeeName,
        r.employeeNumber ?? '',
        r.trip.purpose,
        r.trip.destination ?? '',
        r.countryName,
        format(new Date(`${r.trip.start_date}T00:00:00`), 'dd.MM.yyyy', { locale: de }),
        format(new Date(`${r.trip.end_date}T00:00:00`), 'dd.MM.yyyy', { locale: de }),
        r.total.toFixed(2).replace('.', ','),
      ]
        .map((v) => csvCell(String(v)))
        .join(';')
    );
    const totalLine = ['Gesamt', '', '', '', '', '', '', grandTotal.toFixed(2).replace('.', ',')]
      .map((v) => csvCell(String(v)))
      .join(';');
    const content = [header.join(';'), ...lines, totalLine].join('\r\n');
    downloadCsv(`Reisekosten_VMA_${from}_${to}.csv`, content);
  };

  const employeeOptions = Array.from(profiles.values());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Reisekosten – Verpflegungsmehraufwand
        </CardTitle>
        <CardDescription>
          Auswertung des Verpflegungsmehraufwands zur Weitergabe an die Steuerberatung. Standardmäßig werden nur
          freigegebene Reisen berücksichtigt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label htmlFor="from">Von</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="to">Bis</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">✓ Nur freigegebene</SelectItem>
                <SelectItem value="pending">⏳ Ausstehend</SelectItem>
                <SelectItem value="rejected">✗ Abgelehnt</SelectItem>
                <SelectItem value="all">Alle</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Mitarbeiter</Label>
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Alle Mitarbeiter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Mitarbeiter</SelectItem>
                {employeeOptions.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={handleCsv} disabled={rows.length === 0} className="gap-1">
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button onClick={handlePdf} disabled={rows.length === 0} className="gap-1">
              <FileText className="h-4 w-4" />
              Sammel-PDF
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Wird geladen...</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Keine Reisen im gewählten Zeitraum</div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mitarbeiter</TableHead>
                  <TableHead>Anlass</TableHead>
                  <TableHead>Ziel</TableHead>
                  <TableHead>Zeitraum</TableHead>
                  <TableHead className="text-right">Betrag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.trip.id}>
                    <TableCell className="font-medium">
                      {r.employeeName}
                      {r.employeeNumber && <div className="text-xs text-muted-foreground">Nr. {r.employeeNumber}</div>}
                    </TableCell>
                    <TableCell>{r.trip.purpose}</TableCell>
                    <TableCell>
                      {r.trip.destination ? `${r.trip.destination}, ` : ''}
                      {r.countryName}
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(`${r.trip.start_date}T00:00:00`), 'dd.MM.yyyy', { locale: de })} –{' '}
                      {format(new Date(`${r.trip.end_date}T00:00:00`), 'dd.MM.yyyy', { locale: de })}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatEUR(r.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-bold">
                    Gesamt ({rows.length})
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{formatEUR(grandTotal)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
