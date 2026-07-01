# Änderungsprotokoll

Alle wichtigen Änderungen an der masitcon Zeiterfassungssuite. Neueste oben.

Diese Datei ist die einzige Quelle für das Änderungsprotokoll. Die In-App-Ansicht
unter `/changelog` wird direkt aus dieser Datei erzeugt.

Format: Einträge sind nach Datum sortiert (neueste oben), mit einer lockeren
Versionsnummer. Vier Kategorien:

- **Neu** – neue Funktionen
- **Verbessert** – Verbesserungen an bestehenden Funktionen
- **Behoben** – behobene Fehler
- **Technik** – wichtige technische/infrastrukturelle Änderungen (Migration, Datenbank, Deployment, Sicherheit)

Triviales (reine Refactorings, Formatierung, Dependency-Updates ohne sichtbaren
Effekt) gehört nicht hierher – dafür gibt es die Git-Historie.

## [2.1.1] – 2026-07-01

### Behoben
- **Anmeldedaten gelangen nicht mehr in die URL** — Wenn das Anmeldeformular abgeschickt wurde, bevor die Seite vollständig geladen war, konnten E-Mail und Passwort im Klartext in der Adresszeile landen (und damit in Verlauf und Server-Logs). Das Formular sendet jetzt grundsätzlich per POST, sodass Zugangsdaten nie in der URL erscheinen.

## [2.1.0] – 2026-07-01

### Neu
- **Reisekostenabrechnung** — Mitarbeiter erfassen ihre Dienstreisen (Zeitraum, Zielort, Anlass); der Verpflegungsmehraufwand wird automatisch nach den gültigen Sätzen inkl. Mahlzeitenkürzung berechnet. Für Städte mit eigenem Satz lässt sich der Ort gezielt wählen (z. B. Spanien – Palma de Mallorca). Reisen werden von Admin/HR freigegeben und lassen sich als PDF pro Reise sowie als Sammel-Export (PDF/CSV) für die Steuerberatung ausgeben.
- **Reisekostensätze verwalten** — Admins pflegen die Tagessätze je Land und optional je Stadt/Region mit jahresweiser Gültigkeit; Deutschland und die gängigen Reiseländer sind mit den ab 1. Januar 2026 gültigen BMF-Sätzen vorbelegt.

### Technik
- **Neue Tabellen `business_trips` und `per_diem_rates`** — inklusive Row-Level-Security (eigene Reisen für Mitarbeiter, Vollzugriff für Admin/HR) und geteiltem Berechnungsmodul mit Unit-Tests.

## [2.0.0] – 2026-03-17

### Technik
- **Migration auf Next.js 16 App Router** — Die komplette Anwendung wurde von React/Vite auf Next.js 16 mit App Router umgestellt. Server-seitiges Rendering, geschützte Routen und Auth laufen jetzt über Next.js Middleware und Server Components.
- **Backup-System auf Zwei-Dump-Standard** — Das Backup- und Restore-System wurde überarbeitet (getrennte Rollen- und Daten-Dumps), inklusive Restore-Skript für Legacy-Backups.
- **Admin-Operationen über Next.js API-Routes** — Administrative Vorgänge (z.B. Mitarbeiterverwaltung, Datentransfer) laufen jetzt über Next.js API-Routes statt über Supabase Edge Functions.
- **Robusteres Deployment** — Automatische Erkennung freier Docker-Subnetze, idempotente Migrationen, Health-Checks und Bereinigung veralteter Auth-Cookies.

### Behoben
- **Fehler-Toasts auf der Login-Seite sichtbar** — Benachrichtigungen werden jetzt auch auf der Login-Seite korrekt angezeigt.

## [1.6] – 2026-02-02

