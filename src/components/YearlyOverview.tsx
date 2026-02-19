import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowRight } from 'lucide-react';

interface MonthData {
  month: number;
  monthName: string;
  target: number;
  actual: number;
  balance: number;
}

interface YearlyOverviewProps {
  data: MonthData[];
  year: number;
  onMonthClick: (month: number) => void;
}

export const YearlyOverview = ({ data, year, onMonthClick }: YearlyOverviewProps) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Berechne Jahressumme
  const yearTotal = data.reduce(
    (acc, m) => ({
      target: acc.target + m.target,
      actual: acc.actual + m.actual,
      balance: acc.balance + m.balance,
    }),
    { target: 0, actual: 0, balance: 0 }
  );

  const isFutureMonth = (month: number) => {
    return year > currentYear || (year === currentYear && month > currentMonth);
  };

  return (
    <Card className="p-6">
      <h2 className="text-2xl font-bold mb-6">Jahresübersicht {year}</h2>
      
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Monat</TableHead>
            <TableHead className="text-right">SOLL</TableHead>
            <TableHead className="text-right">IST</TableHead>
            <TableHead className="text-right">SALDO</TableHead>
            <TableHead className="text-right">Aktion</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((monthData) => {
            const isFuture = isFutureMonth(monthData.month);
            const isCurrent = year === currentYear && monthData.month === currentMonth;
            
            return (
              <TableRow
                key={monthData.month}
                className={
                  isFuture
                    ? 'bg-muted/30 text-muted-foreground'
                    : isCurrent
                    ? 'bg-primary/5'
                    : monthData.balance < 0
                    ? 'bg-red-50 dark:bg-red-950/20'
                    : 'bg-green-50 dark:bg-green-950/20'
                }
              >
                <TableCell className="font-medium">
                  {monthData.monthName}
                  {isCurrent && (
                    <span className="ml-2 text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                      Aktuell
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isFuture ? '-' : `${monthData.target.toFixed(1)}h`}
                </TableCell>
                <TableCell className="text-right">
                  {isFuture ? '-' : `${monthData.actual.toFixed(1)}h`}
                </TableCell>
                <TableCell
                  className={`text-right font-semibold ${
                    isFuture
                      ? 'text-muted-foreground'
                      : monthData.balance < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-green-600 dark:text-green-400'
                  }`}
                >
                  {isFuture
                    ? '-'
                    : `${monthData.balance > 0 ? '+' : ''}${monthData.balance.toFixed(1)}h`}
                </TableCell>
                <TableCell className="text-right">
                  {!isFuture && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onMonthClick(monthData.month)}
                      className="h-8"
                    >
                      Details
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow className="font-bold bg-muted/50">
            <TableCell>JAHRES-SUMME</TableCell>
            <TableCell className="text-right">{yearTotal.target.toFixed(1)}h</TableCell>
            <TableCell className="text-right">{yearTotal.actual.toFixed(1)}h</TableCell>
            <TableCell
              className={`text-right ${
                yearTotal.balance < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-green-600 dark:text-green-400'
              }`}
            >
              {yearTotal.balance > 0 ? '+' : ''}
              {yearTotal.balance.toFixed(1)}h
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </Card>
  );
};
