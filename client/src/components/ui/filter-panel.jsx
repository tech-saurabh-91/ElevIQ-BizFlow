import { Children, Fragment, isValidElement, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useIsPhone } from '@/hooks/useMediaQuery';
import { cn } from '@/utils/cn';

/**
 * A list page's filter controls.
 *  - Wider screens: the controls sit inline next to the search box.
 *  - Phones: a "Filters" button (with the active count) next to the search
 *    box opens a bottom sheet with the same controls stacked full width.
 * Controls are rendered once, so they keep working from the URL as before.
 *
 * In the sheet each control is titled from `labels[i]`, else from its
 * aria-label ("Filter by status" -> "Status").
 */
const flatten = (nodes) =>
  Children.toArray(nodes).flatMap((n) =>
    isValidElement(n) && n.type === Fragment ? flatten(n.props.children) : [n]
  );
const titleOf = (el) => {
  const a = isValidElement(el) ? el.props['aria-label'] : '';
  if (!a) return '';
  const t = a.replace(/^filter by\s+/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function FilterPanel({ children, active = 0, onReset, labels = [], className }) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);

  if (!phone) {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        {children}
        {active > 0 && onReset && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            Reset
          </Button>
        )}
      </div>
    );
  }

  const items = flatten(children).filter(Boolean);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="relative h-10 shrink-0 px-3"
        onClick={() => setOpen(true)}
        aria-label={`Filters${active ? ` (${active} on)` : ''}`}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filters
        {active > 0 && (
          <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {active}
          </span>
        )}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        footer={
          <div className="flex w-full gap-2">
            {onReset && (
              <Button
                variant="outline"
                className="flex-1"
                disabled={!active}
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
              >
                Clear all
              </Button>
            )}
            <Button className="flex-1" onClick={() => setOpen(false)}>
              Show results
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pb-1">
          {items.map((child, i) => (
            <div key={i} className="space-y-1.5 [&>*]:!w-full [&_input]:!w-full [&_select]:!w-full">
              {(labels[i] || titleOf(child)) && (
                <p className="text-xs font-medium text-muted-foreground">{labels[i] || titleOf(child)}</p>
              )}
              {child}
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}

/** Classes for the search + filters card: plain on phones, a card from `sm`. */
export const FILTER_CARD = 'max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none';
export const FILTER_ROW =
  'flex items-center gap-2 max-sm:p-0 sm:flex-col sm:items-stretch sm:gap-3 sm:py-4 lg:flex-row lg:items-center';

export default FilterPanel;
