import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Server-side pagination control. Reads `meta = { page, limit, total, pages }`.
 */
export function Pagination({ meta, onPageChange, onLimitChange, limits = [10, 20, 50, 100], className }) {
  const page = Number(meta?.page || 1);
  const pages = Number(meta?.pages || 1);
  const total = Number(meta?.total || 0);
  const limit = Number(meta?.limit || 20);

  if (total === 0) return null;

  const go = (p) => {
    const next = Math.min(Math.max(1, p), pages);
    if (next !== page) onPageChange?.(next);
  };

  // Compact page window: first, last, current ± 1.
  const nums = [];
  for (let p = 1; p <= pages; p += 1) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className={cn('flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row', className)}>
      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span>
      </p>

      <div className="flex items-center gap-2">
        {onLimitChange && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Per page
            <select
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-ring"
            >
              {limits.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-1">
          <PageBtn onClick={() => go(1)} disabled={page === 1} label="First page">
            <ChevronsLeft className="h-4 w-4" />
          </PageBtn>
          <PageBtn onClick={() => go(page - 1)} disabled={page === 1} label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </PageBtn>

          {nums.map((n, i) =>
            n === '…' ? (
              <span key={`e${i}`} className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => go(n)}
                aria-current={n === page ? 'page' : undefined}
                className={cn(
                  'h-8 min-w-8 rounded-md px-2 text-xs font-medium focus-ring',
                  n === page ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                )}
              >
                {n}
              </button>
            )
          )}

          <PageBtn onClick={() => go(page + 1)} disabled={page === pages} label="Next page">
            <ChevronRight className="h-4 w-4" />
          </PageBtn>
          <PageBtn onClick={() => go(pages)} disabled={page === pages} label="Last page">
            <ChevronsRight className="h-4 w-4" />
          </PageBtn>
        </div>
      </div>
    </div>
  );
}

const PageBtn = ({ children, disabled, onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input text-foreground hover:bg-accent focus-ring disabled:pointer-events-none disabled:opacity-40"
  >
    {children}
  </button>
);

export default Pagination;
