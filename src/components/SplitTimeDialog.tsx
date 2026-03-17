"use client";

import { useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logAudit } from "@/lib/auditLog";

interface SplitTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  userId: string;
  onSaved: () => void;
}

export function SplitTimeDialog({
  open,
  onOpenChange,
  date,
  userId,
  onSaved,
}: SplitTimeDialogProps) {
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("19:00");
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const calculateHours = () => {
    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const totalMinutes = endMinutes - startMinutes - breakMinutes;
    return Math.max(0, totalMinutes / 60);
  };

  const handleSave = async () => {
    if (!startTime || !endTime) {
      toast.error("Bitte Start- und Endzeit angeben");
      return;
    }

    const hours = calculateHours();
    if (hours <= 0) {
      toast.error("Die Endzeit muss nach der Startzeit liegen");
      return;
    }

    setSaving(true);
    try {
      const dateStr = format(date, "yyyy-MM-dd");
      
      const { data, error } = await supabase
        .from("time_entries")
        .insert({
          user_id: userId,
          date: dateStr,
          start_time: startTime,
          end_time: endTime,
          break_minutes: breakMinutes,
          notes: notes || "Splitterzeit",
        })
        .select()
        .single();

      if (error) throw error;

      await logAudit({
        action: "INSERT",
        tableName: "time_entries",
        recordId: data.id,
        newValues: data,
        description: `Splitterzeit erfasst: ${format(date, "dd.MM.yyyy")} ${startTime}-${endTime} (${hours.toFixed(1)}h)`,
      });

      toast.success(`Splitterzeit erfasst: ${hours.toFixed(1)} Stunden`);
      onSaved();
      onOpenChange(false);
      
      // Reset form
      setStartTime("18:00");
      setEndTime("19:00");
      setBreakMinutes(0);
      setNotes("");
    } catch (error) {
      console.error("Error saving split time:", error);
      toast.error("Fehler beim Speichern der Splitterzeit");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-violet-500" />
            Zusätzliche Arbeitszeit erfassen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date display */}
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-sm text-muted-foreground">Datum</p>
            <p className="font-medium">
              {format(date, "EEEE, dd. MMMM yyyy", { locale: de })}
            </p>
          </div>

          {/* Info banner */}
          <div className="rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 p-3 text-sm text-violet-700 dark:text-violet-300">
            Diese Zeit wird zur bestehenden Erfassung hinzugefügt.
          </div>

          {/* Time inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="split-start">Startzeit</Label>
              <Input
                id="split-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="split-end">Endzeit</Label>
              <Input
                id="split-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          {/* Break input */}
          <div className="space-y-2">
            <Label htmlFor="split-break">Pause (Minuten)</Label>
            <Input
              id="split-break"
              type="number"
              min={0}
              max={120}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(parseInt(e.target.value, 10) || 0)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="split-notes">Notiz (optional)</Label>
            <Textarea
              id="split-notes"
              placeholder="z.B. Abendarbeit, Rufbereitschaft..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {/* Calculated hours */}
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-sm text-muted-foreground">Berechnete Stunden</p>
            <p className="text-2xl font-bold text-primary">
              {calculateHours().toFixed(1)}h
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Speichere..." : "Speichern"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
