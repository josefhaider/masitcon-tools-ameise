"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Eye, Download, FileText } from 'lucide-react';

import type { Json } from '@/integrations/supabase/types';

interface AuditLog {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_values: Json | null;
  new_values: Json | null;
  description: string | null;
}

const ITEMS_PER_PAGE = 25;

const tableLabels: Record<string, string> = {
  time_entries: 'Zeiteinträge',
  absences: 'Abwesenheiten',
  employee_work_schedules: 'Arbeitszeiten',
  profiles: 'Profile',
  teams: 'Teams',
  team_members: 'Team-Mitglieder',
  break_rules: 'Pausenregeln',
};

const actionLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  INSERT: { label: 'Erstellt', variant: 'default' },
  UPDATE: { label: 'Geändert', variant: 'secondary' },
  DELETE: { label: 'Gelöscht', variant: 'destructive' },
};

const AuditLogViewer = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  // Filters
  const [filterTable, setFilterTable] = useState<string>('all');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterUser, setFilterUser] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');

  useEffect(() => {
    loadLogs();
  }, [page, filterTable, filterAction, filterUser, filterDateFrom, filterDateTo]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE - 1);

      if (filterTable !== 'all') {
        query = query.eq('table_name', filterTable);
      }
      if (filterAction !== 'all') {
        query = query.eq('action', filterAction);
      }
      if (filterUser) {
        query = query.ilike('user_email', `%${filterUser}%`);
      }
      if (filterDateFrom) {
        query = query.gte('created_at', filterDateFrom);
      }
      if (filterDateTo) {
        query = query.lte('created_at', `${filterDateTo}T23:59:59`);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      setLogs(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error('Error loading audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    const headers = ['Zeitpunkt', 'Benutzer', 'Aktion', 'Tabelle', 'Beschreibung', 'Datensatz-ID'];
    const rows = logs.map(log => [
      format(new Date(log.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: de }),
      log.user_email || '-',
      actionLabels[log.action]?.label || log.action,
      tableLabels[log.table_name] || log.table_name,
      log.description || '-',
      log.record_id || '-',
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const renderValue = (value: any): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Audit-Protokoll
              </CardTitle>
              <CardDescription>
                Unveränderliches Protokoll aller Änderungen im System
              </CardDescription>
            </div>
            <Button onClick={exportCSV} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              CSV Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filter */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <div>
              <Label htmlFor="filter-table">Tabelle</Label>
              <Select value={filterTable} onValueChange={(v) => { setFilterTable(v); setPage(0); }}>
                <SelectTrigger id="filter-table">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Tabellen</SelectItem>
                  {Object.entries(tableLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="filter-action">Aktion</Label>
              <Select value={filterAction} onValueChange={(v) => { setFilterAction(v); setPage(0); }}>
                <SelectTrigger id="filter-action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Aktionen</SelectItem>
                  <SelectItem value="INSERT">Erstellt</SelectItem>
                  <SelectItem value="UPDATE">Geändert</SelectItem>
                  <SelectItem value="DELETE">Gelöscht</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="filter-user">Benutzer</Label>
              <Input
                id="filter-user"
                placeholder="E-Mail suchen..."
                value={filterUser}
                onChange={(e) => { setFilterUser(e.target.value); setPage(0); }}
              />
            </div>
            <div>
              <Label htmlFor="filter-from">Von</Label>
              <Input
                id="filter-from"
                type="date"
                value={filterDateFrom}
                onChange={(e) => { setFilterDateFrom(e.target.value); setPage(0); }}
              />
            </div>
            <div>
              <Label htmlFor="filter-to">Bis</Label>
              <Input
                id="filter-to"
                type="date"
                value={filterDateTo}
                onChange={(e) => { setFilterDateTo(e.target.value); setPage(0); }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-between mb-4">
            <Badge variant="secondary">
              {totalCount} {totalCount === 1 ? 'Eintrag' : 'Einträge'} gefunden
            </Badge>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Keine Einträge gefunden
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zeitpunkt</TableHead>
                      <TableHead>Benutzer</TableHead>
                      <TableHead>Aktion</TableHead>
                      <TableHead>Tabelle</TableHead>
                      <TableHead>Beschreibung</TableHead>
                      <TableHead className="text-right">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(log.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: de })}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {log.user_email || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={actionLabels[log.action]?.variant || 'secondary'}>
                            {actionLabels[log.action]?.label || log.action}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {tableLabels[log.table_name] || log.table_name}
                        </TableCell>
                        <TableCell className="max-w-[300px] truncate">
                          {log.description || '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedLog(log)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  Seite {page + 1} von {totalPages || 1}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Zurück
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page >= totalPages - 1}
                  >
                    Weiter
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Audit-Log Details</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Zeitpunkt</Label>
                    <p className="font-medium">
                      {format(new Date(selectedLog.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: de })}
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Benutzer</Label>
                    <p className="font-medium">{selectedLog.user_email || '-'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Aktion</Label>
                    <p>
                      <Badge variant={actionLabels[selectedLog.action]?.variant || 'secondary'}>
                        {actionLabels[selectedLog.action]?.label || selectedLog.action}
                      </Badge>
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Tabelle</Label>
                    <p className="font-medium">
                      {tableLabels[selectedLog.table_name] || selectedLog.table_name}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-muted-foreground">Datensatz-ID</Label>
                    <p className="font-mono text-sm">{selectedLog.record_id || '-'}</p>
                  </div>
                  {selectedLog.description && (
                    <div className="col-span-2">
                      <Label className="text-muted-foreground">Beschreibung</Label>
                      <p>{selectedLog.description}</p>
                    </div>
                  )}
                </div>

                {selectedLog.old_values && (
                  <div>
                    <Label className="text-muted-foreground">Alte Werte</Label>
                    <pre className="mt-1 p-3 bg-muted rounded-md text-sm overflow-auto">
                      {JSON.stringify(selectedLog.old_values, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedLog.new_values && (
                  <div>
                    <Label className="text-muted-foreground">Neue Werte</Label>
                    <pre className="mt-1 p-3 bg-muted rounded-md text-sm overflow-auto">
                      {JSON.stringify(selectedLog.new_values, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedLog.old_values && selectedLog.new_values && 
                 typeof selectedLog.old_values === 'object' && !Array.isArray(selectedLog.old_values) &&
                 typeof selectedLog.new_values === 'object' && !Array.isArray(selectedLog.new_values) && (
                  <div>
                    <Label className="text-muted-foreground">Änderungen</Label>
                    <div className="mt-1 p-3 bg-muted rounded-md text-sm space-y-1">
                      {Object.keys({ ...(selectedLog.old_values as Record<string, unknown>), ...(selectedLog.new_values as Record<string, unknown>) }).map(key => {
                        const oldVal = renderValue((selectedLog.old_values as Record<string, unknown>)?.[key]);
                        const newVal = renderValue((selectedLog.new_values as Record<string, unknown>)?.[key]);
                        if (oldVal !== newVal) {
                          return (
                            <div key={key} className="flex gap-2">
                              <span className="font-medium min-w-[120px]">{key}:</span>
                              <span className="text-destructive line-through">{oldVal}</span>
                              <span>→</span>
                              <span className="text-green-600">{newVal}</span>
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AuditLogViewer;
