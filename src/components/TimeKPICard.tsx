"use client";

import { Card } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimeKPICardProps {
  label: string;
  value: number;
  unit?: string;
  icon: LucideIcon;
  variant?: 'default' | 'success' | 'warning';
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
}

// Formatiert Dezimalstunden als "Xh Ymin" (Minuten nur wenn > 0)
const formatHoursMinutes = (decimalHours: number): string => {
  const isNegative = decimalHours < 0;
  const absHours = Math.abs(decimalHours);
  const hours = Math.floor(absHours);
  const minutes = Math.round((absHours - hours) * 60);
  const sign = isNegative ? '-' : '';
  if (minutes === 0) {
    return `${sign}${hours}h`;
  }
  return `${sign}${hours}h ${minutes}min`;
};

export const TimeKPICard = ({
  label,
  value,
  unit = 'h',
  icon: Icon,
  variant = 'default',
  subtitle,
  trend = 'neutral'
}: TimeKPICardProps) => {
  const variantStyles = {
    default: 'bg-card hover:bg-accent/50',
    success: 'bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/30',
    warning: 'bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/30'
  };

  const iconStyles = {
    default: 'bg-primary text-primary-foreground',
    success: 'bg-emerald-500 text-white',
    warning: 'bg-amber-500 text-white'
  };

  const valueStyles = {
    default: 'text-foreground',
    success: 'text-emerald-700 dark:text-emerald-400',
    warning: 'text-amber-700 dark:text-amber-400'
  };

  return (
    <Card className={cn(
      'p-4 sm:p-6 transition-all duration-300 border-2 overflow-hidden',
      variantStyles[variant]
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {label}
          </p>
          <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap">
            <span className={cn(
              'text-2xl sm:text-4xl font-bold tracking-tight',
              valueStyles[variant]
            )}>
              {formatHoursMinutes(value)}
            </span>
          </div>
          {subtitle && (
            <p className="text-xs sm:text-sm text-muted-foreground mt-2">
              {subtitle}
            </p>
          )}
        </div>
        <div className={cn(
          'rounded-full p-2 sm:p-3 shrink-0',
          iconStyles[variant]
        )}>
          <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
      </div>
    </Card>
  );
};
