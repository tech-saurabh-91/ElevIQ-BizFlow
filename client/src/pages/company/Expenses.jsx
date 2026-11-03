import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  CheckCircle2,
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Wallet,
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
import { formatDate, formatNumber, titleCase, formatMoney } from '@/utils/format';
import StatCard from '@/components/company/stat-card';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  WorkflowDialog,
  categoryLabel,
  expenseActionsFor,
} from '@/components/company/fieldforce-shared';

const STATUS_OPTIONS = ['', ...EXPENSE_STATUSES];
const CATEGORY_OPTIONS = ['', ...EXPENSE_CATEGORIES];

const PAYMENT_MODES = ['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'];

/** Create / edit an expense claim. */
function ExpenseForm({ open, mode, initial, onClose, onSaved }) {
  const queryClient = useQueryClient();
  const { company } = useAuth();

  const [form, setForm] = useState({
    expenseDate: '',
    category: 'TRAVEL',
    amount: '',
    description: '',
    customer: '',
    fromPlace: '',
    toPlace: '',
    distanceKm: '',
    receiptUrl: '',
    notes: '',
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      expenseDate: initial?.expenseDate ? String(initial.expenseDate).slice(0, 10) : '',
      category: initial?.category || 'TRAVEL',
      amount: initial?.amount ?? '',
      description: initial?.description || '',
      customer: initial?.customer?.id || initial?.customer || '',
      fromPlace: initial?.fromPlace || '',
      toPlace: initial?.toPlace || '',
      distanceKm: initial?.distanceKm || '',
      receiptUrl: initial?.receiptUrl || '',
      notes: initial?.notes || '',
    });
  }, [open, initial]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const { data: options } = useQuery({
    queryKey: ['company', 'expenses', 'form-options'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/expenses/form-options');
      return body?.data;
    },
    enabled: open,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (payload) => {
      if (mode === 'edit' && initial?.id) {
        const { data } = await api.patch(`/v1/field-force/expenses/${initial.id}`, payload);
        return data;
      }
      const { data } = await api.post('/v1/field-force/expenses', payload);
      return data;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || (mode === 'edit' ? 'Claim updated' : 'Claim saved as draft'));
      queryClient.invalidateQueries({ queryKey: ['company', 'expenses'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
      onSaved?.();
      onClose();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const submit = (alsoSubmit) => {
    const payload = { category: form.category, amount: Number(form.amount) };
    if (form.expenseDate) payload.expenseDate = form.expenseDate;
    if (form.description.trim()) payload.description = form.description.trim();
    if (form.customer) payload.customer = form.customer;
    if (form.fromPlace.trim()) payload.fromPlace = form.fromPlace.trim();
    if (form.toPlace.trim()) payload.toPlace = form.toPlace.trim();
    if (form.distanceKm !== '') payload.distanceKm = Number(form.distanceKm);
    if (form.receiptUrl.trim()) payload.receiptUrl = form.receiptUrl.trim();
    if (form.notes.trim()) payload.notes = form.notes.trim();
    if (alsoSubmit && mode !== 'edit') payload.submit = true;
    mutation.mutate(payload);
  };

  const canSubmit = Boolean(form.amount) && Number(form.amount) > 0;
  const money = (v) =>
    formatMoney(v, company?.currency, undefined, { decimals: 0 });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? 'Edit claim' : 'New expense claim'}
      description="Log a field spend. Save as a draft, or submit it for approval straight away."
      size="md"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          {mode !== 'edit' && (
            <Button
              variant="secondary"
              onClick={() => submit(true)}
              disabled={!canSubmit}
              loading={mutation.isPending}
            >
              <Send className="h-4 w-4" />
              Save & submit
            </Button>
          )}
          <Button onClick={() => submit(false)} disabled={!canSubmit} loading={mutation.isPending}>
            {mode === 'edit' ? 'Save changes' : 'Save draft'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="exp-date">
            Date
          </label>
          <Input
            id="exp-date"
            type="date"
            value={form.expenseDate}
            onChange={(e) => set('expenseDate', e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="exp-category">
            Category <span className="text-destructive">*</span>
          </label>
          <Select
            id="exp-category"
            value={form.category}
            onChange={(e) => set('category', e.target.value)}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="exp-amount">
            Amount <span className="text-destructive">*</span>
          </label>
          <Input
            id="exp-amount"
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value)}
            placeholder="0"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="exp-customer">
            Customer (optional)
          </label>
          <Select
            id="exp-customer"
            value={form.customer}
            onChange={(e) => set('customer', e.target.value)}
          >
            <option value="">No customer</option>
            {(options?.customers || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium" htmlFor="exp-desc">
            Description
          </label>
          <Input
            id="exp-desc"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What was this spend for?"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="exp-from">
            From
          </label>
          <Input
            id="exp-from"
            value={form.fromPlace}
            onChange={(e) => set('fromPlace', e.target.value)}
            placeholder="Origin"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="exp-to">
            To
          </label>
          <Input
            id="exp-to"
            value={form.toPlace}
            onChange={(e) => set('toPlace', e.target.value)}
            placeholder="Destination"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="exp-distance">
            Distance (km)
          </label>
          <Input
            id="exp-distance"
            type="number"
            min="0"
            value={form.distanceKm}
            onChange={(e) => set('distanceKm', e.target.value)}
            placeholder="0"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="exp-receipt">
            Receipt URL
          </label>
          <Input
            id="exp-receipt"
            value={form.receiptUrl}
            onChange={(e) => set('receiptUrl', e.target.value)}
            placeholder="Link to the bill"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-sm font-medium" htmlFor="exp-notes">
            Notes
          </label>
          <Input
            id="exp-notes"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Anything the approver should know"
          />
        </div>

        {form.amount && (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Claiming {money(form.amount)}
            {form.category === 'TRAVEL' && form.distanceKm
              ? ` for ${form.distanceKm} km`
              : ''}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export default function Expenses() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company } = useAuth();

  const searchParam = params.get('search') || '';
  const status = params.get('status') || '';
  const category = params.get('category') || '';
  const claimant = params.get('claimant') || '';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const sort = params.get('sort') || '';
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';

  const [searchDraft, setSearchDraft] = useState(searchParam);
  const [form, setForm] = useState(null); // { mode, initial }
  const [action, setAction] = useState(null); // { kind, expense }
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
    if (category) out.category = category;
    if (claimant) out.claimant = claimant;
    if (dateFrom) out.dateFrom = dateFrom;
    if (dateTo) out.dateTo = dateTo;
    if (sort) {
      out.sort = sort;
      out.order = order;
    }
    return out;
  }, [page, limit, searchParam, status, category, claimant, dateFrom, dateTo, sort, order]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'expenses', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/expenses', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['company', 'expenses', 'stats'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/expenses/stats');
      return body?.data;
    },
  });

  const { data: options } = useQuery({
    queryKey: ['company', 'expenses', 'form-options'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/field-force/expenses/form-options');
      return body?.data;
    },
    staleTime: 60_000,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'expenses'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (row) => api.delete(`/v1/field-force/expenses/${row.id}`),
    onSuccess: () => {
      toast.success('Draft claim deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const hasActiveFilters = Boolean(
    searchParam || status || category || claimant || dateFrom || dateTo || sort
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

  const downloadXlsx = async () => {
    try {
      const { data } = await api.get('/v1/field-force/expenses/export', {
        params: queryParams,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `expenses-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('Expense register exported');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  const columns = [
    {
      key: 'expenseNo',
      header: 'Claim',
      sortable: 'expenseDate',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{row.expenseNo || 'Draft'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {formatDate(row.expenseDate)}
          </p>
        </div>
      ),
    },
    {
      key: 'claimantName',
      header: 'Claimant',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.claimantName || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{row.claimantRole || ' '}</p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      sortable: 'category',
      render: (row) => <Badge tone="outline">{categoryLabel(row.category)}</Badge>,
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <p className="max-w-[16rem] truncate text-sm text-muted-foreground">
          {row.description || '—'}
        </p>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      sortable: 'amount',
      className: 'text-right',
      render: (row) => <span className="tabular-nums">{money(row.amount)}</span>,
    },
    {
      key: 'approvedAmount',
      header: 'Approved',
      className: 'text-right',
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {row.approvedAmount != null ? money(row.approvedAmount) : '—'}
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
          {row.hasReceipt && <Badge tone="muted">Receipt</Badge>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expense Claims"
        description="Log field spends, approve them and mark reimbursements as paid."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Expense Claims' }]}
        actions={
          <>
            {can('fieldforce.expenses.view') && (
              <Button variant="outline" onClick={downloadXlsx}>
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            {can('fieldforce.expenses.manage') && (
              <Button onClick={() => setForm({ mode: 'create', initial: null })}>
                <Plus className="h-4 w-4" />
                New claim
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Receipt}
          label="Total claims"
          value={formatNumber(stats?.total ?? 0)}
          hint={`${formatNumber(stats?.byStatus?.DRAFT ?? 0)} drafts`}
          loading={statsLoading}
          tone="brand"
        />
        <StatCard
          icon={Send}
          label="Pending approval"
          value={money(stats?.pendingValue ?? 0)}
          hint={`${formatNumber(stats?.pendingCount ?? 0)} awaiting review`}
          loading={statsLoading}
          tone="warning"
        />
        <StatCard
          icon={CheckCircle2}
          label="Approved"
          value={money(stats?.approvedValue ?? 0)}
          hint="Ready to reimburse"
          loading={statsLoading}
          tone="info"
        />
        <StatCard
          icon={Banknote}
          label="Paid this month"
          value={money(stats?.month?.value ?? 0)}
          hint={`${formatNumber(stats?.month?.count ?? 0)} claims this month`}
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
              placeholder="Search claim no, claimant or description…"
              className="pl-9 pr-9"
              aria-label="Search expense claims"
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
                  {value ? titleCase(value) : 'All statuses'}
                </option>
              ))}
            </Select>

            <Select
              value={category}
              onChange={(e) => setParam({ category: e.target.value, page: 1 })}
              className="w-44"
              aria-label="Filter by category"
            >
              {CATEGORY_OPTIONS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value ? categoryLabel(value) : 'All categories'}
                </option>
              ))}
            </Select>

            <Select
              value={claimant}
              onChange={(e) => setParam({ claimant: e.target.value, page: 1 })}
              className="w-48"
              aria-label="Filter by claimant"
            >
              <option value="">All claimants</option>
              {(options?.users || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
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
            title="Could not load expense claims"
            description={apiError(error).message}
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={hasActiveFilters ? 'search' : 'empty'}
            title={hasActiveFilters ? 'No matching claims' : 'No expense claims yet'}
            description={
              hasActiveFilters
                ? 'Try a different status, category, claimant or date range.'
                : 'Log your first field spend to start the reimbursement workflow.'
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={resetAll}>
                  Clear filters
                </Button>
              ) : can('fieldforce.expenses.manage') ? (
                <Button size="sm" onClick={() => setForm({ mode: 'create', initial: null })}>
                  <Plus className="h-4 w-4" />
                  New claim
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
                const available = expenseActionsFor(row, can);
                const isDraft = row.status === 'DRAFT' || row.status === 'REJECTED';
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
                            <span className="sr-only">Actions for {row.expenseNo || row.id}</span>
                          </span>
                        }
                      >
                        {({ close }) => (
                          <>
                            {isDraft && can('fieldforce.expenses.manage') && (
                              <DropdownMenuItem
                                onClick={() => {
                                  close();
                                  setForm({ mode: 'edit', initial: row });
                                }}
                              >
                                <Pencil className="h-4 w-4" /> Edit claim
                              </DropdownMenuItem>
                            )}
                            {available.includes('submit') && (
                              <DropdownMenuItem
                                onClick={() => {
                                  close();
                                  setAction({ kind: 'submit', expense: row });
                                }}
                              >
                                <Send className="h-4 w-4" /> Submit for approval
                              </DropdownMenuItem>
                            )}
                            {available.includes('approve') && (
                              <DropdownMenuItem
                                onClick={() => {
                                  close();
                                  setAction({ kind: 'approve', expense: row });
                                }}
                              >
                                <CheckCircle2 className="h-4 w-4" /> Approve
                              </DropdownMenuItem>
                            )}
                            {available.includes('reject') && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  close();
                                  setAction({ kind: 'reject', expense: row });
                                }}
                              >
                                <XCircle className="h-4 w-4" /> Reject
                              </DropdownMenuItem>
                            )}
                            {available.includes('pay') && (
                              <DropdownMenuItem
                                onClick={() => {
                                  close();
                                  setAction({ kind: 'pay', expense: row });
                                }}
                              >
                                <Wallet className="h-4 w-4" /> Mark as paid
                              </DropdownMenuItem>
                            )}
                            {available.includes('reopen') && (
                              <DropdownMenuItem
                                onClick={() => {
                                  close();
                                  setAction({ kind: 'reopen', expense: row });
                                }}
                              >
                                <RotateCcw className="h-4 w-4" /> Reopen
                              </DropdownMenuItem>
                            )}
                            {isDraft && can('fieldforce.expenses.manage') && (
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

      <ExpenseForm
        open={Boolean(form)}
        mode={form?.mode}
        initial={form?.initial}
        onClose={() => setForm(null)}
        onSaved={invalidate}
      />

      {action?.kind === 'submit' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/field-force/expenses/${action.expense?.id}/submit`}
          title="Submit this claim?"
          description="Once submitted only an approver can move it forward."
          subject={`${action.expense?.expenseNo || 'Draft'} · ${money(action.expense?.amount)}`}
          confirmLabel="Submit claim"
          fields={[{ name: 'note', label: 'Note (optional)', type: 'text' }]}
          errorTitle="Could not submit the claim"
          invalidateKeys={[['company', 'expenses'], ['company', 'dashboard']]}
        />
      )}

      {action?.kind === 'approve' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/field-force/expenses/${action.expense?.id}/approve`}
          title="Approve this claim?"
          description={`The claimed amount is ${money(action.expense?.amount)}. Approve in full, or enter a lower amount.`}
          subject={`${action.expense?.expenseNo || 'Claim'} · ${action.expense?.claimantName || ''}`}
          confirmLabel="Approve"
          fields={[
            { name: 'approvedAmount', label: 'Approved amount', type: 'number', min: 0 },
            { name: 'note', label: 'Note (optional)', type: 'text' },
          ]}
          errorTitle="Could not approve the claim"
          invalidateKeys={[['company', 'expenses'], ['company', 'dashboard']]}
          prepareBody={(body) => {
            const payload = { ...body };
            if (payload.approvedAmount === undefined) payload.approvedAmount = action.expense?.amount;
            return payload;
          }}
        />
      )}

      {action?.kind === 'reject' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/field-force/expenses/${action.expense?.id}/reject`}
          title="Reject this claim?"
          description="The claimant will see the reason and can edit and resubmit."
          subject={`${action.expense?.expenseNo || 'Claim'} · ${action.expense?.claimantName || ''}`}
          confirmLabel="Reject claim"
          tone="destructive"
          fields={[
            {
              name: 'reason',
              label: 'Reason for rejecting',
              type: 'text',
              required: true,
              minLength: 3,
              autoFocus: true,
            },
          ]}
          errorTitle="Could not reject the claim"
          invalidateKeys={[['company', 'expenses'], ['company', 'dashboard']]}
        />
      )}

      {action?.kind === 'pay' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/field-force/expenses/${action.expense?.id}/pay`}
          title="Mark as paid?"
          description="Record how the reimbursement was made so it lands in the pay register."
          subject={`${action.expense?.expenseNo || 'Claim'} · ${money(
            action.expense?.approvedAmount ?? action.expense?.amount
          )}`}
          confirmLabel="Mark as paid"
          fields={[
            {
              name: 'paymentMode',
              label: 'Payment mode',
              type: 'select',
              options: PAYMENT_MODES,
              autoFocus: true,
            },
            { name: 'paymentReference', label: 'Reference (optional)', type: 'text' },
            { name: 'note', label: 'Note (optional)', type: 'text' },
          ]}
          errorTitle="Could not mark as paid"
          invalidateKeys={[['company', 'expenses'], ['company', 'dashboard']]}
        />
      )}

      {action?.kind === 'reopen' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/field-force/expenses/${action.expense?.id}/reopen`}
          title="Reopen this paid claim?"
          description="Reopening moves the claim back to approved so it can be corrected."
          subject={`${action.expense?.expenseNo || 'Claim'} · ${action.expense?.claimantName || ''}`}
          confirmLabel="Reopen claim"
          tone="destructive"
          fields={[{ name: 'note', label: 'Reason (optional)', type: 'text' }]}
          errorTitle="Could not reopen the claim"
          invalidateKeys={[['company', 'expenses'], ['company', 'dashboard']]}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete this draft claim?"
        message={
          deleteTarget
            ? `${deleteTarget.expenseNo || 'This draft'} will be permanently removed. Only drafts and rejected claims can be deleted.`
            : ''
        }
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
