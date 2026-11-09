import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Boxes,
  CalendarCheck,
  Download,
  Footprints,
  IndianRupee,
  Package,
  Percent,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { formatMoney, formatNumber, formatDate, formatShortDate } from '@/utils/format';
import StatCard from '@/components/company/stat-card';
import {
  TrendChart,
  BarList,
  ColumnChart,
  DonutChart,
} from '@/components/company/report-charts';
import { todayInput } from '@/components/company/form-utils';

/**
 * Phase 8 - Reports.
 *
 * Six read-only tabs over the /api/v1/reports aggregations. The date window,
 * granularity and active tab all live in the URL so a report is shareable.
 * Every query is enabled only while its tab is visible, and the Excel export
 * re-runs whichever report is on screen.
 */

const TABS = [
  { value: 'overview', label: 'Overview', icon: BarChart3 },
  { value: 'sales', label: 'Sales', icon: TrendingUp },
  { value: 'receivables', label: 'Receivables', icon: Wallet },
  { value: 'collections', label: 'Collections', icon: Banknote },
  { value: 'inventory', label: 'Inventory', icon: Boxes },
  { value: 'field-force', label: 'Field force', icon: Footprints },
];

/** Tabs that have a matching Excel export type on the server. */
const EXPORT_TYPE = {
  overview: 'sales',
  sales: 'sales',
  receivables: 'receivables',
  collections: 'collections',
  inventory: 'inventory',
  'field-force': 'field-force',
};

const GRANULARITY_LABEL = { day: 'Daily', week: 'Weekly', month: 'Monthly' };

