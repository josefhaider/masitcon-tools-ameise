"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Wrench, Bug } from "lucide-react";

interface ChangeEntry {
  type: "feature" | "improvement" | "fix";
  title: string;
  description: string;
}

interface ChangelogEntry {
  version: string;
  date: string;
  changes: ChangeEntry[];
}

const changelogEntries: ChangelogEntry[] = [
  {
    version: "1.6",
    date: "2026-02-02",
    changes: [
      {
        type: "improvement",
        title: "PDF-Export: Stunden/Minuten-Format",
        description: "Der monatliche Stundennachweis-PDF zeigt Stunden jetzt im Format 'Xh Ymin' statt Dezimalzahlen (z.B. '8h 10min' statt '8.17h') – sowohl in der Tabelle als auch in der Zusammenfassung."
      },
      {
        type: "fix",
        title: "PDF-Export: SOLL-Berechnung bei Überstundenfrei",
        description: "Bei 'Überstundenfrei'-Tagen werden im PDF jetzt die SOLL-Stunden korrekt beibehalten, sodass der negative Saldo-Effekt auf das Stundenkonto korrekt dargestellt wird."
      },
      {
        type: "feature",
        title: "Halbe Urlaubstage beantragen",
        description: "Alle Mitarbeiter können jetzt halbe Urlaubstage beantragen – nicht nur Admins. Die Checkbox erscheint im Urlaubsantragsformular wenn Start- und Enddatum gleich sind."
      },
      {
        type: "feature",
        title: "Halber Urlaubstag bei direkten Abwesenheiten",
        description: "Admins können bei direkten Abwesenheiten ebenfalls halbe Urlaubstage erfassen."
      },
      {
        type: "feature",
        title: "Zeiterfassung bei Abwesenheiten",
        description: "An Urlaubs-, Krankheits- und Überstundenfrei-Tagen kann jetzt trotzdem Zeit erfasst werden. Das Bearbeiten-Symbol erscheint bei allen Abwesenheitstypen – sowohl in der Desktop-Tabelle als auch mobil."
      },
      {
        type: "fix",
        title: "Urlaubsanträge: Korrekte Arbeitstage-Berechnung",
        description: "In der Urlaubsgenehmigung werden jetzt nur noch Arbeitstage gezählt – Wochenenden und Feiertage werden automatisch abgezogen."
      }
    ]
  },
  {
    version: "1.5.14",
    date: "2026-01-25",
    changes: [
      {
        type: "improvement",
        title: "Teamübersicht: Detailansicht erweitert",
        description: "Die Mitarbeiter-Detailansicht in der Teamübersicht zeigt jetzt alle Abwesenheitstypen (Urlaub, Krank, Überstundenfrei, Berufsschule, Unbezahlt, Sonstiges) mit farbigen Badges und korrekten SOLL/SALDO-Werten - identisch zur Zeiterfassung."
      },
      {
        type: "improvement",
        title: "Teamübersicht: Überstundenfrei mit Saldo",
        description: "Bei 'Überstundenfrei'-Tagen werden jetzt SOLL-Stunden und der negative Saldo korrekt angezeigt, sodass die Belastung des Stundenkontos transparent wird."
      },
      {
        type: "improvement",
        title: "Teamübersicht: Farbige Zeilenhintergründe",
        description: "Jeder Abwesenheitstyp hat jetzt eine eigene dezente Hintergrundfarbe für bessere visuelle Unterscheidung (Gelb für Urlaub, Rot für Krank, Blau für Überstundenfrei, etc.)."
      }
    ]
  },
  {
    version: "1.5.13",
    date: "2026-01-25",
    changes: [
      {
        type: "improvement",
        title: "Urlaubsplanung: Vertikale Tagestrennlinien",
        description: "In der Jahresansicht der Urlaubsplanung werden jetzt vertikale Linien zwischen den einzelnen Tagen angezeigt, um die Übersichtlichkeit zu verbessern."
      },
      {
        type: "improvement",
        title: "Urlaubsplanung: Kompaktere Team-Header",
        description: "Die Team-Kopfzeilen in der Jahresansicht sind jetzt schmäler und dienen als dezente visuelle Trenner zwischen den Teams."
      },
      {
        type: "improvement",
        title: "Urlaubsplanung: Mitarbeiteranzahl entfernt",
        description: "Die Anzeige der Mitarbeiteranzahl je Team wurde aus den Team-Headern entfernt, um die Darstellung aufgeräumter zu gestalten."
      }
    ]
  },
  {
    version: "1.5.12",
    date: "2026-01-25",
    changes: [
      {
        type: "fix",
        title: "Unbezahlter Urlaub nicht mehr vom Urlaubskontingent abgezogen",
        description: "In der Team-Übersicht werden jetzt nur noch echte Urlaubstage (Typ 'vacation') vom Urlaubskontingent abgezogen. Unbezahlter Urlaub und Überstundenfrei bleiben unberücksichtigt."
      },
      {
        type: "fix",
        title: "Urlaubsplanung: Korrekte Farbdarstellung",
        description: "Wochenenden und Feiertage behalten jetzt ihre ursprüngliche Farbe (grau bzw. grün), auch wenn sie innerhalb eines Urlaubszeitraums liegen."
      },
      {
        type: "fix",
        title: "Urlaubsplanung: Tage-Summe korrigiert",
        description: "Die Spalte 'Tage' in der Jahresübersicht zählt jetzt nur echte Urlaubstage, die den Urlaubsanspruch betreffen. Unbezahlter Urlaub, Überstundenfrei und Berufsschule werden nicht mehr addiert."
      },
      {
        type: "fix",
        title: "Direkte Abwesenheiten: Tabelle aktualisiert sofort",
        description: "Nach dem Speichern einer direkten Abwesenheit wird die Tabelle jetzt sofort aktualisiert, sodass der neue Eintrag direkt sichtbar ist."
      }
    ]
  },
  {
    version: "1.5.11",
    date: "2026-01-20",
    changes: [
      {
        type: "fix",
        title: "Clipboard-Kopieren und Passwort-Reset",
        description: "Link-Kopieren funktioniert jetzt auch in HTTP-Umgebungen durch Fallback-Mechanismus. Passwort-Reset-Links führen zuverlässig zum 'Neues Passwort'-Dialog, auch wenn bereits eine Session existiert."
      }
    ]
  },
  {
    version: "1.5.10",
    date: "2026-01-20",
    changes: [
      {
        type: "fix",
        title: "Jahresansicht UI-Verbesserungen",
        description: "Doppelte Legende entfernt, 'Heute'-Markierung entfernt und Header-Überlappung beim seitlichen Scrollen behoben. Mitarbeiter-Spalte bleibt jetzt korrekt über den scrollenden Datumsangaben."
      }
    ]
  },
  {
    version: "1.5.9",
    date: "2026-01-20",
    changes: [
      {
        type: "improvement",
        title: "Jahresansicht Urlaubsplanung überarbeitet",
        description: "Komplett neue tagesgenaue Gantt-Ansicht mit horizontalem Scroll. Feiertage und Schulferien werden jetzt als Hintergrundfarbe direkt in den Mitarbeiterzeilen angezeigt, nicht mehr in separaten Zeilen. Monats-Trennlinien für bessere Orientierung."
      }
    ]
  },
  {
    version: "1.5.8",
    date: "2026-01-20",
    changes: [
      {
        type: "fix",
        title: "Überstundenfrei-Anzeige in Zeiterfassung",
        description: "Geplante Überstundenfrei-Tage aus Abwesenheitsanträgen werden jetzt korrekt in der Zeiterfassungstabelle angezeigt mit SOLL-Stunden und negativem Saldo."
      },
      {
        type: "improvement",
        title: "Alle Abwesenheitstypen in Zeiterfassung",
        description: "Berufsschule, unbezahlter Urlaub und sonstige Abwesenheiten werden jetzt ebenfalls korrekt in der Monatsübersicht dargestellt."
      }
    ]
  },
  {
    version: "1.5.7",
    date: "2026-01-20",
    changes: [
      {
        type: "fix",
        title: "Überstundenfrei-Buchung korrigiert",
        description: "Überstundenfrei (Gleitzeittag) wird jetzt korrekt vom Stundenkonto abgezogen statt vom Urlaubskontingent. Die SOLL-Stunden bleiben erhalten, wodurch das Saldo um die Tagesstunden reduziert wird."
      },
      {
        type: "improvement",
        title: "Archivierte Mitarbeiter ausblenden",
        description: "Archivierte Mitarbeiter erscheinen nicht mehr in Auswahllisten, Reports, Team-Übersicht und Urlaubsplanung."
      }
    ]
  },
  {
    version: "1.5.6",
    date: "2026-01-20",
    changes: [
      {
        type: "feature",
        title: "Mitarbeiter archivieren",
        description: "Mitarbeiter können archiviert werden (Soft-Delete). Archivierte Mitarbeiter können sich nicht mehr anmelden, bleiben aber im System erhalten und können reaktiviert werden."
      },
      {
        type: "feature",
        title: "Mitarbeiter dauerhaft löschen",
        description: "Admins können Mitarbeiter inklusive aller zugehörigen Daten (Zeiteinträge, Urlaube, etc.) unwiderruflich löschen. Doppelte Sicherung durch Bestätigungscode erforderlich."
      }
    ]
  },
  {
    version: "1.5.5",
    date: "2026-01-20",
    changes: [
      {
        type: "feature",
        title: "Stundensaldo-Report zum Stichtag",
        description: "Neuer Bericht im Report-Dashboard: Kumuliertes Stundensaldo aller Mitarbeiter vom Jahresbeginn bis zu einem wählbaren Stichtag, inklusive PDF-Export."
      },
      {
        type: "feature",
        title: "Admin: E-Mail & Passwort verwalten",
        description: "Admins können jetzt in der Mitarbeiterverwaltung E-Mail-Adressen ändern und Passwörter zurücksetzen (direkt oder via Reset-Link)."
      }
    ]
  },
  {
    version: "1.5.4",
    date: "2026-01-20",
    changes: [
      {
        type: "fix",
        title: "Admin Profil-Update",
        description: "Admins können jetzt alle Mitarbeiterprofile bearbeiten (Name, Mitarbeiternummer, Zeiterfassungsbefreiung). Fehlende RLS-Policy ergänzt."
      }
    ]
  },
  {
    version: "1.5.3",
    date: "2026-01-19",
    changes: [
      {
        type: "fix",
        title: "HR-Manager Team-Übersicht",
        description: "HR-Manager können jetzt die SOLL-Stunden aller Mitarbeiter in der Team-Übersicht sehen (fehlende RLS-Policy ergänzt)."
      }
    ]
  },
  {
    version: "1.5.2",
    date: "2026-01-19",
    changes: [
      {
        type: "fix",
        title: "Arbeitstage-Berechnung im Krankmeldungsbericht",
        description: "Krankmeldungen über Monatsgrenzen hinweg werden jetzt korrekt auf den gewählten Filtermonat beschränkt berechnet."
      },
      {
        type: "improvement",
        title: "Krankmeldungs-PDF Design",
        description: "MASitcon-Logo im Header, lesbare Text-Symbole statt Unicode-Zeichen (Ja/Nein/n.e.), Unterschriftsfeld entfernt, Legende verbessert."
      }
    ]
  },
  {
    version: "1.5.1",
    date: "2026-01-19",
    changes: [
      {
        type: "feature",
        title: "Kumuliertes Jahressaldo pro Mitarbeiter",
        description: "Neue Spalte 'Saldo (Gesamt)' in der Team-Übersicht zeigt das kumulierte Stundensaldo vom Jahresbeginn bis zum aktuellen Stichtag für jeden Mitarbeiter."
      }
    ]
  },
  {
    version: "1.5.0",
    date: "2026-01-19",
    changes: [
      {
        type: "feature",
        title: "Monatsauswahl in Team-Übersicht",
        description: "Die Team-Übersicht bietet jetzt Jahr- und Monats-Dropdowns statt einfacher Vor/Zurück-Navigation für schnelleren Zugriff auf beliebige Zeiträume."
      },
      {
        type: "feature",
        title: "Mitarbeiter-Drilldown (Read-Only)",
        description: "Klick auf einen Mitarbeiternamen in der Team-Übersicht öffnet dessen komplette Zeiterfassung als Nur-Lese-Ansicht für das gewählte Monat."
      }
    ]
  },
  {
    version: "1.4.2",
    date: "2026-01-19",
    changes: [
      {
        type: "improvement",
        title: "Stundenanzeige in Stunden/Minuten",
        description: "IST, SOLL und SALDO werden jetzt durchgängig als 'Xh Ymin' angezeigt (z.B. 8h 10min statt 8.17h) für bessere Lesbarkeit."
      }
    ]
  },
  {
    version: "1.4.1",
    date: "2026-01-19",
    changes: [
      {
        type: "fix",
        title: "Rundung bei Stundenanzeige korrigiert",
        description: "Dezimalstunden werden jetzt mit maximal 2 Nachkommastellen angezeigt für genauere Minutendarstellung."
      }
    ]
  },
  {
    version: "1.4.0",
    date: "2026-01-19",
    changes: [
      {
        type: "feature",
        title: "Mitarbeiter-Stammdaten bearbeitbar",
        description: "Name und Mitarbeiternummer können jetzt im Tab 'Einstellungen' bearbeitet werden."
      },
      {
        type: "fix",
        title: "Scroll-Position nach Speichern",
        description: "Die Seite springt nach dem Speichern eines Zeiteintrags nicht mehr zum Anfang. Die bearbeitete Zeile bleibt sichtbar und wird kurz hervorgehoben."
      },
      {
        type: "improvement",
        title: "Stundenformatierung verbessert",
        description: "IST-Stunden, SOLL-Stunden und Saldo werden jetzt einheitlich als Dezimalzahl und in Klammern als Stunden/Minuten angezeigt (z.B. '8.5h (8h 30min)')."
      },
      {
        type: "feature",
        title: "Wochenendarbeit möglich",
        description: "Samstags- und Sonntagsarbeit kann jetzt erfasst werden, auch wenn keine Soll-Stunden hinterlegt sind."
      },
      {
        type: "improvement",
        title: "Neues Favicon",
        description: "Das Browser-Tab-Icon wurde auf das masitcon-Logo aktualisiert."
      },
      {
        type: "fix",
        title: "Feiertage im Mini-Kalender",
        description: "Feiertage werden jetzt korrekt ausgegraut angezeigt statt als 'fehlend' (rot). Eine neue Legende zeigt den Feiertag-Status."
      },
      {
        type: "fix",
        title: "Rundungsproblem bei Stundenanzeige",
        description: "Stundenwerte werden jetzt mit bis zu 2 Dezimalstellen angezeigt (z.B. 8.17h statt 8.2h), sodass die Minutenangabe exakt stimmt."
      }
    ]
  }
];

