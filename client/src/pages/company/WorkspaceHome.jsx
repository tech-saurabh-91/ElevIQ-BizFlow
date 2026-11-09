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
  AlertTriangle,
} from 'lucide-react';
import { sellsVia } from '@/utils/salesType';
import { DASHBOARD_KEY, fetchDashboardSummary } from '@/api/dashboard';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import StatCard, { STAT_GRID } from '@/components/company/stat-card';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { formatMoney, formatNumber, formatDate } from '@/utils/format';

/** "Good morning" etc. by the device clock. */
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Phone-only home header: greeting plus today's headline numbers. */
function PhoneHero({ name, company, loading, today, todayHint, month, collections }) {
  return (
    <div className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-4 text-white shadow-lg sm:hidden">
      <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-16 right-10 h-32 w-32 rounded-full bg-white/5" aria-hidden="true" />
      <p className="relative text-xs text-white/75">
        {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
      </p>
      <h1 className="relative mt-0.5 text-lg font-bold">
        {greeting()}, {name} 👋
      </h1>
      <p className="relative truncate text-xs text-white/75">{company}</p>

      <div className="relative mt-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">{today.label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-36 bg-white/20" />
        ) : (
          <p className="text-[28px] font-bold leading-tight tracking-tight tabular-nums">{today.value}</p>
        )}
        <p className="text-xs text-white/75">{todayHint}</p>
      </div>

      <div className="relative mt-4 grid grid-cols-2 divide-x divide-white/20 rounded-xl bg-white/10 py-2.5 backdrop-blur-sm">
        {[month, collections].map((k) => (
          <div key={k.label} className="min-w-0 px-3">
            <p className="truncate text-[10px] font-medium uppercase tracking-wide text-white/70">{k.label}</p>
            {loading ? (
              <Skeleton className="mt-1 h-5 w-20 bg-white/20" />
            ) : (
              <p className="truncate text-sm font-semibold tabular-nums">{k.value}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkspaceHome() {
  const { user, company } = useAuth();
  const { can } = usePermissions();

  const { data, isLoading } = useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: fetchDashboardSummary,
    retry: 1,
  });

  const summary = data || {};
  const money = (v) => formatMoney(v ?? 0, company?.currency || 'INR');
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
      <PhoneHero
        name={user?.name?.split(' ')[0] || ''}
        company={company?.name}
        loading={isLoading}
        today={{ label: my('Sales today'), value: money(summary.salesToday) }}
        todayHint={`${formatNumber(summary.ordersToday ?? 0)} orders booked today`}
        month={{ label: my('Sales this month'), value: money(summary.salesMtd) }}
        collections={{ label: my('Collections (MTD)'), value: money(summary.collectionsMtd) }}
      />

      <PageHeader
        className="hidden sm:block"
        title={`Welcome, ${user?.name?.split(' ')[0] || ''} 👋`}
        description={`Here’s what’s happening at ${company?.name || 'your workspace'} today.`}
        actions={
          <Badge tone="info">
            <Sparkles className="h-3 w-3" /> {company?.businessType || 'Business'} · {company?.code}
          </Badge>
        }
      />

      {/* ---- KPIs (phones: the hero above carries sales + collections) ---- */}
      <div className={STAT_GRID + ' sm:hidden'}>
        <StatCard
          icon={Users}
          label={my('Outstanding')}
          value={money(summary.outstanding)}
          hint="To be collected"
          loading={isLoading}
          tone="muted"
        />
        <StatCard
          icon={AlertTriangle}
          label="Overdue invoices"
          value={formatNumber(summary.overdueCount ?? 0)}
          hint="Past their due date"
          loading={isLoading}
          tone="destructive"
        />
      </div>
      <div className={STAT_GRID.replace('grid ', 'hidden sm:grid ')}>
        <StatCard
          icon={ShoppingCart}
          label={my('Sales today')}
          value={formatMoney(summary.salesToday ?? 0, company?.currency || 'INR')}
          hint={`${formatNumber(summary.ordersToday ?? 0)} orders booked`}
          loading={isLoading}
          tone="brand"
        />
        <StatCard
          icon={FileText}
          label={my('Sales this month')}
          value={formatMoney(summary.salesMtd ?? 0, company?.currency || 'INR')}
          hint={`Invoiced: ${formatMoney(summary.invoicedMtd ?? 0, company?.currency || 'INR')}`}
          loading={isLoading}
          tone="success"
        />
        <StatCard
          icon={Wallet}
          label={my('Collections (MTD)')}
          value={formatMoney(summary.collectionsMtd ?? 0, company?.currency || 'INR')}
          hint={`${formatNumber(summary.paymentsMtd ?? 0)} receipts`}
          loading={isLoading}
          tone="warning"
        />
        <StatCard
          icon={Users}
          label={my('Outstanding')}
          value={formatMoney(summary.outstanding ?? 0, company?.currency || 'INR')}
          hint={`${formatNumber(summary.overdueCount ?? 0)} overdue invoices`}
          loading={isLoading}
          tone="muted"
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ---- Quick actions ---- */}
        <Card className={showSetup ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <CardHeader className="pb-3 max-sm:p-4 max-sm:pb-2">
            <CardTitle>Quick actions</CardTitle>
            <CardDescription className="hidden sm:block">Jump straight into your daily workflow</CardDescription>
          </CardHeader>
          <CardContent className="max-sm:px-2 max-sm:pb-3">
            {quickActions.length === 0 ? (
              <EmptyState
                compact
                title="No actions available for your role"
                description="Ask your administrator to update your permissions."
              />
            ) : (
              // Phones: app-style icon tiles, four per row. Wider: a list of buttons.
              <div className="grid grid-cols-4 gap-1 sm:grid-cols-2 sm:gap-3">
                {quickActions.map((a) => (
                  <Link
                    key={a.to}
                    to={a.to}
                    className="group flex flex-col items-center gap-1.5 rounded-xl p-2 text-center transition-colors active:bg-accent focus-ring sm:flex-row sm:gap-3 sm:rounded-lg sm:border sm:bg-card sm:p-3.5 sm:text-left sm:hover:border-brand-500/50 sm:hover:bg-brand-500/5"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-500/12 text-brand-600 dark:text-brand-300 sm:h-9 sm:w-9 sm:rounded-lg">
                      <a.icon className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden="true" />
                    </span>
                    <span className="line-clamp-2 text-[11px] font-medium leading-tight sm:flex-1 sm:text-sm">{a.label}</span>
                    <ArrowRight className="hidden h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
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
      <div className={`mt-5 grid grid-cols-1 gap-5 ${isSalesman ? '' : 'lg:grid-cols-2'}`}>
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
                    {/* Phones: amount over status, so a long status never widens the page. */}
                    <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <span className="font-semibold">
                        {formatMoney(o.total, company?.currency || 'INR')}
                      </span>
                      <StatusBadge status={o.status} />
                    </div>
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
                  <div className="mb-3 flex flex-wrap gap-2">
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
