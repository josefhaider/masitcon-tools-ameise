"use client";

import { useEffect, useState } from 'react';
import { format, isAfter, isBefore, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';
import { Pencil, Trash2, Thermometer, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAudit } from '@/lib/auditLog';
import EditSickLeaveDialog from './EditSickLeaveDialog';
import { fetchHolidaysForRange, calculateWorkDaysWithHolidays } from '@/lib/workDaysCalculator';
import { useIsMobile } from '@/hooks/use-mobile';
import MobileAbsenceCard from './MobileAbsenceCard';

interface SickLeave {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  created_at: string;
  medical_certificate_status?: string | null;
}

interface MySickLeavesProps {
  refreshTrigger?: number;
}

export default function MySickLeaves({ refreshTrigger }: MySickLeavesProps) {
  const [sickLeaves, setSickLeaves] = useState<SickLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingLeave, setEditingLeave] = useState<SickLeave | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [workDaysMap, setWorkDaysMap] = useState<Map<string, number>>(new Map());
  const [calculatingDays, setCalculatingDays] = useState(false);
  const isMobile = useIsMobile();

  const loadSickLeaves = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('absences')
        .select('*')
        .eq('user_id', user.id)
        .eq('type', 'sick')
        .order('start_date', { ascending: false });

      if (error) throw error;
      setSickLeaves(data || []);
    } catch (error) {
      console.error('Error loading sick leaves:', error);
      toast.error('Fehler beim Laden der Krankmeldungen');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSickLeaves();
  }, [refreshTrigger]);

  // Berechne Arbeitstage für alle Krankmeldungen
  useEffect(() => {
    const calculateAllWorkDays = async () => {
      if (sickLeaves.length === 0) return;
      
      setCalculatingDays(true);
      try {
        const allDates = sickLeaves.flatMap(l => [new Date(l.start_date), new Date(l.end_date)]);
        const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
        
        const holidays = await fetchHolidaysForRange(minDate, maxDate);
        
        const newMap = new Map<string, number>();
        for (const leave of sickLeaves) {
          const days = calculateWorkDaysWithHolidays(leave.start_date, leave.end_date, holidays);
          newMap.set(leave.id, days);
        }
        setWorkDaysMap(newMap);
      } catch (error) {
        console.error('Error calculating work days:', error);
      } finally {
        setCalculatingDays(false);
      }
    };
    calculateAllWorkDays();
  }, [sickLeaves]);

  const getStatus = (leave: SickLeave): 'active' | 'past' | 'planned' => {
    const today = startOfDay(new Date());
    const start = new Date(leave.start_date);
    const end = new Date(leave.end_date);

    if (isBefore(end, today)) {
      return 'past';
    }
    if (isAfter(start, today)) {
      return 'planned';
    }
    return 'active';
  };

  const getStatusLabel = (status: 'active' | 'past' | 'planned') => {
    switch (status) {
      case 'active': return { label: 'Aktiv', variant: 'destructive' as const };
      case 'past': return { label: 'Vergangen', variant: 'secondary' as const };
      case 'planned': return { label: 'Geplant', variant: 'outline' as const };
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const leave = sickLeaves.find(l => l.id === id);
      
      const { error } = await supabase
        .from('absences')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await logAudit({
        action: 'DELETE',
        tableName: 'absences',
        recordId: id,
        oldValues: leave,
        description: `Krankmeldung gelöscht: ${leave?.start_date} - ${leave?.end_date}`,
      });

      toast.success('Krankmeldung gelöscht');
      setDeleteConfirmId(null);
      loadSickLeaves();
    } catch (error: unknown) {
      console.error('Error deleting sick leave:', error);
      toast.error('Fehler beim Löschen der Krankmeldung');
    }
  };

  const getDuration = (leave: SickLeave) => {
    const days = workDaysMap.get(leave.id);
    if (calculatingDays || days === undefined) {
      return <Loader2 className="inline h-3 w-3 animate-spin" />;
    }
    return `${days} ${days === 1 ? 'Arbeitstag' : 'Arbeitstage'}`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Krankmeldungen werden geladen...
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Thermometer className="h-5 w-5" />
            Meine Krankmeldungen
          </CardTitle>
          <CardDescription>
            Übersicht Ihrer erfassten Krankmeldungen
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sickLeaves.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              Keine Krankmeldungen vorhanden
            </p>
          ) : isMobile ? (
            // Mobile: Card-based layout
            <div className="space-y-4">
              {sickLeaves.map((leave) => {
                const status = getStatus(leave);
                const canEdit = status === 'active' || status === 'planned';
                
                return (
                  <MobileAbsenceCard
                    key={leave.id}
                    type="sick"
                    startDate={leave.start_date}
                    endDate={leave.end_date}
                    workDays={workDaysMap.get(leave.id)}
                    calculatingDays={calculatingDays}
                    status={status}
                    notes={leave.notes}
                    certificateStatus={leave.medical_certificate_status}
                    onEdit={canEdit ? () => setEditingLeave(leave) : undefined}
                    onDelete={() => setDeleteConfirmId(leave.id)}
                  />
                );
              })}
            </div>
          ) : (
            // Desktop: Original layout
            <div className="space-y-3">
              {sickLeaves.map((leave) => {
                const status = getStatus(leave);
                const statusInfo = getStatusLabel(status);
                const canEdit = status === 'active' || status === 'planned';
                
                return (
                  <div
                    key={leave.id}
                    className="flex items-center justify-between p-4 border rounded-lg bg-card"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                        <span className="font-medium">
                          {format(new Date(leave.start_date), 'dd.MM.yyyy', { locale: de })}
                          {' – '}
                          {format(new Date(leave.end_date), 'dd.MM.yyyy', { locale: de })}
                        </span>
                        <span className="text-muted-foreground">
                          ({getDuration(leave)})
                        </span>
                      </div>
                      {leave.notes && (
                        <p className="text-sm text-muted-foreground">{leave.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setEditingLeave(leave)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setDeleteConfirmId(leave.id)}
                        className="text-destructive hover:text-destructive"
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

      <EditSickLeaveDialog
        sickLeave={editingLeave}
        open={!!editingLeave}
        onOpenChange={(open) => !open && setEditingLeave(null)}
        onSuccess={loadSickLeaves}
      />

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Krankmeldung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie diese Krankmeldung wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
