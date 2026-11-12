import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * A page made of sections, shown as cards instead of tabs: the landing view
 * is a grid of cards (icon, title, one line), picking one opens that section
 * with a "back to all" link. Used by Inventory and Company Settings.
 */
const TINTS = [
  'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  'bg-rose-500/15 text-rose-600 dark:text-rose-400',
];

export function SectionCards({ items, onPick, className }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}>
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onPick(item.value)}
            className="group flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-ring"
          >
            {Icon && (
              <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', TINTS[i % TINTS.length])}>
                <Icon className="h-5 w-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{item.label}</span>
              {item.description && <span className="line-clamp-2 text-xs text-muted-foreground">{item.description}</span>}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button>
        );
      })}
    </div>
  );
}

/** The bar above an open section: back to the cards, and the section's name. */
export function SectionBar({ backLabel, onBack, item, children }) {
  const Icon = item?.icon;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-0.5 rounded-md py-1 pr-2 text-sm font-medium text-primary hover:underline focus-ring"
      >
        <ChevronLeft className="h-4 w-4" /> {backLabel}
      </button>
      <span className="text-muted-foreground">/</span>
      <span className="inline-flex items-center gap-1.5 font-semibold">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        {item?.label}
      </span>
      {children}
    </div>
  );
}

export default SectionCards;
