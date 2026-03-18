import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Extend jsPDF type to include autoTable
declare module 'jspdf' {
  interface jsPDF {
    lastAutoTable: {
      finalY: number;
    };
  }
}

export interface SickLeaveReportEntry {
  employeeName: string;
  employeeNumber: string | null;
  startDate: string;
  endDate: string;
  workDays: number;
  certificateStatus: string | null;
}

export interface TimeEntryReportData {
  date: string;
  weekday: string;
  timeRange: string;  // Combined: "08:00-16:30" or "08:00-12:00, 14:00-17:00"
  breakMinutes: number;
  actualHours: number;
  targetHours: number;
  notes?: string;
  type: 'work' | 'vacation' | 'sick' | 'holiday' | 'weekend';
}

export interface MonthlyHoursReportData {
  employeeName: string;
  employeeNumber: string | null;
  month: string;
  year: number;
  entries: TimeEntryReportData[];
  summary: {
    workDays: number;
    vacationDays: number;
    sickDays: number;
    holidayDays: number;
    targetHours: number;
    actualHours: number;
    monthBalance: number;
    totalBalance: number;
  };
}

export interface TeamOverviewReportData {
  referenceDate: Date;
  employees: {
    name: string;
    employeeNumber: string | null;
    targetHours: number;
    actualHours: number;
    balance: number;
    vacationUsed: number;
    vacationPlanned: number;
    vacationRemaining: number;
  }[];
}

export interface BalanceReportData {
  cutoffDate: Date;
  employees: {
    name: string;
    employeeNumber: string | null;
    targetHours: number;
    actualHours: number;
    corrections: number;
    balance: number;
    isExempt: boolean;
  }[];
}

const COMPANY_NAME = 'Masitcon';

// MASitcon Logo als Base64 (kleines optimiertes PNG)
const MASITCON_LOGO_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAABQCAYAAACj6kh7AAAACXBIWXMAAAsTAAALEwEAmpwYAAAF8WlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNS42LWMxNDUgNzkuMTYzNDk5LCAyMDE4LzA4LzEzLTE2OjQwOjIyICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ0MgMjAxOSAoV2luZG93cykiIHhtcDpDcmVhdGVEYXRlPSIyMDI1LTAxLTE5VDIwOjAwOjAwKzAxOjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAyNS0wMS0xOVQyMDowMDowMCswMTowMCIgeG1wOk1ldGFkYXRhRGF0ZT0iMjAyNS0wMS0xOVQyMDowMDowMCswMTowMCIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6MDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIiB4bXBNTTpEb2N1bWVudElE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FoMgPXH6z7+AB2ExCNITp//8C3gQFoMgPXH6z7+AB2ExCNITp//8C3gQloMgPXDyz7+AB2E5CNIDJ//8C3gQloMgPXDyz7+AB2E5CNIDJ//8C3gQloMgPXDyz7+AB2E5CNIDp//8C3gQloMgPXD6z7+AB2E5CNIDp//8C3gQloMgPXD6z7+AB2E9CNID5//8C3gQ1oMgPXD+z7+AB2E9CNID5//8C3gQ1oMgPXD+z7+AB2E9CNID5//8C3gQ1oMgPXD+z7+AB2E9CNIDp//8C3gQFoQgPXD6z7+AB2FBCNIDp//8C3gQFoQgPXD6z7+AB2FBCNIDp//8C3gQFoQgPXD6z7+AB2FBCNIDp//8C3gQFoQgPXD6z7+AB2FBCNIHp//8C3gQFoQgfXD6z7+AB2FBCNIHJ//8C3gQFoQgfXDyz7+AB2FBCNIHJ//8C3gQFoQgfXD6z7+AB2FBCNIHJ//8C3gQFoQgfXDyz7+AB2FBCNIHp//8C3gQFoQgfXD6z7+AB2FJCNIFJ//8C3gQloQgXXDyz7+AB2FJCNIFp//8C3gQloQgXXD6z7+AB2FJCNIFJ//8C3gQloQgXXD6z7+AB2FJCNIFJ//8C3gQloQgXXD6z7+AB2FJCNIFJ//8C3gQloQgXXDyz7+AB2FJCNIFJ//8C3gQloQgXXDyz7+AB2FNCNIBp//8C3gQ1oQgHXD+z7+AB2FNCNIBp//8C3gQ1oQgHXD6z7+AB2FNCNIBp//8C3gQ1oQgHXD6z7+AB2FNCNIBp//8C3gQ1oQgHXD6z7+AB2FNCNIFp//8C3gQ1oQgXXDyz7+AB2FNCNIFp//8C3gQ1oQgXXDyz7+AB2FRCNIB5//8C3gQFoUgHTD6z7+AB2FRCNIB5//8C3gQFoUgHTD6z7+AB2FRCNIB5//8C3gQFoUgHXD6z7+AB2FRCNIB5//8C3gQFoUgHXD6z7+AB2FRCNIB5//8C3gQFoUgHXD6z7+AB2FRCNIR5//8C3gQFoUgHTH6z7+AB2FVCNIR5//8C3gQVoUgHTH6z7+AB2FVCNIRp//8C3gQVoUgHTH6z7+AB2FVCNIR5//8C3gQVoUgHTH6z7+AB2FVCNIRp//8C3gQVoUgHTH+z7+AB2FZCNIRp//8C3gQloUgHXH+z7+AB2FZCNIRp//8C3gQloUgHTH+z7+AB2FZCNIRp//8C3gQloUgHTH+z7+AB2FZCNIRpv/8C3gQloUgHTH+z7+AB2FZCNIRpv/8C3gQloUgHTE=';

