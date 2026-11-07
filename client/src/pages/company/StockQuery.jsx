import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Search } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/misc';
import { ErrorAlert } from '@/components/ui/alert';
import { formatNumber } from '@/utils/format';
import { sellsVia } from '@/utils/salesType';
import { cn } from '@/utils/cn';

/**
 * Stock query: free quantity of each product in the warehouses the user may
 * see - a salesman's own van and the godown it loads from; inventory staff
 * and managers see every warehouse. (Godown figures leave out units held for
 * confirmed orders.)
 */
export default function StockQuery() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'stock-query', search],
    queryFn: async () => (await api.get('/v1/vans/stock-query', { params: { q: search || undefined } })).data?.data ?? null,
    placeholderData: keepPreviousData,
  });
  const warehouses = data?.warehouses || [];
  const rows = (data?.rows || []).filter((r) => !onlyInStock || r.total > 0);
  const vanSeller = user?.role === 'SALESMAN' && sellsVia(user, 'VAN_SALE');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock query"
        description="Free quantity of each product, warehouse by warehouse."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Stock query' }]}
        actions={
          vanSeller ? (
            <Button variant="outline" onClick={() => navigate('/app/stock-requests')}>
              <ClipboardList className="h-4 w-4" /> Request van stock
            </Button>
          ) : null
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product or SKU…" className="h-9 pl-8" aria-label="Search products" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
            In stock only
          </label>
          <span className="text-xs text-muted-foreground sm:ml-auto">
            {rows.length} product{rows.length === 1 ? '' : 's'}
          </span>
        </div>

        {isLoading ? (
          <LoadingState label="Loading stock…" />
        ) : isError ? (
          <div className="p-4">
            <ErrorAlert title="Could not load stock" message={apiError(error).message} />
          </div>
        ) : !warehouses.length ? (
          <EmptyState title="No warehouse to show" description="No van is assigned to you and no godown is set up yet." />
        ) : !rows.length ? (
          <EmptyState icon="package" title="No products found" description="Try a different search." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  {warehouses.map((w) => (
                    <th key={w.id} className="px-3 py-2 text-right font-medium">
                      <span className="inline-flex items-center gap-1">
                        {w.code || w.name}
                        {w.type === 'VAN' && <Badge tone="info">Van</Badge>}
                      </span>
                    </th>
                  ))}
                  {warehouses.length > 1 && <th className="px-3 py-2 text-right font-medium">Total</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.product} className="border-t">
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.sku || '—'} · {r.unit}
                      </p>
                    </td>
                    {warehouses.map((w) => {
                      const qty = Number(r.qty?.[w.id] || 0);
                      return (
                        <td key={w.id} className={cn('px-3 py-2 text-right tabular-nums', qty <= 0 && 'text-muted-foreground')}>
                          {formatNumber(qty)}
                        </td>
                      );
                    })}
                    {warehouses.length > 1 && <td className="px-3 py-2 text-right font-medium tabular-nums">{formatNumber(r.total)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
