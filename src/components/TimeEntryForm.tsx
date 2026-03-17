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
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';

interface TimeEntryFormProps {
  userId: string;
}

const TimeEntryForm = ({ userId }: TimeEntryFormProps) => {
  const [templates, setTemplates] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTemplates();
    loadEntries();
  }, []);

  const loadTemplates = async () => {
    const { data } = await supabase
      .from('time_templates')
      .select('*')
      .eq('is_active', true)
      .order('name');
    
    setTemplates(data || []);
  };

  const loadEntries = async () => {
    const { data } = await supabase
      .from('time_entries')
      .select('*, time_templates(name)')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(10);
    
    setEntries(data || []);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const date = formData.get('date') as string;
    const startTime = formData.get('startTime') as string;
    const endTime = formData.get('endTime') as string;
    const breakMinutes = parseInt(formData.get('breakMinutes') as string, 10) || 0;
    const notes = formData.get('notes') as string;

    const { error } = await supabase.from('time_entries').insert({
      user_id: userId,
      date,
      start_time: startTime,
      end_time: endTime,
      break_minutes: breakMinutes,
      template_id: selectedTemplate || null,
      notes: notes || null,
    });

    if (error) {
      toast.error('Fehler beim Speichern', {
        description: error.message,
      });
    } else {
      toast.success('Zeiteintrag gespeichert');
      e.currentTarget.reset();
      setSelectedTemplate('');
      loadEntries();
    }

    setLoading(false);
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    const template = templates.find(t => t.id === templateId);
    if (template) {
      const form = document.getElementById('time-entry-form') as HTMLFormElement;
      (form.elements.namedItem('startTime') as HTMLInputElement).value = template.start_time;
      (form.elements.namedItem('endTime') as HTMLInputElement).value = template.end_time;
      (form.elements.namedItem('breakMinutes') as HTMLInputElement).value = template.break_minutes.toString();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('time_entries').delete().eq('id', id);
    
    if (error) {
      toast.error('Fehler beim Löschen');
    } else {
      toast.success('Eintrag gelöscht');
      loadEntries();
    }
  };

  const calculateHours = (start: string, end: string, breakMin: number) => {
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM) - breakMin;
    return (totalMinutes / 60).toFixed(2);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Neuer Zeiteintrag</CardTitle>
          <CardDescription>Erfassen Sie Ihre Arbeitszeit</CardDescription>
        </CardHeader>
        <CardContent>
          <form id="time-entry-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="template">Vorlage (optional)</Label>
                <Select value={selectedTemplate} onValueChange={handleTemplateChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vorlage wählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="date">Datum</Label>
                <Input
                  id="date"
                  name="date"
                  type="date"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="startTime">Startzeit</Label>
                <Input
                  id="startTime"
                  name="startTime"
                  type="time"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="endTime">Endzeit</Label>
                <Input
                  id="endTime"
                  name="endTime"
                  type="time"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="breakMinutes">Pause (Minuten)</Label>
                <Input
                  id="breakMinutes"
                  name="breakMinutes"
                  type="number"
                  min="0"
                  defaultValue="0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notizen (optional)</Label>
              <Textarea
                id="notes"
                name="notes"
                placeholder="Beschreibung der Tätigkeit..."
                rows={3}
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              {loading ? 'Wird gespeichert...' : 'Zeiteintrag hinzufügen'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Letzte Einträge</CardTitle>
          <CardDescription>Die 10 neuesten Zeiteinträge</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Zeit</TableHead>
                <TableHead>Stunden</TableHead>
                <TableHead>Vorlage</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Noch keine Einträge vorhanden
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{new Date(entry.date).toLocaleDateString('de-DE')}</TableCell>
                    <TableCell>
                      {entry.start_time} - {entry.end_time}
                    </TableCell>
                    <TableCell>
                      {calculateHours(entry.start_time, entry.end_time, entry.break_minutes)}h
                    </TableCell>
                    <TableCell>{entry.time_templates?.name || '-'}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(entry.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default TimeEntryForm;
