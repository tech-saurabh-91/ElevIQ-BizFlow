import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
  Truck,
  X,
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
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';
import {
  ORDER_STATUSES,
  OrderActionDialog,
  downloadOrdersXlsx,
  openOrderPdf,
  orderActionsFor,
  statusLabel,
} from '@/components/company/order-shared';

const STATUS_OPTIONS = ['', ...ORDER_STATUSES];

function StatCard({ label, value, hint, icon: Icon, tone = 'brand', loading }) {
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
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
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

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company, user } = useAuth();
  // A salesman books these inside a shop visit (Sales visit), not from here.
  const canNew = can('orders.create') && user?.role !== 'SALESMAN';

  const searchParam = params.get('search') || '';
  const status = params.get('status') || '';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const sort = params.get('sort') || '';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';

  const [searchDraft, setSearchDraft] = useState(searchParam);
  const [action, setAction] = useState(null); // { action, order }
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
    if (dateFrom) out.dateFrom = dateFrom;
    if (dateTo) out.dateTo = dateTo;
    if (sort) {
      out.sort = sort;
      out.order = order;
    }
    return out;
  }, [page, limit, searchParam, status, dateFrom, dateTo, sort, order]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'orders', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/orders', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['company', 'orders', 'stats'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/orders/stats');
      return body?.data;
    },
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (row) => api.delete(`/v1/orders/${row.id}`),
    onSuccess: () => {
      toast.success('Draft order deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const hasActiveFilters = Boolean(searchParam || status || dateFrom || dateTo || sort);

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

  const money = (value) => formatMoney(value, company?.currency || 'INR');

  const columns = [
    {
      key: 'orderNo',
      header: 'Order',
      sortable: 'orderNo',
      render: (row) => (
        <div className="min-w-0">
          <Link
            to={`/app/orders/${row.id}`}
            className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
          >
            {row.orderNo || 'Draft'}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {row.poReference ? `PO ${row.poReference}` : `${formatNumber(row.itemCount || 0)} units`}
          </p>
        </div>
      ),
    },
    {
      key: 'customerName',
      header: 'Customer',
      sortable: 'customerName',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.customer?.name || row.customerName || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.customer?.code || row.customerCode || row.customerPhone || ' '}
          </p>
        </div>
      ),
    },
    {
      key: 'orderDate',
      header: 'Date',
      sortable: 'orderDate',
      render: (row) => (
        <span className="whitespace-nowrap text-sm">{formatDate(row.orderDate)}</span>
      ),
    },
    {
      key: 'salesman',
      header: 'Salesman',
      render: (row) => (
        <span className="text-sm text-muted-foreground">{row.salesman?.name || 'Unassigned'}</span>
      ),
    },
    {
      key: 'total',
      header: 'Value',
      sortable: 'total',
      className: 'text-right',
      render: (row) => <span className="font-medium tabular-nums">{money(row.total)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: 'status',
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  const actionsFor = (row) => orderActionsFor(row, can);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        description="Book sales orders, track approvals and follow fulfilment."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Orders' }]}
        actions={
          <>
            {can('orders.export') && (
              <Button variant="outline" onClick={() => downloadOrdersXlsx(queryParams)}>
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            {canNew && (
              <Button onClick={() => navigate('/app/orders/new')}>
                <Plus className="h-4 w-4" />
                New order
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ShoppingCart}
          label="Total orders"
          value={formatNumber(stats?.total ?? 0)}
          hint={`${formatNumber(stats?.pendingApprovals ?? 0)} awaiting approval`}
          loading={statsLoading}
          tone="brand"
        />
        <StatCard
          icon={CalendarClock}
          label="Pending approval"
          value={formatNumber(stats?.pendingApprovals ?? 0)}
          hint="Needs a manager decision"
          loading={statsLoading}
          tone="warning"
        />
        <StatCard
          icon={CheckCircle2}
          label="Booked this month"
          value={money(stats?.month?.value ?? 0)}
          hint={`${formatNumber(stats?.month?.count ?? 0)} orders`}
          loading={statsLoading}
          tone="success"
        />
        <StatCard
          icon={ClipboardList}
          label="Booked today"
          value={money(stats?.today?.value ?? 0)}
          hint={`${formatNumber(stats?.today?.count ?? 0)} orders · avg ${money(
            stats?.averageValue ?? 0
          )}`}
          loading={statsLoading}
          tone="muted"
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 py-4 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search order no, customer, phone or PO reference…"
              className="pl-9 pr-9"
              aria-label="Search orders"
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
              className="w-48"
              aria-label="Filter by status"
            >
              {STATUS_OPTIONS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? statusLabel(value) : 'All statuses'}
                </option>
              ))}
            </Select>

            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setParam({ dateFrom: e.target.value, page: 1 })}
              className="w-40"
              aria-label="From date"
            />
            <Input
              type="date"
              value={dateTo}
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
            title="Could not load orders"
            description={apiError(error).message}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={hasActiveFilters ? 'search' : 'empty'}
            title={hasActiveFilters ? 'No matching orders' : 'No orders yet'}
            description={
              hasActiveFilters
                ? 'Try a different search term, status or date range.'
                : 'Book your first sales order to start tracking approvals and fulfilment.'
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={resetAll}>
                  Clear filters
                </Button>
              ) : canNew ? (
                <Button size="sm" onClick={() => navigate('/app/orders/new')}>
                  <Plus className="h-4 w-4" />
                  New order
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
                const available = actionsFor(row);
                const isDraft = row.status === 'DRAFT';
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
                            <span className="sr-only">Actions for {row.orderNo || row.id}</span>
                          </span>
                        }
                      >
                        {({ close }) => (
                          <>
                            <DropdownMenuItem onClick={() => navigate(`/app/orders/${row.id}`)}>
                              <Eye className="h-4 w-4" /> View order
                            </DropdownMenuItem>
                            {isDraft && can('orders.update') && (
                              <DropdownMenuItem onClick={() => navigate(`/app/orders/${row.id}/edit`)}>
                                <Pencil className="h-4 w-4" /> Edit draft
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => openOrderPdf(row)}>
                              <Printer className="h-4 w-4" /> Print / PDF
                            </DropdownMenuItem>
                            {available.length > 0 && <DropdownMenuSeparator />}
                            {available.includes('submit') && (
                              <DropdownMenuItem
                                onClick={() => setAction({ action: 'submit', order: row })}
                              >
                                <CheckCircle2 className="h-4 w-4" /> Submit
                              </DropdownMenuItem>
                            )}
                            {available.includes('approve') && (
                              <DropdownMenuItem
                                onClick={() => setAction({ action: 'approve', order: row })}
                              >
                                <CheckCircle2 className="h-4 w-4" /> Approve
                              </DropdownMenuItem>
                            )}
                            {available.includes('dispatch') && (
                              <DropdownMenuItem
                                onClick={() => setAction({ action: 'dispatch', order: row })}
                              >
                                <Truck className="h-4 w-4" /> Dispatch
                              </DropdownMenuItem>
                            )}
                            {available.includes('deliver') && (
                              <DropdownMenuItem
                                onClick={() => setAction({ action: 'deliver', order: row })}
                              >
                                <Truck className="h-4 w-4" /> Delivered
                              </DropdownMenuItem>
                            )}
                            {available.includes('cancel') && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setAction({ action: 'cancel', order: row })}
                              >
                                <X className="h-4 w-4" /> Cancel order
                              </DropdownMenuItem>
                            )}
                            {isDraft && can('orders.delete') && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => {
                                    close();
                                    setDeleteTarget(row);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" /> Delete draft
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

      <OrderActionDialog
        action={action?.action}
        order={action?.order}
        open={Boolean(action)}
        onClose={() => setAction(null)}
        onDone={invalidate}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete this draft order?"
        message={
          deleteTarget
            ? `${deleteTarget.orderNo || 'This draft'} will be permanently removed. Only drafts can be deleted.`
            : ''
        }
        confirmLabel="Delete draft"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
