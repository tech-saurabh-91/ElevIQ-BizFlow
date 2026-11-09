import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { cn } from '@/utils/cn';

const tones = {
  brand: { icon: 'text-brand-600 dark:text-brand-300 bg-brand-500/12', bar: 'bg-brand-500' },
  success: { icon: 'text-success bg-success/12', bar: 'bg-success' },
  warning: { icon: 'text-warning bg-warning/15', bar: 'bg-warning' },
  destructive: { icon: 'text-destructive bg-destructive/12', bar: 'bg-destructive' },
  info: { icon: 'text-brand-600 dark:text-brand-300 bg-brand-500/12', bar: 'bg-brand-400' },
  muted: { icon: 'text-muted-foreground bg-muted', bar: 'bg-muted-foreground/40' },
};

/**
 * KPI tile used by every list page and dashboard.
 * Phones get a compact tile (two per row, like a mobile app); a thin colour
 * strip on top tells the tones apart at a glance.
 */
export function StatCard({ label, value, hint, icon: Icon, tone = 'brand', loading, className }) {
  const t = tones[tone] || tones.brand;
  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <span className={cn('absolute inset-x-0 top-0 h-0.5 opacity-80', t.bar)} aria-hidden="true" />
      <div className="p-3.5 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-[11px] font-medium uppercase leading-snug tracking-wide text-muted-foreground sm:text-xs">
            {label}
          </p>
          {Icon && (
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:h-8 sm:w-8', t.icon)}>
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            </span>
          )}
        </div>
        {loading ? (
          <Skeleton className="mt-2.5 h-6 w-20 sm:mt-3 sm:h-8 sm:w-24" />
        ) : (
          <p className="mt-1.5 text-lg font-bold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere] sm:mt-2 sm:text-2xl">
            {value}
          </p>
        )}
        {hint && !loading && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground sm:text-xs">{hint}</p>
        )}
      </div>
    </Card>
  );
}

/** Grid for a row of StatCards: two per row on phones, four on wide screens. */
export const STAT_GRID = 'grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4';

export default StatCard;