export function generateSickLeaveReportPDF(
  entries: SickLeaveReportEntry[],
  month: number,
  year: number,
  onlyVerified: boolean
): void {
  const doc = new jsPDF();
  const monthName = format(new Date(year, month - 1, 1), 'MMMM yyyy', { locale: de });

  // Header mit Logo
  try {
    doc.addImage(MASITCON_LOGO_BASE64, 'PNG', 14, 10, 50, 14);
  } catch (e) {
    // Fallback wenn Logo nicht geladen werden kann
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 39, 87); // masitcon Dunkelblau
    doc.text('masitcon', 14, 18);
  }

  // Titel rechts vom Logo
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Krankmeldungsbericht', 196, 15, { align: 'right' });
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text(monthName, 196, 23, { align: 'right' });

  // Meta-Informationen
  doc.setFontSize(10);
  doc.text(`Erstellt am: ${format(new Date(), 'dd.MM.yyyy HH:mm', { locale: de })}`, 14, 35);
  if (onlyVerified) {
    doc.text('Filter: Nur mit ärztlichem Attest', 14, 41);
  }

  // Table - mit Text statt Unicode-Symbolen
  const tableData = entries.map(entry => [
    entry.employeeName,
    entry.employeeNumber || '-',
    format(new Date(entry.startDate), 'dd.MM.yyyy'),
    format(new Date(entry.endDate), 'dd.MM.yyyy'),
    entry.workDays.toString(),
    entry.certificateStatus === 'received' ? 'Ja' : 
      entry.certificateStatus === 'not_required' ? 'n.e.' : 'Nein'
  ]);

  const totalDays = entries.reduce((sum, e) => sum + e.workDays, 0);

  autoTable(doc, {
    startY: onlyVerified ? 48 : 42,
    head: [['Mitarbeiter', 'P.Nr.', 'Von', 'Bis', 'Tage', 'Attest']],
    body: tableData,
    foot: [['GESAMT', '', '', '', totalDays.toString(), '']],
    theme: 'striped',
    headStyles: { fillColor: [16, 39, 87] }, // masitcon Dunkelblau
    footStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0], fontStyle: 'bold' },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 20 },
      2: { cellWidth: 30 },
      3: { cellWidth: 30 },
      4: { cellWidth: 20, halign: 'center' },
      5: { cellWidth: 20, halign: 'center' }
    }
  });

  // Legende (ohne Unterschriftsfeld)
  const finalY = doc.lastAutoTable.finalY + 12;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Legende:', 14, finalY);
  doc.setFontSize(8);
  doc.text('Ja = Attest erhalten  |  n.e. = Nicht erforderlich  |  Nein = Ausstehend', 14, finalY + 5);

  // Download
  doc.save(`Krankmeldungsbericht_${year}-${String(month).padStart(2, '0')}.pdf`);
}

