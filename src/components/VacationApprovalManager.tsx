import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { Check, X, Pencil, Trash2, Plane, Clock, Ban, GraduationCap, Filter, ChevronDown, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import { logAudit } from '@/lib/auditLog';
import { Database } from '@/integrations/supabase/types';
import { useIsMobile } from '@/hooks/use-mobile';
import MobileAbsenceCard from './MobileAbsenceCard';
import { fetchHolidaysForRange, calculateWorkDaysWithHolidays } from '@/lib/workDaysCalculator';

type AbsenceType = Database['public']['Enums']['absence_type'];

interface VacationRequest {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  status: string;
  type: AbsenceType;
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  profiles: {
    full_name: string;
    employee_number: string | null;
  } | null;
}

const getTypeBadge = (type: AbsenceType) => {
  switch (type) {
    case 'vacation':
      return (
        <Badge variant="secondary" className="gap-1">
          <Plane className="h-3 w-3" />
          Bezahlt
        </Badge>
      );
    case 'unpaid_leave':
      return (
        <Badge variant="outline" className="gap-1">
          <Ban className="h-3 w-3" />
          Unbezahlt
        </Badge>
      );
    case 'comp_time':
      return (
        <Badge className="bg-sky-100 text-sky-800 border-sky-300 gap-1">
          <Clock className="h-3 w-3" />
          Überstunden
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

const VacationApprovalManager = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState<VacationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [employees, setEmployees] = useState<{id: string; full_name: string}[]>([]);
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isMobile = useIsMobile();
  
  // Work days calculation
  const [workDaysMap, setWorkDaysMap] = useState<Map<string, number>>(new Map());
  const [calculatingDays, setCalculatingDays] = useState(false);
  
  // Reject dialog state
  const [selectedRequest, setSelectedRequest] = useState<VacationRequest | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<VacationRequest | null>(null);
  
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    loadRequests();
  }, [statusFilter, employeeFilter]);

  // Berechne Arbeitstage für alle Requests (exkl. Wochenenden und Feiertage)
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

  const loadEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('is_archived', false)
        .order('full_name');
      
      if (error) throw error;
      setEmployees(data || []);
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  const loadRequests = async () => {
    try {
      let query = supabase
        .from('absences')
        .select('*, profiles!absences_user_id_fkey(*)')
        .in('type', ['vacation', 'unpaid_leave', 'comp_time'])
        .order('start_date', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (employeeFilter !== 'all') {
        query = query.eq('user_id', employeeFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      const mappedRequests = (data || []).map((item: any) => ({
        ...item,
        profiles: item.profiles ? {
          full_name: item.profiles.full_name,
          employee_number: item.profiles.employee_number
        } : null
      }));
      
      setRequests(mappedRequests);
    } catch (error) {
      console.error('Error loading requests:', error);
      toast.error('Fehler beim Laden der Urlaubsanträge');
    } finally {
      setLoading(false);
    }
  };

  const getWorkDays = (requestId: string): number | null => {
    return workDaysMap.get(requestId) ?? null;
  };

  const handleApprove = async (request: VacationRequest) => {
    if (!confirm(`Urlaubsantrag von ${request.profiles?.full_name || 'Mitarbeiter'} genehmigen?`)) return;

    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('absences')
        .update({
          status: 'approved',
          approved_by: user!.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', request.id);

      if (error) throw error;

      await logAudit({
        action: 'UPDATE',
        tableName: 'absences',
        recordId: request.id,
        oldValues: { status: 'pending' },
        newValues: { status: 'approved' },
        description: `Urlaubsantrag von ${request.profiles?.full_name || 'Mitarbeiter'} genehmigt: ${request.start_date} - ${request.end_date}`,
      });

      toast.success('Urlaubsantrag genehmigt');
      loadRequests();
    } catch (error) {
      console.error('Error approving request:', error);
      toast.error('Fehler beim Genehmigen des Urlaubsantrags');
    } finally {
      setIsProcessing(false);
    }
  };

  const openRejectDialog = (request: VacationRequest) => {
    setSelectedRequest(request);
    setRejectionReason('');
    setRejectDialogOpen(true);
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    if (!rejectionReason.trim()) {
      toast.error('Bitte geben Sie einen Ablehnungsgrund an');
      return;
    }

    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('absences')
        .update({
          status: 'rejected',
          rejection_reason: rejectionReason,
          approved_by: user!.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', selectedRequest.id);

      if (error) throw error;

      await logAudit({
        action: 'UPDATE',
        tableName: 'absences',
        recordId: selectedRequest.id,
        oldValues: { status: 'pending' },
        newValues: { status: 'rejected', rejection_reason: rejectionReason },
        description: `Urlaubsantrag von ${selectedRequest.profiles?.full_name || 'Mitarbeiter'} abgelehnt: ${selectedRequest.start_date} - ${selectedRequest.end_date}`,
      });

      toast.success('Urlaubsantrag abgelehnt');
      setRejectDialogOpen(false);
      setSelectedRequest(null);
      setRejectionReason('');
      loadRequests();
    } catch (error) {
      console.error('Error rejecting request:', error);
      toast.error('Fehler beim Ablehnen des Urlaubsantrags');
    } finally {
      setIsProcessing(false);
    }
  };

  const openEditDialog = (request: VacationRequest) => {
    setEditingRequest({...request});
    setEditDialogOpen(true);
  };

  const handleUpdateRequest = async () => {
    if (!editingRequest) return;

    setIsProcessing(true);
    try {
      const updateData: any = {
        start_date: editingRequest.start_date,
        end_date: editingRequest.end_date,
        status: editingRequest.status,
        notes: editingRequest.notes,
      };

      // Wenn Status auf approved geändert wird
      if (editingRequest.status === 'approved') {
        updateData.approved_by = user!.id;
        updateData.approved_at = new Date().toISOString();
        updateData.rejection_reason = null;
      }

      // Wenn Status auf rejected geändert wird
      if (editingRequest.status === 'rejected') {
        updateData.rejection_reason = editingRequest.rejection_reason;
        updateData.approved_by = user!.id;
        updateData.approved_at = new Date().toISOString();
      }

      // Wenn Status auf pending zurückgesetzt wird
      if (editingRequest.status === 'pending') {
        updateData.approved_by = null;
        updateData.approved_at = null;
        updateData.rejection_reason = null;
      }

      const { error } = await supabase
        .from('absences')
        .update(updateData)
        .eq('id', editingRequest.id);

      if (error) throw error;

      toast.success('Urlaubsantrag aktualisiert');
      setEditDialogOpen(false);
      setEditingRequest(null);
      loadRequests();
    } catch (error) {
      console.error('Error updating request:', error);
      toast.error('Fehler beim Aktualisieren des Urlaubsantrags');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Diesen Urlaubsantrag wirklich löschen?')) return;

    const requestToDelete = requests.find(r => r.id === id);
    
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('absences')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await logAudit({
        action: 'DELETE',
        tableName: 'absences',
        recordId: id,
        oldValues: requestToDelete ? {
          status: requestToDelete.status,
          start_date: requestToDelete.start_date,
          end_date: requestToDelete.end_date,
        } : undefined,
        description: `Urlaubsantrag von ${requestToDelete?.profiles?.full_name || 'Mitarbeiter'} gelöscht`,
      });

      toast.success('Urlaubsantrag gelöscht');
      loadRequests();
    } catch (error) {
      console.error('Error deleting request:', error);
      toast.error('Fehler beim Löschen des Urlaubsantrags');
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Urlaubsanträge</CardTitle>
          <CardDescription>Verwalten Sie alle Urlaubsanträge</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Filter UI Component
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
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{requests.length} Einträge</Badge>
                <ChevronDown className={`h-4 w-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
              </div>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Status</Label>
              <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
                <SelectTrigger className="w-full">
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
            <div className="space-y-2">
              <Label className="text-sm font-medium">Mitarbeiter</Label>
              <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Alle Mitarbeiter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Mitarbeiter</SelectItem>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CollapsibleContent>
        </Collapsible>
      );
    }

    return (
      <div className="mb-6 flex gap-4 items-center flex-wrap">
        <div className="flex gap-2 items-center">
          <Label className="text-sm font-medium">Status:</Label>
          <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
            <SelectTrigger className="w-[180px]">
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
        <div className="flex gap-2 items-center">
          <Label className="text-sm font-medium">Mitarbeiter:</Label>
          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Alle Mitarbeiter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Mitarbeiter</SelectItem>
              {employees.map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge variant="secondary">
          {requests.length} {requests.length === 1 ? 'Eintrag' : 'Einträge'}
        </Badge>
      </div>
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Urlaubsanträge</CardTitle>
          <CardDescription>Verwalten Sie alle Urlaubsanträge Ihrer Mitarbeiter</CardDescription>
        </CardHeader>
        <CardContent>
          <FilterUI />

          {requests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Keine Urlaubsanträge gefunden
            </div>
          ) : isMobile ? (
            // Mobile: Card-based layout
            <div className="space-y-4">
              {requests.map((request) => (
                <MobileAbsenceCard
                  key={request.id}
                  type={request.type}
                  startDate={request.start_date}
                  endDate={request.end_date}
                  workDays={getWorkDays(request.id)}
                  calculatingDays={calculatingDays}
                  status={request.status as 'pending' | 'approved' | 'rejected'}
                  notes={request.notes}
                  rejectionReason={request.rejection_reason}
                  employeeName={request.profiles?.full_name}
                  employeeNumber={request.profiles?.employee_number}
                  approvedAt={request.approved_at}
                  onApprove={request.status === 'pending' ? () => handleApprove(request) : undefined}
                  onReject={request.status === 'pending' ? () => openRejectDialog(request) : undefined}
                  onEdit={() => openEditDialog(request)}
                  onDelete={() => handleDelete(request.id)}
                  isProcessing={isProcessing}
                />
              ))}
            </div>
          ) : (
            // Desktop: Table layout
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mitarbeiter</TableHead>
                    <TableHead>Art</TableHead>
                    <TableHead>Zeitraum</TableHead>
                    <TableHead>Tage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Notizen</TableHead>
                    <TableHead>Bearbeitet</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">
                        {request.profiles?.full_name || 'Unbekannt'}
                        {request.profiles?.employee_number && (
                          <div className="text-xs text-muted-foreground">
                            Nr. {request.profiles.employee_number}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {getTypeBadge(request.type)}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {format(new Date(request.start_date), 'dd.MM.yyyy', { locale: de })}
                          {' - '}
                          {format(new Date(request.end_date), 'dd.MM.yyyy', { locale: de })}
                        </div>
                      </TableCell>
                      <TableCell>
                        {calculatingDays ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          getWorkDays(request.id) ?? '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {request.status === 'pending' && (
                          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
                            ⏳ Ausstehend
                          </Badge>
                        )}
                        {request.status === 'approved' && (
                          <Badge className="bg-green-100 text-green-800 border-green-300">
                            ✓ Genehmigt
                          </Badge>
                        )}
                        {request.status === 'rejected' && (
                          <Badge className="bg-red-100 text-red-800 border-red-300">
                            ✗ Abgelehnt
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="text-sm truncate">
                          {request.notes || '-'}
                        </div>
                        {request.status === 'rejected' && request.rejection_reason && (
                          <div className="text-xs text-red-600 mt-1 truncate">
                            Grund: {request.rejection_reason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {request.status !== 'pending' && request.approved_at && (
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(request.approved_at), 'dd.MM.yyyy HH:mm', { locale: de })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {request.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleApprove(request)}
                                disabled={isProcessing}
                                className="gap-1"
                              >
                                <Check className="h-4 w-4" />
                                Genehmigen
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => openRejectDialog(request)}
                                disabled={isProcessing}
                                className="gap-1"
                              >
                                <X className="h-4 w-4" />
                                Ablehnen
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDialog(request)}
                            disabled={isProcessing}
                            className="gap-1"
                          >
                            <Pencil className="h-4 w-4" />
                            Bearbeiten
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(request.id)}
                            disabled={isProcessing}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Urlaubsantrag ablehnen</DialogTitle>
            <DialogDescription>
              {selectedRequest?.profiles?.full_name} - {selectedRequest && (getWorkDays(selectedRequest.id) ?? '...')} Arbeitstage
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="rejection-reason">
                Ablehnungsgrund <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="rejection-reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Bitte geben Sie einen Grund für die Ablehnung an..."
                className="mt-2"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectDialogOpen(false);
                setSelectedRequest(null);
                setRejectionReason('');
              }}
              disabled={isProcessing}
            >
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isProcessing || !rejectionReason.trim()}
            >
              {isProcessing ? 'Wird abgelehnt...' : 'Ablehnen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Urlaubsantrag bearbeiten</DialogTitle>
            <DialogDescription>
              {editingRequest?.profiles?.full_name}
            </DialogDescription>
          </DialogHeader>
          {editingRequest && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-status">Status</Label>
                <Select 
                  value={editingRequest.status}
                  onValueChange={(value) => 
                    setEditingRequest({...editingRequest, status: value})
                  }
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">⏳ Ausstehend</SelectItem>
                    <SelectItem value="approved">✓ Genehmigt</SelectItem>
                    <SelectItem value="rejected">✗ Abgelehnt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="edit-start-date">Von</Label>
                <Input
                  id="edit-start-date"
                  type="date"
                  value={editingRequest.start_date}
                  onChange={(e) => 
                    setEditingRequest({...editingRequest, start_date: e.target.value})
                  }
                  className="mt-2"
                />
              </div>
              
              <div>
                <Label htmlFor="edit-end-date">Bis</Label>
                <Input
                  id="edit-end-date"
                  type="date"
                  value={editingRequest.end_date}
                  onChange={(e) => 
                    setEditingRequest({...editingRequest, end_date: e.target.value})
                  }
                  className="mt-2"
                />
              </div>
              
              <div>
                <Label htmlFor="edit-notes">Notizen</Label>
                <Textarea
                  id="edit-notes"
                  value={editingRequest.notes || ''}
                  onChange={(e) => 
                    setEditingRequest({...editingRequest, notes: e.target.value})
                  }
                  placeholder="Optionale Notizen..."
                  className="mt-2"
                  rows={3}
                />
              </div>
              
              {editingRequest.status === 'rejected' && (
                <div>
                  <Label htmlFor="edit-rejection-reason">
                    Ablehnungsgrund <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="edit-rejection-reason"
                    value={editingRequest.rejection_reason || ''}
                    onChange={(e) => 
                      setEditingRequest({...editingRequest, rejection_reason: e.target.value})
                    }
                    placeholder="Grund für die Ablehnung..."
                    className="mt-2"
                    rows={3}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setEditDialogOpen(false);
                setEditingRequest(null);
              }}
              disabled={isProcessing}
            >
              Abbrechen
            </Button>
            <Button 
              onClick={handleUpdateRequest}
              disabled={isProcessing || (editingRequest?.status === 'rejected' && !editingRequest?.rejection_reason?.trim())}
            >
              {isProcessing ? 'Wird gespeichert...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default VacationApprovalManager;
