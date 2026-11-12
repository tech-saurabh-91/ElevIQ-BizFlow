import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/utils/cn';

/**
 * KPI tile used by every list page and dashboard: a colour-gradient tile
 * (matching the home dashboard) with white text. Phones get a compact tile,
 * two per row, like a mobile app.
 */
const tones = {
  brand: 'from-blue-600 to-indigo-500',
  success: 'from-emerald-600 to-teal-500',
  warning: 'from-amber-500 to-orange-500',
  destructive: 'from-rose-600 to-pink-500',
  info: 'from-sky-600 to-cyan-500',
  violet: 'from-violet-600 to-fuchsia-500',
  muted: 'from-slate-600 to-slate-500',
};

export function StatCard({ label, value, hint, icon: Icon, tone = 'brand', loading, className }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl bg-gradient-to-br p-3.5 text-white shadow-md sm:p-5',
        tones[tone] || tones.brand,
        className
      )}
    >
      <span className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/10" aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 text-[11px] font-medium uppercase leading-snug tracking-wide text-white/85 sm:text-xs">{label}</p>
        {Icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white/20 sm:h-8 sm:w-8">
            <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="relative mt-2.5 h-6 w-20 bg-white/25 sm:mt-3 sm:h-8 sm:w-24" />
      ) : (
        <p className="relative mt-1.5 text-lg font-bold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere] sm:mt-2 sm:text-2xl">
          {value}
        </p>
      )}
      {hint && !loading && (
        <p className="relative mt-1 line-clamp-2 text-[11px] leading-snug text-white/85 sm:text-xs">{hint}</p>
      )}
    </div>
  );
}

/** Grid for a row of StatCards: two per row on phones, four on wide screens. */
export const STAT_GRID = 'grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4';

export default StatCard;
