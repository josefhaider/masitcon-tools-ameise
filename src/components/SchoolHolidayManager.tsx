import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Plus, Trash2, Sparkles, GraduationCap } from "lucide-react";
import { generateBavarianSchoolHolidays } from "@/lib/holidays";

interface SchoolHoliday {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  federal_state: string;
  school_year: string | null;
}

export default function SchoolHolidayManager() {
  const [schoolHolidays, setSchoolHolidays] = useState<SchoolHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newHoliday, setNewHoliday] = useState({
    name: "",
    start_date: "",
    end_date: "",
    school_year: "",
  });
  const { toast } = useToast();

  useEffect(() => {
    loadSchoolHolidays();
  }, [selectedYear]);

  const loadSchoolHolidays = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("school_holidays")
        .select("*")
        .eq("federal_state", "BY")
        .or(`start_date.gte.${selectedYear}-01-01,end_date.lte.${selectedYear + 1}-12-31`)
        .order("start_date");

      if (error) throw error;
      
      // Filter to only show holidays that overlap with the selected school year
      const filtered = (data || []).filter(h => {
        const start = new Date(h.start_date);
        const end = new Date(h.end_date);
        const yearStart = new Date(selectedYear, 0, 1);
        const yearEnd = new Date(selectedYear, 11, 31);
        return start <= yearEnd && end >= yearStart;
      });
      
      setSchoolHolidays(filtered);
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: "Schulferien konnten nicht geladen werden: " + error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const addSchoolHoliday = async () => {
    if (!newHoliday.name || !newHoliday.start_date || !newHoliday.end_date) {
      toast({
        title: "Fehler",
        description: "Bitte alle Felder ausfüllen",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase.from("school_holidays").insert({
        name: newHoliday.name,
        start_date: newHoliday.start_date,
        end_date: newHoliday.end_date,
        federal_state: "BY",
        school_year: newHoliday.school_year || null,
      });

      if (error) throw error;

      toast({
        title: "Schulferien hinzugefügt",
        description: `${newHoliday.name} wurde erfolgreich hinzugefügt.`,
      });

      setNewHoliday({ name: "", start_date: "", end_date: "", school_year: "" });
      setDialogOpen(false);
      loadSchoolHolidays();
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: "Schulferien konnten nicht hinzugefügt werden: " + error.message,
        variant: "destructive",
      });
    }
  };

  const deleteSchoolHoliday = async (id: string, name: string) => {
    try {
      const { error } = await supabase.from("school_holidays").delete().eq("id", id);

      if (error) throw error;

      toast({
        title: "Schulferien gelöscht",
        description: `${name} wurde erfolgreich gelöscht.`,
      });

      loadSchoolHolidays();
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: "Schulferien konnten nicht gelöscht werden: " + error.message,
        variant: "destructive",
      });
    }
  };

  const generateHolidays = async () => {
    try {
      const holidaysToGenerate = generateBavarianSchoolHolidays(selectedYear);

      if (holidaysToGenerate.length === 0) {
        toast({
          title: "Keine Daten",
          description: `Keine Ferien-Daten für ${selectedYear} verfügbar.`,
          variant: "destructive",
        });
        return;
      }

      // Check for existing holidays in this year
      const { data: existing } = await supabase
        .from("school_holidays")
        .select("start_date, end_date")
        .eq("federal_state", "BY");

      const existingSet = new Set(
        (existing || []).map((h) => `${h.start_date}_${h.end_date}`)
      );

      const newHolidays = holidaysToGenerate.filter(
        (h) => !existingSet.has(`${h.start_date}_${h.end_date}`)
      );

      if (newHolidays.length === 0) {
        toast({
          title: "Bereits vorhanden",
          description: `Alle Ferien für ${selectedYear}/${selectedYear + 1} sind bereits eingetragen.`,
        });
        return;
      }

      const { error } = await supabase.from("school_holidays").insert(
        newHolidays.map((h) => ({
          name: h.name,
          start_date: h.start_date,
          end_date: h.end_date,
          federal_state: "BY",
          school_year: h.school_year,
        }))
      );

      if (error) throw error;

      toast({
        title: "Schulferien generiert",
        description: `${newHolidays.length} Ferienperioden für ${selectedYear}/${selectedYear + 1} wurden hinzugefügt.`,
      });

      loadSchoolHolidays();
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: "Schulferien konnten nicht generiert werden: " + error.message,
        variant: "destructive",
      });
    }
  };

  const formatDateDisplay = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const calculateDays = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Schulferien Bayern
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedYear(selectedYear - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-semibold text-lg min-w-[60px] text-center">
                {selectedYear}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedYear(selectedYear + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={generateHolidays} variant="secondary" size="sm">
              <Sparkles className="h-4 w-4 mr-2" />
              Bayern Ferien generieren
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Hinzufügen
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Neue Schulferien hinzufügen</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      placeholder="z.B. Sommerferien"
                      value={newHoliday.name}
                      onChange={(e) =>
                        setNewHoliday({ ...newHoliday, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Von</Label>
                      <Input
                        type="date"
                        value={newHoliday.start_date}
                        onChange={(e) =>
                          setNewHoliday({ ...newHoliday, start_date: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Bis</Label>
                      <Input
                        type="date"
                        value={newHoliday.end_date}
                        onChange={(e) =>
                          setNewHoliday({ ...newHoliday, end_date: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Schuljahr (optional)</Label>
                    <Input
                      placeholder="z.B. 2024/2025"
                      value={newHoliday.school_year}
                      onChange={(e) =>
                        setNewHoliday({ ...newHoliday, school_year: e.target.value })
                      }
                    />
                  </div>
                  <Button onClick={addSchoolHoliday} className="w-full">
                    Schulferien hinzufügen
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            Lade Schulferien...
          </div>
        ) : schoolHolidays.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
            <GraduationCap className="h-12 w-12 opacity-30" />
            <p>Keine Schulferien für {selectedYear} eingetragen.</p>
            <Button onClick={generateHolidays} variant="outline" size="sm">
              <Sparkles className="h-4 w-4 mr-2" />
              Bayern Ferien generieren
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Von</TableHead>
                  <TableHead>Bis</TableHead>
                  <TableHead className="text-center">Tage</TableHead>
                  <TableHead>Schuljahr</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schoolHolidays.map((holiday) => (
                  <TableRow key={holiday.id}>
                    <TableCell className="font-medium">{holiday.name}</TableCell>
                    <TableCell>{formatDateDisplay(holiday.start_date)}</TableCell>
                    <TableCell>{formatDateDisplay(holiday.end_date)}</TableCell>
                    <TableCell className="text-center">
                      {calculateDays(holiday.start_date, holiday.end_date)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {holiday.school_year || "-"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSchoolHoliday(holiday.id, holiday.name)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
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
      </CardContent>
    </Card>
  );
}
