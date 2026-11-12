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
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { ErrorAlert } from '@/components/ui/alert';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { PayablesStats, PAYABLES_KEY, SupplierSelect, amountOf, onlyDecimal } from '@/components/company/payables-shared';
import { CancelDialog } from '@/components/company/payables-shared-dialogs';
import { todayInput } from '@/components/company/form-utils';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatMoney } from '@/utils/format';
import { cn } from '@/utils/cn';

const MODES = [
  ['BANK_TRANSFER', 'Bank transfer'],
  ['UPI', 'UPI'],
  ['CHEQUE', 'Cheque'],
  ['CASH', 'Cash'],
  ['CARD', 'Card'],
  ['OTHER', 'Other'],
];
const modeLabel = (m) => MODES.find(([v]) => v === m)?.[1] || m;

/** Money paid to suppliers, set against their bills (the rest is an advance). */
export default function SupplierPayments() {
  const { company } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const money = (v) => formatMoney(v || 0, company?.currency);
  const [params, setParams] = useSearchParams();
  const [paying, setPaying] = useState(false);
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
    queryKey: [...PAYABLES_KEY, 'payments', query],
    queryFn: async () => (await api.get('/v1/supplier-payments', { params: query })).data,
    keepPreviousData: true,
  });
  const rows = data?.data || [];

  const cancel = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/v1/supplier-payments/${id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success('Payment cancelled');
      setCancelling(null);
      queryClient.invalidateQueries({ queryKey: PAYABLES_KEY });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Supplier Payments"
        description="Payments made to suppliers, set against their bills. Anything not set against a bill is an advance."
        breadcrumbs={[{ label: 'Purchase', to: '/app/purchase-bills' }, { label: 'Supplier Payments' }]}
        actions={
          can('supplierpayments.create') && (
            <Button onClick={() => setPaying(true)}>
              <Plus className="h-4 w-4" /> Record payment
            </Button>
          )
        }
      />

      <PayablesStats currency={company?.currency} />

      <Card className={FILTER_CARD}>
        <CardContent className={FILTER_ROW}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              defaultValue={search}
              onKeyDown={(e) => e.key === 'Enter' && setParam({ search: e.currentTarget.value.trim(), page: 1 })}
              onBlur={(e) => e.currentTarget.value.trim() !== search && setParam({ search: e.currentTarget.value.trim(), page: 1 })}
              placeholder="Search payment no, supplier, UTR / cheque or bill…"
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
          <EmptyState
            icon="empty"
            title="No supplier payments yet"
            description="Record what you pay suppliers to keep their balances right."
            action={can('supplierpayments.create') && <Button onClick={() => setPaying(true)}>Record payment</Button>}
          />
        ) : (
          <Table cards>
            <TableHeader>
              <TableRow>
                <TableHead>Payment</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Against</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <p className="font-semibold">{p.paymentNo}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(p.paymentDate)}</p>
                  </TableCell>
                  <TableCell className="font-medium">{p.supplierName}</TableCell>
                  <TableCell>
                    {modeLabel(p.mode)}
                    {p.reference && <span className="block text-xs text-muted-foreground">{p.reference}</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(p.allocations || []).map((a) => a.billNo).join(', ') || '—'}
                    {p.advanceAmount > 0 && <span className="block text-warning">Advance {money(p.advanceAmount)}</span>}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{money(p.amount)}</TableCell>
                  <TableCell>
                    <StatusBadge status={p.status}>{p.status}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-right" data-actions>
                    {can('supplierpayments.cancel') && p.status !== 'CANCELLED' ? (
                      <DropdownMenu
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions for {p.paymentNo}</span>
                          </span>
                        }
                      >
                        {({ close }) => (
                          <DropdownMenuItem className="text-destructive" onClick={() => (close(), setCancelling(p))}>
                            <XCircle className="h-4 w-4" /> Cancel payment
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

      {paying && <PayDialog onClose={() => setPaying(false)} money={money} />}
      <CancelDialog
        open={Boolean(cancelling)}
        title={`Cancel payment ${cancelling?.paymentNo || ''}?`}
        message="The bills it paid become due again and what you owe the supplier goes back up."
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason })}
        loading={cancel.isPending}
      />
    </div>
  );
}

