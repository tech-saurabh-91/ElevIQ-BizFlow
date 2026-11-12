import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, AlertTriangle, Boxes, ClipboardList, Download, Layers, MoreHorizontal, Package, PackagePlus, Plus, Search, ShoppingCart, Trash2, TrendingUp, Truck, Warehouse, X, Upload } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { FilterPanel, FILTER_CARD, FILTER_ROW } from '@/components/ui/filter-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { TabPanel } from '@/components/ui/tabs';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { useLookups } from '@/hooks/useLookups';
import { formatDate, formatNumber, titleCase, formatMoney } from '@/utils/format';
import StatCard from '@/components/company/stat-card';
import { WorkflowDialog } from '@/components/company/fieldforce-shared';
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_STATUSES,
  GRN_STATUSES,
  MOVEMENT_TYPES,
  PO_STATUSES,
  TRANSFER_STATUSES,
  LineEditor,
  adjustmentActionsFor,
  grnActionsFor,
  isPositiveType,
  movementLabel,
  poActionsFor,
  reasonLabel,
  transferActionsFor,
} from '@/components/company/inventory-shared';
import BulkImport from '@/components/company/BulkImport';
import { todayInput } from '@/components/company/form-utils';
import { SectionCards, SectionBar } from '@/components/ui/section-cards';

const TABS = [
  { value: 'stock', label: 'Stock on hand', icon: Boxes, description: 'What each warehouse and van holds right now' },
  { value: 'movements', label: 'Movements', icon: Layers, description: 'Every stock in and out, with cost' },
  { value: 'adjustments', label: 'Adjustments', icon: ClipboardList, description: 'Counts, damages, corrections and opening stock' },
  { value: 'transfers', label: 'Transfers', icon: Truck, description: 'Move stock between warehouses and vans' },
];

const money = (value, currency) => formatMoney(value, currency, undefined, { decimals: 0 });

