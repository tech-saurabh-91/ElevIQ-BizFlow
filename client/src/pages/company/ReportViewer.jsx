import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, Info, Printer, RefreshCw } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableFooter } from '@/components/ui/table';
import { useLookups } from '@/hooks/useLookups';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * One report from the hub: its filters (as the server's registry declares
 * them), the table with totals, and Excel export / print.
 */

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const PRESETS = [
  ['This month', () => [firstOfMonth(), todayKey()]],
  [
    'Last month',
    () => {
      const d = new Date();
      const s = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const e = new Date(d.getFullYear(), d.getMonth(), 0);
      const k = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      return [k(s), k(e)];
    },
  ],
];

/** Financial-year presets for the company's year start (April in India). */
const fyPresets = (startMonth = 4) => {
  const d = new Date();
  const m = Number(startMonth) || 4;
  const y = d.getMonth() + 1 >= m ? d.getFullYear() : d.getFullYear() - 1;
  const mm = String(m).padStart(2, '0');
  const lastDay = (year) => {
    const end = new Date(year + 1, m - 1, 0);
    return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  };
  const label = (year) => (m === 1 ? `FY ${year}` : `FY ${year}-${String(year + 1).slice(-2)}`);
  return [
    [`This FY (${label(y)})`, () => [`${y}-${mm}-01`, todayKey()]],
    [`Last FY (${label(y - 1)})`, () => [`${y - 1}-${mm}-01`, lastDay(y - 1)]],
  ];
};

