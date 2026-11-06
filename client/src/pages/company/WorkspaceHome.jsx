import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ShoppingCart,
  FileText,
  Wallet,
  Users,
  Package,
  ArrowRight,
  Sparkles,
  MapPin,
  CalendarCheck,
  Navigation,
  Truck,
} from 'lucide-react';
import { sellsVia } from '@/utils/salesType';
import api from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { formatMoney, formatNumber, formatDate } from '@/utils/format';

function Kpi({ label, value, hint, icon: Icon, loading, tone = 'brand' }) {
  const tones = {
    brand: 'text-brand-600 dark:text-brand-300 bg-brand-500/12',
    success: 'text-success bg-success/12',
    warning: 'text-warning bg-warning/15',
    muted: 'text-muted-foreground bg-muted',
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
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

export default function WorkspaceHome() {
  const { user, company } = useAuth();
  const { can } = usePermissions();

  const { data, isLoading } = useQuery({
    queryKey: ['company', 'dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/v1/dashboard/summary');
      return data?.data;
    },
    retry: 1,
  });

  const summary = data || {};
  // A salesman's home is their own day: numbers are theirs, and every sale
  // starts from a shop check-in in Sales visit.
  const isSalesman = user?.role === 'SALESMAN';
  const my = (label) =>
    isSalesman ? `My ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
  const quickActions = (
    isSalesman
      ? [
          {
            to: '/app/attendance',
            label: 'Mark attendance',
            icon: CalendarCheck,
            perm: 'fieldforce.attendance.manage',
          },
          {
            to: '/app/sales',
            label: 'Start sales visit',
            icon: Navigation,
            perm: 'fieldforce.visits.manage',
          },
          ...(sellsVia(user, 'VAN_SALE')
            ? [
                {
                  to: '/app/day-cashout',
                  label: 'Day cashout',
                  icon: Truck,
                  perm: 'fieldforce.visits.manage',
                },
              ]
            : []),
          {
            to: '/app/expenses',
            label: 'Claim an expense',
            icon: Wallet,
            perm: 'fieldforce.expenses.manage',
          },
        ]
      : [
          { to: '/app/orders', label: 'Book an order', icon: ShoppingCart, perm: 'orders.create' },
          { to: '/app/invoices', label: 'Create invoice', icon: FileText, perm: 'invoices.create' },
          { to: '/app/payments', label: 'Record payment', icon: Wallet, perm: 'payments.create' },
          { to: '/app/customers', label: 'Add customer', icon: Users, perm: 'customers.create' },
          { to: '/app/products', label: 'Manage products', icon: Package, perm: 'products.view' },
          {
            to: '/app/visits',
            label: 'Visits report',
            icon: MapPin,
            perm: 'fieldforce.visits.view',
          },
        ]
  ).filter((a) => can(a.perm));
  const showSetup = user?.role === 'COMPANY_ADMIN';

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.name?.split(' ')[0] || ''} 👋`}
        description={`Here’s what’s happening at ${company?.name || 'your workspace'} today.`}
        actions={
          <Badge tone="info">
            <Sparkles className="h-3 w-3" /> {company?.businessType || 'Business'} · {company?.code}
          </Badge>
        }
      />

      {/* ---- KPIs ---- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={ShoppingCart}
          label={my('Sales today')}
          value={formatMoney(summary.salesToday ?? 0, company?.currency || 'INR')}
          hint={`${formatNumber(summary.ordersToday ?? 0)} orders booked`}
          loading={isLoading}
          tone="brand"
        />
        <Kpi
          icon={FileText}
          label={my('Sales this month')}
          value={formatMoney(summary.salesMtd ?? 0, company?.currency || 'INR')}
          hint={`Invoiced: ${formatMoney(summary.invoicedMtd ?? 0, company?.currency || 'INR')}`}
          loading={isLoading}
          tone="success"
        />
        <Kpi
          icon={Wallet}
          label={my('Collections (MTD)')}
          value={formatMoney(summary.collectionsMtd ?? 0, company?.currency || 'INR')}
          hint={`${formatNumber(summary.paymentsMtd ?? 0)} receipts`}
          loading={isLoading}
          tone="warning"
        />
        <Kpi
          icon={Users}
          label={my('Outstanding')}
          value={formatMoney(summary.outstanding ?? 0, company?.currency || 'INR')}
          hint={`${formatNumber(summary.overdueCount ?? 0)} overdue invoices`}
          loading={isLoading}
          tone="muted"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* ---- Quick actions ---- */}
        <Card className={showSetup ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <CardHeader className="pb-3">
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Jump straight into your daily workflow</CardDescription>
          </CardHeader>
          <CardContent>
            {quickActions.length === 0 ? (
              <EmptyState
                compact
                title="No actions available for your role"
                description="Ask your administrator to update your permissions."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {quickActions.map((a) => (
                  <Link
                    key={a.to}
                    to={a.to}
                    className="group flex items-center gap-3 rounded-lg border bg-card p-3.5 transition-colors hover:border-brand-500/50 hover:bg-brand-500/5 focus-ring"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
                      <a.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="flex-1 text-sm font-medium">{a.label}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---- Setup / getting started (company admin only) ---- */}
        {showSetup && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Getting started</CardTitle>
              <CardDescription>Finish setting up your workspace</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  label: 'Company profile & invoice settings',
                  to: '/app/settings',
                  done: summary.setup?.profile,
                },
                { label: 'Add your team members', to: '/app/users', done: summary.setup?.users },
                { label: 'Import customers', to: '/app/customers', done: summary.setup?.customers },
                {
                  label: 'Add products & price lists',
                  to: '/app/products',
                  done: summary.setup?.products,
                },
                {
                  label: 'Book your first order',
                  to: '/app/orders',
                  done: summary.setup?.firstOrder,
                },
              ].map((step) => (
                <Link
                  key={step.label}
                  to={step.to}
                  className="flex items-center gap-3 rounded-lg border border-dashed p-3 text-sm transition-colors hover:bg-accent focus-ring"
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      step.done
                        ? 'bg-success text-success-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {step.done ? '✓' : ''}
                  </span>
                  <span
                    className={step.done ? 'text-muted-foreground line-through' : 'font-medium'}
                  >
                    {step.label}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ---- Recent activity / notices ---- */}
      <div className={`mt-5 grid gap-5 ${isSalesman ? '' : 'lg:grid-cols-2'}`}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{isSalesman ? 'My recent orders' : 'Recent orders'}</CardTitle>
            <CardDescription>
              {isSalesman ? 'Orders you booked at your shops' : 'Latest bookings across your team'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (data?.recentOrders || []).length === 0 ? (
              <EmptyState
                compact
                icon="package"
                title="No orders yet"
                description="Orders booked by your team will show up here."
                action={
                  can('orders.create') && !isSalesman ? (
                    <Link
                      to="/app/orders"
                      className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-ring"
                    >
                      Book the first order
                    </Link>
                  ) : null
                }
              />
            ) : (
              <ul className="divide-y">
                {data.recentOrders.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{o.orderNo}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {o.customerName} · {formatDate(o.date)}
                      </p>
                    </div>
                    <span className="font-semibold">
                      {formatMoney(o.total, company?.currency || 'INR')}
                    </span>
                    <StatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {!isSalesman && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Low stock & overdue</CardTitle>
              <CardDescription>Items needing attention</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <>
                  <div className="mb-3 flex gap-3">
                    <Badge tone="warning">
                      {formatNumber(summary.lowStockCount ?? 0)} low stock
                    </Badge>
                    <Badge tone="destructive">
                      {formatNumber(summary.overdueCount ?? 0)} overdue
                    </Badge>
                    <Badge tone="info">
                      {formatNumber(summary.pendingApprovals ?? 0)} approvals
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Open the{' '}
                    <Link to="/app/reports" className="font-medium text-brand-600 hover:underline">
                      reports
                    </Link>{' '}
                    or{' '}
                    <Link
                      to="/app/inventory"
                      className="font-medium text-brand-600 hover:underline"
                    >
                      inventory
                    </Link>{' '}
                    module for the full list with exports.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
