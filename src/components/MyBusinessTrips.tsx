"use client";

import { useEffect, useState, useCallback } from 'react';
import { useProfile } from '@/contexts/profile-context';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Trash2, FileText, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { logAudit } from '@/lib/auditLog';
import type { Database } from '@/integrations/supabase/types';
import {
  calculateTravelExpense,
  formatEUR,
  locationLabel,
  type PerDiemRate,
  type MealProvision,
} from '@/lib/travelExpenses';
import { generateBusinessTripPDF } from '@/lib/pdfGenerator';

type BusinessTrip = Database['public']['Tables']['business_trips']['Row'];

const statusBadge = (status: string) => {
  switch (status) {
    case 'pending':
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">⏳ Ausstehend</Badge>;
    case 'approved':
      return <Badge className="bg-green-100 text-green-800 border-green-300">✓ Genehmigt</Badge>;
    case 'rejected':
      return <Badge className="bg-red-100 text-red-800 border-red-300">✗ Abgelehnt</Badge>;
    default:
      return <Badge>Unbekannt</Badge>;
  }
};

const parseMeals = (json: unknown): MealProvision[] =>
  Array.isArray(json) ? (json as MealProvision[]) : [];

const MyBusinessTrips = () => {
  const { userId, fullName } = useProfile();
  const [trips, setTrips] = useState<BusinessTrip[]>([]);
  const [rates, setRates] = useState<PerDiemRate[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!userId) return;
    try {
      const [tripsRes, ratesRes] = await Promise.all([
        supabase
          .from('business_trips')
          .select('*')
          .eq('user_id', userId)
          .order('start_date', { ascending: false }),
        supabase
          .from('per_diem_rates')
          .select('country_code, country_name, full_day_rate, partial_day_rate, valid_from, valid_to, region'),
      ]);
      if (tripsRes.error) throw tripsRes.error;
      if (ratesRes.error) throw ratesRes.error;
      setTrips(tripsRes.data || []);
      setRates(ratesRes.data || []);
    } catch (error) {
      console.error('Error loading business trips:', error);
      toast.error('Fehler beim Laden der Dienstreisen');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const countryName = (code: string) =>
    rates.find((r) => r.country_code === code)?.country_name ?? code;

  const tripLocation = (trip: BusinessTrip) => locationLabel(countryName(trip.country_code), trip.region);

  const computeTotal = (trip: BusinessTrip) =>
    calculateTravelExpense({
      startDate: trip.start_date,
      startTime: trip.start_time,
      endDate: trip.end_date,
      endTime: trip.end_time,
      countryCode: trip.country_code,
      region: trip.region,
      rates,
      meals: parseMeals(trip.meals_provided),
    });

  const handleDelete = async (trip: BusinessTrip) => {
    if (!confirm('Möchten Sie diese Dienstreise wirklich löschen?')) return;
    try {
      const { error } = await supabase.from('business_trips').delete().eq('id', trip.id);
      if (error) throw error;
      await logAudit({
        action: 'DELETE',
        tableName: 'business_trips',
        recordId: trip.id,
        oldValues: { purpose: trip.purpose, start_date: trip.start_date, end_date: trip.end_date },
        description: `Dienstreise gelöscht: ${trip.destination || trip.country_code} (${trip.start_date} – ${trip.end_date})`,
      });
      toast.success('Dienstreise gelöscht');
      loadData();
    } catch (error) {
      console.error('Error deleting business trip:', error);
      toast.error('Fehler beim Löschen der Dienstreise');
    }
  };

  const handlePdf = (trip: BusinessTrip) => {
    const result = computeTotal(trip);
    generateBusinessTripPDF({
      employeeName: fullName || 'Mitarbeiter',
      employeeNumber: null,
      purpose: trip.purpose,
      destination: trip.destination,
      countryName: tripLocation(trip),
      startLabel: `${format(new Date(`${trip.start_date}T00:00:00`), 'dd.MM.yyyy', { locale: de })} ${trip.start_time.slice(0, 5)}`,
      endLabel: `${format(new Date(`${trip.end_date}T00:00:00`), 'dd.MM.yyyy', { locale: de })} ${trip.end_time.slice(0, 5)}`,
      days: result.days,
      total: result.total,
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">Wird geladen...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meine Dienstreisen</CardTitle>
        <CardDescription>Übersicht Ihrer erfassten Reisen und des berechneten Verpflegungsmehraufwands</CardDescription>
      </CardHeader>
      <CardContent>
        {trips.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Sie haben noch keine Dienstreisen erfasst</p>
        ) : (
          <div className="space-y-4">
            {trips.map((trip) => {
              const result = computeTotal(trip);
              return (
                <div key={trip.id} className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {statusBadge(trip.status)}
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {trip.destination ? `${trip.destination}, ` : ''}
                        {tripLocation(trip)}
                      </span>
                    </div>
                    <div className="text-sm font-medium">
                      {format(new Date(`${trip.start_date}T00:00:00`), 'dd. MMM yyyy', { locale: de })}{' '}
                      {trip.start_time.slice(0, 5)} –{' '}
                      {format(new Date(`${trip.end_date}T00:00:00`), 'dd. MMM yyyy', { locale: de })}{' '}
                      {trip.end_time.slice(0, 5)}
                    </div>
                    <p className="text-sm text-muted-foreground">{trip.purpose}</p>
                    {trip.status === 'rejected' && trip.rejection_reason && (
                      <div className="rounded-md bg-red-50 p-2 text-sm text-red-800">
                        <span className="font-medium">Ablehnungsgrund:</span> {trip.rejection_reason}
                      </div>
                    )}
                    <div className="text-base font-bold">{formatEUR(result.total)}</div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button variant="outline" size="sm" onClick={() => handlePdf(trip)} className="gap-1">
                      <FileText className="h-4 w-4" />
                      PDF
                    </Button>
                    {trip.status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(trip)}
                        className="gap-1 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        Löschen
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MyBusinessTrips;
