import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MoreHorizontal, Plus, Search, XCircle } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { FilterPanel, FILTER_CARD, FILTER_ROW } from '@/components/ui/filter-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { ErrorAlert } from '@/components/ui/alert';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { PAYABLES_KEY, SupplierSelect, amountOf, onlyDecimal } from '@/components/company/payables-shared';
import { CancelDialog } from '@/components/company/payables-shared-dialogs';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';

/**
 * Purchase returns (debit notes): goods from a goods receipt sent back to the
 * supplier. Stock leaves at the receipt cost; if the goods were billed, the
 * bill and what you owe go down.
 */
export default function PurchaseReturns() {
  const { company } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const money = (v) => formatMoney(v || 0, company?.currency);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(null);

  const search = params.get('search') || '';
  const status = params.get('status') || '';
  const page = Number(params.get('page') || 1);
  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === '' || v == null ? next.delete(k) : next.set(k, String(v))));
    setParams(next, { replace: true });
  };
  const query = { page, limit: 20, ...(search && { search }), ...(status && { status }) };

  const { data, isLoading } = useQuery({
    queryKey: [...PAYABLES_KEY, 'returns', query],
    queryFn: async () => (await api.get('/v1/purchase-returns', { params: query })).data,
    keepPreviousData: true,
  });
  const rows = data?.data || [];

  const cancel = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/v1/purchase-returns/${id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success('Return cancelled');
      setCancelling(null);
      queryClient.invalidateQueries({ queryKey: PAYABLES_KEY });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchase Returns"
        description="Goods sent back to suppliers (debit notes). Stock leaves at what it cost; billed goods come off the bill."
        breadcrumbs={[{ label: 'Purchase', to: '/app/purchase-bills' }, { label: 'Purchase Returns' }]}
        actions={
          can('purchasereturns.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New return
            </Button>
          )
        }
      />

      <Card className={FILTER_CARD}>
        <CardContent className={FILTER_ROW}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              defaultValue={search}
              onKeyDown={(e) => e.key === 'Enter' && setParam({ search: e.currentTarget.value.trim(), page: 1 })}
              onBlur={(e) => e.currentTarget.value.trim() !== search && setParam({ search: e.currentTarget.value.trim(), page: 1 })}
              placeholder="Search return no, supplier, GRN or bill…"
              className="pl-9"
            />
          </div>
          <FilterPanel active={[status].filter(Boolean).length} onReset={status ? () => setParam({ status: '', page: 1 }) : undefined}>
            <Select value={status} onChange={(e) => setParam({ status: e.target.value, page: 1 })} className="w-40" aria-label="Filter by status">
              <option value="">All</option>
              <option value="POSTED">Posted</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </FilterPanel>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !rows.length ? (
          <EmptyState icon="empty" title="No purchase returns" description="Damaged or wrong goods sent back to a supplier show up here." />
        ) : (
          <Table cards>
            <TableHeader>
              <TableRow>
                <TableHead>Return</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Goods</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Off bills</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((x) => (
                <TableRow key={x.id}>
                  <TableCell>
                    <p className="font-semibold">{x.returnNo}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(x.returnDate)} · {x.grnNo}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{x.supplierName}</p>
                    {x.reason && <p className="text-xs text-muted-foreground">{x.reason}</p>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(x.items || []).map((i) => `${i.name} × ${formatNumber(i.qty)}`).join(', ')}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{money(x.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{x.billedTotal > 0 ? money(x.billedTotal) : 'Not billed'}</TableCell>
                  <TableCell>
                    <StatusBadge status={x.status}>{x.status}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-right" data-actions>
                    {can('purchasereturns.cancel') && x.status !== 'CANCELLED' ? (
                      <DropdownMenu
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions for {x.returnNo}</span>
                          </span>
                        }
                      >
                        {({ close }) => (
                          <DropdownMenuItem className="text-destructive" onClick={() => (close(), setCancelling(x))}>
                            <XCircle className="h-4 w-4" /> Cancel return
                          </DropdownMenuItem>
                        )}
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination meta={data?.meta} onPageChange={(p) => setParam({ page: p })} />
      </Card>

      {creating && <ReturnDialog onClose={() => setCreating(false)} money={money} />}
      <CancelDialog
        open={Boolean(cancelling)}
        title={`Cancel return ${cancelling?.returnNo || ''}?`}
        message="The goods come back into stock at the same cost, and any bill amount it took off is owed again."
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason })}
        loading={cancel.isPending}
      />
    </div>
  );
}

function ReturnDialog({ onClose, money }) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [grnId, setGrnId] = useState('');
  const [qty, setQty] = useState({}); // grnItemId -> text
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  const { data, isFetching } = useQuery({
    queryKey: [...PAYABLES_KEY, 'return-options', supplierId],
    queryFn: async () => (await api.get('/v1/purchase-returns/form-options', { params: { supplierId } })).data?.data,
    enabled: Boolean(supplierId),
  });
  const grns = data?.grns || [];
  const grn = grns.find((g) => g.id === grnId);

  const lines = useMemo(
    () => (grn?.lines || []).map((l) => ({ ...l, qty: amountOf(qty[l.grnItemId]) })),
    [grn, qty]
  );
  const chosen = lines.filter((l) => l.qty > 0);
  const tooMany = lines.some((l) => l.qty > l.returnable + 0.0001);
  const value = amountOf(chosen.reduce((s, l) => s + l.qty * l.unitPrice * (1 + l.taxRate / 100), 0));

  const save = useMutation({
    mutationFn: () =>
      api.post('/v1/purchase-returns', {
        grnId,
        items: chosen.map((l) => ({ grnItemId: l.grnItemId, qty: l.qty })),
        reason,
      }),
    onSuccess: (res) => {
      toast.success(`Return ${res.data?.data?.returnNo || ''} posted`);
      queryClient.invalidateQueries({ queryKey: PAYABLES_KEY });
      onClose();
    },
    onError: (err) => setError(apiError(err)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Return goods to supplier"
      description="Pick the goods receipt they came on and how much goes back."
      footer={
        <>
          <span className="mr-auto text-sm">
            About <span className="font-bold tabular-nums">{money(value)}</span> incl. tax
          </span>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => save.mutate()} disabled={!chosen.length || tooMany} loading={save.isPending}>
            Post return
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorAlert title="Could not post the return" message={error.message} errors={error.errors} onClose={() => setError(null)} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <SupplierSelect value={supplierId} onChange={(v) => (setSupplierId(v), setGrnId(''), setQty({}))} />
          <Field label="Goods receipt" required>
            <Select value={grnId} onChange={(e) => (setGrnId(e.target.value), setQty({}))} disabled={!supplierId || isFetching}>
              <option value="">{supplierId && !isFetching && !grns.length ? 'Nothing to return' : 'Select…'}</option>
              {grns.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.grnNo} · {formatDate(g.grnDate)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {grn && (
          <ul className="divide-y rounded-xl border">
            {lines.map((l) => (
              <li key={l.grnItemId} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {money(l.unitPrice)} / {l.unit} · up to {formatNumber(l.returnable)}
                  </p>
                </div>
                <Input
                  inputMode="decimal"
                  value={qty[l.grnItemId] ?? ''}
                  onChange={(e) => setQty({ ...qty, [l.grnItemId]: onlyDecimal(e.target.value) })}
                  error={l.qty > l.returnable + 0.0001}
                  placeholder="0"
                  className="h-9 text-right"
                  aria-label={`Return qty of ${l.name}`}
                />
              </li>
            ))}
          </ul>
        )}
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged in transit, wrong item" />
        </Field>
        <p className="text-xs text-muted-foreground">
          Goods not yet billed simply will not be billed. Goods already on a bill come off that bill and what you owe the supplier.
        </p>
      </div>
    </Dialog>
  );
}
