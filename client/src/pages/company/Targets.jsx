import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  Award,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Target as TargetIcon,
  Trash2,
  TrendingUp,
  X,
  XCircle,
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
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatNumber, titleCase, formatMoney } from '@/utils/format';
import StatCard from '@/components/company/stat-card';
import {
  TARGET_PERIODS,
  TARGET_STATUSES,
  WorkflowDialog,
  ProgressBar,
} from '@/components/company/fieldforce-shared';

const PERIOD_OPTIONS = ['', ...TARGET_PERIODS];
const STATUS_OPTIONS = ['', ...TARGET_STATUSES];

/** Create / edit a target: pick an owner (rep XOR route), a period and goals. */
function TargetForm({ open, mode, initial, onClose, onSaved }) {
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    periodType: 'MONTH',
    owner: 'salesman',
    salesman: '',
    route: '',
    targetValue: '',
    targetOrders: '',
    targetVisits: '',
    notes: '',
  });

  // Seed the form whenever it opens (create or edit).
  useEffect(() => {
    if (!open) return;
    setForm({
      name: initial?.name || '',
      periodType: initial?.periodType || 'MONTH',
      owner: initial?.route ? 'route' : 'salesman',
      salesman: initial?.salesman?.id || initial?.salesman || '',
      route: initial?.route?.id || initial?.route || '',
      targetValue: initial?.targetValue ?? '',
      targetOrders: initial?.targetOrders ?? '',
      targetVisits: initial?.targetVisits ?? '',
      notes: initial?.notes || '',
    });
  }, [open, initial]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const { data: options } = useQuery({
    queryKey: ['company', 'targets', 'form-options'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/targets/form-options');
      return body?.data;
    },
    enabled: open,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (payload) => {
      if (mode === 'edit' && initial?.id) {
        const { data } = await api.patch(`/v1/field-force/targets/${initial.id}`, payload);
        return data;
      }
      const { data } = await api.post('/v1/field-force/targets', payload);
      return data;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || (mode === 'edit' ? 'Target updated' : 'Target created'));
      queryClient.invalidateQueries({ queryKey: ['company', 'targets'] });
      onSaved?.();
      onClose();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const isRoute = form.owner === 'route';
  const ownerId = isRoute ? form.route : form.salesman;
  const canSubmit = Boolean(ownerId);

  const submit = () => {
    const payload = { periodType: form.periodType };
    if (form.name.trim()) payload.name = form.name.trim();
    if (isRoute) payload.route = form.route;
    else payload.salesman = form.salesman;
    if (form.targetValue !== '') payload.targetValue = Number(form.targetValue);
    if (form.targetOrders !== '') payload.targetOrders = Number(form.targetOrders);
    if (form.targetVisits !== '') payload.targetVisits = Number(form.targetVisits);
    if (form.notes.trim()) payload.notes = form.notes.trim();
    mutation.mutate(payload);
  };

  const salesmen = (options?.salesmen || []).filter((u) => u.role === 'SALESMAN');
  const routes = options?.routes || [];
  const window = options?.windows?.[form.periodType];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? 'Edit target' : 'Set a sales target'}
      description="Assign a revenue / activity goal to a rep or a whole beat for a period."
      size="md"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} loading={mutation.isPending}>
            {mode === 'edit' ? 'Save changes' : 'Create target'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium" htmlFor="target-name">
            Name
          </label>
          <Input
            id="target-name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder={window ? `${window.periodLabel} goal` : 'Optional label'}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="target-period">
            Period <span className="text-destructive">*</span>
          </label>
          <Select
            id="target-period"
            value={form.periodType}
            onChange={(e) => set('periodType', e.target.value)}
            disabled={mode === 'edit'}
          >
            {TARGET_PERIODS.map((p) => (
              <option key={p} value={p}>
                {titleCase(p)}
                {options?.windows?.[p] ? ` · ${options.windows[p].periodLabel}` : ''}
              </option>
            ))}
          </Select>
          {window && (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDate(window.startDate)} – {formatDate(window.endDate)}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Assign to</label>
          <Select
            value={form.owner}
            onChange={(e) => set('owner', e.target.value)}
            disabled={mode === 'edit'}
            aria-label="Assign target to"
          >
            <option value="salesman">A salesman</option>
            <option value="route">A route / beat</option>
          </Select>
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium" htmlFor="target-owner">
            {isRoute ? 'Route' : 'Salesman'} <span className="text-destructive">*</span>
          </label>
          <Select
            id="target-owner"
            value={ownerId}
            onChange={(e) => set(isRoute ? 'route' : 'salesman', e.target.value)}
            disabled={mode === 'edit'}
          >
            <option value="">{isRoute ? 'Select a route…' : 'Select a salesman…'}</option>
            {isRoute
              ? routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.code ? ` (${r.code})` : ''}
                  </option>
                ))
              : salesmen.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.territory ? ` · ${u.territory}` : ''}
                  </option>
                ))}
          </Select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="target-value">
            Revenue target
          </label>
          <Input
            id="target-value"
            type="number"
            min="0"
            value={form.targetValue}
            onChange={(e) => set('targetValue', e.target.value)}
            placeholder="0"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="target-orders">
            Orders target
          </label>
          <Input
            id="target-orders"
            type="number"
            min="0"
            value={form.targetOrders}
            onChange={(e) => set('targetOrders', e.target.value)}
            placeholder="0"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="target-visits">
            Visits target
          </label>
          <Input
            id="target-visits"
            type="number"
            min="0"
            value={form.targetVisits}
            onChange={(e) => set('targetVisits', e.target.value)}
            placeholder="0"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="target-notes">
            Notes
          </label>
          <Input
            id="target-notes"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Optional"
          />
        </div>

        {mode === 'edit' && (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Achievements are recalculated from booked orders when you save.
          </p>
        )}
      </div>
    </Dialog>
  );
}

