import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CASHOUT_LABEL } from '@/components/company/FieldDay';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  CalendarCheck,
  CalendarOff,
  Clock,
  LogIn,
  LogOut,
  MapPin,
  Search,
  Timer,
  Users,
  X,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { FilterPanel, FILTER_CARD, FILTER_ROW } from '@/components/ui/filter-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { usePermissions } from '@/hooks/usePermissions';
import { formatDate, formatNumber, titleCase, formatTime, formatDateTime } from '@/utils/format';
import StatCard from '@/components/company/stat-card';
import {
  ATTENDANCE_STATUSES,
  WorkflowDialog,
  CheckOutDialog,
  captureGps,
} from '@/components/company/fieldforce-shared';
import { todayInput } from '@/components/company/form-utils';

const STATUS_OPTIONS = ['', ...ATTENDANCE_STATUSES];

const minutesToHm = (mins) => {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** Today's live panel: check-in / check-out for the signed-in rep. */
function TodayPanel({ canManage }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState(null); // 'in' | 'out'
  const [closingVisit, setClosingVisit] = useState(false);
  const { isRole } = usePermissions();
  const isSalesman = isRole('SALESMAN');

  const { data, isLoading } = useQuery({
    queryKey: ['company', 'attendance', 'today'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/attendance/today');
      return body?.data;
    },
  });

  const attendance = data?.attendance || null;
  const config = data?.config || {};
  const checkedIn = Boolean(attendance?.isCheckedIn);
  const checkedOut = Boolean(attendance?.isCheckedOut);
  const day = data?.day;
  // Working-day rules: a day left open, van cashout approval before mark out.
  const fieldDay = data?.fieldDay || {};
  const previousOpen = fieldDay.previousOpen;
  const cashout = fieldDay.cashout;
  const cashoutApproved = !cashout || cashout.status === 'APPROVED';
  const markInBlocked = ['ATTENDANCE_OUT_PENDING', 'DAY_CASHOUT_PENDING'].includes(fieldDay.blocked?.code);
  // A shop still checked in (often left open on an earlier day) has to be
  // checked out before the day can be marked out - do it right here.
  const beat = useQuery({
    queryKey: ['company', 'beat', 'mine'],
    queryFn: async () => (await api.get('/v1/beat-plans/mine')).data?.data ?? null,
    enabled: isSalesman,
  });
  const openVisit = beat.data?.openVisit || null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'attendance'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
  };

  // A direct (non-dialog) check-in used when GPS isn't strictly required.
  const quickMutation = useMutation({
    mutationFn: async (kind) => {
      const gps = await captureGps();
      const body = { source: 'WEB' };
      if (gps) {
        body.location = { lat: gps.lat, lng: gps.lng };
        if (gps.accuracy != null) body.accuracy = gps.accuracy;
      }
      const { data: res } = await api.post(`/v1/field-force/attendance/check-${kind}`, body);
      return res;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Updated');
      setDialog(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  return (
    <>
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Today · {formatDate(day)}
              </p>
              {isLoading ? (
                <Skeleton className="mt-2 h-8 w-40" />
              ) : (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <p className="text-xl font-bold tracking-tight">
                    {checkedOut
                      ? 'Day completed'
                      : checkedIn
                        ? 'Checked in'
                        : 'Not checked in'}
                  </p>
                  {attendance?.status && <StatusBadge status={attendance.status} />}
                  {attendance?.isManual && <Badge tone="warning">Manual</Badge>}
                </div>
              )}
              {!isLoading && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {checkedIn && !checkedOut
                    ? `Checked in at ${formatDateTime(attendance?.checkIn?.at)} — don't forget to check out.`
                    : checkedOut
                      ? `Worked ${minutesToHm(attendance?.workedMinutes)}${attendance?.overtimeMinutes ? ` · ${minutesToHm(attendance.overtimeMinutes)} overtime` : ''}.`
                      : `Start your day by checking in.${config.requireGps ? ' Your GPS location will be captured.' : ''}`}
                </p>
              )}
              {!isLoading && checkedIn && !checkedOut && attendance?.checkIn?.address && (
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" /> {attendance.checkIn.address}
                </p>
              )}
            </div>

            {canManage && !isLoading && (
              <div className="flex shrink-0 flex-wrap gap-2">
                {previousOpen && (
                  <Button variant="outline" onClick={() => setDialog('out')}>
                    <LogOut className="h-4 w-4" />
                    Mark out {formatDate(previousOpen.day)}
                  </Button>
                )}
                {!checkedIn && (
                  <Button onClick={() => setDialog('in')} loading={quickMutation.isPending} disabled={markInBlocked}>
                    <LogIn className="h-4 w-4" />
                    Check in
                  </Button>
                )}
                {checkedIn && !checkedOut && !previousOpen && (
                  <Button
                    variant="outline"
                    onClick={() => setDialog('out')}
                    disabled={!cashoutApproved}
                    title={cashoutApproved ? undefined : 'Your day cashout must be approved first'}
                  >
                    <LogOut className="h-4 w-4" />
                    Check out
                  </Button>
                )}
                {checkedOut && (
                  <p className="self-center text-sm text-muted-foreground">
                    See you tomorrow 👋
                  </p>
                )}
              </div>
            )}
          </div>

          {!isLoading && openVisit && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
              <span>
                Still checked in at <strong>{openVisit.customerName}</strong>
                {openVisit.earlierDay ? ` since ${formatDate(`${openVisit.day}T12:00:00`)}` : ''} ({formatTime(openVisit.checkInAt)}). Check out
                of the shop before marking out.
              </span>
              <Button size="sm" onClick={() => setClosingVisit(true)}>
                <LogOut className="h-4 w-4" /> Check out of shop
              </Button>
            </div>
          )}
          {!isLoading && fieldDay.blocked && fieldDay.blocked.code !== 'ATTENDANCE_REQUIRED' && (
            <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm">{fieldDay.blocked.message}</p>
          )}
          {!isLoading && cashout && checkedIn && !checkedOut && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <span>
                Van {cashout.van?.code} day cashout: <strong>{CASHOUT_LABEL[cashout.status] || cashout.status}</strong>
                {cashout.rejectReason ? ` (${cashout.rejectReason})` : ''}
              </span>
              {['NONE', 'REJECTED'].includes(cashout.status) && (
                <Button size="sm" variant="outline" onClick={() => navigate('/app/day-cashout')}>
                  Submit day cashout
                </Button>
              )}
            </div>
          )}

          {!isLoading && config.workStart && (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {config.workStart} – {config.workEnd}
              </span>
              {config.requireGps && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> GPS required · geofence {config.geofenceRadiusM}m
                </span>
              )}
              {config.requireSelfie && <span>Selfie required</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {closingVisit && openVisit && (
        <CheckOutDialog
          visit={openVisit}
          onClose={() => setClosingVisit(false)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['company', 'beat'] });
            invalidate();
          }}
        />
      )}

      {dialog && (
        <WorkflowDialog
          open
          onClose={() => setDialog(null)}
          onDone={invalidate}
          endpoint={`/v1/field-force/attendance/check-${dialog}`}
          title={dialog === 'in' ? 'Mark in for today' : previousOpen ? `Mark out ${formatDate(previousOpen.day)}` : 'Mark out for today'}
          description={
            dialog === 'in'
              ? 'Your current GPS location will be captured to record the start of the day.'
              : 'Your current GPS location will be captured to close out the day.'
          }
          confirmLabel={dialog === 'in' ? 'Check in' : 'Check out'}
          fields={[{ name: 'note', label: 'Note (optional)', type: 'text' }]}
          errorTitle={dialog === 'in' ? 'Could not check in' : 'Could not check out'}
          invalidateKeys={[['company', 'attendance'], ['company', 'dashboard'], ['company', 'beat']]}
          prepareBody={async (body) => {
            const gps = await captureGps();
            if (!gps && config.requireGps) {
              const err = new Error('location');
              err.userMessage =
                'Your location is not available. Allow location access for this site in the browser (and turn on GPS), then try again.';
              err.code = 'GPS_UNAVAILABLE';
              throw err;
            }
            const payload = { ...body, source: 'WEB' };
            if (gps) {
              payload.location = { lat: gps.lat, lng: gps.lng };
              if (gps.accuracy != null) payload.accuracy = gps.accuracy;
            }
            return payload;
          }}
        />
      )}
    </>
  );
}

