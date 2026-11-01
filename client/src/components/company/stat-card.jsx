import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/utils/cn';

const tones = {
  brand: 'text-brand-600 dark:text-brand-300 bg-brand-500/12',
  success: 'text-success bg-success/12',
  warning: 'text-warning bg-warning/15',
  destructive: 'text-destructive bg-destructive/12',
  info: 'text-brand-600 dark:text-brand-300 bg-brand-500/12',
  muted: 'text-muted-foreground bg-muted',
};

/** KPI tile shared by the Phase 6/7 dashboards. */
export function StatCard({ label, value, hint, icon: Icon, tone = 'brand', loading, className }) {
  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {Icon && (
            <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', tones[tone])}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
        </div>
        {loading ? (
          <Skeleton className="mt-3 h-8 w-24" />
        ) : (
          <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
        )}
        {hint && !loading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default StatCard;