### Neu
- **Halbe Urlaubstage beantragen** — Alle Mitarbeiter können jetzt halbe Urlaubstage beantragen – nicht nur Admins. Die Checkbox erscheint im Urlaubsantragsformular wenn Start- und Enddatum gleich sind.
- **Halber Urlaubstag bei direkten Abwesenheiten** — Admins können bei direkten Abwesenheiten ebenfalls halbe Urlaubstage erfassen.
- **Zeiterfassung bei Abwesenheiten** — An Urlaubs-, Krankheits- und Überstundenfrei-Tagen kann jetzt trotzdem Zeit erfasst werden. Das Bearbeiten-Symbol erscheint bei allen Abwesenheitstypen – sowohl in der Desktop-Tabelle als auch mobil.

### Verbessert
- **PDF-Export: Stunden/Minuten-Format** — Der monatliche Stundennachweis-PDF zeigt Stunden jetzt im Format 'Xh Ymin' statt Dezimalzahlen (z.B. '8h 10min' statt '8.17h') – sowohl in der Tabelle als auch in der Zusammenfassung.

### Behoben
- **PDF-Export: SOLL-Berechnung bei Überstundenfrei** — Bei 'Überstundenfrei'-Tagen werden im PDF jetzt die SOLL-Stunden korrekt beibehalten, sodass der negative Saldo-Effekt auf das Stundenkonto korrekt dargestellt wird.
- **Urlaubsanträge: Korrekte Arbeitstage-Berechnung** — In der Urlaubsgenehmigung werden jetzt nur noch Arbeitstage gezählt – Wochenenden und Feiertage werden automatisch abgezogen.

## [1.5.14] – 2026-01-25

### Verbessert
- **Teamübersicht: Detailansicht erweitert** — Die Mitarbeiter-Detailansicht in der Teamübersicht zeigt jetzt alle Abwesenheitstypen (Urlaub, Krank, Überstundenfrei, Berufsschule, Unbezahlt, Sonstiges) mit farbigen Badges und korrekten SOLL/SALDO-Werten - identisch zur Zeiterfassung.
- **Teamübersicht: Überstundenfrei mit Saldo** — Bei 'Überstundenfrei'-Tagen werden jetzt SOLL-Stunden und der negative Saldo korrekt angezeigt, sodass die Belastung des Stundenkontos transparent wird.
- **Teamübersicht: Farbige Zeilenhintergründe** — Jeder Abwesenheitstyp hat jetzt eine eigene dezente Hintergrundfarbe für bessere visuelle Unterscheidung (Gelb für Urlaub, Rot für Krank, Blau für Überstundenfrei, etc.).

## [1.5.13] – 2026-01-25

### Verbessert
- **Urlaubsplanung: Vertikale Tagestrennlinien** — In der Jahresansicht der Urlaubsplanung werden jetzt vertikale Linien zwischen den einzelnen Tagen angezeigt, um die Übersichtlichkeit zu verbessern.
- **Urlaubsplanung: Kompaktere Team-Header** — Die Team-Kopfzeilen in der Jahresansicht sind jetzt schmäler und dienen als dezente visuelle Trenner zwischen den Teams.
- **Urlaubsplanung: Mitarbeiteranzahl entfernt** — Die Anzeige der Mitarbeiteranzahl je Team wurde aus den Team-Headern entfernt, um die Darstellung aufgeräumter zu gestalten.

## [1.5.12] – 2026-01-25

### Behoben
- **Unbezahlter Urlaub nicht mehr vom Urlaubskontingent abgezogen** — In der Team-Übersicht werden jetzt nur noch echte Urlaubstage (Typ 'vacation') vom Urlaubskontingent abgezogen. Unbezahlter Urlaub und Überstundenfrei bleiben unberücksichtigt.
- **Urlaubsplanung: Korrekte Farbdarstellung** — Wochenenden und Feiertage behalten jetzt ihre ursprüngliche Farbe (grau bzw. grün), auch wenn sie innerhalb eines Urlaubszeitraums liegen.
- **Urlaubsplanung: Tage-Summe korrigiert** — Die Spalte 'Tage' in der Jahresübersicht zählt jetzt nur echte Urlaubstage, die den Urlaubsanspruch betreffen. Unbezahlter Urlaub, Überstundenfrei und Berufsschule werden nicht mehr addiert.
- **Direkte Abwesenheiten: Tabelle aktualisiert sofort** — Nach dem Speichern einer direkten Abwesenheit wird die Tabelle jetzt sofort aktualisiert, sodass der neue Eintrag direkt sichtbar ist.

