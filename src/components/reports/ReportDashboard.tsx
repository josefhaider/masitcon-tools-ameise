"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, ClipboardList, Scale } from 'lucide-react';

interface ReportDashboardProps {
  onNavigate: (view: string) => void;
}

export default function ReportDashboard({ onNavigate }: ReportDashboardProps) {
  const reports = [
    {
      id: 'sick-leave-report',
      title: 'Krankmeldungsreport',
      description: 'PDF-Report für die Steuerberaterin zur Erstattung durch die Krankenkasse.',
      icon: FileText,
      color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
    },
    {
      id: 'hours-report',
      title: 'Stundennachweis',
      description: 'Monatliche Stundenübersicht als PDF für jeden Mitarbeiter.',
      icon: ClipboardList,
      color: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
    },
    {
      id: 'balance-report',
      title: 'Stundensaldo zum Stichtag',
      description: 'Kumuliertes Stundensaldo aller Mitarbeiter zum gewählten Stichtag.',
      icon: Scale,
      color: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Reports</h2>
        <p className="text-muted-foreground">Erstellen Sie Berichte und verwalten Sie Dokumentation.</p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reports.map((report) => (
          <Card key={report.id} className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => onNavigate(report.id)}>
            <CardHeader>
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-3 ${report.color}`}>
                <report.icon className="h-6 w-6" />
              </div>
              <CardTitle className="text-lg">{report.title}</CardTitle>
              <CardDescription>{report.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" onClick={(e) => { e.stopPropagation(); onNavigate(report.id); }}>
                Öffnen
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