const getTypeBadge = (type: ChangeEntry["type"]) => {
  switch (type) {
    case "feature":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">
          <Sparkles className="h-3 w-3 mr-1" />
          Neu
        </Badge>
      );
    case "improvement":
      return (
        <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 hover:bg-blue-500/20">
          <Wrench className="h-3 w-3 mr-1" />
          Verbessert
        </Badge>
      );
    case "fix":
      return (
        <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20">
          <Bug className="h-3 w-3 mr-1" />
          Behoben
        </Badge>
      );
  }
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
};

export default function Changelog() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Änderungsprotokoll</h2>
        <p className="text-muted-foreground">
          Alle Änderungen und Verbesserungen an der Zeiterfassungssuite
        </p>
      </div>

      <ScrollArea className="h-[calc(100vh-200px)]">
        <div className="space-y-6 pr-4">
          {changelogEntries.map((entry) => (
            <Card key={entry.version} className="border-l-4 border-l-primary">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">Version {entry.version}</CardTitle>
                  <CardDescription className="text-sm">
                    {formatDate(entry.date)}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {entry.changes.map((change, index) => (
                    <div key={index} className="flex gap-3">
                      <div className="flex-shrink-0 pt-0.5">
                        {getTypeBadge(change.type)}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-medium text-sm">{change.title}</h4>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {change.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
