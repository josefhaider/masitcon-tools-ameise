"use client";

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/contexts/profile-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Check, X, Trash2, FileText, MapPin } from 'lucide-react';
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
type Profile = { id: string; full_name: string; employee_number: string | null };
type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

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

const TravelExpenseApproval = () => {
  const { userId } = useProfile();
  const [trips, setTrips] = useState<BusinessTrip[]>([]);
  const [rates, setRates] = useState<PerDiemRate[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [isProcessing, setIsProcessing] = useState(false);

  const [rejectTrip, setRejectTrip] = useState<BusinessTrip | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const loadData = useCallback(async () => {
    try {
      let query = supabase.from('business_trips').select('*').order('start_date', { ascending: false });
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
      console.error('Error loading trips:', error);
      toast.error('Fehler beim Laden der Dienstreisen');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, employeeFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const employee = (id: string) => profiles.get(id);
  const countryName = (code: string) => rates.find((r) => r.country_code === code)?.country_name ?? code;
  const tripLocation = (trip: BusinessTrip) => locationLabel(countryName(trip.country_code), trip.region);

  const compute = (trip: BusinessTrip) =>
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

  const handleApprove = async (trip: BusinessTrip) => {
    const emp = employee(trip.user_id);
    if (!confirm(`Dienstreise von ${emp?.full_name || 'Mitarbeiter'} genehmigen?`)) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('business_trips')
        .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString(), rejection_reason: null })
        .eq('id', trip.id);
      if (error) throw error;
      await logAudit({
        action: 'UPDATE',
        tableName: 'business_trips',
        recordId: trip.id,
        oldValues: { status: 'pending' },
        newValues: { status: 'approved' },
        description: `Dienstreise von ${emp?.full_name || 'Mitarbeiter'} genehmigt (${trip.start_date} – ${trip.end_date})`,
      });
      toast.success('Dienstreise genehmigt');
      loadData();
    } catch (error) {
      console.error('Error approving trip:', error);
      toast.error('Fehler beim Genehmigen');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!rejectTrip) return;
    if (!rejectReason.trim()) {
      toast.error('Bitte einen Ablehnungsgrund angeben');
      return;
    }
    const emp = employee(rejectTrip.user_id);
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('business_trips')
        .update({
          status: 'rejected',
          rejection_reason: rejectReason.trim(),
          approved_by: userId,
          approved_at: new Date().toISOString(),
        })
        .eq('id', rejectTrip.id);
      if (error) throw error;
      await logAudit({
        action: 'UPDATE',
        tableName: 'business_trips',
        recordId: rejectTrip.id,
        oldValues: { status: 'pending' },
        newValues: { status: 'rejected', rejection_reason: rejectReason.trim() },
        description: `Dienstreise von ${emp?.full_name || 'Mitarbeiter'} abgelehnt`,
      });
      toast.success('Dienstreise abgelehnt');
      setRejectTrip(null);
      setRejectReason('');
      loadData();
    } catch (error) {
      console.error('Error rejecting trip:', error);
      toast.error('Fehler beim Ablehnen');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (trip: BusinessTrip) => {
    if (!confirm('Diese Dienstreise wirklich löschen?')) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase.from('business_trips').delete().eq('id', trip.id);
      if (error) throw error;
      await logAudit({
        action: 'DELETE',
        tableName: 'business_trips',
        recordId: trip.id,
        oldValues: { purpose: trip.purpose, start_date: trip.start_date, end_date: trip.end_date },
        description: `Dienstreise gelöscht (${employee(trip.user_id)?.full_name || 'Mitarbeiter'})`,
      });
      toast.success('Dienstreise gelöscht');
      loadData();
    } catch (error) {
      console.error('Error deleting trip:', error);
      toast.error('Fehler beim Löschen');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePdf = (trip: BusinessTrip) => {
    const emp = employee(trip.user_id);
    const result = compute(trip);
    generateBusinessTripPDF({
      employeeName: emp?.full_name || 'Mitarbeiter',
      employeeNumber: emp?.employee_number ?? null,
      purpose: trip.purpose,
      destination: trip.destination,
      countryName: tripLocation(trip),
      startLabel: `${format(new Date(`${trip.start_date}T00:00:00`), 'dd.MM.yyyy', { locale: de })} ${trip.start_time.slice(0, 5)}`,
      endLabel: `${format(new Date(`${trip.end_date}T00:00:00`), 'dd.MM.yyyy', { locale: de })} ${trip.end_time.slice(0, 5)}`,
      days: result.days,
      total: result.total,
    });
  };

  const employeeOptions = Array.from(profiles.values());

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Dienstreisen freigeben</CardTitle>
          <CardDescription>Prüfen und genehmigen Sie die erfassten Reisen Ihrer Mitarbeiter.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Status:</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle anzeigen</SelectItem>
                  <SelectItem value="pending">⏳ Ausstehend</SelectItem>
                  <SelectItem value="approved">✓ Genehmigt</SelectItem>
                  <SelectItem value="rejected">✗ Abgelehnt</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">Mitarbeiter:</Label>
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
            <Badge variant="secondary">
              {trips.length} {trips.length === 1 ? 'Eintrag' : 'Einträge'}
            </Badge>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
            </div>
          ) : trips.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">Keine Dienstreisen gefunden</div>
          ) : (
            <div className="space-y-4">
              {trips.map((trip) => {
                const emp = employee(trip.user_id);
                const result = compute(trip);
                return (
                  <div key={trip.id} className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{emp?.full_name || 'Unbekannt'}</span>
                        {emp?.employee_number && (
                          <span className="text-xs text-muted-foreground">Nr. {emp.employee_number}</span>
                        )}
                        {statusBadge(trip.status)}
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {trip.destination ? `${trip.destination}, ` : ''}
                          {tripLocation(trip)}
                        </span>
                      </div>
                      <div className="text-sm">
                        {format(new Date(`${trip.start_date}T00:00:00`), 'dd.MM.yyyy', { locale: de })}{' '}
                        {trip.start_time.slice(0, 5)} –{' '}
                        {format(new Date(`${trip.end_date}T00:00:00`), 'dd.MM.yyyy', { locale: de })}{' '}
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
                      {trip.status === 'pending' && (
                        <>
                          <Button size="sm" onClick={() => handleApprove(trip)} disabled={isProcessing} className="gap-1">
                            <Check className="h-4 w-4" />
                            Genehmigen
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => { setRejectTrip(trip); setRejectReason(''); }}
                            disabled={isProcessing}
                            className="gap-1"
                          >
                            <X className="h-4 w-4" />
                            Ablehnen
                          </Button>
                        </>
                      )}
                      <Button variant="outline" size="sm" onClick={() => handlePdf(trip)} className="gap-1">
                        <FileText className="h-4 w-4" />
                        PDF
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(trip)}
                        disabled={isProcessing}
                        className="gap-1 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejectTrip} onOpenChange={(open) => !open && setRejectTrip(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dienstreise ablehnen</DialogTitle>
            <DialogDescription>{rejectTrip && employee(rejectTrip.user_id)?.full_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">
              Ablehnungsgrund <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Bitte geben Sie einen Grund an..."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTrip(null)} disabled={isProcessing}>
              Abbrechen
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={isProcessing || !rejectReason.trim()}>
              {isProcessing ? 'Wird abgelehnt...' : 'Ablehnen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TravelExpenseApproval;