export function generateMonthlyHoursReportPDF(data: MonthlyHoursReportData): void {
  const doc = new jsPDF();

  // Helper für Stunden-Formatierung im "Xh Ymin" Format
  const formatHoursMinutes = (hours: number): string => {
    if (hours === 0) return '0h';
    const h = Math.floor(Math.abs(hours));
    const m = Math.round((Math.abs(hours) - h) * 60);
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
  };

  const formatHoursMinutesSigned = (hours: number): string => {
    if (hours === 0) return '0h';
    const isNegative = hours < 0;
    const h = Math.floor(Math.abs(hours));
    const m = Math.round((Math.abs(hours) - h) * 60);
    const sign = isNegative ? '-' : '+';
    if (m === 0) return `${sign}${h}h`;
    return `${sign}${h}h ${m}min`;
  };

  // Header - compact
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Stundennachweis', 105, 15, { align: 'center' });
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`${data.month} ${data.year}`, 105, 22, { align: 'center' });

  // Employee info - compact single line
  doc.setFontSize(9);
  const employeeInfo = data.employeeNumber 
    ? `${data.employeeName} (P.Nr.: ${data.employeeNumber})  |  Erstellt: ${format(new Date(), 'dd.MM.yyyy HH:mm', { locale: de })}`
    : `${data.employeeName}  |  Erstellt: ${format(new Date(), 'dd.MM.yyyy HH:mm', { locale: de })}`;
  doc.text(employeeInfo, 14, 30);

  // Time entries table - compact with combined time column
  const tableData = data.entries.map(entry => {
    if (entry.type === 'weekend') {
      return [entry.date, entry.weekday, '', '', '', '', 'Wochenende'];
    }
    if (entry.type === 'holiday') {
      return [entry.date, entry.weekday, '', '', '', '', entry.notes || 'Feiertag'];
    }
    if (entry.type === 'vacation') {
      const note = entry.notes || 'Urlaub';
      // Bei Urlaub mit SOLL-Stunden (halber Urlaubstag) - zeige SOLL und IST
      if (entry.targetHours > 0 || entry.actualHours > 0) {
        return [
          entry.date,
          entry.weekday,
          entry.timeRange || '-',
          entry.breakMinutes > 0 ? `${entry.breakMinutes}` : '-',
          entry.actualHours > 0 ? formatHoursMinutes(entry.actualHours) : '-',
          formatHoursMinutes(entry.targetHours),
          note
        ];
      }
      return [entry.date, entry.weekday, '', '', '', '', note];
    }
    if (entry.type === 'sick') {
      return [entry.date, entry.weekday, '', '', '', '', 'Krank'];
    }
    return [
      entry.date,
      entry.weekday,
      entry.timeRange || '-',
      entry.breakMinutes > 0 ? `${entry.breakMinutes}` : '-',
      entry.actualHours > 0 ? formatHoursMinutes(entry.actualHours) : '-',
      entry.targetHours > 0 ? formatHoursMinutes(entry.targetHours) : '-',
      entry.notes || ''
    ];
  });

  autoTable(doc, {
    startY: 35,
    head: [['Datum', 'Tag', 'Zeit', 'Pause', 'IST', 'SOLL', 'Bemerkung']],
    body: tableData,
    theme: 'striped',
    headStyles: { fillColor: [66, 66, 66], fontSize: 7, cellPadding: 1.5 },
    styles: { fontSize: 7, cellPadding: 1.5 },
    columnStyles: {
      0: { cellWidth: 16 },
      1: { cellWidth: 10 },
      2: { cellWidth: 45 },  // Time range column - wider for split times
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 18, halign: 'right' },  // IST - etwas breiter für "8h 10min"
      5: { cellWidth: 18, halign: 'right' },  // SOLL - etwas breiter für "8h 10min"
      6: { cellWidth: 'auto' }
    }
  });

  // Compact summary box
  const summaryY = doc.lastAutoTable.finalY + 5;
  
  doc.setFillColor(245, 245, 245);
  doc.rect(14, summaryY, 182, 28, 'F');
  doc.setDrawColor(200, 200, 200);
  doc.rect(14, summaryY, 182, 28, 'S');
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('ZUSAMMENFASSUNG', 18, summaryY + 6);
  
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  
  // First row: Days info + Target/Actual hours
  let lineY = summaryY + 13;
  doc.text(`Arbeitstage: ${data.summary.workDays}  |  Urlaub: ${data.summary.vacationDays}  |  Krank: ${data.summary.sickDays}  |  Feiertage: ${data.summary.holidayDays}`, 18, lineY);
  doc.text(`Soll: ${formatHoursMinutes(data.summary.targetHours)}  |  Ist: ${formatHoursMinutes(data.summary.actualHours)}`, 130, lineY);
  
  // Second row: Balances
  lineY += 8;
  const monthBalanceStr = formatHoursMinutesSigned(data.summary.monthBalance);
  const totalBalanceStr = formatHoursMinutesSigned(data.summary.totalBalance);
  doc.text(`Saldo Monat: ${monthBalanceStr}`, 18, lineY);
  doc.setFont('helvetica', 'bold');
  doc.text(`SALDO GESAMT: ${totalBalanceStr}`, 130, lineY);

  // Download
  const monthNum = new Date(`${data.month} 1, ${data.year}`).getMonth() + 1;
  doc.save(`Stundennachweis_${data.employeeName.replace(/\s+/g, '_')}_${data.year}-${String(monthNum).padStart(2, '0')}.pdf`);
}