## [1.5.11] – 2026-01-20

### Behoben
- **Clipboard-Kopieren und Passwort-Reset** — Link-Kopieren funktioniert jetzt auch in HTTP-Umgebungen durch Fallback-Mechanismus. Passwort-Reset-Links führen zuverlässig zum 'Neues Passwort'-Dialog, auch wenn bereits eine Session existiert.

## [1.5.10] – 2026-01-20

### Behoben
- **Jahresansicht UI-Verbesserungen** — Doppelte Legende entfernt, 'Heute'-Markierung entfernt und Header-Überlappung beim seitlichen Scrollen behoben. Mitarbeiter-Spalte bleibt jetzt korrekt über den scrollenden Datumsangaben.

## [1.5.9] – 2026-01-20

### Verbessert
- **Jahresansicht Urlaubsplanung überarbeitet** — Komplett neue tagesgenaue Gantt-Ansicht mit horizontalem Scroll. Feiertage und Schulferien werden jetzt als Hintergrundfarbe direkt in den Mitarbeiterzeilen angezeigt, nicht mehr in separaten Zeilen. Monats-Trennlinien für bessere Orientierung.

## [1.5.8] – 2026-01-20

### Verbessert
- **Alle Abwesenheitstypen in Zeiterfassung** — Berufsschule, unbezahlter Urlaub und sonstige Abwesenheiten werden jetzt ebenfalls korrekt in der Monatsübersicht dargestellt.

### Behoben
- **Überstundenfrei-Anzeige in Zeiterfassung** — Geplante Überstundenfrei-Tage aus Abwesenheitsanträgen werden jetzt korrekt in der Zeiterfassungstabelle angezeigt mit SOLL-Stunden und negativem Saldo.

## [1.5.7] – 2026-01-20

### Verbessert
- **Archivierte Mitarbeiter ausblenden** — Archivierte Mitarbeiter erscheinen nicht mehr in Auswahllisten, Reports, Team-Übersicht und Urlaubsplanung.

### Behoben
- **Überstundenfrei-Buchung korrigiert** — Überstundenfrei (Gleitzeittag) wird jetzt korrekt vom Stundenkonto abgezogen statt vom Urlaubskontingent. Die SOLL-Stunden bleiben erhalten, wodurch das Saldo um die Tagesstunden reduziert wird.

## [1.5.6] – 2026-01-20

### Neu
- **Mitarbeiter archivieren** — Mitarbeiter können archiviert werden (Soft-Delete). Archivierte Mitarbeiter können sich nicht mehr anmelden, bleiben aber im System erhalten und können reaktiviert werden.
- **Mitarbeiter dauerhaft löschen** — Admins können Mitarbeiter inklusive aller zugehörigen Daten (Zeiteinträge, Urlaube, etc.) unwiderruflich löschen. Doppelte Sicherung durch Bestätigungscode erforderlich.

## [1.5.5] – 2026-01-20

### Neu
- **Stundensaldo-Report zum Stichtag** — Neuer Bericht im Report-Dashboard: Kumuliertes Stundensaldo aller Mitarbeiter vom Jahresbeginn bis zu einem wählbaren Stichtag, inklusive PDF-Export.
- **Admin: E-Mail & Passwort verwalten** — Admins können jetzt in der Mitarbeiterverwaltung E-Mail-Adressen ändern und Passwörter zurücksetzen (direkt oder via Reset-Link).

## [1.5.4] – 2026-01-20

