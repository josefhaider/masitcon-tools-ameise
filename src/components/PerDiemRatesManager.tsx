"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Globe } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { logAudit } from '@/lib/auditLog';
import { formatEUR } from '@/lib/travelExpenses';
import type { Database } from '@/integrations/supabase/types';

type PerDiemRate = Database['public']['Tables']['per_diem_rates']['Row'];

interface RateForm {
  country_code: string;
  country_name: string;
  region: string;
  full_day_rate: string;
  partial_day_rate: string;
  valid_from: string;
  valid_to: string;
}

const emptyForm: RateForm = {
  country_code: '',
  country_name: '',
  region: '',
  full_day_rate: '',
  partial_day_rate: '',
  valid_from: `${new Date().getFullYear()}-01-01`,
  valid_to: '',
};

export default function PerDiemRatesManager() {
  const [rates, setRates] = useState<PerDiemRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RateForm>(emptyForm);

  useEffect(() => {
    loadRates();
  }, []);

  const loadRates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('per_diem_rates')
        .select('*')
        .order('country_name')
        .order('valid_from', { ascending: false });
      if (error) throw error;
      setRates(data || []);
    } catch (error: unknown) {
      toast.error('Fehler beim Laden: ' + (error instanceof Error ? error.message : 'Unbekannt'));
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (rate: PerDiemRate) => {
    setEditingId(rate.id);
    setForm({
      country_code: rate.country_code,
      country_name: rate.country_name,
      region: rate.region ?? '',
      full_day_rate: String(rate.full_day_rate),
      partial_day_rate: String(rate.partial_day_rate),
      valid_from: rate.valid_from,
      valid_to: rate.valid_to ?? '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const fullDay = parseFloat(form.full_day_rate.replace(',', '.'));
    const partialDay = parseFloat(form.partial_day_rate.replace(',', '.'));

    if (!form.country_code.trim() || !form.country_name.trim()) {
      toast.error('Bitte Länderkürzel und Ländername angeben');
      return;
    }
    if (Number.isNaN(fullDay) || Number.isNaN(partialDay) || fullDay < 0 || partialDay < 0) {
      toast.error('Bitte gültige Sätze angeben');
      return;
    }
    if (!form.valid_from) {
      toast.error('Bitte ein "Gültig ab"-Datum angeben');
      return;
    }

    const payload = {
      country_code: form.country_code.trim().toUpperCase(),
      country_name: form.country_name.trim(),
      region: form.region.trim() || null,
      full_day_rate: fullDay,
      partial_day_rate: partialDay,
      valid_from: form.valid_from,
      valid_to: form.valid_to || null,
    };

    try {
      if (editingId) {
        const { error } = await supabase.from('per_diem_rates').update(payload).eq('id', editingId);
        if (error) throw error;
        await logAudit({
          action: 'UPDATE',
          tableName: 'per_diem_rates',
          recordId: editingId,
          newValues: payload,
          description: `Reisekostensatz geändert: ${payload.country_name} (${payload.full_day_rate}/${payload.partial_day_rate} €)`,
        });
        toast.success('Satz aktualisiert');
      } else {
        const { data, error } = await supabase.from('per_diem_rates').insert(payload).select().single();
        if (error) throw error;
        await logAudit({
          action: 'INSERT',
          tableName: 'per_diem_rates',
          recordId: data?.id,
          newValues: payload,
          description: `Reisekostensatz angelegt: ${payload.country_name} (${payload.full_day_rate}/${payload.partial_day_rate} €)`,
        });
        toast.success('Satz angelegt');
      }
      setDialogOpen(false);
      loadRates();
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === '23505') {
        toast.error('Für dieses Land/Region und Gültigkeitsdatum existiert bereits ein Satz');
      } else {
        toast.error('Fehler: ' + (error instanceof Error ? error.message : 'Unbekannt'));
      }
    }
  };

  const handleDelete = async (rate: PerDiemRate) => {
    if (!confirm(`Satz für ${rate.country_name} wirklich löschen?`)) return;
    try {
      const { error } = await supabase.from('per_diem_rates').delete().eq('id', rate.id);
      if (error) throw error;
      await logAudit({
        action: 'DELETE',
        tableName: 'per_diem_rates',
        recordId: rate.id,
        oldValues: { country_name: rate.country_name, full_day_rate: rate.full_day_rate },
        description: `Reisekostensatz gelöscht: ${rate.country_name}`,
      });
      toast.success('Satz gelöscht');
      loadRates();
    } catch (error: unknown) {
      toast.error('Fehler: ' + (error instanceof Error ? error.message : 'Unbekannt'));
    }
  };

  const fmtDate = (d: string | null) => (d ? format(new Date(`${d}T00:00:00`), 'dd.MM.yyyy', { locale: de }) : '–');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Reisekostensätze
              </CardTitle>
              <CardDescription>
                Tagessätze für den Verpflegungsmehraufwand je Land. Auslandssätze bei Bedarf gegen das aktuelle
                BMF-Schreiben aktualisieren.
              </CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Satz hinzufügen
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingId ? 'Satz bearbeiten' : 'Neuer Reisekostensatz'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Länderkürzel *</Label>
                      <Input
                        value={form.country_code}
                        onChange={(e) => setForm((f) => ({ ...f, country_code: e.target.value.toUpperCase() }))}
                        placeholder="z.B. AT"
                        maxLength={5}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Ländername *</Label>
                      <Input
                        value={form.country_name}
                        onChange={(e) => setForm((f) => ({ ...f, country_name: e.target.value }))}
                        placeholder="z.B. Österreich"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Region / Stadt (optional)</Label>
                    <Input
                      value={form.region}
                      onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                      placeholder="z.B. Paris (leer = Standardsatz des Landes)"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Voller Tagessatz (€) *</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.full_day_rate}
                        onChange={(e) => setForm((f) => ({ ...f, full_day_rate: e.target.value }))}
                        placeholder="28.00"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Teil-Tagessatz (€) *</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.partial_day_rate}
                        onChange={(e) => setForm((f) => ({ ...f, partial_day_rate: e.target.value }))}
                        placeholder="14.00"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Gültig ab *</Label>
                      <Input
                        type="date"
                        value={form.valid_from}
                        onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Gültig bis (optional)</Label>
                      <Input
                        type="date"
                        value={form.valid_to}
                        onChange={(e) => setForm((f) => ({ ...f, valid_to: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Abbrechen
                  </Button>
                  <Button onClick={handleSave}>Speichern</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Lade Sätze...</div>
          ) : rates.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">Noch keine Sätze hinterlegt.</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Land</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead className="text-right">Voller Tag</TableHead>
                    <TableHead className="text-right">Teil-Tag</TableHead>
                    <TableHead>Gültig ab</TableHead>
                    <TableHead>Gültig bis</TableHead>
                    <TableHead className="w-[110px] text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.map((rate) => (
                    <TableRow key={rate.id}>
                      <TableCell className="font-medium">
                        {rate.country_name}
                        <span className="ml-1 text-xs text-muted-foreground">({rate.country_code})</span>
                      </TableCell>
                      <TableCell>{rate.region ?? '–'}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEUR(rate.full_day_rate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatEUR(rate.partial_day_rate)}</TableCell>
                      <TableCell>{fmtDate(rate.valid_from)}</TableCell>
                      <TableCell>{fmtDate(rate.valid_to)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(rate)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(rate)}
                            className="text-destructive hover:text-destructive"
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
    </div>
  );
}
