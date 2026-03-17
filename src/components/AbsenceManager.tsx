"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Thermometer, Plane, Ban, Clock, GraduationCap, CircleDot } from 'lucide-react';
import { logAudit } from '@/lib/auditLog';

const AbsenceManager = () => {
  const [employees, setEmployees] = useState<any[]>([]);
  const [absences, setAbsences] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedAbsence, setSelectedAbsence] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  // State für halben Urlaubstag im Erstellen-Formular
  const [formType, setFormType] = useState<string>('');
  const [formStartDate, setFormStartDate] = useState<string>('');
  const [formEndDate, setFormEndDate] = useState<string>('');
  const [isHalfDay, setIsHalfDay] = useState(false);

  // Reset isHalfDay wenn Bedingungen nicht mehr erfüllt sind
  useEffect(() => {
    if (formType !== 'vacation' || !formStartDate || !formEndDate || formStartDate !== formEndDate) {
      setIsHalfDay(false);
    }
  }, [formType, formStartDate, formEndDate]);

  useEffect(() => {
    loadEmployees();
    loadAbsences();
  }, []);

  const loadEmployees = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_archived', false)
      .order('full_name');
    
    setEmployees(data || []);
  };

  const loadAbsences = async () => {
    const { data } = await supabase
      .from('absences')
      .select('*, profiles!absences_user_id_fkey(full_name)')
      .order('start_date', { ascending: false });
    
    setAbsences(data || []);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setLoading(true);

    const formData = new FormData(form);
    const userId = formData.get('userId') as string;
    const type = formData.get('type') as string;
    const startDate = formData.get('startDate') as string;
    const endDate = formData.get('endDate') as string;
    const notes = formData.get('notes') as string;

    const { data: { user } } = await supabase.auth.getUser();
    const employee = employees.find(emp => emp.id === userId);
    
    // Halber Tag nur bei vacation und gleichem Start-/Enddatum
    const halfDayValue = type === 'vacation' && startDate === endDate ? isHalfDay : false;

    const { data: newAbsence, error } = await supabase.from('absences').insert([{
      user_id: userId,
      type: type as 'vacation' | 'sick' | 'other',
      start_date: startDate,
      end_date: endDate,
      notes: notes || null,
      status: 'approved',
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
      created_by: user?.id,
      is_half_day: halfDayValue,
    }]).select().single();

    if (error) {
      toast.error('Fehler beim Speichern', {
        description: error.message,
      });
    } else {
      const displayDays = halfDayValue ? '0,5' : calculateDays(startDate, endDate);
      await logAudit({
        action: 'INSERT',
        tableName: 'absences',
        recordId: newAbsence?.id,
        newValues: { user_id: userId, type, start_date: startDate, end_date: endDate, status: 'approved', is_half_day: halfDayValue },
        description: `Abwesenheit (${type}) für ${employee?.full_name || 'Mitarbeiter'} eingetragen: ${startDate} - ${endDate} (${displayDays} Tage${halfDayValue ? ', halber Tag' : ''})`,
      });
      
      toast.success('Abwesenheit eingetragen');
      form.reset();
      setFormType('');
      setFormStartDate('');
      setFormEndDate('');
      setIsHalfDay(false);
      await loadAbsences();
    }

    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    const absenceToDelete = absences.find(a => a.id === id);
    const { error } = await supabase.from('absences').delete().eq('id', id);
    
    if (error) {
      toast.error('Fehler beim Löschen');
    } else {
      await logAudit({
        action: 'DELETE',
        tableName: 'absences',
        recordId: id,
        oldValues: absenceToDelete ? {
          type: absenceToDelete.type,
          start_date: absenceToDelete.start_date,
          end_date: absenceToDelete.end_date,
          status: absenceToDelete.status,
        } : undefined,
        description: `Abwesenheit gelöscht: ${absenceToDelete?.start_date} - ${absenceToDelete?.end_date}`,
      });
      
      toast.success('Abwesenheit gelöscht');
      loadAbsences();
    }
  };

  const handleUpdate = async () => {
    if (!selectedAbsence) return;
    
    const originalAbsence = absences.find(a => a.id === selectedAbsence.id);
    
    // Halber Tag nur bei vacation und gleichem Start-/Enddatum
    const halfDayValue = selectedAbsence.type === 'vacation' && 
                         selectedAbsence.start_date === selectedAbsence.end_date 
                         ? selectedAbsence.is_half_day 
                         : false;
    
    const { error } = await supabase
      .from('absences')
      .update({
        type: selectedAbsence.type,
        start_date: selectedAbsence.start_date,
        end_date: selectedAbsence.end_date,
        status: selectedAbsence.status,
        notes: selectedAbsence.notes,
        is_half_day: halfDayValue,
      })
      .eq('id', selectedAbsence.id);
      
    if (error) {
      toast.error('Fehler beim Aktualisieren', {
        description: error.message,
      });
    } else {
      await logAudit({
        action: 'UPDATE',
        tableName: 'absences',
        recordId: selectedAbsence.id,
        oldValues: originalAbsence ? {
          type: originalAbsence.type,
          start_date: originalAbsence.start_date,
          end_date: originalAbsence.end_date,
          status: originalAbsence.status,
          notes: originalAbsence.notes,
          is_half_day: originalAbsence.is_half_day,
        } : undefined,
        newValues: {
          type: selectedAbsence.type,
          start_date: selectedAbsence.start_date,
          end_date: selectedAbsence.end_date,
          status: selectedAbsence.status,
          notes: selectedAbsence.notes,
          is_half_day: halfDayValue,
        },
        description: `Abwesenheit aktualisiert: ${selectedAbsence.start_date} - ${selectedAbsence.end_date}${halfDayValue ? ' (halber Tag)' : ''}`,
      });
      
      toast.success('Abwesenheit aktualisiert');
      setEditDialogOpen(false);
      setSelectedAbsence(null);
      loadAbsences();
    }
  };

  const filteredAbsences = absences.filter(absence => {
    const typeMatch = typeFilter === 'all' || absence.type === typeFilter;
    const statusMatch = statusFilter === 'all' || absence.status === statusFilter;
    return typeMatch && statusMatch;
  });

  const getTypeLabel = (type: string, isHalfDayAbsence?: boolean) => {
    const labels: Record<string, string> = {
      sick: 'Krank',
      vacation: 'Urlaub',
      unpaid_leave: 'Unbezahlter Urlaub',
      comp_time: 'Überstundenfrei',
      vocational_school: 'Berufsschule',
      other: 'Sonstiges',
    };
    const label = labels[type] || type;
    return isHalfDayAbsence ? `${label} (½ Tag)` : label;
  };

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'sick': return 'bg-red-100 text-red-800';
      case 'vacation': return 'bg-blue-100 text-blue-800';
      case 'unpaid_leave': return 'bg-gray-100 text-gray-800';
      case 'comp_time': return 'bg-sky-100 text-sky-800';
      case 'vocational_school': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const calculateDays = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  };

  // Prüfen ob halber Tag Checkbox angezeigt werden soll
  const canBeHalfDay = formType === 'vacation' && formStartDate && formEndDate && formStartDate === formEndDate;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Direkte Abwesenheiten</CardTitle>
          <CardDescription>Krankheitstage, Notfall-Urlaube und sonstige Abwesenheiten direkt eintragen</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="userId">Mitarbeiter</Label>
                <Select name="userId" required>
                  <SelectTrigger>
                    <SelectValue placeholder="Mitarbeiter wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Typ</Label>
                <Select 
                  name="type" 
                  required 
                  value={formType}
                  onValueChange={setFormType}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Typ wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sick">
                      <div className="flex items-center gap-2">
                        <Thermometer className="h-4 w-4 text-red-500" />
                        Krank
                      </div>
                    </SelectItem>
                    <SelectItem value="vacation">
                      <div className="flex items-center gap-2">
                        <Plane className="h-4 w-4 text-blue-500" />
                        Urlaub (Notfall)
                      </div>
                    </SelectItem>
                    <SelectItem value="unpaid_leave">
                      <div className="flex items-center gap-2">
                        <Ban className="h-4 w-4 text-gray-500" />
                        Unbezahlter Urlaub
                      </div>
                    </SelectItem>
                    <SelectItem value="comp_time">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-sky-500" />
                        Überstundenfrei
                      </div>
                    </SelectItem>
                    <SelectItem value="vocational_school">
                      <div className="flex items-center gap-2">
                        <GraduationCap className="h-4 w-4 text-purple-500" />
                        Berufsschule
                      </div>
                    </SelectItem>
                    <SelectItem value="other">
                      <div className="flex items-center gap-2">
                        <CircleDot className="h-4 w-4 text-gray-500" />
                        Sonstiges
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="startDate">Von</Label>
                <Input
                  id="startDate"
                  name="startDate"
                  type="date"
                  required
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="endDate">Bis</Label>
                <Input
                  id="endDate"
                  name="endDate"
                  type="date"
                  required
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* Halber Tag Checkbox - nur bei vacation + gleiche Daten */}
            {canBeHalfDay && (
              <div className="flex items-center space-x-2 rounded-md bg-muted/50 p-3">
                <Checkbox
                  id="isHalfDay"
                  checked={isHalfDay}
                  onCheckedChange={(checked) => setIsHalfDay(checked === true)}
                />
                <Label htmlFor="isHalfDay" className="text-sm cursor-pointer">
                  Halber Urlaubstag (0,5 Tage)
                </Label>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notizen (optional)</Label>
              <Textarea
                id="notes"
                name="notes"
                placeholder="Zusätzliche Informationen..."
                rows={2}
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              {loading ? 'Wird gespeichert...' : 'Abwesenheit hinzufügen'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Abwesenheiten</CardTitle>
          <CardDescription>Übersicht aller Urlaube und Krankheitstage</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filter-Optionen */}
          <div className="flex gap-2 mb-4">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Alle Typen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Typen</SelectItem>
                <SelectItem value="sick">Krank</SelectItem>
                <SelectItem value="vacation">Urlaub</SelectItem>
                <SelectItem value="unpaid_leave">Unbezahlter Urlaub</SelectItem>
                <SelectItem value="comp_time">Überstundenfrei</SelectItem>
                <SelectItem value="vocational_school">Berufsschule</SelectItem>
                <SelectItem value="other">Sonstiges</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Alle Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Status</SelectItem>
                <SelectItem value="pending">Ausstehend</SelectItem>
                <SelectItem value="approved">Genehmigt</SelectItem>
                <SelectItem value="rejected">Abgelehnt</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mitarbeiter</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Zeitraum</TableHead>
                <TableHead>Tage</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAbsences.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Keine Abwesenheiten gefunden
                  </TableCell>
                </TableRow>
              ) : (
                filteredAbsences.map((absence) => (
                  <TableRow key={absence.id}>
                    <TableCell>{absence.profiles?.full_name}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${getTypeBadgeClass(absence.type)}`}>
                        {getTypeLabel(absence.type, absence.is_half_day)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {new Date(absence.start_date).toLocaleDateString('de-DE')} - {new Date(absence.end_date).toLocaleDateString('de-DE')}
                    </TableCell>
                    <TableCell>
                      {absence.is_half_day ? '0,5' : calculateDays(absence.start_date, absence.end_date)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedAbsence(absence);
                            setEditDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(absence.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit-Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abwesenheit bearbeiten</DialogTitle>
            <DialogDescription>
              Ändern Sie die Details dieser Abwesenheit
            </DialogDescription>
          </DialogHeader>
          {selectedAbsence && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Typ</Label>
                <Select 
                  value={selectedAbsence.type} 
                  onValueChange={(value) => setSelectedAbsence({...selectedAbsence, type: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sick">Krank</SelectItem>
                    <SelectItem value="vacation">Urlaub</SelectItem>
                    <SelectItem value="unpaid_leave">Unbezahlter Urlaub</SelectItem>
                    <SelectItem value="comp_time">Überstundenfrei</SelectItem>
                    <SelectItem value="vocational_school">Berufsschule</SelectItem>
                    <SelectItem value="other">Sonstiges</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Von</Label>
                <Input 
                  type="date" 
                  value={selectedAbsence.start_date}
                  onChange={(e) => setSelectedAbsence({...selectedAbsence, start_date: e.target.value})}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Bis</Label>
                <Input 
                  type="date" 
                  value={selectedAbsence.end_date}
                  onChange={(e) => setSelectedAbsence({...selectedAbsence, end_date: e.target.value})}
                />
              </div>
              
              {/* Halber Tag Checkbox im Edit-Dialog */}
              {selectedAbsence.type === 'vacation' && 
               selectedAbsence.start_date === selectedAbsence.end_date && (
                <div className="flex items-center space-x-2 rounded-md bg-muted/50 p-3">
                  <Checkbox
                    id="editIsHalfDay"
                    checked={selectedAbsence.is_half_day || false}
                    onCheckedChange={(checked) => setSelectedAbsence({
                      ...selectedAbsence, 
                      is_half_day: checked === true
                    })}
                  />
                  <Label htmlFor="editIsHalfDay" className="text-sm cursor-pointer">
                    Halber Urlaubstag (0,5 Tage)
                  </Label>
                </div>
              )}
              
              <div className="space-y-2">
                <Label>Status</Label>
                <Select 
                  value={selectedAbsence.status}
                  onValueChange={(value) => setSelectedAbsence({...selectedAbsence, status: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Ausstehend</SelectItem>
                    <SelectItem value="approved">Genehmigt</SelectItem>
                    <SelectItem value="rejected">Abgelehnt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Notizen</Label>
                <Textarea 
                  value={selectedAbsence.notes || ''}
                  onChange={(e) => setSelectedAbsence({...selectedAbsence, notes: e.target.value})}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setEditDialogOpen(false);
              setSelectedAbsence(null);
            }}>
              Abbrechen
            </Button>
            <Button onClick={handleUpdate}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AbsenceManager;
