import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  TriangleAlert,
  Wallet,
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
import { useLookups } from '@/hooks/useLookups';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';
import {
  INVOICE_STATUSES,
  InvoiceActionDialog,
  downloadInvoicesXlsx,
  invoiceActionsFor,
  openInvoicePdf,
  statusLabel,
} from '@/components/company/invoice-shared';

const STATUS_OPTIONS = ['', ...INVOICE_STATUSES];

function StatCard({ label, value, hint, icon: Icon, tone = 'brand', loading }) {
  const tones = {
    brand: 'text-brand-600 dark:text-brand-300 bg-brand-500/12',
    success: 'text-success bg-success/12',
    warning: 'text-warning bg-warning/15',
    destructive: 'text-destructive bg-destructive/12',
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

export default function Invoices() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company } = useAuth();
  const { lookups } = useLookups();

  const searchParam = params.get('search') || '';
  const status = params.get('status') || '';
  const customerId = params.get('customerId') || '';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const sort = params.get('sort') || '';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';

  const [searchDraft, setSearchDraft] = useState(searchParam);
  const [action, setAction] = useState(null); // { action, invoice }
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
    if (customerId) out.customerId = customerId;
    if (dateFrom) out.dateFrom = dateFrom;
    if (dateTo) out.dateTo = dateTo;
    if (sort) {
      out.sort = sort;
      out.order = order;
    }
    return out;
  }, [page, limit, searchParam, status, customerId, dateFrom, dateTo, sort, order]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'invoices', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/invoices', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['company', 'invoices', 'stats'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/invoices/stats');
      return body?.data;
    },
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'invoices'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'credit-notes'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (row) => api.delete(`/v1/invoices/${row.id}`),
    onSuccess: () => {
      toast.success('Draft invoice deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const hasActiveFilters = Boolean(searchParam || status || customerId || dateFrom || dateTo || sort);

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
      key: 'invoiceNo',
      header: 'Invoice',
      sortable: 'invoiceNo',
      render: (row) => (
        <div className="min-w-0">
          <Link
            to={`/app/invoices/${row.id}`}
            className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
          >
            {row.invoiceNo || 'Draft'}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {row.orderNo
              ? `Order ${row.orderNo}`
              : row.poReference
                ? `PO ${row.poReference}`
                : row.direct
                  ? 'Direct invoice'
                  : '—'}
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
      key: 'invoiceDate',
      header: 'Invoice date',
      sortable: 'invoiceDate',
      render: (row) => (
        <span className="whitespace-nowrap text-sm">{formatDate(row.invoiceDate)}</span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      sortable: 'dueDate',
      render: (row) => {
        const overdue =
          row.status === 'OVERDUE' ||
          (['ISSUED', 'PARTIALLY_PAID'].includes(row.status) &&
            row.dueDate &&
            new Date(row.dueDate) < new Date());
        return (
          <span
            className={`whitespace-nowrap text-sm ${overdue ? 'font-medium text-destructive' : ''}`}
          >
            {formatDate(row.dueDate)}
          </span>
        );
      },
    },
    {
      key: 'total',
      header: 'Total',
      sortable: 'total',
      className: 'text-right',
      render: (row) => <span className="font-medium tabular-nums">{money(row.total)}</span>,
    },
    {
      key: 'balanceDue',
      header: 'Balance',
      sortable: 'balanceDue',
      className: 'text-right',
      render: (row) => (
        <span
          className={`tabular-nums ${
            Number(row.balanceDue) > 0 ? 'font-medium' : 'text-muted-foreground'
          }`}
        >
          {money(row.balanceDue)}
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
        title="Invoices"
        description="Raise tax invoices from orders or at the counter, then track collections."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Invoices' }]}
        actions={
          <>
            {can('invoices.export') && (
              <Button variant="outline" onClick={() => downloadInvoicesXlsx(queryParams)}>
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            {can('invoices.create') && (
              <Button onClick={() => navigate('/app/invoices/new')}>
                <Plus className="h-4 w-4" />
                New invoice
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FileText}
          label="Total invoices"
          value={formatNumber(stats?.total ?? 0)}
          hint={`${formatNumber(stats?.draftCount ?? 0)} drafts awaiting issue`}
          loading={statsLoading}
          tone="brand"
        />
        <StatCard
          icon={Wallet}
          label="Outstanding"
          value={money(stats?.outstanding ?? 0)}
          hint={`${formatNumber(stats?.overdueCount ?? 0)} overdue invoices`}
          loading={statsLoading}
          tone="warning"
        />
        <StatCard
          icon={TriangleAlert}
          label="Overdue amount"
          value={money(stats?.overdueAmount ?? 0)}
          hint="Past the due date and unpaid"
          loading={statsLoading}
          tone="destructive"
        />
        <StatCard
          icon={CheckCircle2}
          label="Billed this month"
          value={money(stats?.month?.value ?? 0)}
          hint={`${formatNumber(stats?.month?.count ?? 0)} invoices · credit ${money(
            stats?.creditNoteTotal ?? 0
          )}`}
          loading={statsLoading}
          tone="success"
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 py-4 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search invoice no, customer, phone, order or PO reference…"
              className="pl-9 pr-9"
              aria-label="Search invoices"
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
              className="w-44"
              aria-label="Filter by status"
            >
              {STATUS_OPTIONS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? statusLabel(value) : 'All statuses'}
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
            title="Could not load invoices"
            description={apiError(error).message}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={hasActiveFilters ? 'search' : 'empty'}
            title={hasActiveFilters ? 'No matching invoices' : 'No invoices yet'}
            description={
              hasActiveFilters
                ? 'Try a different search term, status, customer or date range.'
                : 'Bill a confirmed order or raise a direct counter invoice to get started.'
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={resetAll}>
                  Clear filters
                </Button>
              ) : can('invoices.create') ? (
                <Button size="sm" onClick={() => navigate('/app/invoices/new')}>
                  <Plus className="h-4 w-4" />
                  New invoice
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
                const available = invoiceActionsFor(row, can);
                const isDraft = row.status === 'DRAFT';
                const canCredit =
                  !isDraft &&
                  row.status !== 'CANCELLED' &&
                  can('creditnotes.create') &&
                  Number(row.balanceDue) > 0;
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
                        width="w-56"
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions for {row.invoiceNo || row.id}</span>
                          </span>
                        }
                      >
                        {({ close }) => (
                          <>
                            <DropdownMenuItem onClick={() => navigate(`/app/invoices/${row.id}`)}>
                              <Eye className="h-4 w-4" /> View invoice
                            </DropdownMenuItem>
                            {isDraft && can('invoices.update') && (
                              <DropdownMenuItem onClick={() => navigate(`/app/invoices/${row.id}/edit`)}>
                                <Pencil className="h-4 w-4" /> Edit draft
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => openInvoicePdf(row)}>
                              <Printer className="h-4 w-4" /> Print / PDF
                            </DropdownMenuItem>
                            {canCredit && (
                              <DropdownMenuItem
                                onClick={() =>
                                  navigate(
                                    `/app/credit-notes/new?invoiceId=${row.id}`
                                  )
                                }
                              >
                                <FileText className="h-4 w-4" /> Create credit note
                              </DropdownMenuItem>
                            )}
                            {available.length > 0 && <DropdownMenuSeparator />}
                            {available.includes('issue') && (
                              <DropdownMenuItem
                                onClick={() => setAction({ action: 'issue', invoice: row })}
                              >
                                <CheckCircle2 className="h-4 w-4" /> Issue invoice
                              </DropdownMenuItem>
                            )}
                            {available.includes('cancel') && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setAction({ action: 'cancel', invoice: row })}
                              >
                                <X className="h-4 w-4" /> Cancel invoice
                              </DropdownMenuItem>
                            )}
                            {isDraft && can('invoices.delete') && (
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

      <InvoiceActionDialog
        action={action?.action}
        invoice={action?.invoice}
        open={Boolean(action)}
        onClose={() => setAction(null)}
        onDone={invalidate}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete this draft invoice?"
        message={
          deleteTarget
            ? `${deleteTarget.invoiceNo || 'This draft'} will be permanently removed. Only drafts can be deleted.`
            : ''
        }
        confirmLabel="Delete draft"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