export default function Attendance() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();

  const [tab, setTab] = useState('days');
  const searchParam = params.get('search') || '';
  const status = params.get('status') || '';
  const userId = params.get('userId') || '';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const sort = params.get('sort') || '';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';

  const [searchDraft, setSearchDraft] = useState(searchParam);

  useEffect(() => {
    setSearchDraft(searchParam);
  }, [searchParam]);

  const setParam = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '' || v === 'ALL') next.delete(k);
        else next.set(k, String(v));
      });
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  useEffect(() => {
    if (searchDraft === searchParam) return undefined;
    const t = setTimeout(() => {
      setParam({ search: searchDraft.trim(), page: 1 });
    }, 400);
    return () => clearTimeout(t);
  }, [searchDraft, searchParam, setParam]);

  const queryParams = useMemo(() => {
    const out = { page, limit };
    if (searchParam) out.search = searchParam;
    if (status) out.status = status;
    if (userId) out.userId = userId;
    if (dateFrom) out.dateFrom = dateFrom;
    if (dateTo) out.dateTo = dateTo;
    if (sort) {
      out.sort = sort;
      out.order = order;
    }
    return out;
  }, [page, limit, searchParam, status, userId, dateFrom, dateTo, sort, order]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'attendance', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/attendance', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const canSeeSummary = can('fieldforce.view');
  const { data: summary } = useQuery({
    queryKey: ['company', 'attendance', 'summary', { dateFrom, dateTo }],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/attendance/summary', {
        params: { dateFrom, dateTo },
      });
      return body?.data;
    },
    enabled: canSeeSummary,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ row, reviewNote }) =>
      api.post(`/v1/field-force/attendance/${row.id}/review`, { reviewNote }),
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Attendance reviewed');
      queryClient.invalidateQueries({ queryKey: ['company', 'attendance'] });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const hasActiveFilters = Boolean(searchParam || status || userId || dateFrom || dateTo || sort);

  const resetAll = () => {
    const next = new URLSearchParams();
    if (limit !== 20) next.set('limit', String(limit));
    setParams(next, { replace: true });
    setSearchDraft('');
  };

  const toggleSort = (key) => {
    if (sort === key) setParam({ order: order === 'asc' ? 'desc' : 'asc', page: 1 });
    else setParam({ sort: key, order: 'asc', page: 1 });
  };

  const users = summary?.users || [];
  const totals = summary?.totals || { days: 0, presentDays: 0, workedMinutes: 0, overtimeMinutes: 0 };

  const columns = [
    {
      key: 'day',
      header: 'Day',
      sortable: 'day',
      render: (row) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap font-medium">{formatDate(row.day)}</p>
          {row.source && (
            <p className="truncate text-xs text-muted-foreground">{titleCase(row.source)}</p>
          )}
        </div>
      ),
    },
    {
      key: 'userName',
      header: 'Rep',
      sortable: 'userName',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.userName || row.user?.name || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.userRole || row.user?.role || ''}
          </p>
        </div>
      ),
    },
    {
      key: 'checkIn',
      header: 'Check-in',
      render: (row) =>
        row.checkIn?.at ? (
          <div className="min-w-0">
            <p className="whitespace-nowrap text-sm">
              {formatTime(row.checkIn.at)}
            </p>
            {row.checkIn.address && (
              <p className="truncate text-xs text-muted-foreground">{row.checkIn.address}</p>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'checkOut',
      header: 'Check-out',
      render: (row) =>
        row.checkOut?.at ? (
          <p className="whitespace-nowrap text-sm">
            {formatTime(row.checkOut.at)}
          </p>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'workedMinutes',
      header: 'Worked',
      className: 'text-right',
      sortable: 'workedMinutes',
      render: (row) => (
        <span className="tabular-nums text-sm">{minutesToHm(row.workedMinutes)}</span>
      ),
    },
    {
      key: 'overtimeMinutes',
      header: 'OT',
      className: 'text-right',
      render: (row) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {row.overtimeMinutes ? minutesToHm(row.overtimeMinutes) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: 'status',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={row.status} />
          {row.isManual && <Badge tone="warning">Manual</Badge>}
          {row.isCheckedIn && !row.isCheckedOut && <Badge tone="info">Open</Badge>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attendance"
        description="GPS check-in/out for the field team, with daily hours and manager review."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Attendance' }]}
      />

      <TodayPanel canManage={can('fieldforce.attendance.manage')} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={CalendarCheck}
          label="Days logged"
          value={formatNumber(totals.days)}
          hint="Across the selected period"
          loading={!summary && canSeeSummary}
          tone="brand"
        />
        <StatCard
          icon={Users}
          label="Present days"
          value={formatNumber(totals.presentDays)}
          hint={`${users.length} rep${users.length === 1 ? '' : 's'} with attendance`}
          loading={!summary && canSeeSummary}
          tone="success"
        />
        <StatCard
          icon={Timer}
          label="Hours worked"
          value={minutesToHm(totals.workedMinutes)}
          hint="Total across the team"
          loading={!summary && canSeeSummary}
          tone="info"
        />
        <StatCard
          icon={Clock}
          label="Overtime"
          value={minutesToHm(totals.overtimeMinutes)}
          hint="Beyond the configured work day"
          loading={!summary && canSeeSummary}
          tone="warning"
        />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'days', label: 'Daily log', icon: CalendarCheck },
          ...(canSeeSummary ? [{ value: 'team', label: 'Team summary', icon: Users }] : []),
        ]}
      />

      <TabPanel value="days" active={tab}>
        <div className="space-y-4">
          <Card className={FILTER_CARD}>
            <CardContent className={FILTER_ROW}>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="Search rep name or note…"
                  className="pl-9 pr-9"
                  aria-label="Search attendance"
                />
                {searchDraft && (
                  <button
                    type="button"
                    onClick={() => setSearchDraft('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent focus-ring"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <FilterPanel
                active={[status, dateFrom, dateTo].filter(Boolean).length}
                onReset={hasActiveFilters ? resetAll : undefined}
              >
                <Select
                  value={status}
                  onChange={(e) => setParam({ status: e.target.value, page: 1 })}
                  className="w-44"
                  aria-label="Filter by status"
                >
                  {STATUS_OPTIONS.map((value) => (
                    <option key={value || 'all'} value={value}>
                      {value ? titleCase(value.replace(/_/g, ' ')) : 'All statuses'}
                    </option>
                  ))}
                </Select>

                <Input
                  type="date"
                  value={dateFrom}
                  max={dateTo || todayInput()}
                  onChange={(e) => setParam({ dateFrom: e.target.value, page: 1 })}
                  className="w-40"
                  aria-label="From date"
                />
                <Input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  max={todayInput()}
                  onChange={(e) => setParam({ dateTo: e.target.value, page: 1 })}
                  className="w-40"
                  aria-label="To date"
                />
              </FilterPanel>
            </CardContent>
          </Card>

          {isLoading ? (
            <Card>
              <CardContent className="space-y-3 py-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </CardContent>
            </Card>
          ) : isError ? (
            <Card>
              <EmptyState
                icon="error"
                title="Could not load attendance"
                description={apiError(error).message}
              />
            </Card>
          ) : rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={hasActiveFilters ? 'search' : 'empty'}
                title={hasActiveFilters ? 'No matching days' : 'No attendance yet'}
                description={
                  hasActiveFilters
                    ? 'Try a different rep, status or date range.'
                    : 'Check in to start logging your working day.'
                }
                action={
                  hasActiveFilters ? (
                    <Button variant="outline" size="sm" onClick={resetAll}>
                      Clear filters
                    </Button>
                  ) : null
                }
              />
            </Card>
          ) : (
            <Card className={isFetching ? 'opacity-80 transition-opacity' : 'transition-opacity'}>
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead
                        key={col.key}
                        className={col.className}
                        sortable={col.sortable}
                        onClick={col.sortable ? () => toggleSort(col.sortable) : undefined}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.header}
                          {col.sortable && sort === col.sortable && (
                            order === 'asc' ? (
                              <ArrowUp className="h-3 w-3" aria-label="Sorted ascending" />
                            ) : (
                              <ArrowDown className="h-3 w-3" aria-label="Sorted descending" />
                            )
                          )}
                        </span>
                      </TableHead>
                    ))}
                    {can('fieldforce.attendance.approve') && (
                      <TableHead className="w-24 text-right">Review</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      {columns.map((col) => (
                        <TableCell key={col.key} className={col.className}>
                          {col.render ? col.render(row) : row[col.key] ?? '—'}
                        </TableCell>
                      ))}
                      {can('fieldforce.attendance.approve') && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={Boolean(row.reviewedAt)}
                            onClick={() => reviewMutation.mutate({ row, reviewNote: 'Verified' })}
                          >
                            {row.reviewedAt ? 'Reviewed' : 'Approve'}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Pagination
                meta={{ ...meta, page, limit }}
                onPageChange={(p) => setParam({ page: p })}
                onLimitChange={(l) => setParam({ limit: l, page: 1 })}
              />
            </Card>
          )}
        </div>
      </TabPanel>

      <TabPanel value="team" active={tab}>
        <Card>
          {users.length === 0 ? (
            <EmptyState
              icon="empty"
              title="No attendance in this period"
              description="Widen the date range to see the per-rep rollup."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rep</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Present</TableHead>
                  <TableHead className="text-right">Absent</TableHead>
                  <TableHead className="text-right">Leave</TableHead>
                  <TableHead className="text-right">Worked</TableHead>
                  <TableHead className="text-right">Overtime</TableHead>
                  <TableHead className="text-right">Distance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.userId}>
                    <TableCell className="font-medium">{u.userName || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(u.days)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(u.presentDays)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(u.absentDays)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(u.leaveDays)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {minutesToHm(u.workedMinutes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {u.overtimeMinutes ? minutesToHm(u.overtimeMinutes) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {u.distanceMeters ? `${(u.distanceMeters / 1000).toFixed(1)} km` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </TabPanel>

      {!isLoading && rows.length > 0 && tab === 'days' && !can('fieldforce.attendance.approve') && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarOff className="h-3.5 w-3.5" />
          A rep can see and correct their own days; managers review the team.
        </p>
      )}
    </div>
  );
}