export default function Targets() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company } = useAuth();

  const searchParam = params.get('search') || '';
  const status = params.get('status') || '';
  const periodType = params.get('periodType') || '';
  const salesman = params.get('salesman') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const sort = params.get('sort') || '';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';

  const [searchDraft, setSearchDraft] = useState(searchParam);
  const [form, setForm] = useState(null); // { mode, initial }
  const [closeTarget, setCloseTarget] = useState(null);
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
    if (periodType) out.periodType = periodType;
    if (salesman) out.salesman = salesman;
    if (sort) {
      out.sort = sort;
      out.order = order;
    }
    return out;
  }, [page, limit, searchParam, status, periodType, salesman, sort, order]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'targets', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/targets', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const { data: progress, isLoading: progressLoading } = useQuery({
    queryKey: ['company', 'targets', 'progress', { periodType }],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/targets/progress', {
        params: periodType ? { periodType } : {},
      });
      return body?.data;
    },
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'targets'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (row) => api.delete(`/v1/field-force/targets/${row.id}`),
    onSuccess: () => {
      toast.success('Target deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const refreshMutation = useMutation({
    mutationFn: (row) => api.post(`/v1/field-force/targets/${row.id}/refresh`, {}),
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Achievements refreshed');
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const hasActiveFilters = Boolean(searchParam || status || periodType || salesman || sort);

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
      key: 'name',
      header: 'Target',
      sortable: 'name',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.name || row.periodLabel || 'Target'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.routeName || row.salesmanName || row.periodLabel}
            {row.route ? ' · route' : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'periodLabel',
      header: 'Period',
      render: (row) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap text-sm">{row.periodLabel || row.periodKey}</p>
          <p className="truncate text-xs text-muted-foreground">{titleCase(row.periodType)}</p>
        </div>
      ),
    },
    {
      key: 'targetValue',
      header: 'Goal',
      sortable: 'targetValue',
      className: 'text-right',
      render: (row) => <span className="tabular-nums">{money(row.targetValue)}</span>,
    },
    {
      key: 'achievedValue',
      header: 'Achieved',
      sortable: 'achievedValue',
      className: 'text-right',
      render: (row) => (
        <span className="tabular-nums font-medium">{money(row.achievedValue)}</span>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      className: 'w-44',
      render: (row) => {
        const pct =
          Number(row.targetValue) > 0
            ? Math.min(100, (Number(row.achievedValue) / Number(row.targetValue)) * 100)
            : 0;
        return (
          <div className="min-w-0">
            <ProgressBar percent={pct} />
            <p className="mt-1 text-xs text-muted-foreground">{pct.toFixed(0)}%</p>
          </div>
        );
      },
    },
    {
      key: 'activity',
      header: 'Orders / Visits',
      className: 'text-right',
      render: (row) => (
        <div className="text-xs tabular-nums text-muted-foreground">
          <p>
            {formatNumber(row.achievedOrders)}/{formatNumber(row.targetOrders)} orders
          </p>
          <p>
            {formatNumber(row.achievedVisits)}/{formatNumber(row.targetVisits)} visits
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: 'status',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={row.status} />
          {row.status === 'ACHIEVED' && <Award className="h-3.5 w-3.5 text-success" />}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Targets"
        description="Set revenue and activity goals for reps and beats, and track achievement."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Sales Targets' }]}
        actions={
          can('fieldforce.targets.manage') && (
            <Button onClick={() => setForm({ mode: 'create', initial: null })}>
              <Plus className="h-4 w-4" />
              New target
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={TargetIcon}
          label="Overall achievement"
          value={`${progress?.overallPercent ?? 0}%`}
          hint={`${formatNumber(progress?.total ?? 0)} targets in scope`}
          loading={progressLoading}
          tone="brand"
        />
        <StatCard
          icon={TrendingUp}
          label="Goal vs achieved"
          value={money(progress?.totalAchieved ?? 0)}
          hint={`of ${money(progress?.totalTarget ?? 0)} targeted`}
          loading={progressLoading}
          tone="info"
        />
        <StatCard
          icon={Award}
          label="Targets achieved"
          value={formatNumber(progress?.achievedCount ?? 0)}
          hint={`${formatNumber(progress?.activeCount ?? 0)} still active`}
          loading={progressLoading}
          tone="success"
        />
        <StatCard
          icon={XCircle}
          label="Missed"
          value={formatNumber(progress?.missedCount ?? 0)}
          hint="Closed below goal"
          loading={progressLoading}
          tone="warning"
        />
      </div>

      <Card className={FILTER_CARD}>
        <CardContent className={FILTER_ROW}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search target, rep or period…"
              className="pl-9 pr-9"
              aria-label="Search targets"
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
            active={[periodType, status].filter(Boolean).length}
            onReset={hasActiveFilters ? resetAll : undefined}
          >
            <Select
              value={periodType}
              onChange={(e) => setParam({ periodType: e.target.value, page: 1 })}
              className="w-36"
              aria-label="Filter by period"
            >
              {PERIOD_OPTIONS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? titleCase(value) : 'All periods'}
                </option>
              ))}
            </Select>

            <Select
              value={status}
              onChange={(e) => setParam({ status: e.target.value, page: 1 })}
              className="w-40"
              aria-label="Filter by status"
            >
              {STATUS_OPTIONS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? titleCase(value) : 'All statuses'}
                </option>
              ))}
            </Select>
          </FilterPanel>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState
            icon="error"
            title="Could not load targets"
            description={apiError(error).message}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={hasActiveFilters ? 'search' : 'empty'}
            title={hasActiveFilters ? 'No matching targets' : 'No targets yet'}
            description={
              hasActiveFilters
                ? 'Try a different period, status or search term.'
                : 'Set a goal for a rep or a beat to start measuring achievement.'
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={resetAll}>
                  Clear filters
                </Button>
              ) : can('fieldforce.targets.manage') ? (
                <Button size="sm" onClick={() => setForm({ mode: 'create', initial: null })}>
                  <Plus className="h-4 w-4" />
                  New target
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <Card className={isFetching ? 'opacity-80 transition-opacity' : 'transition-opacity'}>
          <Table cards>
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
                {can('fieldforce.targets.manage') && (
                  <TableHead className="w-12 text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      className={col.className}
                      data-label={typeof col.header === 'string' ? col.header : undefined}
                    >
                      {col.render ? col.render(row) : row[col.key] ?? '—'}
                    </TableCell>
                  ))}
                  {can('fieldforce.targets.manage') && (
                    <TableCell className="text-right" data-actions>
                      <DropdownMenu
                        align="end"
                        width="w-48"
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions for {row.name || row.id}</span>
                          </span>
                        }
                      >
                        {({ close }) => (
                          <>
                            {row.status !== 'CLOSED' && (
                              <DropdownMenuItem
                                onClick={() => {
                                  close();
                                  setForm({ mode: 'edit', initial: row });
                                }}
                              >
                                <Pencil className="h-4 w-4" /> Edit target
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => {
                                close();
                                refreshMutation.mutate(row);
                              }}
                            >
                              <RefreshCw className="h-4 w-4" /> Refresh achievement
                            </DropdownMenuItem>
                            {row.status !== 'CLOSED' && (
                              <DropdownMenuItem
                                onClick={() => {
                                  close();
                                  setCloseTarget(row);
                                }}
                              >
                                <CheckCircle2 className="h-4 w-4" /> Close target
                              </DropdownMenuItem>
                            )}
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
                      </DropdownMenu>
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

      <TargetForm
        open={Boolean(form)}
        mode={form?.mode}
        initial={form?.initial}
        onClose={() => setForm(null)}
        onSaved={invalidate}
      />

      <WorkflowDialog
        open={Boolean(closeTarget)}
        onClose={() => setCloseTarget(null)}
        onDone={invalidate}
        endpoint={`/v1/field-force/targets/${closeTarget?.id}/close`}
        title="Close this target?"
        description="Closing stops further tracking and locks the target for the period."
        subject={closeTarget ? `${closeTarget.name || 'Target'} · ${closeTarget.periodLabel || ''}` : ''}
        confirmLabel="Close target"
        fields={[{ name: 'note', label: 'Closing note (optional)', type: 'text' }]}
        errorTitle="Could not close the target"
        invalidateKeys={[['company', 'targets'], ['company', 'dashboard']]}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete this target?"
        message={
          deleteTarget
            ? `${deleteTarget.name || 'This target'} will be permanently removed. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />

      {!isLoading && rows.length > 0 && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge tone="info">Live</Badge>
          Achievements refresh automatically from booked orders and visits.
        </p>
      )}
    </div>
  );
}
