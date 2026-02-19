import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Coffee, Plus, Trash2 } from 'lucide-react';

interface BreakRule {
  id: string;
  name: string;
  min_work_hours: number;
  break_minutes: number;
  is_mandatory: boolean;
  priority: number;
}

const BreakRulesManager = () => {
  const [rules, setRules] = useState<BreakRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [newRule, setNewRule] = useState({
    name: '',
    min_work_hours: 0,
    break_minutes: 0,
    is_mandatory: false,
    priority: 0,
  });

  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    const { data } = await supabase
      .from('break_rules')
      .select('*')
      .order('priority');
    
    setRules(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newRule.name || newRule.min_work_hours <= 0 || newRule.break_minutes <= 0) {
      toast.error('Bitte alle Felder ausfüllen');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('break_rules')
        .insert([newRule]);

      if (error) throw error;

      toast.success('Pausenregel erstellt');
      setNewRule({
        name: '',
        min_work_hours: 0,
        break_minutes: 0,
        is_mandatory: false,
        priority: 0,
      });
      loadRules();
    } catch (error) {
      console.error('Error creating break rule:', error);
      toast.error('Fehler beim Erstellen');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Möchten Sie diese Pausenregel wirklich löschen?')) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('break_rules')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('Pausenregel gelöscht');
      loadRules();
    } catch (error) {
      console.error('Error deleting break rule:', error);
      toast.error('Fehler beim Löschen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-6 flex items-center gap-3">
          <Coffee className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold">Pausenregeln verwalten</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Regelname</Label>
              <Input
                id="name"
                value={newRule.name}
                onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                placeholder="z.B. Gesetzliche Pause ab 6h"
              />
            </div>

            <div>
              <Label htmlFor="min_hours">Mindest-Arbeitsstunden</Label>
              <Input
                id="min_hours"
                type="number"
                step="0.5"
                min="0"
                value={newRule.min_work_hours || ''}
                onChange={(e) => setNewRule({ ...newRule, min_work_hours: parseFloat(e.target.value) || 0 })}
                placeholder="z.B. 6"
              />
            </div>

            <div>
              <Label htmlFor="break_minutes">Pause (Minuten)</Label>
              <Input
                id="break_minutes"
                type="number"
                min="0"
                value={newRule.break_minutes || ''}
                onChange={(e) => setNewRule({ ...newRule, break_minutes: parseInt(e.target.value, 10) || 0 })}
                placeholder="z.B. 30"
              />
            </div>

            <div>
              <Label htmlFor="priority">Priorität</Label>
              <Input
                id="priority"
                type="number"
                min="0"
                value={newRule.priority || ''}
                onChange={(e) => setNewRule({ ...newRule, priority: parseInt(e.target.value, 10) || 0 })}
                placeholder="z.B. 1 (niedrigste zuerst)"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="mandatory"
              checked={newRule.is_mandatory}
              onCheckedChange={(checked) => setNewRule({ ...newRule, is_mandatory: checked })}
            />
            <Label htmlFor="mandatory" className="cursor-pointer">
              Pflichtpause (gesetzlich)
            </Label>
          </div>

          <Button type="submit" disabled={loading}>
            <Plus className="mr-2 h-4 w-4" />
            Regel hinzufügen
          </Button>
        </form>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Bestehende Pausenregeln</h3>
        
        {rules.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Keine Pausenregeln vorhanden
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Ab Stunden</TableHead>
                  <TableHead>Pause</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Priorität</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map(rule => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell>≥ {rule.min_work_hours}h</TableCell>
                    <TableCell>{rule.break_minutes} Min</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        rule.is_mandatory 
                          ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' 
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                      }`}>
                        {rule.is_mandatory ? 'Pflicht' : 'Optional'}
                      </span>
                    </TableCell>
                    <TableCell>{rule.priority}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDelete(rule.id)}
                        disabled={loading}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="mt-6 p-4 bg-muted rounded-lg">
          <h4 className="font-semibold mb-2">Hinweise zu Pausenregeln:</h4>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li><strong>Fallback-Regeln:</strong> Diese gelten nur, wenn keine individuelle Pause im Arbeitszeitplan hinterlegt ist</li>
            <li>Priorität: Niedrigere Zahlen werden zuerst angewendet</li>
            <li>Die erste passende Regel wird verwendet (basierend auf Arbeitszeit)</li>
            <li>Individuelle Pausen im Mitarbeiter-Arbeitszeitplan haben Vorrang</li>
          </ul>
        </div>
      </Card>
    </div>
  );
};

export default BreakRulesManager;