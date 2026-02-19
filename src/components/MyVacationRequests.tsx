import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Trash2, Plane, Clock, Ban, GraduationCap, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Database } from '@/integrations/supabase/types';
import { fetchHolidaysForRange, calculateWorkDaysWithHolidays } from '@/lib/workDaysCalculator';
import { useIsMobile } from '@/hooks/use-mobile';
import MobileAbsenceCard from './MobileAbsenceCard';

type AbsenceType = Database['public']['Enums']['absence_type'];

interface VacationRequest {
  id: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  status: string;
  type: AbsenceType;
  approved_at: string | null;
  rejection_reason: string | null;
  approved_by: string | null;
  is_half_day: boolean | null;
  profiles?: {
    full_name: string;
  } | null;
}

const MyVacationRequests = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState<VacationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [workDaysMap, setWorkDaysMap] = useState<Map<string, number>>(new Map());
  const [calculatingDays, setCalculatingDays] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    loadRequests();
  }, [user]);

  // Berechne Arbeitstage für alle Requests
  useEffect(() => {
    const calculateAllWorkDays = async () => {
      if (requests.length === 0) return;
      
      setCalculatingDays(true);
      try {
        // Finde den Datumsbereich aller Requests
        const allDates = requests.flatMap(r => [new Date(r.start_date), new Date(r.end_date)]);
        const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
        
        // Lade Feiertage einmal für den gesamten Bereich
        const holidays = await fetchHolidaysForRange(minDate, maxDate);
        
        // Berechne Arbeitstage für jeden Request
        const newMap = new Map<string, number>();
        for (const req of requests) {
          const days = calculateWorkDaysWithHolidays(req.start_date, req.end_date, holidays);
          newMap.set(req.id, days);
        }
        setWorkDaysMap(newMap);
      } catch (error) {
        console.error('Error calculating work days:', error);
      } finally {
        setCalculatingDays(false);
      }
    };
    calculateAllWorkDays();
  }, [requests]);

  const loadRequests = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('absences')
        .select(`
          *,
          profiles:profiles!absences_approved_by_fkey (full_name)
        `)
        .eq('user_id', user.id)
        .in('type', ['vacation', 'unpaid_leave', 'comp_time'])
        .order('start_date', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error('Error loading vacation requests:', error);
      toast.error('Fehler beim Laden der Urlaubsanträge');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Möchten Sie diesen Urlaubsantrag wirklich löschen?')) return;

    try {
      const { error } = await supabase.from('absences').delete().eq('id', id);
      if (error) throw error;

      toast.success('Urlaubsantrag gelöscht');
      loadRequests();
    } catch (error) {
      console.error('Error deleting vacation request:', error);
      toast.error('Fehler beim Löschen des Urlaubsantrags');
    }
  };

  const getWorkDays = (request: VacationRequest): number | null => {
    // Bei halbem Tag immer 0,5 zurückgeben
    if (request.is_half_day) return 0.5;
    return workDaysMap.get(request.id) ?? null;
  };

  const getStatusBadge = (request: VacationRequest) => {
    switch (request.status) {
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

  const getTypeBadge = (type: AbsenceType) => {
    switch (type) {
      case 'vacation':
        return (
          <Badge variant="secondary" className="gap-1">
            <Plane className="h-3 w-3" />
            Bezahlter Urlaub
          </Badge>
        );
      case 'unpaid_leave':
        return (
          <Badge variant="outline" className="gap-1">
            <Ban className="h-3 w-3" />
            Unbezahlter Urlaub
          </Badge>
        );
      case 'comp_time':
        return (
          <Badge className="bg-sky-100 text-sky-800 border-sky-300 gap-1">
            <Clock className="h-3 w-3" />
            Überstundenfrei
          </Badge>
        );
      case 'vocational_school':
        return (
          <Badge className="bg-purple-100 text-purple-800 border-purple-300 gap-1">
            <GraduationCap className="h-3 w-3" />
            Berufsschule
          </Badge>
        );
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
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
        <CardTitle>Meine Urlaubsanträge</CardTitle>
        <CardDescription>Übersicht über alle Ihre Urlaubsanträge und deren Status</CardDescription>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            Sie haben noch keine Urlaubsanträge gestellt
          </p>
        ) : isMobile ? (
          // Mobile: Card-based layout
          <div className="space-y-4">
            {requests.map((request) => (
              <MobileAbsenceCard
                key={request.id}
                type={request.type}
                startDate={request.start_date}
                endDate={request.end_date}
                workDays={getWorkDays(request)}
                calculatingDays={calculatingDays}
                status={request.status as 'pending' | 'approved' | 'rejected'}
                notes={request.notes}
                rejectionReason={request.rejection_reason}
                approvedAt={request.approved_at}
                approvedBy={request.profiles?.full_name}
                isHalfDay={request.is_half_day ?? false}
                onDelete={request.status === 'pending' ? () => handleDelete(request.id) : undefined}
              />
            ))}
          </div>
        ) : (
          // Desktop: Original layout
          <div className="space-y-4">
            {requests.map((request) => (
              <div
                key={request.id}
                className="flex items-start justify-between rounded-lg border bg-card p-4"
              >
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getTypeBadge(request.type)}
                    {getStatusBadge(request)}
                    {request.is_half_day && (
                      <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                        ½ Tag
                      </span>
                    )}
                    <span className="text-sm text-muted-foreground">
                      {calculatingDays ? (
                        <Loader2 className="inline h-3 w-3 animate-spin" />
                      ) : (
                        <>{getWorkDays(request)?.toLocaleString('de-DE') ?? '-'} Arbeitstage</>
                      )}
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">
                      {format(new Date(request.start_date), 'dd. MMM yyyy', { locale: de })} -{' '}
                      {format(new Date(request.end_date), 'dd. MMM yyyy', { locale: de })}
                    </span>
                  </div>
                  {request.notes && (
                    <p className="text-sm text-muted-foreground">{request.notes}</p>
                  )}
                  {request.status === 'approved' && request.approved_at && (
                    <p className="text-xs text-muted-foreground">
                      Genehmigt am {format(new Date(request.approved_at), 'dd. MMM yyyy', { locale: de })}
                      {request.profiles && ` von ${request.profiles.full_name}`}
                    </p>
                  )}
                  {request.status === 'rejected' && request.rejection_reason && (
                    <div className="rounded-md bg-red-50 p-2 text-sm text-red-800">
                      <span className="font-medium">Ablehnungsgrund:</span> {request.rejection_reason}
                    </div>
                  )}
                </div>
                {request.status === 'pending' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(request.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MyVacationRequests;
