import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  MapPin,
  MoreHorizontal,
  Navigation,
  Search,
  SkipForward,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { useLookups } from '@/hooks/useLookups';
import { formatDate, formatDateTime, formatNumber, titleCase, formatMoney } from '@/utils/format';
import StatCard from '@/components/company/stat-card';
import {
  VISIT_STATUSES,
  VISIT_OUTCOMES,
  VISIT_PURPOSES,
  WorkflowDialog,
  noOrderReasonLabel,
  outcomeLabel,
  purposeLabel,
  visitActionsFor,
} from '@/components/company/fieldforce-shared';

const STATUS_OPTIONS = ['', ...VISIT_STATUSES];
const OUTCOME_OPTIONS = ['', ...VISIT_OUTCOMES];
const PURPOSE_OPTIONS = ['', ...VISIT_PURPOSES];

export default function Visits() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company } = useAuth();
  const { lookups } = useLookups();

  const searchParam = params.get('search') || '';
  const status = params.get('status') || '';
  const outcome = params.get('outcome') || '';
  const purpose = params.get('purpose') || '';
  const salesman = params.get('salesman') || '';
  const customerId = params.get('customerId') || '';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const sort = params.get('sort') || '';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';

  const [searchDraft, setSearchDraft] = useState(searchParam);
  const [action, setAction] = useState(null); // { kind, visit }
  const [deleteTarget, setDeleteTarget] = useState(null);

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
    if (outcome) out.outcome = outcome;
    if (purpose) out.purpose = purpose;
    if (salesman) out.salesman = salesman;
    if (customerId) out.customerId = customerId;
    if (dateFrom) out.dateFrom = dateFrom;
    if (dateTo) out.dateTo = dateTo;
    if (sort) {
      out.sort = sort;
      out.order = order;
    }
    return out;
  }, [page, limit, searchParam, status, outcome, purpose, salesman, customerId, dateFrom, dateTo, sort, order]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'visits', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/visits', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['company', 'visits', 'stats'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/visits/stats');
      return body?.data;
    },
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'visits'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'targets'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (row) => api.delete(`/v1/field-force/visits/${row.id}`),
    onSuccess: () => {
      toast.success('Visit deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const hasActiveFilters = Boolean(
    searchParam || status || outcome || purpose || salesman || customerId || dateFrom || dateTo || sort
  );

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

  const money = (value) =>
    formatMoney(value, company?.currency, undefined, { decimals: 0 });

  const columns = [
    {
      key: 'visitNo',
      header: 'Visit',
      sortable: 'visitDay',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.visitNo || 'Visit'}</p>
          <p className="truncate text-xs text-muted-foreground">{purposeLabel(row.purpose)}</p>
        </div>
      ),
    },
    {
      key: 'customerName',
      header: 'Customer',
      sortable: 'customerName',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.customerName || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{row.customerCode || ' '}</p>
        </div>
      ),
    },
    {
      key: 'salesmanName',
      header: 'Rep',
      sortable: 'salesmanName',
      render: (row) => <span className="truncate text-sm">{row.salesmanName || '—'}</span>,
    },
    {
      key: 'visitDay',
      header: 'Day',
      sortable: 'visitDay',
      render: (row) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap text-sm">{formatDate(row.visitDay)}</p>
          {row.checkIn?.at && (
            <p className="truncate text-xs text-muted-foreground">
              In {formatDateTime(row.checkIn.at)}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'durationMinutes',
      header: 'Stay',
      className: 'text-right',
      render: (row) => (
        <span className="tabular-nums text-sm text-muted-foreground">
          {row.durationMinutes ? `${Math.round(row.durationMinutes)}m` : '—'}
        </span>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          {row.outcome ? <StatusBadge status={row.outcome} /> : <span className="text-xs text-muted-foreground">—</span>}
          {row.noOrderReason && <span className="text-xs text-muted-foreground">{noOrderReasonLabel(row.noOrderReason)}</span>}
          {row.outsideGeofence && (
            <Badge tone="warning" title="Checked in away from the customer's pinned location">
              {row.checkInDistanceM != null ? `${row.checkInDistanceM} m away` : 'Away from shop'}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'orderValue',
      header: 'Order',
      className: 'text-right',
      render: (row) => (
        <span className="tabular-nums text-sm">
          {row.orderValue ? money(row.orderValue) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: 'status',
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Visits report"
        description="Every shop visit from the Sales visit screen: time at the shop, distance from the pinned location, outcome and no-order reason."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Visits report' }]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={MapPin}
          label="Total visits"
          value={formatNumber(stats?.total ?? 0)}
          hint={`${formatNumber(stats?.today?.planned ?? 0)} planned today`}
          loading={statsLoading}
          tone="brand"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed today"
          value={formatNumber(stats?.today?.completed ?? 0)}
          hint={`${formatNumber(stats?.today?.inProgress ?? 0)} in progress now`}
          loading={statsLoading}
          tone="success"
        />
        <StatCard
          icon={Navigation}
          label="Orders this month"
          value={formatNumber(stats?.month?.visits ?? 0)}
          hint={`${money(stats?.month?.orderValue ?? 0)} booked from visits`}
          loading={statsLoading}
          tone="info"
        />
        <StatCard
          icon={SkipForward}
          label="Skipped today"
          value={formatNumber(stats?.today?.skipped ?? 0)}
          hint={`${formatNumber(stats?.outcomeCounts?.PAYMENT_COLLECTED ?? 0)} collections recorded`}
          loading={statsLoading}
          tone="warning"
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 py-4 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search visit no, customer, code or rep…"
              className="pl-9 pr-9"
              aria-label="Search visits"
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

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onChange={(e) => setParam({ status: e.target.value, page: 1 })}
              className="w-40"
              aria-label="Filter by status"
            >
              {STATUS_OPTIONS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? titleCase(value.replace(/_/g, ' ')) : 'All statuses'}
                </option>
              ))}
            </Select>

            <Select
              value={outcome}
              onChange={(e) => setParam({ outcome: e.target.value, page: 1 })}
              className="w-48"
              aria-label="Filter by outcome"
            >
              {OUTCOME_OPTIONS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? outcomeLabel(value) : 'All outcomes'}
                </option>
              ))}
            </Select>

            <Select
              value={purpose}
              onChange={(e) => setParam({ purpose: e.target.value, page: 1 })}
              className="w-44"
              aria-label="Filter by purpose"
            >
              {PURPOSE_OPTIONS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? purposeLabel(value) : 'All purposes'}
                </option>
              ))}
            </Select>

            <Select
              value={customerId}
              onChange={(e) => setParam({ customerId: e.target.value, page: 1 })}
              className="w-48"
              aria-label="Filter by customer"
            >
              <option value="">All customers</option>
              {(lookups.customers || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.code ? ` (${c.code})` : ''}
                </option>
              ))}
            </Select>

            <Input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setParam({ dateFrom: e.target.value, page: 1 })}
              className="w-40"
              aria-label="From date"
            />
            <Input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setParam({ dateTo: e.target.value, page: 1 })}
              className="w-40"
              aria-label="To date"
            />

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={resetAll}>
                Reset
              </Button>
            )}
          </div>
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
            title="Could not load visits"
            description={apiError(error).message}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={hasActiveFilters ? 'search' : 'empty'}
            title={hasActiveFilters ? 'No matching visits' : 'No visits yet'}
            description={
              hasActiveFilters
                ? 'Try a different search term, status, outcome or date range.'
                : 'Plan your beat and check in at each stop to start tracking field activity.'
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
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const available = visitActionsFor(row, can).filter((k) => k === 'cancel');
                return (
                  <TableRow key={row.id}>
                    {columns.map((col) => (
                      <TableCell key={col.key} className={col.className}>
                        {col.render ? col.render(row) : row[col.key] ?? '—'}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <DropdownMenu
                        align="end"
                        width="w-52"
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions for {row.visitNo || row.id}</span>
                          </span>
                        }
                      >
                        {({ close }) => (
                          <>
                            {available.includes('cancel') && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  close();
                                  setAction({ kind: 'cancel', visit: row });
                                }}
                              >
                                <XCircle className="h-4 w-4" /> Cancel visit
                              </DropdownMenuItem>
                            )}
                            {can('fieldforce.visits.manage') && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => {
                                    close();
                                    setDeleteTarget(row);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </>
                        )}
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Pagination
            meta={{ ...meta, page, limit }}
            onPageChange={(p) => setParam({ page: p })}
            onLimitChange={(l) => setParam({ limit: l, page: 1 })}
          />
        </Card>
      )}

      {action?.kind === 'cancel' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/field-force/visits/${action.visit?.id}/cancel`}
          title="Cancel this visit?"
          description="Cancelling removes the stop from the beat. It is kept for audit."
          subject={`${action.visit?.visitNo || 'Visit'} · ${action.visit?.customerName || ''}`}
          confirmLabel="Cancel visit"
          tone="destructive"
          fields={[
            {
              name: 'reason',
              label: 'Reason for cancelling',
              type: 'text',
              required: true,
              minLength: 3,
              autoFocus: true,
            },
          ]}
          errorTitle="Could not cancel the visit"
          invalidateKeys={[['company', 'visits'], ['company', 'targets']]}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete this visit?"
        message={
          deleteTarget
            ? `${deleteTarget.visitNo || 'This visit'} will be permanently removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
