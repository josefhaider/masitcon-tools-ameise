import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Download,
  Upload,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Users,
} from "lucide-react";
import { format } from "date-fns";

interface Profile {
  id: string;
  email: string;
  full_name: string;
  employee_number: string | null;
  is_archived: boolean | null;
}

interface ImportEmployee {
  email: string;
  profile?: { full_name?: string };
  time_entries?: any[];
  absences?: any[];
  work_schedules?: any[];
  balance_corrections?: any[];
  team_memberships?: any[];
  roles?: string[];
}

interface ImportData {
  version: string;
  exported_at: string;
  exported_by: string;
  source_url: string;
  employees: ImportEmployee[];
}

interface ImportResult {
  email: string;
  status: "imported" | "skipped" | "error" | "warning";
  reason?: string;
  counts?: Record<string, number>;
}

const DataTransferManager = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [exportPassword, setExportPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Import state
  const [importData, setImportData] = useState<ImportData | null>(null);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(
    null,
  );
  const [importFileName, setImportFileName] = useState<string>("");

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, employee_number, is_archived")
      .order("full_name");

    if (error) {
      toast.error("Fehler beim Laden der Mitarbeiter");
      return;
    }
    setProfiles(data || []);
    setLoading(false);
  };

  const activeProfiles = profiles.filter((p) => !p.is_archived);

  // ─── Export Logic ───
  const toggleEmployee = (email: string) => {
    const next = new Set(selectedEmails);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    setSelectedEmails(next);
  };

  const selectAll = () => {
    setSelectedEmails(new Set(activeProfiles.map((p) => p.email)));
  };

  const selectNone = () => {
    setSelectedEmails(new Set());
  };

  const handleExport = async () => {
    if (selectedEmails.size === 0) {
      toast.error("Bitte mindestens einen Mitarbeiter auswählen");
      return;
    }
    if (!exportPassword) {
      toast.error("Bitte Sicherheitskennwort eingeben");
      return;
    }

    setExporting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userEmail = session?.user?.email;
      if (!userEmail) {
        toast.error("Nicht angemeldet");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/employee-data-transfer`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "export",
            employee_emails: Array.from(selectedEmails),
            password: exportPassword,
            user_email: userEmail,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Export fehlgeschlagen");
      }

      // Download as JSON file
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mitarbeiter-export_${format(new Date(), "yyyy-MM-dd")}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`${result.data.employees.length} Mitarbeiter exportiert`);

      if (result.warnings?.length > 0) {
        result.warnings.forEach((w: string) => toast.warning(w));
      }

      setExportPassword("");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Export fehlgeschlagen");
    } finally {
      setExporting(false);
    }
  };

  // ─── Import Logic ───
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    setImportResults(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!parsed.employees || !Array.isArray(parsed.employees)) {
          toast.error("Ungültiges Dateiformat: employees-Array fehlt");
          setImportData(null);
          return;
        }
        setImportData(parsed);
      } catch {
        toast.error("Ungültige JSON-Datei");
        setImportData(null);
      }
    };
    reader.readAsText(file);
  };

  const getEmployeeMappingStatus = (email: string): "found" | "not_found" => {
    return profiles.some((p) => p.email === email) ? "found" : "not_found";
  };

  const handleImport = async () => {
    if (!importData) return;
    if (!importPassword) {
      toast.error("Bitte Sicherheitskennwort eingeben");
      return;
    }

    setImporting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userEmail = session?.user?.email;
      if (!userEmail) {
        toast.error("Nicht angemeldet");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/employee-data-transfer`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "import",
            data: importData,
            password: importPassword,
            user_email: userEmail,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Import fehlgeschlagen");
      }

      setImportResults(result.results);

      const imported = result.results.filter(
        (r: ImportResult) => r.status === "imported",
      ).length;
      const skipped = result.results.filter(
        (r: ImportResult) => r.status === "skipped",
      ).length;
      const errors = result.results.filter(
        (r: ImportResult) => r.status === "error",
      ).length;

      if (errors > 0) {
        toast.error(
          `Import abgeschlossen: ${imported} importiert, ${skipped} übersprungen, ${errors} Fehler`,
        );
      } else {
        toast.success(
          `Import erfolgreich: ${imported} importiert, ${skipped} übersprungen`,
        );
      }

      setImportPassword("");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Import fehlgeschlagen");
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Datentransfer</h2>
        <p className="text-muted-foreground">
          Mitarbeiterdaten zwischen Umgebungen exportieren und importieren
        </p>
      </div>

      <Tabs defaultValue="export" className="space-y-4">
        <TabsList>
          <TabsTrigger value="export">
            <Download className="h-4 w-4 mr-2" />
            Export
          </TabsTrigger>
          <TabsTrigger value="import">
            <Upload className="h-4 w-4 mr-2" />
            Import
          </TabsTrigger>
        </TabsList>

        {/* ─── Export Tab ─── */}
        <TabsContent value="export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Mitarbeiter auswählen
              </CardTitle>
              <CardDescription>
                Wählen Sie die Mitarbeiter aus, deren Daten exportiert werden
                sollen.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Alle auswählen
                </Button>
                <Button variant="outline" size="sm" onClick={selectNone}>
                  Keine auswählen
                </Button>
                <Badge variant="secondary" className="ml-auto self-center">
                  {selectedEmails.size} / {activeProfiles.length} ausgewählt
                </Badge>
              </div>

              <div className="border rounded-md max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>E-Mail</TableHead>
                      <TableHead>Mitarbeiter-Nr.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeProfiles.map((profile) => (
                      <TableRow
                        key={profile.id}
                        className="cursor-pointer"
                        onClick={() => toggleEmployee(profile.email)}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedEmails.has(profile.email)}
                            onCheckedChange={() =>
                              toggleEmployee(profile.email)
                            }
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {profile.full_name}
                        </TableCell>
                        <TableCell>{profile.email}</TableCell>
                        <TableCell>{profile.employee_number || "–"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-2 max-w-sm">
                <Label htmlFor="export-password">Sicherheitskennwort</Label>
                <Input
                  id="export-password"
                  type="password"
                  placeholder="Kennwort eingeben..."
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                />
              </div>

              <Button
                onClick={handleExport}
                disabled={
                  exporting || selectedEmails.size === 0 || !exportPassword
                }
                className="w-full sm:w-auto"
              >
                {exporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Exportiere...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    {selectedEmails.size} Mitarbeiter exportieren
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Import Tab ─── */}
        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                JSON-Datei hochladen
              </CardTitle>
              <CardDescription>
                Laden Sie eine zuvor exportierte JSON-Datei hoch, um die Daten
                zu importieren.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="import-file">Export-Datei (.json)</Label>
                <Input
                  id="import-file"
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                />
                {importFileName && (
                  <p className="text-sm text-muted-foreground">
                    Datei: {importFileName}
                  </p>
                )}
              </div>

              {importData && (
                <>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Version: {importData.version}</p>
                    <p>
                      Exportiert am:{" "}
                      {new Date(importData.exported_at).toLocaleString("de-DE")}
                    </p>
                    <p>Exportiert von: {importData.exported_by}</p>
                    <p>Quelle: {importData.source_url}</p>
                  </div>

                  <div className="border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>E-Mail</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead className="text-right">
                            Zeiteinträge
                          </TableHead>
                          <TableHead className="text-right">
                            Abwesenheiten
                          </TableHead>
                          <TableHead className="text-right">
                            Arbeitspläne
                          </TableHead>
                          <TableHead className="text-right">
                            Korrekturen
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importData.employees.map((emp, idx) => {
                          const status = getEmployeeMappingStatus(emp.email);
                          return (
                            <TableRow key={idx}>
                              <TableCell>
                                {status === "found" ? (
                                  <Badge variant="default">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Gefunden
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive">
                                    <XCircle className="h-3 w-3 mr-1" />
                                    Nicht gefunden
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>{emp.email}</TableCell>
                              <TableCell className="font-medium">
                                {emp.profile?.full_name || "–"}
                              </TableCell>
                              <TableCell className="text-right">
                                {emp.time_entries?.length ?? 0}
                              </TableCell>
                              <TableCell className="text-right">
                                {emp.absences?.length ?? 0}
                              </TableCell>
                              <TableCell className="text-right">
                                {emp.work_schedules?.length ?? 0}
                              </TableCell>
                              <TableCell className="text-right">
                                {emp.balance_corrections?.length ?? 0}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-destructive font-medium">
                      <AlertTriangle className="h-5 w-5" />
                      Achtung: Bestehende Daten werden überschrieben!
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Beim Import werden alle bestehenden Zeiteinträge,
                      Abwesenheiten, Arbeitspläne, Korrekturbuchungen,
                      Team-Zuordnungen und Rollen der gefundenen Mitarbeiter{" "}
                      <strong>gelöscht</strong> und durch die importierten Daten
                      ersetzt.
                    </p>
                  </div>

                  <div className="space-y-2 max-w-sm">
                    <Label htmlFor="import-password">Sicherheitskennwort</Label>
                    <Input
                      id="import-password"
                      type="password"
                      placeholder="Kennwort eingeben..."
                      value={importPassword}
                      onChange={(e) => setImportPassword(e.target.value)}
                    />
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={importing || !importPassword}
                        variant="destructive"
                        className="w-full sm:w-auto"
                      >
                        {importing ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Importiere...
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 mr-2" />
                            {importData.employees.length} Mitarbeiter
                            importieren
                          </>
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Import bestätigen</AlertDialogTitle>
                        <AlertDialogDescription>
                          Sind Sie sicher? Bestehende Daten von{" "}
                          {
                            importData.employees.filter(
                              (e) =>
                                getEmployeeMappingStatus(e.email) === "found",
                            ).length
                          }{" "}
                          Mitarbeiter(n) werden gelöscht und durch die
                          importierten Daten ersetzt. Dieser Vorgang kann nicht
                          rückgängig gemacht werden.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleImport}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Ja, importieren
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}

              {/* Import Results */}
              {importResults && (
                <Card>
                  <CardHeader>
                    <CardTitle>Import-Ergebnis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Status</TableHead>
                            <TableHead>E-Mail</TableHead>
                            <TableHead>Details</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importResults.map((result, idx) => (
                            <TableRow key={idx}>
                              <TableCell>
                                {result.status === "imported" && (
                                  <Badge variant="default">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Importiert
                                  </Badge>
                                )}
                                {result.status === "skipped" && (
                                  <Badge variant="secondary">
                                    Übersprungen
                                  </Badge>
                                )}
                                {result.status === "error" && (
                                  <Badge variant="destructive">
                                    <XCircle className="h-3 w-3 mr-1" />
                                    Fehler
                                  </Badge>
                                )}
                                {result.status === "warning" && (
                                  <Badge
                                    variant="outline"
                                    className="border-accent text-accent-foreground"
                                  >
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    Warnung
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>{result.email}</TableCell>
                              <TableCell className="text-sm">
                                {result.reason ||
                                  (result.counts &&
                                    `${result.counts.time_entries} Zeiteinträge, ${result.counts.absences} Abwesenheiten, ${result.counts.work_schedules} Arbeitspläne, ${result.counts.balance_corrections} Korrekturen`)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DataTransferManager;
