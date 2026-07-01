"use client";

import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { FileText, Download, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { Database } from '@/integrations/supabase/types';
import {
  calculateTravelExpense,
  formatEUR,
  locationLabel,
  travelDayKindLabel,
  type PerDiemRate,
  type MealProvision,
  type TravelExpenseResult,
} from '@/lib/travelExpenses';
import { generateTravelExpenseSummaryPDF } from '@/lib/pdfGenerator';

type BusinessTrip = Database['public']['Tables']['business_trips']['Row'];
type Profile = { id: string; full_name: string; employee_number: string | null };
type StatusFilter = 'approved' | 'pending' | 'rejected' | 'all';

interface TripDetail {
  trip: BusinessTrip;
  employeeName: string;
  employeeNumber: string | null;
  locationName: string;
  result: TravelExpenseResult;
}

interface EmployeeGroup {
  userId: string;
  employeeName: string;
  employeeNumber: string | null;
  trips: TripDetail[];
  total: number;
}

const parseMeals = (json: unknown): MealProvision[] =>
  Array.isArray(json) ? (json as MealProvision[]) : [];

/** CSV-Wert für Excel absichern (Semikolon/Anführungszeichen/Zeilenumbruch). */
const csvCell = (value: string) => (/[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

const downloadCsv = (filename: string, content: string) => {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const dmy = (d: string) => format(new Date(`${d}T00:00:00`), 'dd.MM.yyyy', { locale: de });
const dateTimeLabel = (d: string, t: string) => `${dmy(d)} ${t.slice(0, 5)}`;
/** Kürzungswert für die Anzeige ("− 5,60 €" bzw. "–"). */
const redLabel = (n: number) => (n > 0 ? `− ${formatEUR(n)}` : '–');

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

  // Reisen mit voller Tagesberechnung, gruppiert je Mitarbeiter
  const groups = useMemo<EmployeeGroup[]>(() => {
    const map = new Map<string, EmployeeGroup>();
    for (const trip of trips) {
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
      const detail: TripDetail = {
        trip,
        employeeName: emp?.full_name ?? 'Unbekannt',
        employeeNumber: emp?.employee_number ?? null,
        locationName: locationLabel(countryName(trip.country_code), trip.region),
        result,
      };
      let group = map.get(trip.user_id);
      if (!group) {
        group = {
          userId: trip.user_id,
          employeeName: detail.employeeName,
          employeeNumber: detail.employeeNumber,
          trips: [],
          total: 0,
        };
        map.set(trip.user_id, group);
      }
      group.trips.push(detail);
      group.total += result.total;
    }
    return Array.from(map.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [trips, profiles, rates]);

  const grandTotal = groups.reduce((sum, g) => sum + g.total, 0);
  const tripCount = groups.reduce((sum, g) => sum + g.trips.length, 0);

  const fromLabel = dmy(from);
  const toLabel = dmy(to);

  const handlePdf = () => {
    if (tripCount === 0) {
      toast.error('Keine Reisen im gewählten Zeitraum');
      return;
    }
    generateTravelExpenseSummaryPDF({
      fromLabel,
      toLabel,
      grandTotal,
      employees: groups.map((g) => ({
        employeeName: g.employeeName,
        employeeNumber: g.employeeNumber,
        total: g.total,
        trips: g.trips.map((d) => ({
          purpose: d.trip.purpose,
          destination: d.trip.destination,
          locationName: d.locationName,
          startLabel: dateTimeLabel(d.trip.start_date, d.trip.start_time),
          endLabel: dateTimeLabel(d.trip.end_date, d.trip.end_time),
          days: d.result.days,
          total: d.result.total,
        })),
      })),
    });
  };

  const handleCsv = () => {
    if (tripCount === 0) {
      toast.error('Keine Reisen im gewählten Zeitraum');
      return;
    }
    // Eine Zeile je Reisetag – volle Nachvollziehbarkeit für die Steuerberatung
    const header = [
      'Mitarbeiter', 'Personalnummer', 'Anlass', 'Ziel',
      'Datum', 'Art', 'Tagessatz', 'Kürzung Frühstück', 'Kürzung Mittag', 'Kürzung Abend', 'Betrag',
    ];
    const eur = (n: number) => n.toFixed(2).replace('.', ',');
    const lines: string[] = [];
    for (const g of groups) {
      for (const d of g.trips) {
        for (const day of d.result.days) {
          lines.push(
            [
              g.employeeName,
              g.employeeNumber ?? '',
              d.trip.purpose,
              `${d.trip.destination ? `${d.trip.destination}, ` : ''}${d.locationName}`,
              dmy(day.date),
              travelDayKindLabel(day.kind),
              eur(day.baseRate),
              eur(day.reductions.breakfast),
              eur(day.reductions.lunch),
              eur(day.reductions.dinner),
              eur(day.amount),
            ]
              .map((v) => csvCell(String(v)))
              .join(';')
          );
        }
      }
    }
    const totalLine = ['Gesamt', '', '', '', '', '', '', '', '', '', eur(grandTotal)]
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
          Nachvollziehbare Auswertung mit Tagesaufstellung je Reise zur Weitergabe an die Steuerberatung.
          Standardmäßig werden nur freigegebene Reisen berücksichtigt.
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
            <Button variant="outline" onClick={handleCsv} disabled={tripCount === 0} className="gap-1">
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button onClick={handlePdf} disabled={tripCount === 0} className="gap-1">
              <FileText className="h-4 w-4" />
              Sammel-PDF
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Wird geladen...</div>
        ) : tripCount === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Keine Reisen im gewählten Zeitraum</div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.userId} className="overflow-hidden rounded-lg border">
                {/* Mitarbeiter-Kopf */}
                <div className="flex items-center justify-between bg-primary px-4 py-2.5 text-primary-foreground">
                  <div className="font-semibold">
                    {group.employeeName}
                    {group.employeeNumber && (
                      <span className="ml-2 text-xs font-normal opacity-80">Nr. {group.employeeNumber}</span>
                    )}
                  </div>
                  <div className="text-sm">
                    Summe: <span className="font-bold">{formatEUR(group.total)}</span>
                  </div>
                </div>

                <div className="divide-y">
                  {group.trips.map((d) => (
                    <div key={d.trip.id} className="space-y-3 p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <div className="font-medium">{d.trip.purpose}</div>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {d.trip.destination ? `${d.trip.destination}, ` : ''}
                            {d.locationName}
                            <span className="mx-1">·</span>
                            {dateTimeLabel(d.trip.start_date, d.trip.start_time)} – {dateTimeLabel(d.trip.end_date, d.trip.end_time)}
                          </div>
                        </div>
                        <div className="font-bold">{formatEUR(d.result.total)}</div>
                      </div>

                      <div className="overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Datum</TableHead>
                              <TableHead>Art</TableHead>
                              <TableHead className="text-right">Tagessatz</TableHead>
                              <TableHead className="text-right">Frühstück</TableHead>
                              <TableHead className="text-right">Mittag</TableHead>
                              <TableHead className="text-right">Abend</TableHead>
                              <TableHead className="text-right">Betrag</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {d.result.days.map((day) => (
                              <TableRow key={day.date}>
                                <TableCell className="whitespace-nowrap">
                                  {format(new Date(`${day.date}T00:00:00`), 'EEE, dd.MM.yyyy', { locale: de })}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">
                                    {travelDayKindLabel(day.kind)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{formatEUR(day.baseRate)}</TableCell>
                                <TableCell className={`text-right tabular-nums ${day.reductions.breakfast > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                  {redLabel(day.reductions.breakfast)}
                                </TableCell>
                                <TableCell className={`text-right tabular-nums ${day.reductions.lunch > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                  {redLabel(day.reductions.lunch)}
                                </TableCell>
                                <TableCell className={`text-right tabular-nums ${day.reductions.dinner > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                  {redLabel(day.reductions.dinner)}
                                </TableCell>
                                <TableCell className="text-right font-semibold tabular-nums">{formatEUR(day.amount)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                          <TableFooter>
                            <TableRow>
                              <TableCell colSpan={6} className="text-right font-medium">
                                Summe Reise
                              </TableCell>
                              <TableCell className="text-right font-bold tabular-nums">{formatEUR(d.result.total)}</TableCell>
                            </TableRow>
                          </TableFooter>
                        </Table>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Gesamtsumme */}
            <div className="flex items-center justify-between border-t-2 border-primary pt-4">
              <span className="text-lg font-bold">Gesamtsumme ({tripCount} {tripCount === 1 ? 'Reise' : 'Reisen'})</span>
              <span className="text-lg font-bold tabular-nums">{formatEUR(grandTotal)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
