import { Card } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

interface ChartData {
  month: string;
  target: number;
  actual: number;
  balance: number;
}

interface HoursComparisonChartProps {
  data: ChartData[];
}

export const HoursComparisonChart = ({ data }: HoursComparisonChartProps) => {
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const target = payload[0].value;
      const actual = payload[1].value;
      const balance = actual - target;
      
      return (
        <div className="bg-card border border-border rounded-lg shadow-lg p-3">
          <p className="font-semibold text-sm mb-2">{label}</p>
          <div className="space-y-1 text-xs">
            <p className="text-primary">SOLL: {target.toFixed(1)}h</p>
            <p className="text-emerald-600 dark:text-emerald-400">IST: {actual.toFixed(1)}h</p>
            <p className={balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
              SALDO: {balance >= 0 ? '+' : ''}{balance.toFixed(1)}h
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="p-3 sm:p-6 overflow-hidden">
      <h3 className="text-base sm:text-lg font-semibold mb-4">Stundenentwicklung</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis 
            dataKey="month" 
            className="text-xs text-muted-foreground"
            tick={{ fontSize: 10 }}
          />
          <YAxis 
            className="text-xs text-muted-foreground"
            label={{ value: 'Stunden', angle: -90, position: 'insideLeft', className: 'text-xs' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ fontSize: '12px' }}
            formatter={(value) => {
              if (value === 'target') return 'SOLL';
              if (value === 'actual') return 'IST';
              return value;
            }}
          />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
          <Bar 
            dataKey="target" 
            fill="hsl(var(--primary))" 
            radius={[4, 4, 0, 0]}
            opacity={0.6}
          />
          <Bar 
            dataKey="actual" 
            fill="hsl(142 76% 36%)" 
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
};