export function generateTeamOverviewPDF(data: TeamOverviewReportData): void {
  const doc = new jsPDF();
  const refDateStr = format(data.referenceDate, 'dd.MM.yyyy', { locale: de });

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Team-Übersicht', 105, 15, { align: 'center' });
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Stichtag: ${refDateStr}`, 105, 22, { align: 'center' });

  doc.setFontSize(9);
  doc.text(`Erstellt am: ${format(new Date(), 'dd.MM.yyyy HH:mm', { locale: de })}`, 14, 30);

  // Calculate totals
  const totals = data.employees.reduce(
    (acc, emp) => ({
      targetHours: acc.targetHours + emp.targetHours,
      actualHours: acc.actualHours + emp.actualHours,
      balance: acc.balance + emp.balance,
      vacationUsed: acc.vacationUsed + emp.vacationUsed,
      vacationPlanned: acc.vacationPlanned + emp.vacationPlanned
    }),
    { targetHours: 0, actualHours: 0, balance: 0, vacationUsed: 0, vacationPlanned: 0 }
  );

  // Table
  const tableData = data.employees.map(emp => [
    emp.name,
    emp.employeeNumber || '-',
    emp.targetHours.toFixed(1),
    emp.actualHours.toFixed(1),
    (emp.balance > 0 ? '+' : '') + emp.balance.toFixed(1),
    emp.vacationUsed.toString(),
    emp.vacationPlanned.toString(),
    emp.vacationRemaining.toString()
  ]);

  autoTable(doc, {
    startY: 35,
    head: [['Mitarbeiter', 'P.Nr.', 'SOLL', 'IST', 'Saldo', 'U.gen.', 'U.gepl.', 'U.Rest']],
    body: tableData,
    foot: [[
      `GESAMT (${data.employees.length} MA)`,
      '',
      totals.targetHours.toFixed(1),
      totals.actualHours.toFixed(1),
      (totals.balance > 0 ? '+' : '') + totals.balance.toFixed(1),
      totals.vacationUsed.toString(),
      totals.vacationPlanned.toString(),
      '-'
    ]],
    theme: 'striped',
    headStyles: { fillColor: [66, 66, 66], fontSize: 8, cellPadding: 2 },
    footStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 20, halign: 'right' },
      3: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 20, halign: 'right' },
      5: { cellWidth: 18, halign: 'center' },
      6: { cellWidth: 18, halign: 'center' },
      7: { cellWidth: 18, halign: 'center' }
    }
  });

  // Legend
  const finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(8);
  doc.text('Legende: U.gen. = Urlaub genommen, U.gepl. = Urlaub geplant, U.Rest = Urlaub verbleibend', 14, finalY);

  // Download
  doc.save(`Team-Uebersicht_${format(data.referenceDate, 'yyyy-MM-dd')}.pdf`);
}

export function generateBalanceReportPDF(data: BalanceReportData): void {
  const doc = new jsPDF();
  const cutoffDateStr = format(data.cutoffDate, 'dd.MM.yyyy', { locale: de });
  const year = data.cutoffDate.getFullYear();

  // Header mit Logo
  try {
    doc.addImage(MASITCON_LOGO_BASE64, 'PNG', 14, 10, 50, 14);
  } catch (e) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 39, 87);
    doc.text('masitcon', 14, 18);
  }

  // Titel rechts vom Logo
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('Stundensaldo zum Stichtag', 196, 15, { align: 'right' });
  
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text(`Stichtag: ${cutoffDateStr}`, 196, 23, { align: 'right' });

  // Meta-Informationen
  doc.setFontSize(10);
  doc.text(`Erstellt am: ${format(new Date(), 'dd.MM.yyyy HH:mm', { locale: de })}`, 14, 35);
  doc.text(`Berechnungszeitraum: 01.01.${year} bis ${cutoffDateStr}`, 14, 41);

  // Helper für Stunden-Formatierung
  const formatHours = (hours: number, includeSign = true): string => {
    if (hours === 0) return '0h';
    const h = Math.floor(Math.abs(hours));
    const m = Math.round((Math.abs(hours) - h) * 60);
    const sign = includeSign ? (hours < 0 ? '-' : hours > 0 ? '+' : '') : '';
    if (m === 0) return `${sign}${h}h`;
    return `${sign}${h}h ${m}min`;
  };

  // Tabellen-Daten
  const activeEmployees = data.employees.filter(e => !e.isExempt);
  const tableData = data.employees.map(emp => [
    emp.name,
    emp.employeeNumber || '-',
    emp.isExempt ? '–' : formatHours(emp.targetHours, false),
    emp.isExempt ? '–' : formatHours(emp.actualHours, false),
    emp.isExempt ? '–' : (emp.corrections !== 0 ? formatHours(emp.corrections) : '–'),
    emp.isExempt ? '–' : formatHours(emp.balance)
  ]);

  // Summen berechnen
  const totals = activeEmployees.reduce(
    (acc, emp) => ({
      targetHours: acc.targetHours + emp.targetHours,
      actualHours: acc.actualHours + emp.actualHours,
      corrections: acc.corrections + emp.corrections,
      balance: acc.balance + emp.balance,
    }),
    { targetHours: 0, actualHours: 0, corrections: 0, balance: 0 }
  );

  autoTable(doc, {
    startY: 48,
    head: [['Mitarbeiter', 'P.Nr.', 'SOLL', 'IST', 'Korr.', 'SALDO']],
    body: tableData,
    foot: [[
      `GESAMT (${activeEmployees.length} MA)`,
      '',
      formatHours(totals.targetHours, false),
      formatHours(totals.actualHours, false),
      totals.corrections !== 0 ? formatHours(totals.corrections) : '–',
      formatHours(totals.balance)
    ]],
    theme: 'striped',
    headStyles: { fillColor: [16, 39, 87] },
    footStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0], fontStyle: 'bold' },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 28, halign: 'right' },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 25, halign: 'right' },
      5: { cellWidth: 30, halign: 'right', fontStyle: 'bold' }
    }
  });

  // Legende
  const legendY = doc.lastAutoTable.finalY + 12;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Legende:', 14, legendY);
  doc.setFontSize(8);
  doc.text('SOLL = Geplante Arbeitsstunden (ohne Feiertage, Wochenenden, Abwesenheiten)  |  IST = Erfasste Arbeitsstunden  |  Korr. = Manuelle Korrekturen', 14, legendY + 5);
  doc.text('– = Zeiterfassungsbefreit oder keine Korrekturen', 14, legendY + 10);

  // Download
  doc.save(`Stundensaldo_${format(data.cutoffDate, 'yyyy-MM-dd')}.pdf`);
}