/** Turn a $dateTrunc bucket key into something readable on an axis. */
const periodLabel = (p) => {
  if (!p) return '';
  const s = String(p);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return formatShortDate(`${s}T00:00:00Z`, { day: '2-digit', month: 'short', timeZone: 'UTC' });
  }
  const week = s.match(/-W(\d{1,2})$/);
  if (week) return `W${week[1]}`;
  if (/^\d{4}-\d{2}$/.test(s)) {
    return formatShortDate(`${s}-01T00:00:00Z`, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  return s;
};

/** Re-key a server series onto readable axis labels. */
const labelSeries = (rows = []) =>
  rows.map((r) => ({ ...r, period: periodLabel(r.period) }));

const sumBy = (rows = [], key = 'value') => rows.reduce((s, r) => s + Number(r[key] || 0), 0);

/** Strip UI-only keys (the active tab) before they reach the API. */
const toApiParams = ({ tab: _tab, ...rest }) => rest;

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

function ChartCard({ title, hint, children, className }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function LoadingGrid({ cols = 4 }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}

function ReportError({ error, onRetry }) {
  return (
    <EmptyState
      icon="error"
      title="Could not load this report"
      description={apiError(error).message}
      action={
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function OverviewTab({ params, money }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['company', 'reports', 'overview', params],
    queryFn: async () => (await api.get('/v1/reports/overview', { params: toApiParams(params) })).data?.data,
    enabled: params.tab === 'overview',
    keepPreviousData: true,
  });

  if (isLoading) return <LoadingGrid />;
  if (isError) return <ReportError error={error} onRetry={refetch} />;
  if (!data) return null;

  // Merge the sales + collections series so one chart shows both lines.
  const collectionsByPeriod = new Map(
    (data.collectionsSeries || []).map((c) => [c.period, c.value])
  );
  const trend = labelSeries(
    (data.salesSeries || []).map((s) => ({
      period: s.period,
      value: s.value,
      collected: collectionsByPeriod.get(s.period) ?? 0,
    }))
  );

  const overdue = data.receivables || {};
  const salesDelta = Number(data.sales?.outstanding || 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={IndianRupee}
          label="Sales invoiced"
          value={money(data.sales?.total)}
          hint={`${formatNumber(data.sales?.count || 0)} invoices`}
          tone="brand"
        />
        <StatCard
          icon={Banknote}
          label="Collections"
          value={money(data.collections?.total)}
          hint={`${formatNumber(data.collections?.count || 0)} payments`}
          tone="success"
        />
        <StatCard
          icon={Wallet}
          label="Outstanding"
          value={money(overdue.total)}
          hint={`${formatNumber(overdue.overdueCount || 0)} overdue · ${money(overdue.overdueValue)}`}
          tone={overdue.overdueValue > 0 ? 'warning' : 'muted'}
        />
        <StatCard
          icon={AlertTriangle}
          label="Low stock"
          value={formatNumber(data.inventory?.lowStockCount || 0)}
          hint={`${formatNumber(data.masters?.products || 0)} products · ${formatNumber(
            data.masters?.customers || 0
          )} customers`}
          tone={data.inventory?.lowStockCount > 0 ? 'destructive' : 'muted'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Sales vs collections"
          hint={`Invoiced ${money(data.sales?.total)} · collected ${money(data.collections?.total)} · net outstanding ${money(
            salesDelta
          )}`}
          className="lg:col-span-2"
        >
          <TrendChart
            data={trend}
            valueKey="value"
            secondKey="collected"
            valueLabel="Invoiced"
            secondLabel="Collected"
            formatValue={(v) => money(v)}
            height={280}
          />
        </ChartCard>

        <ChartCard title="Top customers" hint="By invoiced value in this window">
          <BarList
            data={data.topCustomers || []}
            labelKey="name"
            valueKey="value"
            formatValue={(v) => money(v)}
            height={280}
          />
        </ChartCard>
      </div>
    </div>
  );
}

function SalesTab({ params, money }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['company', 'reports', 'sales', params],
    queryFn: async () => (await api.get('/v1/reports/sales', { params: toApiParams(params) })).data?.data,
    enabled: params.tab === 'sales',
    keepPreviousData: true,
  });

  if (isLoading) return <LoadingGrid />;
  if (isError) return <ReportError error={error} onRetry={refetch} />;
  if (!data) return null;

  const s = data.summary || {};

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard icon={IndianRupee} label="Invoiced" value={money(s.total)} hint="Excl. drafts & cancellations" tone="brand" />
        <StatCard icon={Receipt} label="Invoices" value={formatNumber(s.count)} hint={`Avg ${money(s.average)} each`} tone="info" />
        <StatCard icon={Banknote} label="Collected" value={money(s.collected)} hint={`${s.total > 0 ? Math.round((s.collected / s.total) * 100) : 0}% of invoiced`} tone="success" />
        <StatCard icon={Wallet} label="Outstanding" value={money(s.outstanding)} hint={`Tax ${money(s.tax)} · Disc ${money(s.discount)}`} tone={s.outstanding > 0 ? 'warning' : 'muted'} />
      </div>

      <ChartCard title="Invoiced value over time" hint={`${GRANULARITY_LABEL[params.granularity] || 'Daily'} buckets`}>
        <TrendChart data={labelSeries(data.series || [])} valueKey="value" secondKey="count" valueLabel="Invoiced" secondLabel="Invoices" formatValue={(v) => money(v)} height={260} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Top customers" hint="By invoiced value">
          <BarList data={data.byCustomer || []} labelKey="name" valueKey="value" formatValue={(v) => money(v)} height={260} />
        </ChartCard>
        <ChartCard title="Salesman performance" hint="By invoiced value">
          <BarList data={data.bySalesman || []} labelKey="name" valueKey="value" formatValue={(v) => money(v)} height={260} />
        </ChartCard>
        <ChartCard title="Payment modes" hint="Share of invoiced value">
          <DonutChart data={data.byPaymentMode || []} nameKey="mode" valueKey="value" formatValue={(v) => money(v)} centerLabel="Invoiced" centerValue={money(s.total)} height={260} />
        </ChartCard>
        <ChartCard title="Top products" hint="By line value">
          <BarList data={data.byProduct || []} labelKey="name" valueKey="value" formatValue={(v) => money(v)} height={260} />
        </ChartCard>
      </div>
    </div>
  );
}

function ReceivablesTab({ params, money }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['company', 'reports', 'receivables', params],
    queryFn: async () => (await api.get('/v1/reports/receivables', { params: toApiParams(params) })).data?.data,
    enabled: params.tab === 'receivables',
    keepPreviousData: true,
  });

  if (isLoading) return <LoadingGrid />;
  if (isError) return <ReportError error={error} onRetry={refetch} />;
  if (!data) return null;

  const s = data.summary || {};
  const invoices = data.invoices || [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard icon={Wallet} label="Total outstanding" value={money(s.total)} hint={`${formatNumber(s.invoiceCount)} open invoices`} tone="brand" />
        <StatCard icon={AlertTriangle} label="Overdue" value={money(s.overdueValue)} hint={`${formatNumber(s.overdueCount)} past due`} tone="warning" />
        <StatCard icon={Percent} label="Overdue share" value={`${s.overduePercent || 0}%`} hint="Of total receivables" tone={s.overduePercent > 50 ? 'destructive' : 'info'} />
        <StatCard icon={Receipt} label="Open invoices" value={formatNumber(s.invoiceCount)} hint="Live balance, all time" tone="muted" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Aging buckets" hint="Outstanding grouped by days past due">
          <ColumnChart data={data.buckets || []} nameKey="label" valueKey="value" valueLabel="Outstanding" formatValue={(v) => money(v)} height={260} />
        </ChartCard>
        <ChartCard title="Top debtors" hint="By outstanding balance">
          <BarList data={data.byCustomer || []} labelKey="name" valueKey="value" formatValue={(v) => money(v)} height={260} />
        </ChartCard>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Open invoices</CardTitle>
          <p className="text-xs text-muted-foreground">Oldest first · showing up to {invoices.length}</p>
        </CardHeader>
        <CardContent className="pt-0">
          {invoices.length === 0 ? (
            <EmptyState icon="empty" title="Nothing outstanding" description="Every invoice in this company is settled." compact />
          ) : (
            <div className="overflow-x-auto">
              <Table cards>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.invoiceNo}</TableCell>
                      <TableCell>{inv.customerName}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(inv.invoiceDate)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(inv.dueDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(inv.total)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{money(inv.outstanding)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CollectionsTab({ params, money }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['company', 'reports', 'collections', params],
    queryFn: async () => (await api.get('/v1/reports/collections', { params: toApiParams(params) })).data?.data,
    enabled: params.tab === 'collections',
    keepPreviousData: true,
  });

  if (isLoading) return <LoadingGrid />;
  if (isError) return <ReportError error={error} onRetry={refetch} />;
  if (!data) return null;

  const s = data.summary || {};

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard icon={Banknote} label="Received" value={money(s.total)} hint={`${formatNumber(s.count)} payments`} tone="success" />
        <StatCard icon={Receipt} label="Applied to invoices" value={money(s.applied)} hint="Settled against dues" tone="brand" />
        <StatCard icon={Wallet} label="Advance / on-account" value={money(s.advance)} hint="Unallocated balance" tone="info" />
        <StatCard icon={IndianRupee} label="Average payment" value={money(s.average)} hint="Per transaction" tone="muted" />
      </div>

      <ChartCard title="Collections over time" hint={`${GRANULARITY_LABEL[params.granularity] || 'Daily'} buckets`}>
        <TrendChart data={labelSeries(data.series || [])} valueKey="value" secondKey="count" valueLabel="Collected" secondLabel="Payments" formatValue={(v) => money(v)} height={260} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="By payment mode" hint="Share of money received">
          <DonutChart data={data.byMode || []} nameKey="mode" valueKey="value" formatValue={(v) => money(v)} centerLabel="Received" centerValue={money(s.total)} height={260} />
        </ChartCard>
        <ChartCard title="By collector" hint="Who brought the money in">
          <BarList data={data.byCollector || []} labelKey="name" valueKey="value" formatValue={(v) => money(v)} height={260} />
        </ChartCard>
      </div>
    </div>
  );
}

function InventoryTab({ params, money }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['company', 'reports', 'inventory', params],
    queryFn: async () => (await api.get('/v1/reports/inventory', { params: toApiParams(params) })).data?.data,
    enabled: params.tab === 'inventory',
    keepPreviousData: true,
  });

  if (isLoading) return <LoadingGrid />;
  if (isError) return <ReportError error={error} onRetry={refetch} />;
  if (!data) return null;

  const s = data.summary || {};
  const low = data.lowStock || [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard icon={IndianRupee} label="Stock value" value={money(s.stockValue)} hint={`${formatNumber(s.lines)} stock lines`} tone="brand" />
        <StatCard icon={Boxes} label="Units on hand" value={formatNumber(s.qty)} hint={`${formatNumber(s.reserved)} reserved · ${formatNumber(s.available)} available`} tone="info" />
        <StatCard icon={AlertTriangle} label="Low stock" value={formatNumber(s.lowStockCount)} hint="At or below reorder level" tone={s.lowStockCount > 0 ? 'destructive' : 'muted'} />
        <StatCard icon={Package} label="Warehouses" value={formatNumber(s.warehouseCount)} hint="Holding stock" tone="muted" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Stock value by warehouse" hint="Qty × last cost">
          <BarList data={data.byWarehouse || []} labelKey="name" valueKey="value" formatValue={(v) => money(v)} height={260} />
        </ChartCard>
        <ChartCard title="Movement by type" hint={`${GRANULARITY_LABEL[params.granularity] || 'Daily'} movement value`}>
          <ColumnChart data={data.byType || []} nameKey="type" valueKey="value" valueLabel="Value" formatValue={(v) => money(v)} height={260} />
        </ChartCard>
      </div>

      <ChartCard title="Stock movement over time" hint="Value moved in this window">
        <TrendChart data={labelSeries(data.series || [])} valueKey="value" secondKey="count" valueLabel="Value" secondLabel="Movements" formatValue={(v) => money(v)} height={240} />
      </ChartCard>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Low stock</CardTitle>
          <p className="text-xs text-muted-foreground">Products at or below their reorder level</p>
        </CardHeader>
        <CardContent className="pt-0">
          {low.length === 0 ? (
            <EmptyState icon="empty" title="All stocked up" description="No product is at or below its reorder level." compact />
          ) : (
            <div className="overflow-x-auto">
              <Table cards>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Reorder at</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {low.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.sku}</TableCell>
                      <TableCell className="text-muted-foreground">{p.category || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(p.stock)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(p.lowStockLevel)}</TableCell>
                      <TableCell>
                        <Badge tone={p.stock <= 0 ? 'destructive' : 'warning'}>
                          {p.stock <= 0 ? 'Out of stock' : 'Low'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FieldForceTab({ params, money }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['company', 'reports', 'field-force', params],
    queryFn: async () => (await api.get('/v1/reports/field-force', { params: toApiParams(params) })).data?.data,
    enabled: params.tab === 'field-force',
    keepPreviousData: true,
  });

  if (isLoading) return <LoadingGrid />;
  if (isError) return <ReportError error={error} onRetry={refetch} />;
  if (!data) return null;

  const visits = data.visits || {};
  const expenses = data.expenses || {};
  const attendance = data.attendance || [];
  const targets = data.targets || [];

  const visitCount = sumBy(visits.series || [], 'count');
  const expenseTotal = sumBy(expenses.byCategory || [], 'value');
  const expenseApproved = sumBy(expenses.byCategory || [], 'approved');
  const targetTotal = sumBy(targets, 'target');
  const targetAchieved = sumBy(targets, 'achieved');
  const targetPercent = targetTotal > 0 ? Math.round((targetAchieved / targetTotal) * 100) : 0;
  const workedHours = attendance.reduce((s, a) => s + Number(a.workedHours || 0), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard icon={Footprints} label="Visits" value={formatNumber(visitCount)} hint={`${formatNumber(visits.bySalesman?.length || 0)} reps active`} tone="brand" />
        <StatCard icon={CalendarCheck} label="Hours worked" value={`${formatNumber(workedHours)}`} hint={`${formatNumber(attendance.length)} reps attendance`} tone="info" />
        <StatCard icon={Receipt} label="Field expenses" value={money(expenseTotal)} hint={`${money(expenseApproved)} approved`} tone="warning" />
        <StatCard icon={Target} label="Target achievement" value={`${targetPercent}%`} hint={`${money(targetAchieved)} of ${money(targetTotal)}`} tone={targetPercent >= 100 ? 'success' : 'muted'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Visits over time" hint={`${GRANULARITY_LABEL[params.granularity] || 'Daily'} buckets`} className="lg:col-span-2">
          <TrendChart data={labelSeries(visits.series || [])} valueKey="value" secondKey="count" valueLabel="Order value" secondLabel="Visits" formatValue={(v) => money(v)} height={260} />
        </ChartCard>
        <ChartCard title="Visit outcomes" hint="How visits ended">
          <DonutChart data={visits.byOutcome || []} nameKey="outcome" valueKey="count" formatValue={(v) => `${v} visits`} centerLabel="Visits" centerValue={formatNumber(visitCount)} height={260} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Expenses by category" hint={`Approved ${money(expenseApproved)} of ${money(expenseTotal)}`}>
          <ColumnChart data={expenses.byCategory || []} nameKey="category" valueKey="value" secondKey="approved" valueLabel="Claimed" secondLabel="Approved" formatValue={(v) => money(v)} height={260} />
        </ChartCard>
        <ChartCard title="Rep visits" hint="Completed vs skipped">
          <BarList data={visits.bySalesman || []} labelKey="name" valueKey="visits" formatValue={(v) => `${v} visits`} height={260} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Attendance</CardTitle>
            <p className="text-xs text-muted-foreground">Hours logged in this window</p>
          </CardHeader>
          <CardContent className="pt-0">
            {attendance.length === 0 ? (
              <EmptyState icon="empty" title="No attendance yet" description="No check-ins recorded in this window." compact />
            ) : (
              <div className="overflow-x-auto">
                <Table cards>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rep</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead className="text-right">Present</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">OT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendance.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(a.days)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(a.present)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(a.workedHours)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumber(a.overtimeHours)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Targets</CardTitle>
            <p className="text-xs text-muted-foreground">Top {targets.length} by achievement</p>
          </CardHeader>
          <CardContent className="pt-0">
            {targets.length === 0 ? (
              <EmptyState icon="empty" title="No targets set" description="Create targets to track achievement here." compact />
            ) : (
              <div className="overflow-x-auto">
                <Table cards>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Target</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead className="text-right">Achieved</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {targets.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <p className="font-medium">{t.name}</p>
                          <p className="text-xs text-muted-foreground">{t.periodLabel}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(t.target)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(t.achieved)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{t.percent}%</TableCell>
                        <TableCell>
                          <StatusBadge status={t.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const { can } = usePermissions();
  const { company } = useAuth();

  const tab = params.get('tab') || 'overview';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const granularity = params.get('granularity') || 'day';

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '' || v === 'ALL') next.delete(k);
      else next.set(k, String(v));
    });
    setParams(next, { replace: true });
  };

  const currency = company?.currency || 'INR';
  const money = useMemo(
    () => (value) => formatMoney(value, currency),
    [currency]
  );

  /** Query params shared by every windowed report (empty values omitted). */
  const windowParams = useMemo(() => {
    const out = {};
    if (dateFrom) out.dateFrom = dateFrom;
    if (dateTo) out.dateTo = dateTo;
    return out;
  }, [dateFrom, dateTo]);

  const query = useMemo(() => ({ ...windowParams, granularity }), [windowParams, granularity]);
  const exportParams = useMemo(
    () => ({ ...query, type: EXPORT_TYPE[tab] || 'sales' }),
    [query, tab]
  );

  /** Quick ranges so a user does not have to type dates. */
  const applyRange = (days) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    const iso = (d) => d.toISOString().slice(0, 10);
    setParam({ dateFrom: iso(from), dateTo: iso(to) });
  };

  const isSet = Boolean(dateFrom || dateTo);
  const activeGranularity = ['sales', 'collections', 'inventory', 'field-force'].includes(tab);

  const downloadXlsx = async () => {
    try {
      const { data } = await api.get('/v1/reports/export', {
        params: exportParams,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${EXPORT_TYPE[tab] || 'sales'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('Report exported to Excel');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Sales, receivables, collections, inventory and field-force analytics in one place."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Reports' }]}
        actions={
          <>
            {can('reports.export') && (
              <Button variant="outline" onClick={downloadXlsx}>
                <Download className="h-4 w-4" />
                Export Excel
              </Button>
            )}
          </>
        }
      />

      <Tabs items={TABS} value={tab} onChange={(v) => setParam({ tab: v })} />

      <Card className="max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
        <CardContent className="flex flex-col gap-3 py-4 max-sm:p-0 xl:flex-row xl:items-center">
          {/* Phones: a segmented control. */}
          <div className="flex flex-wrap items-center gap-2 max-sm:grid max-sm:grid-cols-4 max-sm:gap-1 max-sm:rounded-xl max-sm:bg-muted max-sm:p-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground max-sm:hidden">
              Range
            </span>
            <Button size="sm" variant={isSet ? 'ghost' : 'outline'} onClick={() => setParam({ dateFrom: '', dateTo: '' })}>
              All time
            </Button>
            <Button size="sm" variant="ghost" onClick={() => applyRange(7)}>
              7D
            </Button>
            <Button size="sm" variant="ghost" onClick={() => applyRange(30)}>
              30D
            </Button>
            <Button size="sm" variant="ghost" onClick={() => applyRange(90)}>
              90D
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 max-sm:grid max-sm:grid-cols-2 xl:ml-auto">
            <Input
              type="date"
              value={dateFrom}
              max={dateTo || todayInput()}
              onChange={(e) => setParam({ dateFrom: e.target.value })}
              className="w-full sm:w-40"
              aria-label="From date"
            />
            <Input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              max={todayInput()}
              onChange={(e) => setParam({ dateTo: e.target.value })}
              className="w-full sm:w-40"
              aria-label="To date"
            />
            {activeGranularity && (
              <Select
                value={granularity}
                onChange={(e) => setParam({ granularity: e.target.value })}
                className="w-full sm:w-32"
                aria-label="Granularity"
              >
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </Select>
            )}
            {isSet && (
              <Button variant="ghost" size="sm" onClick={() => setParam({ dateFrom: '', dateTo: '' })}>
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {dateFrom || dateTo
          ? `Showing ${dateFrom || 'the beginning'} → ${dateTo || 'today'}`
          : 'Showing the last 30 days (balances are live)'}
        {' · '}
        granularity: {GRANULARITY_LABEL[granularity] || 'Daily'}
      </p>

      <TabPanel value="overview" active={tab}>
        <OverviewTab params={{ ...query, tab }} money={money} />
      </TabPanel>
      <TabPanel value="sales" active={tab}>
        <SalesTab params={{ ...query, tab }} money={money} />
      </TabPanel>
      <TabPanel value="receivables" active={tab}>
        <ReceivablesTab params={{ ...windowParams, tab }} money={money} />
      </TabPanel>
      <TabPanel value="collections" active={tab}>
        <CollectionsTab params={{ ...query, tab }} money={money} />
      </TabPanel>
      <TabPanel value="inventory" active={tab}>
        <InventoryTab params={{ ...query, tab }} money={money} />
      </TabPanel>
      <TabPanel value="field-force" active={tab}>
        <FieldForceTab params={{ ...query, tab }} money={money} />
      </TabPanel>
    </div>
  );
}
