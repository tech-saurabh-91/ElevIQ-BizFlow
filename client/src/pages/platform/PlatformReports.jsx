import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Activity,
  Building2,
  CreditCard,
  Download,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import StatCard from '@/components/company/stat-card';
import { TrendChart, BarList, DonutChart, ColumnChart } from '@/components/company/report-charts';
import { formatNumber } from '@/utils/format';

/**
 * Phase 8 - Platform reports.
 *
 * Cross-tenant analytics: company lifecycle mix, signup trend, plan adoption,
 * user headcount by role and audit activity. Every number comes from
 * /api/platform/reports/overview — nothing here is derived client-side.
 */

const RANGES = [
  { value: 90, label: '90D' },
  { value: 180, label: '180D' },
  { value: 365, label: '1Y' },
  { value: 730, label: '2Y' },
];

const STATUS_TONE = {
  ACTIVE: 'success',
  TRIAL: 'info',
  SUSPENDED: 'warning',
  EXPIRED: 'muted',
  CANCELLED: 'destructive',
};

const ROLE_LABEL = {
  COMPANY_ADMIN: 'Admins',
  MANAGER: 'Managers',
  SALESMAN: 'Salesmen',
  ACCOUNTANT: 'Accountants',
  WAREHOUSE: 'Warehouse',
};

