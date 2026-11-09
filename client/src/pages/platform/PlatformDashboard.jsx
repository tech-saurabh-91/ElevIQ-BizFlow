import { useQuery } from '@tanstack/react-query';
import { Building2, Users, TrendingUp, AlertTriangle, Activity, Server } from 'lucide-react';
import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { formatNumber, formatDate, timeAgo } from '@/utils/format';
import { useAuth } from '@/hooks/useAuth';

function StatCard({ icon: Icon, label, value, hint, tone = 'brand', loading }) {
  const tones = {
    brand: 'bg-brand-500/12 text-brand-600 dark:text-brand-300',
    success: 'bg-success/12 text-success',
    warning: 'bg-warning/15 text-warning',
    destructive: 'bg-destructive/12 text-destructive',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-5">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-20" />
          ) : (
            <p className="mt-1 truncate text-2xl font-bold tracking-tight">{value}</p>
          )}
          {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PlatformDashboard() {
  const { user } = useAuth();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['platform', 'dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/platform/dashboard');
      return data?.data;
    },
    retry: 1,
  });

  const stats = data?.stats || {};
  const topCompanies = data?.topCompanies || [];
  const expiring = data?.expiring || [];
  const health = data?.health || {};

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.name?.split(' ')[0] || 'admin'}`}
        description="Monitor companies, revenue and platform health across ElevIQ SFA."
        actions={
          <Badge tone="info" dot>
            {health.apiStatus || 'All systems operational'}
          </Badge>
        }
      />

      {error && (
        <Card className="mb-5 border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>
              Could not load live platform statistics — showing the console shell only.{' '}
              <span className="text-muted-foreground">
                {apiError(error).message}
              </span>
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent focus-ring"
              disabled={isFetching}
            >
              {isFetching ? 'Retrying…' : 'Retry'}
            </button>
          </CardContent>
        </Card>
      )}

      {/* ---- KPI grid ---- */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={Building2}
          label="Total companies"
          value={formatNumber(stats.totalCompanies)}
          hint={`${formatNumber(stats.activeCompanies || 0)} active · ${formatNumber(stats.trialCompanies || 0)} on trial`}
          loading={isLoading}
        />
        <StatCard
          icon={Users}
          label="Platform users"
          value={formatNumber(stats.totalUsers)}
          hint={`${formatNumber(stats.newSignups || 0)} new signups (30d)`}
          tone="muted"
          loading={isLoading}
        />
        <StatCard
          icon={TrendingUp}
          label="Revenue (MRR)"
          value={formatNumber(stats.mrr)}
          hint={`${formatNumber(stats.revenueYtd || 0)} YTD`}
          tone="success"
          loading={isLoading}
        />
        <StatCard
          icon={AlertTriangle}
          label="Expiring in 30 days"
          value={formatNumber(stats.expiringSoon)}
          hint={`${formatNumber(stats.suspended || 0)} suspended`}
          tone="warning"
          loading={isLoading}
        />
      </div>

      {/* ---- Two column: top companies + expiring ---- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle>Top companies by order volume</CardTitle>
              <CardDescription>Leading tenants over the last 30 days</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : topCompanies.length === 0 ? (
              <EmptyState
                compact
                icon="package"
                title="No order data yet"
                description="Company order and invoice statistics appear here once tenants start transacting."
              />
            ) : (
              <ul className="divide-y">
                {topCompanies.map((c, i) => (
                  <li key={c.id || i} className="flex items-center gap-3 py-3">
                    <span className="w-5 text-center text-xs font-bold text-muted-foreground">{i + 1}</span>
                    <Avatar name={c.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.code} · {c.city || '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatNumber(c.orders)}</p>
                      <p className="text-xs text-muted-foreground">orders</p>
                    </div>
                    <Badge tone={c.status === 'ACTIVE' ? 'success' : c.status === 'TRIAL' ? 'info' : 'muted'}>
                      {c.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Subscriptions expiring soon</CardTitle>
              <CardDescription>Next 30 days</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : expiring.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nothing expiring soon.</p>
              ) : (
                <ul className="space-y-2.5">
                  {expiring.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.code}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold">{formatDate(c.subscriptionEnd)}</p>
                        <p className="text-[10px] uppercase text-warning">{c.daysLeft}d left</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" /> System health
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <Row label="API status" value={health.apiStatus || 'Operational'} tone="success" />
              <Row label="Error rate (24h)" value={health.errorRate ?? '0%'} />
              <Row label="Avg response" value={health.avgResponseMs ? `${health.avgResponseMs} ms` : '—'} />
              <Row
                label="Last activity"
                value={health.lastActivity ? timeAgo(health.lastActivity) : '—'}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ---- Activity strip ---- */}
      <Card className="mt-5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" /> Recent platform activity
          </CardTitle>
          <CardDescription>Latest actions recorded in the platform audit log</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (data?.recentActivity || []).length === 0 ? (
            <EmptyState compact title="No recent activity" description="Audit events will appear here." />
          ) : (
            <ul className="divide-y">
              {data.recentActivity.map((a, i) => (
                <li key={i} className="flex items-start gap-3 py-2.5 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="font-medium">{a.actor || 'system'}</span>{' '}
                      <span className="text-muted-foreground">{a.description}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.entityLabel} · {timeAgo(a.occurredAt)}
                    </p>
                  </div>
                  <Badge tone="muted">{a.action}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium ${tone === 'success' ? 'text-success' : ''}`}>{value}</span>
    </div>
  );
}