function PayDialog({ onClose, money }) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [form, setForm] = useState({ amount: '', paymentDate: todayInput(), mode: 'BANK_TRANSFER', reference: '', notes: '' });
  const [manual, setManual] = useState(false);
  const [alloc, setAlloc] = useState({}); // billId -> amount text
  const [error, setError] = useState(null);

  const { data, isFetching } = useQuery({
    queryKey: [...PAYABLES_KEY, 'pay-options', supplierId],
    queryFn: async () => (await api.get('/v1/supplier-payments/form-options', { params: { supplierId } })).data?.data,
    enabled: Boolean(supplierId),
  });
  const bills = data?.bills || [];
  const amount = amountOf(form.amount);

  // Oldest due first, as the server does when nothing is chosen.
  const auto = useMemo(() => {
    let left = amount;
    const out = {};
    bills.forEach((b) => {
      const take = Math.max(0, Math.min(left, b.balanceDue));
      out[b.id] = amountOf(take);
      left = amountOf(left - take);
    });
    return out;
  }, [bills, amount]);
  const plan = manual ? Object.fromEntries(bills.map((b) => [b.id, amountOf(alloc[b.id])])) : auto;
  const allocated = amountOf(Object.values(plan).reduce((s, v) => s + v, 0));
  const advance = amountOf(amount - allocated);
  const overBill = manual && bills.some((b) => plan[b.id] > b.balanceDue + 0.009);

  const save = useMutation({
    mutationFn: () =>
      api.post('/v1/supplier-payments', {
        supplierId,
        amount,
        paymentDate: form.paymentDate,
        mode: form.mode,
        reference: form.reference,
        notes: form.notes,
        ...(manual && { allocations: bills.filter((b) => plan[b.id] > 0).map((b) => ({ bill: b.id, amount: plan[b.id] })) }),
      }),
    onSuccess: (res) => {
      toast.success(`Payment ${res.data?.data?.paymentNo || ''} recorded`);
      queryClient.invalidateQueries({ queryKey: PAYABLES_KEY });
      onClose();
    },
    onError: (err) => setError(apiError(err)),
  });
  const canSave = supplierId && amount > 0 && advance >= -0.009 && !overBill;

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Record supplier payment"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => save.mutate()} disabled={!canSave} loading={save.isPending}>
            Save payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorAlert title="Could not save the payment" message={error.message} errors={error.errors} onClose={() => setError(null)} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <SupplierSelect value={supplierId} onChange={(v) => (setSupplierId(v), setAlloc({}))} />
          <Field label="Amount paid" required>
            <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: onlyDecimal(e.target.value) })} placeholder="0.00" />
          </Field>
          <Field label="Date">
            <Input type="date" max={todayInput()} value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} />
          </Field>
          <Field label="Mode">
            <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              {MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="UTR / cheque no." className="sm:col-span-2">
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Optional" />
          </Field>
        </div>

        {supplierId && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                Open bills {data?.supplier && <span className="font-normal text-muted-foreground">· you owe {money(data.supplier.outstanding)}</span>}
              </h3>
              {bills.length > 0 && (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={manual} onChange={(e) => (setManual(e.target.checked), setAlloc(Object.fromEntries(Object.entries(auto).map(([k, v]) => [k, v ? String(v) : '']))))} />
                  Choose amounts myself
                </label>
              )}
            </div>
            {isFetching && !bills.length ? (
              <Skeleton className="h-14 w-full" />
            ) : !bills.length ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No open bills - the whole amount will be an advance.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {bills.map((b) => (
                  <li key={b.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {b.billNo} <span className="font-normal text-muted-foreground">· inv {b.supplierInvoiceNo}</span>
                      </p>
                      <p className={cn('text-xs', b.overdue ? 'text-destructive' : 'text-muted-foreground')}>
                        Due {formatDate(b.dueDate)} · balance {money(b.balanceDue)}
                      </p>
                    </div>
                    {manual ? (
                      <Input
                        inputMode="decimal"
                        value={alloc[b.id] ?? ''}
                        onChange={(e) => setAlloc({ ...alloc, [b.id]: onlyDecimal(e.target.value) })}
                        error={plan[b.id] > b.balanceDue + 0.009}
                        className="h-9 text-right"
                        aria-label={`Amount against ${b.billNo}`}
                      />
                    ) : (
                      <span className="text-right font-medium tabular-nums">{plan[b.id] > 0 ? money(plan[b.id]) : '—'}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-right text-sm">
              Against bills <span className="font-semibold tabular-nums">{money(allocated)}</span>
              {advance > 0.009 && <span className="text-warning"> · advance {money(advance)}</span>}
              {advance < -0.009 && <span className="text-destructive"> · more than the amount paid</span>}
            </p>
          </section>
        )}

        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