export default function ReportViewer() {
  const { code } = useParams();
  const { company } = useAuth();
  const { lookups } = useLookups();
  const [params, setParams] = useSearchParams();
  const money = (v) => formatMoney(v || 0, company?.currency);
  const [downloading, setDownloading] = useState(false);

  const { data: catalog } = useQuery({
    queryKey: ['company', 'reports-hub', 'catalog'],
    queryFn: async () => (await api.get('/v1/reports/hub/catalog')).data?.data,
  });
  const meta = catalog?.reports?.find((r) => r.code === code);
  const filters = meta?.filters || [];

  const query = useMemo(() => {
    const q = Object.fromEntries(params.entries());
    if (filters.includes('dateRange')) {
      q.from = q.from || firstOfMonth();
      q.to = q.to || todayKey();
    }
    return q;
  }, [params, filters]);
  const set = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === '' || v == null ? next.delete(k) : next.set(k, String(v))));
    setParams(next, { replace: true });
  };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['company', 'reports-hub', 'run', code, query],
    queryFn: async () => (await api.get(`/v1/reports/hub/run/${code}`, { params: query })).data?.data,
    enabled: Boolean(meta),
    keepPreviousData: true,
    retry: false,
  });

  const exportXlsx = async () => {
    setDownloading(true);
    try {
      const res = await api.get(`/v1/reports/hub/run/${code}/export`, { params: query, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${code}-${todayKey()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      setDownloading(false);
    }
  };

  const cell = (c, v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (c.type === 'money') return money(v);
    if (c.type === 'number') return formatNumber(v);
    if (c.type === 'percent') return `${formatNumber(v)}%`;
    if (c.type === 'date') return formatDate(v);
    return v;
  };
  const numeric = (c) => ['money', 'number', 'percent'].includes(c.type);
  const columns = data?.columns || [];
  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const hasTotals = Object.keys(totals).length > 0 && rows.length > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={meta?.title || data?.title || 'Report'}
        description={meta?.description}
        breadcrumbs={[{ label: 'Reports', to: '/app/reports' }, { label: meta?.title || 'Report' }]}
        actions={
          <>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh" title="Refresh">
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
            <Button variant="outline" onClick={() => window.print()} className="max-sm:hidden">
              <Printer className="h-4 w-4" /> Print
            </Button>
            {catalog?.canExport && (
              <Button onClick={exportXlsx} loading={downloading} disabled={!rows.length}>
                <Download className="h-4 w-4" /> Excel
              </Button>
            )}
          </>
        }
      />

      {filters.length > 0 && (
        <Card className="print:hidden">
          <CardContent className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-3 lg:grid-cols-6">
            {filters.includes('dateRange') && (
              <>
                <Field label="From">
                  <Input type="date" value={query.from} max={query.to} onChange={(e) => set({ from: e.target.value })} />
                </Field>
                <Field label="To">
                  <Input type="date" value={query.to} min={query.from} onChange={(e) => set({ to: e.target.value })} />
                </Field>
                <div className="col-span-2 flex flex-wrap items-end gap-1.5 sm:col-span-1 lg:col-span-1">
                  {[...PRESETS, ...fyPresets(company?.financialYearStartMonth)].map(([label, fn]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        const [from, to] = fn();
                        set({ from, to });
                      }}
                      className="h-9 rounded-lg border px-2.5 text-xs font-medium hover:bg-accent focus-ring"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {filters.includes('groupBy') && meta?.groupBy && (
              <Field label="Group by">
                <Select value={query.groupBy || meta.groupBy[0][0]} onChange={(e) => set({ groupBy: e.target.value })}>
                  {meta.groupBy.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {filters.includes('customer') && <LookupFilter label="Customer" value={query.customer} onChange={(v) => set({ customer: v })} options={lookups.customers} />}
            {filters.includes('supplier') && <LookupFilter label="Supplier" value={query.supplier} onChange={(v) => set({ supplier: v })} options={lookups.suppliers} />}
            {filters.includes('product') && <LookupFilter label="Product" value={query.product} onChange={(v) => set({ product: v })} options={lookups.products} />}
            {filters.includes('salesman') && (
              <LookupFilter
                label="Salesman"
                value={query.salesman}
                onChange={(v) => set({ salesman: v })}
                options={(lookups.users || []).filter((u) => ['SALESMAN', 'MANAGER'].includes(u.role))}
              />
            )}
            {filters.includes('warehouse') && <LookupFilter label="Warehouse" value={query.warehouse} onChange={(v) => set({ warehouse: v })} options={lookups.warehouses} />}
            {filters.includes('status') && meta?.statuses && (
              <Field label="Status">
                <Select value={query.status || ''} onChange={(e) => set({ status: e.target.value })}>
                  {meta.statuses.map(([v, l]) => (
                    <option key={v || 'all'} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {filters.includes('days') && (
              <Field label="Not sold for (days)">
                <Input type="number" min="1" value={query.days || '60'} onChange={(e) => set({ days: e.target.value })} />
              </Field>
            )}
            {filters.includes('includeZero') && (
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={query.includeZero === 'true'} onChange={(e) => set({ includeZero: e.target.checked ? 'true' : '' })} />
                Include zero / inactive
              </label>
            )}
          </CardContent>
        </Card>
      )}

      {data?.note && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {data.note}
        </p>
      )}

      <Card className={cn('transition-opacity', isFetching && 'opacity-70')}>
        {!meta && catalog ? (
          <EmptyState icon="error" title="Report not available" description="It does not exist or your role cannot open it." />
        ) : isLoading || !meta ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState icon="error" title="Could not run the report" description={apiError(error).message} />
        ) : !rows.length ? (
          <EmptyState icon="empty" title="Nothing for these filters" description="Try another date range or filter." />
        ) : (
          <Table cards className="text-[13px]">
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.key} className={cn('whitespace-nowrap', numeric(c) && 'text-right')}>
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  {columns.map((c, j) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        'py-2',
                        numeric(c) && 'text-right tabular-nums',
                        j === 0 && 'font-medium',
                        c.type === 'money' && Number(r[c.key]) < 0 && 'text-destructive'
                      )}
                    >
                      {cell(c, r[c.key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
            {hasTotals && (
              <TableFooter>
                <TableRow>
                  {columns.map((c, j) => (
                    <TableCell key={c.key} className={cn('py-2 font-semibold', numeric(c) && 'text-right tabular-nums')}>
                      {j === 0 ? `Total (${rows.length})` : totals[c.key] !== undefined ? cell(c, totals[c.key]) : ''}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        )}
      </Card>
      {data?.truncated && <p className="text-xs text-warning">Showing the first 5,000 rows - narrow the filters or export to Excel for everything.</p>}
    </div>
  );
}

function LookupFilter({ label, value, onChange, options = [] }) {
  return (
    <Field label={label}>
      <Select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
