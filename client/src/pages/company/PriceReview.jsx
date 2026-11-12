import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCheck, RefreshCw, Save, Settings, TrendingUp, Wand2 } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/alert';
import { marginOf } from '@/components/company/cost-margin';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/utils/cn';
import { formatDate, formatMoney } from '@/utils/format';

/**
 * Price review: after purchases move a product's average cost (or when it
 * sells below cost), its selling price is listed here with the margin it now
 * gives and the price the default markup suggests. Edit, accept suggestions,
 * then save - saved rows drop off the list until the cost moves again.
 */
export default function PriceReview() {
  const { company } = useAuth();
  const queryClient = useQueryClient();
  const money = (v) => formatMoney(v, company?.currency);
  const [showAll, setShowAll] = useState(false);
  const [prices, setPrices] = useState({}); // id -> typed selling price (string)
  const [error, setError] = useState(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['company', 'price-review', showAll],
    queryFn: async () => (await api.get('/v1/products/price-review', { params: showAll ? { all: 'true' } : {} })).data,
  });
  const rows = data?.data || [];
  const markup = Number(data?.meta?.markupPercent || 0);

  useEffect(() => setPrices({}), [showAll]);

  const priceOf = (r) => (prices[r.id] !== undefined ? prices[r.id] : String(r.sellingPrice || ''));
  const changed = useMemo(
    () => rows.filter((r) => prices[r.id] !== undefined && Number(prices[r.id]) !== Number(r.sellingPrice)),
    [rows, prices]
  );

  const save = useMutation({
    mutationFn: (items) => api.post('/v1/products/price-review', { items }),
    onSuccess: (res) => {
      toast.success(res.data?.message || 'Prices saved');
      setPrices({});
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['company', 'price-review'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'products'] });
    },
    onError: (err) => setError(apiError(err)),
  });

  const saveAll = () =>
    save.mutate(rows.map((r) => (prices[r.id] !== undefined ? { id: r.id, sellingPrice: Number(prices[r.id]) } : { id: r.id })));
  const useAllSuggested = () =>
    setPrices((p) => {
      const next = { ...p };
      rows.forEach((r) => {
        if (r.suggestedPrice > 0) next[r.id] = String(r.suggestedPrice);
      });
      return next;
    });

  const belowCount = rows.filter((r) => r.belowCost).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Price Review"
        description="Selling prices to check after purchases changed the cost. Saved rows leave the list until the cost moves again."
        breadcrumbs={[{ label: 'Masters', to: '/app/products' }, { label: 'Price Review' }]}
        actions={
          <>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh" title="Refresh">
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
            {markup > 0 && rows.some((r) => r.suggestedPrice > 0) && (
              <Button variant="outline" onClick={useAllSuggested}>
                <Wand2 className="h-4 w-4" /> Use all suggested
              </Button>
            )}
            <Button onClick={saveAll} disabled={!rows.length || save.isPending} loading={save.isPending}>
              {changed.length ? <Save className="h-4 w-4" /> : <CheckCheck className="h-4 w-4" />}
              {changed.length ? `Save ${changed.length} price${changed.length === 1 ? '' : 's'}` : 'Mark all reviewed'}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex rounded-xl bg-muted p-1">
          {[
            { v: false, label: 'Needs review' },
            { v: true, label: 'All products' },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setShowAll(t.v)}
              className={cn(
                'rounded-lg px-3 py-1.5 font-medium transition-colors focus-ring',
                showAll === t.v ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground">
          {markup > 0 ? (
            <>Suggested price = cost + {markup}% (capped at MRP).</>
          ) : (
            <>
              No default markup set -{' '}
              <Link to="/app/settings" className="inline-flex items-center gap-1 text-primary hover:underline">
                <Settings className="h-3.5 w-3.5" /> set one
              </Link>{' '}
              to get suggested prices.
            </>
          )}
        </span>
        {belowCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" /> {belowCount} below cost
          </span>
        )}
      </div>

      {error && <ErrorAlert title="Could not save prices" message={error.message} errors={error.errors} onClose={() => setError(null)} />}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : !rows.length ? (
        <EmptyState
          icon="empty"
          title={showAll ? 'No products yet' : 'All prices are up to date'}
          description={showAll ? 'Add products to review their prices.' : 'When a purchase changes a product’s cost, it shows up here.'}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {/* Column heads (sm and up). */}
          <div className="hidden grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_minmax(0,1.3fr)] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Product</span>
            <span className="text-right">Avg cost</span>
            <span className="text-right">MRP</span>
            <span className="text-right">Margin</span>
            <span className="text-right">Suggested</span>
            <span className="text-right">Selling price</span>
          </div>
          <ul className="divide-y">
            {rows.map((r) => {
              const typed = priceOf(r);
              const cost = r.avgCost || r.purchasePrice;
              const margin = marginOf(Number(typed), cost);
              const below = Number(typed) > 0 && cost > 0 && Number(typed) < cost;
              const overMrp = r.mrp > 0 && Number(typed) > r.mrp;
              const dirty = prices[r.id] !== undefined && Number(prices[r.id]) !== Number(r.sellingPrice);
              return (
                <li
                  key={r.id}
                  className={cn(
                    'grid grid-cols-2 items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_minmax(0,1.3fr)]',
                    dirty && 'bg-primary/[0.04]'
                  )}
                >
                  <div className="col-span-2 min-w-0 sm:col-span-1">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {r.sku} · per {r.unit}
                      {r.costChanged && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 font-medium text-amber-700 dark:text-amber-400">
                          Cost changed{r.costChangedAt ? ` ${formatDate(r.costChangedAt)}` : ''}
                        </span>
                      )}
                      {r.belowCost && (
                        <span className="rounded-full bg-red-500/12 px-1.5 font-medium text-red-600 dark:text-red-400">Below cost</span>
                      )}
                    </p>
                  </div>
                  <Cell label="Avg cost">{cost ? money(cost) : '—'}</Cell>
                  <Cell label="MRP">{r.mrp ? money(r.mrp) : '—'}</Cell>
                  <Cell label="Margin">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 font-semibold',
                        margin == null ? 'text-muted-foreground' : below ? 'text-destructive' : margin < 5 ? 'text-warning' : 'text-success'
                      )}
                    >
                      {margin != null && <TrendingUp className="h-3.5 w-3.5" />}
                      {margin == null ? '—' : `${margin}%`}
                    </span>
                  </Cell>
                  <Cell label="Suggested">
                    {r.suggestedPrice > 0 ? (
                      <button
                        type="button"
                        onClick={() => setPrices((p) => ({ ...p, [r.id]: String(r.suggestedPrice) }))}
                        className="rounded font-medium text-primary hover:underline focus-ring"
                        title="Use this price"
                      >
                        {money(r.suggestedPrice)}
                      </button>
                    ) : (
                      '—'
                    )}
                  </Cell>
                  <div className="col-span-2 sm:col-span-1">
                    <Input
                      inputMode="decimal"
                      value={typed}
                      onChange={(e) => setPrices((p) => ({ ...p, [r.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                      aria-label={`Selling price of ${r.name}`}
                      error={overMrp}
                      className="h-9 text-right tabular-nums"
                    />
                    {overMrp && <p className="mt-0.5 text-right text-[11px] text-destructive">Above MRP</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A value with its label shown on phones (the column heads show from sm up). */
function Cell({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm tabular-nums sm:block sm:text-right">
      <span className="text-xs text-muted-foreground sm:hidden">{label}</span>
      <span>{children}</span>
    </div>
  );
}