### Behoben
- **Admin Profil-Update** — Admins können jetzt alle Mitarbeiterprofile bearbeiten (Name, Mitarbeiternummer, Zeiterfassungsbefreiung). Fehlende RLS-Policy ergänzt.

## [1.5.3] – 2026-01-19

### Behoben
- **HR-Manager Team-Übersicht** — HR-Manager können jetzt die SOLL-Stunden aller Mitarbeiter in der Team-Übersicht sehen (fehlende RLS-Policy ergänzt).

## [1.5.2] – 2026-01-19

### Verbessert
- **Krankmeldungs-PDF Design** — MASitcon-Logo im Header, lesbare Text-Symbole statt Unicode-Zeichen (Ja/Nein/n.e.), Unterschriftsfeld entfernt, Legende verbessert.

### Behoben
- **Arbeitstage-Berechnung im Krankmeldungsbericht** — Krankmeldungen über Monatsgrenzen hinweg werden jetzt korrekt auf den gewählten Filtermonat beschränkt berechnet.

## [1.5.1] – 2026-01-19

### Neu
- **Kumuliertes Jahressaldo pro Mitarbeiter** — Neue Spalte 'Saldo (Gesamt)' in der Team-Übersicht zeigt das kumulierte Stundensaldo vom Jahresbeginn bis zum aktuellen Stichtag für jeden Mitarbeiter.

## [1.5.0] – 2026-01-19

### Neu
- **Monatsauswahl in Team-Übersicht** — Die Team-Übersicht bietet jetzt Jahr- und Monats-Dropdowns statt einfacher Vor/Zurück-Navigation für schnelleren Zugriff auf beliebige Zeiträume.
- **Mitarbeiter-Drilldown (Read-Only)** — Klick auf einen Mitarbeiternamen in der Team-Übersicht öffnet dessen komplette Zeiterfassung als Nur-Lese-Ansicht für das gewählte Monat.

## [1.4.2] – 2026-01-19

### Verbessert
- **Stundenanzeige in Stunden/Minuten** — IST, SOLL und SALDO werden jetzt durchgängig als 'Xh Ymin' angezeigt (z.B. 8h 10min statt 8.17h) für bessere Lesbarkeit.

## [1.4.1] – 2026-01-19

### Behoben
- **Rundung bei Stundenanzeige korrigiert** — Dezimalstunden werden jetzt mit maximal 2 Nachkommastellen angezeigt für genauere Minutendarstellung.

## [1.4.0] – 2026-01-19

### Neu
- **Mitarbeiter-Stammdaten bearbeitbar** — Name und Mitarbeiternummer können jetzt im Tab 'Einstellungen' bearbeitet werden.
- **Wochenendarbeit möglich** — Samstags- und Sonntagsarbeit kann jetzt erfasst werden, auch wenn keine Soll-Stunden hinterlegt sind.

### Verbessert
- **Stundenformatierung verbessert** — IST-Stunden, SOLL-Stunden und Saldo werden jetzt einheitlich als Dezimalzahl und in Klammern als Stunden/Minuten angezeigt (z.B. '8.5h (8h 30min)').
- **Neues Favicon** — Das Browser-Tab-Icon wurde auf das masitcon-Logo aktualisiert.

### Behoben
- **Scroll-Position nach Speichern** — Die Seite springt nach dem Speichern eines Zeiteintrags nicht mehr zum Anfang. Die bearbeitete Zeile bleibt sichtbar und wird kurz hervorgehoben.
- **Feiertage im Mini-Kalender** — Feiertage werden jetzt korrekt ausgegraut angezeigt statt als 'fehlend' (rot). Eine neue Legende zeigt den Feiertag-Status.
- **Rundungsproblem bei Stundenanzeige** — Stundenwerte werden jetzt mit bis zu 2 Dezimalstellen angezeigt (z.B. 8.17h statt 8.2h), sodass die Minutenangabe exakt stimmt.
