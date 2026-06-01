"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Wrench, Bug, Cog } from "lucide-react";
import type { ChangeEntry, ChangelogEntry } from "@/lib/changelog";

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
    case "technical":
      return (
        <Badge className="bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20 hover:bg-slate-500/20">
          <Cog className="h-3 w-3 mr-1" />
          Technik
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

export default function Changelog({ entries }: { entries: ChangelogEntry[] }) {
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
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Aktuell sind keine Einträge verfügbar.
            </p>
          )}
          {entries.map((entry) => (
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