function ReportCard({ title, hint, children, className }) {
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

export default function PlatformReports() {
  const [days, setDays] = useState(365);
  const [statusFilter, setStatusFilter] = useState('');

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const iso = (d) => d.toISOString().slice(0, 10);

  const params = { dateFrom: iso(from), dateTo: iso(to) };

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['platform', 'reports', 'overview', params],
    queryFn: async () => (await api.get('/platform/reports/overview', { params })).data?.data,
    keepPreviousData: true,
    retry: 1,
  });

  const s = data?.summary || {};

  const rows = (data?.byStatus || []).filter((r) =>
    statusFilter ? r.status === statusFilter : true
  );
  const byRole = (data?.byRole || []).map((r) => ({
    ...r,
    label: ROLE_LABEL[r.role] || r.role,
  }));
  const byPlan = data?.byPlan || [];
  const topCompanies = data?.topCompanies || [];
  const activity = data?.activity || {};

  /** There is no platform workbook endpoint, so export the raw JSON payload. */
  const downloadJson = async () => {
    try {
      const { data: body } = await api.get('/platform/reports/overview', { params });
      const blob = new Blob([JSON.stringify(body?.data ?? {}, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `platform-report-${iso(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('Platform report exported');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  if (isError) {
    return (
      <div>
        <PageHeader
          title="Platform Reports"
          description="Cross-tenant analytics for the ElevIQ SFA platform."
        />
        <EmptyState
          icon="error"
          title="Could not load platform reports"
          description={apiError(error).message}
          action={
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform Reports"
        description="Company growth, plan adoption, user headcount and platform audit activity."
        actions={
          <>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Refresh
            </Button>
            <Button variant="outline" onClick={downloadJson}>
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
          </>
        }
      />

      {/* ---- Window + status filters ---- */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Window
          </span>
          {RANGES.map((r) => (
            <Button
              key={r.value}
              size="sm"
              variant={days === r.value ? 'secondary' : 'ghost'}
              onClick={() => setDays(r.value)}
            >
              {r.label}
            </Button>
          ))}

          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="ml-auto w-44"
            aria-label="Filter by company status"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="TRIAL">Trial</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </CardContent>
      </Card>

      {/* ---- KPIs ---- */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={Building2}
          label="Total companies"
          value={isLoading ? '—' : formatNumber(s.totalCompanies)}
          hint={`${formatNumber(s.activeCompanies || 0)} active · ${formatNumber(s.trialCompanies || 0)} trial`}
          loading={isLoading}
        />
        <StatCard
          icon={TrendingUp}
          label="New in window"
          value={isLoading ? '—' : formatNumber(s.newCompanies)}
          hint={`${formatNumber(s.suspended || 0)} suspended · ${formatNumber(s.expired || 0)} expired`}
          tone="info"
          loading={isLoading}
        />
        <StatCard
          icon={Users}
          label="Platform users"
          value={isLoading ? '—' : formatNumber(s.totalUsers)}
          hint={`${formatNumber(s.activeUsers || 0)} active · ${formatNumber(s.inactiveUsers || 0)} disabled`}
          tone="muted"
          loading={isLoading}
        />
        <StatCard
          icon={ShieldCheck}
          label="Activation rate"
          value={isLoading ? '—' : `${s.activationRate || 0}%`}
          hint="Active users of all platform users"
          tone={Number(s.activationRate || 0) >= 80 ? 'success' : 'warning'}
          loading={isLoading}
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <ReportCard
              title="New companies"
              hint={`${data?.window?.from} → ${data?.window?.to}`}
              className="lg:col-span-2"
            >
              <TrendChart
                data={(data?.signups || []).map((r) => ({ period: r.label, value: r.count }))}
                valueKey="value"
                valueLabel="Signups"
                formatValue={(v) => formatNumber(v)}
                height={260}
              />
            </ReportCard>

            <ReportCard title="Lifecycle mix" hint="Companies by status">
              <DonutChart
                data={rows}
                nameKey="status"
                valueKey="count"
                formatValue={(v) => `${v} companies`}
                centerLabel="Companies"
                centerValue={formatNumber(
                  rows.reduce((acc, r) => acc + Number(r.count || 0), 0)
                )}
                height={260}
              />
            </ReportCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ReportCard title="Plan adoption" hint="Companies on each plan">
              {byPlan.length === 0 ? (
                <EmptyState
                  compact
                  icon="empty"
                  title="No plans assigned"
                  description="Assign plans to companies to see adoption here."
                />
              ) : (
                <BarList
                  data={byPlan}
                  labelKey="name"
                  valueKey="count"
                  formatValue={(v) => `${v} companies`}
                  height={240}
                />
              )}
            </ReportCard>

            <ReportCard title="Users by role" hint="Platform-wide headcount">
              <ColumnChart
                data={byRole}
                nameKey="label"
                valueKey="count"
                secondKey="active"
                valueLabel="Total"
                secondLabel="Active"
                formatValue={(v) => formatNumber(v)}
                height={240}
              />
            </ReportCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <ReportCard title="Top companies" hint="By active user headcount" className="lg:col-span-2">
              {topCompanies.length === 0 ? (
                <EmptyState
                  compact
                  icon="empty"
                  title="No active users yet"
                  description="Company adoption rankings appear once users start signing in."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table cards>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Active users</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topCompanies.map((c, i) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                          <TableCell>
                            <p className="font-medium">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.code}</p>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={c.status} />
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatNumber(c.users)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </ReportCard>

            <ReportCard title="Audit activity" hint="Platform events in window">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Events logged</span>
                  <span className="text-lg font-bold tabular-nums">
                    {formatNumber(activity.total || 0)}
                  </span>
                </div>

                {(activity.bySeverity || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No audit events in this window.</p>
                ) : (
                  <ul className="space-y-2">
                    {activity.bySeverity.map((a) => (
                      <li
                        key={a.severity}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <Badge
                          tone={
                            a.severity === 'ERROR' || a.severity === 'CRITICAL'
                              ? 'destructive'
                              : a.severity === 'WARN'
                                ? 'warning'
                                : 'muted'
                          }
                        >
                          {a.severity}
                        </Badge>
                        <span className="font-semibold tabular-nums">{formatNumber(a.count)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                  Counts come from the platform audit log.
                </div>
              </div>
            </ReportCard>
          </div>

          {/* ---- Status breakdown table ---- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Company lifecycle detail
              </CardTitle>
              <CardDescription>Exact counts behind the mix chart</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <Table cards>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Companies</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                          No companies match this status.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((r) => {
                        const total = rows.reduce((acc, x) => acc + Number(x.count || 0), 0);
                        const share = total > 0 ? Math.round((r.count / total) * 100) : 0;
                        return (
                          <TableRow key={r.status}>
                            <TableCell>
                              <StatusBadge status={r.status} />
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {formatNumber(r.count)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {share}%
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