/** Small helper to build a URL-param setter bound to the current search state. */
const useSetParam = (params, setParams) =>
  useCallback(
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

// ===========================================================================
// Stock on hand
// ===========================================================================
function StockTab() {
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam(params, setParams);
  const { company } = useAuth();
  const { lookups } = useLookups();

  const search = params.get('search') || '';
  const warehouseId = params.get('warehouseId') || '';
  const lowStock = params.get('lowStock') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);
  const [searchDraft, setSearchDraft] = useState(search);

  useEffect(() => setSearchDraft(search), [search]);
  useEffect(() => {
    if (searchDraft === search) return undefined;
    const t = setTimeout(() => setParam({ search: searchDraft.trim(), page: 1 }), 400);
    return () => clearTimeout(t);
  }, [searchDraft, search, setParam]);

  const queryParams = useMemo(() => {
    const out = { page, limit };
    if (search) out.search = search;
    if (warehouseId) out.warehouseId = warehouseId;
    if (lowStock) out.lowStock = 'true';
    return out;
  }, [page, limit, search, warehouseId, lowStock]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'inventory', 'stock', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/inventory/stock', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const downloadXlsx = async () => {
    try {
      const { data: blob } = await api.get('/v1/inventory/stock/export', {
        params: queryParams,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([blob]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `stock-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success('Stock exported');
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  const hasFilters = Boolean(search || warehouseId || lowStock);

  return (
    <div className="space-y-4">
      <Card className={FILTER_CARD}>
        <CardContent className={FILTER_ROW}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search product, SKU or warehouse…"
              className="pl-9 pr-9"
              aria-label="Search stock"
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
            active={[warehouseId, lowStock].filter(Boolean).length}
            onReset={hasFilters ? () => setParam({ search: '', warehouseId: '', lowStock: '', page: 1 }) : undefined}
          >
            <Select
              value={warehouseId}
              onChange={(e) => setParam({ warehouseId: e.target.value, page: 1 })}
              className="w-48"
              aria-label="Filter by warehouse"
            >
              <option value="">All warehouses</option>
              {(lookups.warehouses || []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>

            <Button
              variant={lowStock ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setParam({ lowStock: lowStock ? '' : 'true', page: 1 })}
            >
              <AlertTriangle className="h-4 w-4" />
              Low stock only
            </Button>
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
          <EmptyState icon="error" title="Could not load stock" description={apiError(error).message} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={hasFilters ? 'search' : 'package'}
            title={hasFilters ? 'No matching stock lines' : 'No stock recorded yet'}
            description={
              hasFilters
                ? 'Try a different product, warehouse, or clear the low-stock filter.'
                : 'Post an opening balance or receive goods against a purchase order to build the ledger.'
            }
          />
        </Card>
      ) : (
        <Card className={isFetching ? 'opacity-80 transition-opacity' : 'transition-opacity'}>
          <Table cards>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Last movement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const available = Number(row.qty || 0) - Number(row.reservedQty || 0);
                const isLow = Number(row.qty || 0) <= Number(row.lowStockLevel || 0);
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.productName || '—'}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.productSku || ' '}
                          {row.unit ? ` · ${row.unit}` : ''}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate text-sm">{row.warehouseName || 'Company-wide'}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.warehouseCode || ' '}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`tabular-nums font-medium ${isLow ? 'text-destructive' : ''}`}>
                        {formatNumber(row.qty)}
                      </span>
                      {isLow && (
                        <Badge tone="destructive" className="ml-1.5">
                          Low
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatNumber(row.reservedQty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(available)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(Number(row.qty || 0) * Number(row.lastCost || 0), company?.currency)}
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate text-sm">{formatDate(row.lastMovementAt)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.lastMovementType ? movementLabel(row.lastMovementType) : ' '}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between border-t px-4 py-3">
            <Button variant="outline" size="sm" onClick={downloadXlsx}>
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Pagination
              meta={{ ...meta, page, limit }}
              onPageChange={(p) => setParam({ page: p })}
              onLimitChange={(l) => setParam({ limit: l, page: 1 })}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

// ===========================================================================
// Movements
// ===========================================================================
function MovementsTab() {
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam(params, setParams);
  const { company } = useAuth();

  const type = params.get('type') || '';
  const warehouseId = params.get('warehouseId') || '';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);

  const queryParams = useMemo(() => {
    const out = { page, limit };
    if (type) out.type = type;
    if (warehouseId) out.warehouseId = warehouseId;
    if (dateFrom) out.dateFrom = dateFrom;
    if (dateTo) out.dateTo = dateTo;
    return out;
  }, [page, limit, type, warehouseId, dateFrom, dateTo]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'inventory', 'movements', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/inventory/movements', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};
  const hasFilters = Boolean(type || warehouseId || dateFrom || dateTo);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-4">
          <Select
            value={type}
            onChange={(e) => setParam({ type: e.target.value, page: 1 })}
            className="w-52"
            aria-label="Filter by movement type"
          >
            <option value="">All movement types</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {movementLabel(t)}
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

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => setParam({ type: '', warehouseId: '', dateFrom: '', dateTo: '', page: 1 })}>
              Reset
            </Button>
          )}
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
          <EmptyState icon="error" title="Could not load movements" description={apiError(error).message} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={hasFilters ? 'search' : 'empty'}
            title={hasFilters ? 'No matching movements' : 'No stock movements yet'}
            description="Every stock change lands here — opening balances, receipts, dispatches and adjustments."
          />
        </Card>
      ) : (
        <Card className={isFetching ? 'opacity-80 transition-opacity' : 'transition-opacity'}>
          <Table cards>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Warehouse</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const positive = isPositiveType(row.type);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-sm">{formatDate(row.movedAt || row.createdAt)}</TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.productName || '—'}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.productSku || ' '}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge tone={positive ? 'success' : 'destructive'}>{movementLabel(row.type)}</Badge>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${positive ? 'text-success' : 'text-destructive'}`}>
                      {positive ? '+' : ''}
                      {formatNumber(row.qty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {money(row.value, company?.currency)}
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate text-sm">{row.refType || '—'}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.refNo || ' '}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{row.warehouseName || 'Company-wide'}</TableCell>
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
    </div>
  );
}

// ===========================================================================
// Adjustments (list + create)
// ===========================================================================
function AdjustmentsTab() {
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam(params, setParams);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { lookups } = useLookups();

  const status = params.get('status') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ warehouse: '', reason: 'COUNT', notes: '', lines: [] });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [action, setAction] = useState(null);

  const queryParams = useMemo(() => {
    const out = { page, limit };
    if (status) out.status = status;
    return out;
  }, [page, limit, status]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'inventory', 'adjustments', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/inventory/adjustments', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'inventory'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'products'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
  };

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/v1/inventory/adjustments', payload);
      return data;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Adjustment created');
      setCreateOpen(false);
      setForm({ warehouse: '', reason: 'COUNT', notes: '', lines: [] });
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (row) => api.delete(`/v1/inventory/adjustments/${row.id}`),
    onSuccess: () => {
      toast.success('Draft adjustment deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const canCreate = can('inventory.adjustments.manage');
  const linesValid = form.lines.length > 0 && form.lines.every((l) => l.product && l.qty !== '' && Number(l.qty) !== 0);

  const submit = (post) => {
    createMutation.mutate({
      warehouse: form.warehouse,
      reason: form.reason,
      notes: form.notes.trim() || undefined,
      items: form.lines.map((l) => ({
        product: l.product,
        qty: Number(l.qty),
        unitCost: l.unitCost === '' ? undefined : Number(l.unitCost),
      })),
      post,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onChange={(e) => setParam({ status: e.target.value, page: 1 })}
              className="w-40"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {ADJUSTMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
            {status && (
              <Button variant="ghost" size="sm" onClick={() => setParam({ status: '', page: 1 })}>
                Reset
              </Button>
            )}
          </div>

          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New adjustment
            </Button>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState icon="error" title="Could not load adjustments" description={apiError(error).message} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="empty"
            title="No stock adjustments yet"
            description="Use adjustments to correct counts, write off damage or record expiry."
            action={
              canCreate ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New adjustment
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
                <TableHead>Adjustment</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Net qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const available = adjustmentActionsFor(row, can);
                const netQty = (row.items || []).reduce((s, l) => s + Number(l.qty || 0), 0);
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{row.adjustmentNo || 'Draft'}</p>
                        <p className="truncate text-xs text-muted-foreground">{formatDate(row.adjustmentDate)}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{row.warehouseName || 'Company-wide'}</TableCell>
                    <TableCell>
                      <Badge tone="outline">{reasonLabel(row.reason)}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{(row.items || []).length}</TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${netQty >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {netQty >= 0 ? '+' : ''}
                      {formatNumber(netQty)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {available.length > 0 && (
                        <DropdownMenu
                          align="end"
                          width="w-44"
                          trigger={
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Actions</span>
                            </span>
                          }
                        >
                          {({ close }) => (
                            <>
                              {available.includes('post') && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    close();
                                    setAction({ kind: 'post', row });
                                  }}
                                >
                                  <TrendingUp className="h-4 w-4" /> Post adjustment
                                </DropdownMenuItem>
                              )}
                              {available.includes('cancel') && (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => {
                                    close();
                                    setAction({ kind: 'cancel', row });
                                  }}
                                >
                                  <X className="h-4 w-4" /> Cancel
                                </DropdownMenuItem>
                              )}
                              {available.includes('delete') && (
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
                      )}
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

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New stock adjustment"
        description="Correct on-hand quantities. Posting writes a signed ledger movement per line."
        size="lg"
        dismissible={!createMutation.isPending}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => submit(true)}
              disabled={!form.warehouse || !linesValid}
              loading={createMutation.isPending}
            >
              Save & post
            </Button>
            <Button
              onClick={() => submit(false)}
              disabled={!form.warehouse || !linesValid}
              loading={createMutation.isPending}
            >
              Save draft
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="adj-warehouse">
                Warehouse <span className="text-destructive">*</span>
              </label>
              <Select
                id="adj-warehouse"
                value={form.warehouse}
                onChange={(e) => setForm((f) => ({ ...f, warehouse: e.target.value }))}
              >
                <option value="">Select a warehouse…</option>
                {(lookups.warehouses || []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="adj-reason">
                Reason <span className="text-destructive">*</span>
              </label>
              <Select
                id="adj-reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              >
                {ADJUSTMENT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {reasonLabel(r)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="adj-notes">
              Notes
            </label>
            <Input
              id="adj-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Why is this adjustment being made?"
            />
          </div>

          <LineEditor
            value={form.lines}
            onChange={(lines) => setForm((f) => ({ ...f, lines }))}
            products={lookups.products || []}
            qtyLabel="Δ Qty"
            costLabel="Unit cost"
            signed
          />
        </div>
      </Dialog>

      {action?.kind === 'post' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/inventory/adjustments/${action.row?.id}/post`}
          title="Post this adjustment?"
          description="Posting applies the quantity changes to the stock ledger and cannot be undone (cancel to reverse)."
          subject={action.row?.adjustmentNo || 'Adjustment'}
          confirmLabel="Post adjustment"
          fields={[{ name: 'note', label: 'Note (optional)', type: 'text' }]}
          errorTitle="Could not post the adjustment"
          invalidateKeys={[['company', 'inventory'], ['company', 'products'], ['company', 'dashboard']]}
        />
      )}

      {action?.kind === 'cancel' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/inventory/adjustments/${action.row?.id}/cancel`}
          title="Cancel this posted adjustment?"
          description="Cancelling reverses the ledger movements it created."
          subject={action.row?.adjustmentNo || 'Adjustment'}
          confirmLabel="Cancel adjustment"
          tone="destructive"
          fields={[
            {
              name: 'reason',
              label: 'Reason',
              type: 'text',
              required: true,
              minLength: 3,
              autoFocus: true,
            },
          ]}
          errorTitle="Could not cancel the adjustment"
          invalidateKeys={[['company', 'inventory'], ['company', 'products'], ['company', 'dashboard']]}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete this draft adjustment?"
        message={`${deleteTarget?.adjustmentNo || 'This draft'} will be permanently removed. Only drafts can be deleted.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

// ===========================================================================
// Transfers (list + create)
// ===========================================================================
function TransfersTab() {
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam(params, setParams);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { lookups } = useLookups();

  const status = params.get('status') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ fromWarehouse: '', toWarehouse: '', vehicleNo: '', notes: '', lines: [] });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [action, setAction] = useState(null);

  const queryParams = useMemo(() => {
    const out = { page, limit };
    if (status) out.status = status;
    return out;
  }, [page, limit, status]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'inventory', 'transfers', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/inventory/transfers', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'inventory'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'products'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
  };

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/v1/inventory/transfers', payload);
      return data;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Transfer created');
      setCreateOpen(false);
      setForm({ fromWarehouse: '', toWarehouse: '', vehicleNo: '', notes: '', lines: [] });
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (row) => api.delete(`/v1/inventory/transfers/${row.id}`),
    onSuccess: () => {
      toast.success('Draft transfer deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const canCreate = can('inventory.transfers.manage');
  const warehouses = lookups.warehouses || [];
  const validWarehouse =
    form.fromWarehouse && form.toWarehouse && form.fromWarehouse !== form.toWarehouse;
  const linesValid =
    form.lines.length > 0 && form.lines.every((l) => l.product && l.qty !== '' && Number(l.qty) > 0);

  const submit = () => {
    createMutation.mutate({
      fromWarehouse: form.fromWarehouse,
      toWarehouse: form.toWarehouse,
      vehicleNo: form.vehicleNo.trim() || undefined,
      notes: form.notes.trim() || undefined,
      items: form.lines.map((l) => ({ product: l.product, qty: Number(l.qty) })),
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onChange={(e) => setParam({ status: e.target.value, page: 1 })}
              className="w-44"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {TRANSFER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
            {status && (
              <Button variant="ghost" size="sm" onClick={() => setParam({ status: '', page: 1 })}>
                Reset
              </Button>
            )}
          </div>

          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New transfer
            </Button>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState icon="error" title="Could not load transfers" description={apiError(error).message} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="empty"
            title="No stock transfers yet"
            description="Move stock between warehouses. Dispatch books it out; receive books it in."
            action={
              canCreate ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New transfer
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
                <TableHead>Transfer</TableHead>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const available = transferActionsFor(row, can);
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{row.transferNo || 'Draft'}</p>
                        <p className="truncate text-xs text-muted-foreground">{formatDate(row.transferDate)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate text-sm">
                          {row.fromWarehouseName || '—'} → {row.toWarehouseName || '—'}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.fromWarehouseCode || ''} → {row.toWarehouseCode || ''}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{(row.items || []).length}</TableCell>
                    <TableCell className="text-sm">{row.vehicleNo || '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {available.length > 0 && (
                        <DropdownMenu
                          align="end"
                          width="w-44"
                          trigger={
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Actions</span>
                            </span>
                          }
                        >
                          {({ close }) => (
                            <>
                              {available.includes('dispatch') && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    close();
                                    setAction({ kind: 'dispatch', row });
                                  }}
                                >
                                  <Truck className="h-4 w-4" /> Dispatch
                                </DropdownMenuItem>
                              )}
                              {available.includes('receive') && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    close();
                                    setAction({ kind: 'receive', row });
                                  }}
                                >
                                  <Package className="h-4 w-4" /> Receive
                                </DropdownMenuItem>
                              )}
                              {available.includes('delete') && (
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
                      )}
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

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New stock transfer"
        description="Move stock from one warehouse to another. Dispatch books it out, receive books it in."
        size="lg"
        dismissible={!createMutation.isPending}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!validWarehouse || !linesValid} loading={createMutation.isPending}>
              Create transfer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="trf-from">
                From warehouse <span className="text-destructive">*</span>
              </label>
              <Select
                id="trf-from"
                value={form.fromWarehouse}
                onChange={(e) => setForm((f) => ({ ...f, fromWarehouse: e.target.value }))}
              >
                <option value="">Source…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="trf-to">
                To warehouse <span className="text-destructive">*</span>
              </label>
              <Select
                id="trf-to"
                value={form.toWarehouse}
                onChange={(e) => setForm((f) => ({ ...f, toWarehouse: e.target.value }))}
              >
                <option value="">Destination…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
              {form.fromWarehouse && form.toWarehouse && form.fromWarehouse === form.toWarehouse && (
                <p className="mt-1 text-xs text-destructive">Source and destination must differ.</p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="trf-vehicle">
                Vehicle number
              </label>
              <Input
                id="trf-vehicle"
                value={form.vehicleNo}
                onChange={(e) => setForm((f) => ({ ...f, vehicleNo: e.target.value }))}
                placeholder="Optional"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="trf-notes">
                Notes
              </label>
              <Input
                id="trf-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>

          <LineEditor
            value={form.lines}
            onChange={(lines) => setForm((f) => ({ ...f, lines }))}
            products={lookups.products || []}
            qtyLabel="Qty"
            showCost={false}
          />
        </div>
      </Dialog>

      {action?.kind === 'dispatch' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/inventory/transfers/${action.row?.id}/dispatch`}
          title="Dispatch this transfer?"
          description="Dispatching books the stock out of the source warehouse. It stays in transit until received."
          subject={action.row?.transferNo || 'Transfer'}
          confirmLabel="Dispatch"
          fields={[{ name: 'note', label: 'Note (optional)', type: 'text' }]}
          errorTitle="Could not dispatch the transfer"
          invalidateKeys={[['company', 'inventory'], ['company', 'products'], ['company', 'dashboard']]}
        />
      )}

      {action?.kind === 'receive' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/inventory/transfers/${action.row?.id}/receive`}
          title="Receive this transfer?"
          description="Receiving books the stock into the destination warehouse and closes the transfer."
          subject={action.row?.transferNo || 'Transfer'}
          confirmLabel="Receive"
          fields={[{ name: 'note', label: 'Note (optional)', type: 'text' }]}
          errorTitle="Could not receive the transfer"
          invalidateKeys={[['company', 'inventory'], ['company', 'products'], ['company', 'dashboard']]}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete this draft transfer?"
        message={`${deleteTarget?.transferNo || 'This draft'} will be permanently removed. Only drafts can be deleted.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

// ===========================================================================
// Purchase orders
// ===========================================================================
/** Also the Purchase Orders page (Purchase menu). */
export function PurchaseOrdersTab() {
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam(params, setParams);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company } = useAuth();

  const status = params.get('status') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [action, setAction] = useState(null);

  const queryParams = useMemo(() => {
    const out = { page, limit };
    if (status) out.status = status;
    return out;
  }, [page, limit, status]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'inventory', 'purchase-orders', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/purchase-orders', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'inventory'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (row) => api.delete(`/v1/purchase-orders/${row.id}`),
    onSuccess: () => {
      toast.success('Draft purchase order deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const money2 = (v) => money(v, company?.currency);

  // ---- create ---------------------------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    supplierId: '',
    warehouse: '',
    poDate: '',
    expectedDate: '',
    paymentTerms: '',
    notes: '',
    send: true,
    lines: [],
  });

  const { data: options } = useQuery({
    queryKey: ['company', 'inventory', 'po-form-options'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/purchase-orders/form-options');
      return body?.data;
    },
    enabled: createOpen,
    staleTime: 60_000,
  });

  const resetForm = () =>
    setForm({
      supplierId: '',
      warehouse: '',
      poDate: '',
      expectedDate: '',
      paymentTerms: '',
      notes: '',
      send: true,
      lines: [],
    });

  const linesValid =
    form.lines.length > 0 &&
    form.lines.every((l) => l.product && l.qty !== '' && Number(l.qty) > 0);

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/v1/purchase-orders', payload);
      return data;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Purchase order created');
      setCreateOpen(false);
      resetForm();
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const submitCreate = () => {
    const payload = {
      supplierId: form.supplierId,
      items: form.lines.map((l) => ({
        product: l.product,
        qty: Number(l.qty),
        unit: l.unit || undefined,
        unitPrice: l.unitCost === '' ? 0 : Number(l.unitCost),
        taxRate: l.taxRate === '' ? undefined : Number(l.taxRate),
      })),
      send: Boolean(form.send),
    };
    if (form.warehouse) payload.warehouse = form.warehouse;
    if (form.poDate && form.poDate > todayInput()) {
      toast.error('PO date cannot be in the future');
      return;
    }
    if (form.expectedDate && form.expectedDate < (form.poDate || todayInput())) {
      toast.error('Expected delivery cannot be before the PO date');
      return;
    }
    if (form.poDate) payload.poDate = form.poDate;
    if (form.expectedDate) payload.expectedDate = form.expectedDate;
    if (form.paymentTerms.trim()) payload.paymentTerms = form.paymentTerms.trim();
    if (form.notes.trim()) payload.notes = form.notes.trim();
    createMutation.mutate(payload);
  };

  const canCreate = can('purchases.create');

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onChange={(e) => setParam({ status: e.target.value, page: 1 })}
              className="w-48"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {PO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s.replace(/_/g, ' '))}
                </option>
              ))}
            </Select>
            {status && (
              <Button variant="ghost" size="sm" onClick={() => setParam({ status: '', page: 1 })}>
                Reset
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canCreate && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New purchase order
              </Button>
            )}

            {can('purchases.view') && (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const { data: blob } = await api.get('/v1/purchase-orders/export', {
                      params: queryParams,
                      responseType: 'blob',
                    });
                    const url = URL.createObjectURL(new Blob([blob]));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `purchase-orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 10_000);
                    toast.success('Purchase orders exported');
                  } catch (err) {
                    toast.error(apiError(err).message);
                  }
                }}
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState icon="error" title="Could not load purchase orders" description={apiError(error).message} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="empty"
            title="No purchase orders yet"
            description="Raise a purchase order to buy stock from a supplier, then receive it with a GRN."
            action={
              canCreate ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New purchase order
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
                <TableHead>PO number</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>PO date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const available = poActionsFor(row, can);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-semibold">{row.poNo || '—'}</TableCell>
                    <TableCell className="text-sm">{row.supplierName || '—'}</TableCell>
                    <TableCell className="text-sm">{row.warehouseName || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatDate(row.poDate)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{money2(row.total)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatNumber(row.receivedQty)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {available.length > 0 && (
                        <DropdownMenu
                          align="end"
                          width="w-44"
                          trigger={
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Actions</span>
                            </span>
                          }
                        >
                          {({ close }) => (
                            <>
                              {available.includes('send') && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    close();
                                    setAction({ kind: 'send', row });
                                  }}
                                >
                                  <Truck className="h-4 w-4" /> Mark as sent
                                </DropdownMenuItem>
                              )}
                              {available.includes('cancel') && (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => {
                                    close();
                                    setAction({ kind: 'cancel', row });
                                  }}
                                >
                                  <X className="h-4 w-4" /> Cancel PO
                                </DropdownMenuItem>
                              )}
                              {available.includes('delete') && (
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
                      )}
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

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New purchase order"
        description="Order stock from a supplier. Nothing moves until a goods receipt is posted."
        size="xl"
        dismissible={!createMutation.isPending}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submitCreate}
              disabled={!form.supplierId || !linesValid}
              loading={createMutation.isPending}
            >
              {form.send ? 'Create & send' : 'Save as draft'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="po-supplier">
                Supplier <span className="text-destructive">*</span>
              </label>
              <Select
                id="po-supplier"
                value={form.supplierId}
                onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
              >
                <option value="">Select a supplier…</option>
                {(options?.suppliers || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.code ? ` (${s.code})` : ''}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="po-warehouse">
                Warehouse
              </label>
              <Select
                id="po-warehouse"
                value={form.warehouse}
                onChange={(e) => setForm((f) => ({ ...f, warehouse: e.target.value }))}
              >
                <option value="">Default warehouse</option>
                {(options?.warehouses || []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="po-date">
                PO date
              </label>
              <Input
                id="po-date"
                type="date"
                value={form.poDate}
                max={todayInput()}
                onChange={(e) => setForm((f) => ({ ...f, poDate: e.target.value }))}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="po-expected">
                Expected delivery
              </label>
              <Input
                id="po-expected"
                type="date"
                value={form.expectedDate}
                min={form.poDate || todayInput()}
                onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="po-terms">
                Payment terms
              </label>
              <Input
                id="po-terms"
                value={form.paymentTerms}
                onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}
                placeholder="e.g. Net 30"
                maxLength={30}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="po-notes">
                Notes
              </label>
              <Input
                id="po-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>

          <LineEditor
            value={form.lines}
            onChange={(lines) => setForm((f) => ({ ...f, lines }))}
            products={options?.products || []}
            qtyLabel="Order qty"
            costLabel="Unit price"
            showTax
            showUnits
          />

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.send}
              onChange={(e) => setForm((f) => ({ ...f, send: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
            Mark as sent to the supplier straight away
          </label>
        </div>
      </Dialog>

      {action?.kind === 'send' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/purchase-orders/${action.row?.id}/send`}
          title="Mark this PO as sent?"
          description="This records that the order has been placed with the supplier."
          subject={action.row?.poNo || 'Purchase order'}
          confirmLabel="Mark as sent"
          fields={[{ name: 'note', label: 'Note (optional)', type: 'text' }]}
          errorTitle="Could not update the PO"
          invalidateKeys={[['company', 'inventory'], ['company', 'dashboard']]}
        />
      )}

      {action?.kind === 'cancel' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/purchase-orders/${action.row?.id}/cancel`}
          title="Cancel this purchase order?"
          description="Cancelling stops any further receipts against this order."
          subject={action.row?.poNo || 'Purchase order'}
          confirmLabel="Cancel PO"
          tone="destructive"
          fields={[
            {
              name: 'reason',
              label: 'Reason',
              type: 'text',
              required: true,
              minLength: 3,
              autoFocus: true,
            },
          ]}
          errorTitle="Could not cancel the PO"
          invalidateKeys={[['company', 'inventory'], ['company', 'dashboard']]}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete this draft purchase order?"
        message={`${deleteTarget?.poNo || 'This draft'} will be permanently removed. Only drafts can be deleted.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

// ===========================================================================
// Goods receipt notes
// ===========================================================================
/** Also the Goods Receipts page (Purchase menu). */
export function GoodsReceiptsTab() {
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam(params, setParams);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company } = useAuth();

  const status = params.get('status') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [action, setAction] = useState(null);

  const queryParams = useMemo(() => {
    const out = { page, limit };
    if (status) out.status = status;
    return out;
  }, [page, limit, status]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'inventory', 'goods-receipts', queryParams],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/goods-receipts', { params: queryParams });
      return body;
    },
    keepPreviousData: true,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'inventory'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'products'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (row) => api.delete(`/v1/goods-receipts/${row.id}`),
    onSuccess: () => {
      toast.success('Draft receipt deleted');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const money2 = (v) => money(v, company?.currency);

  // ---- create ---------------------------------------------------------------
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    purchaseOrder: '',
    warehouse: '',
    supplierId: '',
    grnDate: '',
    invoiceNo: '',
    notes: '',
    post: true,
    lines: [],
  });

  // Receivable POs (anything not fully received or cancelled).
  const { data: poOptions } = useQuery({
    queryKey: ['company', 'inventory', 'receivable-pos'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/purchase-orders', { params: { limit: 200 } });
      return (body?.data || []).filter((r) =>
        ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'].includes(r.status)
      );
    },
    enabled: createOpen,
    staleTime: 60_000,
  });

  // Suppliers / warehouses / catalogue for direct receipts (no PO).
  const { data: masterForm } = useQuery({
    queryKey: ['company', 'inventory', 'master-form-options'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/purchase-orders/form-options');
      return body?.data;
    },
    enabled: createOpen,
    staleTime: 60_000,
  });

  // Selecting a PO loads its open lines so the user only records what arrived.
  const { data: poForm, isFetching: poLoading } = useQuery({
    queryKey: ['company', 'inventory', 'grn-form-options', form.purchaseOrder],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/goods-receipts/form-options', {
        params: { purchaseOrder: form.purchaseOrder },
      });
      return body?.data;
    },
    enabled: createOpen && Boolean(form.purchaseOrder),
    staleTime: 30_000,
  });

  const resetForm = () =>
    setForm({
      purchaseOrder: '',
      warehouse: '',
      supplierId: '',
      grnDate: '',
      invoiceNo: '',
      notes: '',
      post: true,
      lines: [],
    });

  const products = form.purchaseOrder ? poForm?.products || [] : masterForm?.products || [];
  const warehouses = form.purchaseOrder
    ? poForm?.warehouses || []
    : masterForm?.warehouses || [];
  const suppliers = masterForm?.suppliers || [];

  // Switching PO clears the grid and the warehouse; the new PO repopulates both.
  const selectPo = (poId) =>
    setForm((f) => ({ ...f, purchaseOrder: poId, lines: [], warehouse: '' }));

  // Prefill outstanding quantities once the chosen PO's options arrive.
  useEffect(() => {
    if (!form.purchaseOrder || !poForm?.openLines) return;
    setForm((f) => {
      if (f.purchaseOrder !== form.purchaseOrder || f.lines.length > 0) return f;
      return {
        ...f,
        warehouse: poForm.defaultWarehouseId || f.warehouse,
        lines: poForm.openLines.map((l) => ({
          product: l.product,
          receivedQty: l.pendingQty || '',
          unitCost: l.unitPrice || '',
          rejectedQty: '',
        })),
      };
    });
  }, [poForm, form.purchaseOrder]);

  // Direct receipt: fall back to the company default warehouse.
  useEffect(() => {
    if (!createOpen || form.purchaseOrder || form.warehouse || !masterForm) return;
    const fallback = masterForm.defaultWarehouseId;
    if (fallback) setForm((f) => ({ ...f, warehouse: fallback }));
  }, [createOpen, masterForm, form.purchaseOrder, form.warehouse]);

  const linesValid =
    form.lines.length > 0 &&
    form.lines.every(
      (l) => l.product && l.receivedQty !== '' && Number(l.receivedQty) >= 0
    );

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/v1/goods-receipts', payload);
      return data;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Goods receipt created');
      setCreateOpen(false);
      resetForm();
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const submitCreate = () => {
    const payload = {
      warehouse: form.warehouse,
      items: form.lines.map((l) => ({
        product: l.product,
        receivedQty: Number(l.receivedQty),
        rejectedQty: l.rejectedQty === '' ? 0 : Number(l.rejectedQty),
        unitCost: l.unitCost === '' ? 0 : Number(l.unitCost),
      })),
      post: Boolean(form.post),
    };
    if (form.purchaseOrder) payload.purchaseOrder = form.purchaseOrder;
    else payload.supplierId = form.supplierId;
    if (form.grnDate && form.grnDate > todayInput()) {
      toast.error('Receipt date cannot be in the future');
      return;
    }
    if (form.grnDate) payload.grnDate = form.grnDate;
    if (form.invoiceNo.trim()) payload.invoiceNo = form.invoiceNo.trim();
    if (form.notes.trim()) payload.notes = form.notes.trim();
    createMutation.mutate(payload);
  };

  const canCreate = can('grn.create');
  const needsSupplier = !form.purchaseOrder;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onChange={(e) => setParam({ status: e.target.value, page: 1 })}
              className="w-40"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {GRN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
            {status && (
              <Button variant="ghost" size="sm" onClick={() => setParam({ status: '', page: 1 })}>
                Reset
              </Button>
            )}
          </div>

          {canCreate && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New goods receipt
            </Button>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState icon="error" title="Could not load goods receipts" description={apiError(error).message} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="empty"
            title="No goods receipts yet"
            description="A GRN books physically received stock into a warehouse against a purchase order."
            action={
              canCreate ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New goods receipt
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
                <TableHead>GRN number</TableHead>
                <TableHead>PO number</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const available = grnActionsFor(row, can);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-semibold">{row.grnNo || '—'}</TableCell>
                    <TableCell className="text-sm">{row.poNo || '—'}</TableCell>
                    <TableCell className="text-sm">{row.supplierName || '—'}</TableCell>
                    <TableCell className="text-sm">{row.warehouseName || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatDate(row.grnDate)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {money2(row.totalValue)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {available.length > 0 && (
                        <DropdownMenu
                          align="end"
                          width="w-44"
                          trigger={
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Actions</span>
                            </span>
                          }
                        >
                          {({ close }) => (
                            <>
                              {available.includes('post') && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    close();
                                    setAction({ kind: 'post', row });
                                  }}
                                >
                                  <PackagePlus className="h-4 w-4" /> Post receipt
                                </DropdownMenuItem>
                              )}
                              {available.includes('cancel') && (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => {
                                    close();
                                    setAction({ kind: 'cancel', row });
                                  }}
                                >
                                  <X className="h-4 w-4" /> Cancel receipt
                                </DropdownMenuItem>
                              )}
                              {available.includes('delete') && (
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
                      )}
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

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New goods receipt"
        description="Record what physically arrived. Posting the receipt is what books stock in."
        size="xl"
        dismissible={!createMutation.isPending}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submitCreate}
              disabled={!form.warehouse || !linesValid || (needsSupplier && !form.supplierId)}
              loading={createMutation.isPending}
            >
              {form.post ? 'Receive & post' : 'Save as draft'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium" htmlFor="grn-po">
                Against purchase order
              </label>
              <Select
                id="grn-po"
                value={form.purchaseOrder}
                onChange={(e) => selectPo(e.target.value)}
              >
                <option value="">Direct receipt (no PO)</option>
                {(poOptions || []).map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.poNo} · {po.supplierName}
                  </option>
                ))}
              </Select>
              {poLoading && <p className="mt-1 text-xs text-muted-foreground">Loading open lines…</p>}
            </div>

            {needsSupplier && (
              <div>
                <label className="mb-1.5 block text-sm font-medium" htmlFor="grn-supplier">
                  Supplier <span className="text-destructive">*</span>
                </label>
                <Select
                  id="grn-supplier"
                  value={form.supplierId}
                  onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
                >
                  <option value="">Select a supplier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.code ? ` (${s.code})` : ''}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose a purchase order to pick the supplier automatically.
                </p>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="grn-warehouse">
                Warehouse <span className="text-destructive">*</span>
              </label>
              <Select
                id="grn-warehouse"
                value={form.warehouse}
                onChange={(e) => setForm((f) => ({ ...f, warehouse: e.target.value }))}
              >
                <option value="">Select a warehouse…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="grn-date">
                Receipt date
              </label>
              <Input
                id="grn-date"
                type="date"
                value={form.grnDate}
                max={todayInput()}
                onChange={(e) => setForm((f) => ({ ...f, grnDate: e.target.value }))}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="grn-invoice">
                Supplier invoice no.
              </label>
              <Input
                id="grn-invoice"
                value={form.invoiceNo}
                onChange={(e) => setForm((f) => ({ ...f, invoiceNo: e.target.value }))}
                placeholder="Optional"
                maxLength={60}
              />
            </div>

            <div className={needsSupplier ? 'sm:col-span-2' : ''}>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="grn-notes">
                Notes
              </label>
              <Input
                id="grn-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>

          {form.purchaseOrder && poForm?.purchaseOrder && (
            <p className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {poForm.purchaseOrder.poNo} · outstanding quantities are pre-filled; adjust them to what
              actually arrived (rejected stock is recorded separately).
            </p>
          )}

          <LineEditor
            value={form.lines}
            onChange={(lines) => setForm((f) => ({ ...f, lines }))}
            products={products}
            qtyKey="receivedQty"
            qtyLabel="Received"
            costLabel="Unit cost"
          />

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.post}
              onChange={(e) => setForm((f) => ({ ...f, post: e.target.checked }))}
              className="h-4 w-4 rounded border-input"
            />
            Post immediately — books the accepted quantities into stock
          </label>
        </div>
      </Dialog>

      {action?.kind === 'post' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/goods-receipts/${action.row?.id}/post`}
          title="Post this goods receipt?"
          description="Posting books the accepted quantities into stock and rolls the purchase order forward."
          subject={action.row?.grnNo || 'Goods receipt'}
          confirmLabel="Post receipt"
          fields={[{ name: 'note', label: 'Note (optional)', type: 'text' }]}
          errorTitle="Could not post the receipt"
          invalidateKeys={[['company', 'inventory'], ['company', 'products'], ['company', 'dashboard']]}
        />
      )}

      {action?.kind === 'cancel' && (
        <WorkflowDialog
          open
          onClose={() => setAction(null)}
          onDone={invalidate}
          endpoint={`/v1/goods-receipts/${action.row?.id}/cancel`}
          title="Cancel this goods receipt?"
          description="Cancelling reverses the stock movements it booked in."
          subject={action.row?.grnNo || 'Goods receipt'}
          confirmLabel="Cancel receipt"
          tone="destructive"
          fields={[
            {
              name: 'reason',
              label: 'Reason',
              type: 'text',
              required: true,
              minLength: 3,
              autoFocus: true,
            },
          ]}
          errorTitle="Could not cancel the receipt"
          invalidateKeys={[['company', 'inventory'], ['company', 'products'], ['company', 'dashboard']]}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteMutation.mutate(deleteTarget)}
        title="Delete this draft receipt?"
        message={`${deleteTarget?.grnNo || 'This draft'} will be permanently removed. Only drafts can be deleted.`}
        confirmLabel="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

// ===========================================================================
// Page shell
// ===========================================================================
export default function Inventory() {
  const { can } = usePermissions();
  const [openingOpen, setOpeningOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const { company } = useAuth();

  // The section lives in the URL so a refresh (or deep link) keeps the user
  // put; without one the page shows its sections as cards.
  const tab = params.get('tab') || '';
  const setTab = (value) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete('tab');
    else next.set('tab', value);
    // Reset paging whenever the tab changes.
    next.delete('page');
    setParams(next, { replace: true });
  };

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['company', 'inventory', 'stats'],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/inventory/stats');
      return body?.data;
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        description="Stock on hand, movements, adjustments and transfers. Buying is under Purchase."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Inventory' }]}
        actions={
          can('inventory.adjustments.manage') ? (
            <Button variant="outline" onClick={() => setOpeningOpen(true)}>
              <Upload className="h-4 w-4" /> Opening stock
            </Button>
          ) : null
        }
      />
      <OpeningStockImport open={openingOpen} onClose={() => setOpeningOpen(false)} />

      {!tab && (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          icon={Warehouse}
          label="Stock value"
          value={money(stats?.stockValue ?? 0, company?.currency)}
          hint={`${formatNumber(stats?.totalLines ?? 0)} balance lines · ${formatNumber(stats?.warehouseCount ?? 0)} warehouses`}
          loading={statsLoading}
          tone="brand"
        />
        <StatCard
          icon={Boxes}
          label="Units on hand"
          value={formatNumber(stats?.totalQty ?? 0)}
          hint={`${formatNumber(stats?.reservedQty ?? 0)} reserved for confirmed orders`}
          loading={statsLoading}
          tone="info"
        />
        <StatCard
          icon={AlertTriangle}
          label="Low stock"
          value={formatNumber(stats?.lowStockCount ?? 0)}
          hint={`${formatNumber(stats?.outOfStockCount ?? 0)} out of stock`}
          loading={statsLoading}
          tone="warning"
        />
        <StatCard
          icon={TrendingUp}
          label="Movements"
          value={formatNumber(
            Object.values(stats?.movementByType || {}).reduce((s, m) => s + Number(m.count || 0), 0)
          )}
          hint="Ledger entries recorded"
          loading={statsLoading}
          tone="success"
        />
      </div>

      )}

      {tab ? (
        <SectionBar backLabel="All inventory" onBack={() => setTab('')} item={TABS.find((t) => t.value === tab)} />
      ) : (
        <SectionCards items={TABS} onPick={setTab} />
      )}

      <TabPanel value="stock" active={tab}>
        <StockTab />
      </TabPanel>
      <TabPanel value="movements" active={tab}>
        <MovementsTab />
      </TabPanel>
      <TabPanel value="adjustments" active={tab}>
        <AdjustmentsTab />
      </TabPanel>
      <TabPanel value="transfers" active={tab}>
        <TransfersTab />
      </TabPanel>

    </div>
  );
}

/** Opening stock for a main / sub warehouse from a pre-filled Excel template. */
function OpeningStockImport({ open, onClose }) {
  const { lookups } = useLookups();
  const [warehouse, setWarehouse] = useState('');
  const options = (lookups.warehouses || []).filter((w) => ['MAIN', 'SUB'].includes(w.type || 'MAIN'));
  return (
    <BulkImport
      open={open}
      onClose={() => {
        setWarehouse('');
        onClose();
      }}
      title="Opening stock"
      description="Stock a warehouse with what it holds today, from one Excel sheet."
      endpoint="/v1/inventory/opening-stock"
      noun="opening stock"
      params={warehouse ? { warehouse } : {}}
      ready={Boolean(warehouse)}
      invalidate={[['company', 'inventory'], ['company', 'products']]}
      hint="The template lists every product; fill the quantity held today and leave the rest blank."
      extra={
        <Field label="Warehouse" required hint="Each product gets opening stock in a warehouse once; later changes are adjustments.">
          <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            <option value="">Choose a main or sub warehouse</option>
            {options.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </Select>
        </Field>
      }
    />
  );
}
