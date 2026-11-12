import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Eye, MoreHorizontal, Plus, Search, XCircle } from 'lucide-react';

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
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';
import { todayInput } from '@/components/company/form-utils';
import { cn } from '@/utils/cn';

/**
 * Supplier bills: the supplier's tax invoice for goods received on GRNs.
 * Booking one adds to what we owe the supplier; payments and returns bring it
 * down.
 */
export default function PurchaseBills() {
  const { company } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const money = (v) => formatMoney(v || 0, company?.currency);
  const [params, setParams] = useSearchParams();
  const [booking, setBooking] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const search = params.get('search') || '';
  const status = params.get('status') || '';
  const page = Number(params.get('page') || 1);
  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === '' || v == null ? next.delete(k) : next.set(k, String(v))));
    setParams(next, { replace: true });
  };
  const query = { page, limit: 20, ...(search && { search }), ...(status === 'OVERDUE' ? { overdue: 'true' } : status ? { status } : {}) };

  const { data, isLoading } = useQuery({
    queryKey: [...PAYABLES_KEY, 'bills', query],
    queryFn: async () => (await api.get('/v1/purchase-bills', { params: query })).data,
    keepPreviousData: true,
  });
  const rows = data?.data || [];

  const cancel = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/v1/purchase-bills/${id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success('Bill cancelled');
      setCancelling(null);
      queryClient.invalidateQueries({ queryKey: PAYABLES_KEY });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Supplier Bills"
        description="Suppliers' tax invoices for goods received. Booking a bill adds to what you owe them."
        breadcrumbs={[{ label: 'Purchase', to: '/app/purchase-bills' }, { label: 'Supplier Bills' }]}
        actions={
          can('bills.create') && (
            <Button onClick={() => setBooking(true)}>
              <Plus className="h-4 w-4" /> Book bill
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
              placeholder="Search bill no, supplier invoice no, supplier or GRN…"
              className="pl-9"
            />
          </div>
          <FilterPanel active={[status].filter(Boolean).length} onReset={status ? () => setParam({ status: '', page: 1 }) : undefined}>
            <Select value={status} onChange={(e) => setParam({ status: e.target.value, page: 1 })} className="w-44" aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="POSTED">Unpaid</option>
              <option value="PARTIALLY_PAID">Partly paid</option>
              <option value="OVERDUE">Overdue</option>
              <option value="PAID">Paid</option>
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
            title="No supplier bills yet"
            description="Post a goods receipt, then book the supplier's bill for it here."
            action={can('bills.create') && <Button onClick={() => setBooking(true)}>Book bill</Button>}
          />
        ) : (
          <Table cards>
            <TableHeader>
              <TableRow>
                <TableHead>Bill</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const overdue = ['POSTED', 'PARTIALLY_PAID'].includes(b.status) && b.dueDate && new Date(b.dueDate) < new Date(todayInput());
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <button type="button" onClick={() => setViewing(b.id)} className="text-left font-semibold text-brand-600 hover:underline dark:text-brand-300">
                        {b.billNo}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        Inv {b.supplierInvoiceNo} · {formatDate(b.supplierInvoiceDate)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{b.supplierName}</p>
                      <p className="text-xs text-muted-foreground">{(b.grnNos || []).join(', ')}</p>
                    </TableCell>
                    <TableCell className={cn(overdue && 'font-medium text-destructive')}>{formatDate(b.dueDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(b.total)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(b.balanceDue)}</TableCell>
                    <TableCell>
                      <StatusBadge status={overdue ? 'OVERDUE' : b.status}>{(overdue ? 'OVERDUE' : b.status).replace(/_/g, ' ')}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-right" data-actions>
                      <DropdownMenu
                        trigger={
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions for {b.billNo}</span>
                          </span>
                        }
                      >
                        {({ close }) => (
                          <>
                            <DropdownMenuItem onClick={() => (close(), setViewing(b.id))}>
                              <Eye className="h-4 w-4" /> View bill
                            </DropdownMenuItem>
                            {can('bills.cancel') && b.status !== 'CANCELLED' && (
                              <DropdownMenuItem className="text-destructive" onClick={() => (close(), setCancelling(b))}>
                                <XCircle className="h-4 w-4" /> Cancel bill
                              </DropdownMenuItem>
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
        )}
        <Pagination meta={data?.meta} onPageChange={(p) => setParam({ page: p })} />
      </Card>

      {booking && <BookBillDialog onClose={() => setBooking(false)} money={money} />}
      {viewing && <BillDetailDialog id={viewing} onClose={() => setViewing(null)} money={money} />}
      <CancelDialog
        open={Boolean(cancelling)}
        title={`Cancel bill ${cancelling?.billNo || ''}?`}
        message="What you owe the supplier goes down by its total, and its goods can be billed again. A bill with payments or returns cannot be cancelled until those are."
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => cancel.mutate({ id: cancelling.id, reason })}
        loading={cancel.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function BookBillDialog({ onClose, money }) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [picked, setPicked] = useState({}); // grnId -> true
  const [lines, setLines] = useState({}); // grnItemId -> { qty, taxRate }
  const [form, setForm] = useState({ supplierInvoiceNo: '', supplierInvoiceDate: todayInput(), otherCharges: '', notes: '' });
  const [error, setError] = useState(null);

  const { data, isFetching } = useQuery({
    queryKey: [...PAYABLES_KEY, 'bill-options', supplierId],
    queryFn: async () => (await api.get('/v1/purchase-bills/form-options', { params: { supplierId } })).data?.data,
    enabled: Boolean(supplierId),
  });
  const grns = data?.grns || [];

  const chosen = useMemo(
    () =>
      grns
        .filter((g) => picked[g.id])
        .flatMap((g) =>
          g.lines.map((l) => {
            const edit = lines[l.grnItemId] || {};
            const qty = edit.qty !== undefined ? amountOf(edit.qty) : l.billable;
            const taxRate = edit.taxRate !== undefined ? amountOf(edit.taxRate) : l.taxRate;
            const taxable = amountOf(qty * l.unitPrice);
            return { ...l, qty, taxRate, taxable, tax: amountOf((taxable * taxRate) / 100) };
          })
        ),
    [grns, picked, lines]
  );
  const taxable = amountOf(chosen.reduce((s, l) => s + l.taxable, 0));
  const tax = amountOf(chosen.reduce((s, l) => s + l.tax, 0));
  const total = amountOf(taxable + tax + amountOf(form.otherCharges));

  const save = useMutation({
    mutationFn: () =>
      api.post('/v1/purchase-bills', {
        supplierId,
        supplierInvoiceNo: form.supplierInvoiceNo,
        supplierInvoiceDate: form.supplierInvoiceDate,
        grnIds: grns.filter((g) => picked[g.id]).map((g) => g.id),
        items: chosen.map((l) => ({ grnItemId: l.grnItemId, qty: l.qty, taxRate: l.taxRate })),
        otherCharges: amountOf(form.otherCharges),
        notes: form.notes,
      }),
    onSuccess: (res) => {
      toast.success(`Bill ${res.data?.data?.billNo || ''} booked`);
      queryClient.invalidateQueries({ queryKey: PAYABLES_KEY });
      onClose();
    },
    onError: (err) => setError(apiError(err)),
  });

  const badQty = chosen.some((l) => l.qty < 0 || l.qty > l.billable + 0.0001);
  const canSave = supplierId && form.supplierInvoiceNo.trim() && form.supplierInvoiceDate && chosen.some((l) => l.qty > 0) && !badQty;

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Book supplier bill"
      description="Pick the supplier and the goods receipts this bill is for. Rates come from the receipts."
      footer={
        <>
          <span className="mr-auto text-sm">
            Total <span className="font-bold tabular-nums">{money(total)}</span>
          </span>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => save.mutate()} disabled={!canSave} loading={save.isPending}>
            Book bill
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorAlert title="Could not book the bill" message={error.message} errors={error.errors} onClose={() => setError(null)} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <SupplierSelect
            value={supplierId}
            onChange={(v) => {
              setSupplierId(v);
              setPicked({});
              setLines({});
            }}
          />
          <Field label="Supplier invoice no." required>
            <Input value={form.supplierInvoiceNo} onChange={(e) => setForm({ ...form, supplierInvoiceNo: e.target.value })} placeholder="As printed on their bill" />
          </Field>
          <Field label="Supplier invoice date" required>
            <Input type="date" max={todayInput()} value={form.supplierInvoiceDate} onChange={(e) => setForm({ ...form, supplierInvoiceDate: e.target.value })} />
          </Field>
        </div>

        {supplierId && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Goods receipts not yet billed</h3>
            {isFetching && !grns.length ? (
              <Skeleton className="h-16 w-full" />
            ) : !grns.length ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nothing left to bill for this supplier. Post a goods receipt first.</p>
            ) : (
              grns.map((g) => (
                <div key={g.id} className={cn('rounded-xl border', picked[g.id] && 'border-primary/50 bg-primary/[0.03]')}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={Boolean(picked[g.id])}
                      onChange={(e) => setPicked({ ...picked, [g.id]: e.target.checked })}
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold">{g.grnNo}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {formatDate(g.grnDate)}
                        {g.poNo ? ` · ${g.poNo}` : ''}
                        {g.invoiceNo ? ` · challan ${g.invoiceNo}` : ''}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">{g.lines.length} line(s)</span>
                  </label>
                  {picked[g.id] && (
                    <div className="divide-y border-t">
                      {g.lines.map((l) => {
                        const line = chosen.find((c) => c.grnItemId === l.grnItemId);
                        const over = line && line.qty > l.billable + 0.0001;
                        return (
                          <div key={l.grnItemId} className="grid grid-cols-2 items-end gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,2fr)_7rem_6rem_7rem]">
                            <div className="col-span-2 min-w-0 sm:col-span-1">
                              <p className="truncate font-medium">{l.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {money(l.unitPrice)} / {l.unit} · up to {formatNumber(l.billable)}
                              </p>
                            </div>
                            <Field label="Qty" error={over ? 'Too much' : undefined}>
                              <Input
                                inputMode="decimal"
                                value={lines[l.grnItemId]?.qty ?? String(l.billable)}
                                onChange={(e) => setLines({ ...lines, [l.grnItemId]: { ...lines[l.grnItemId], qty: onlyDecimal(e.target.value) } })}
                                className="h-9 text-right"
                              />
                            </Field>
                            <Field label="Tax %">
                              <Input
                                inputMode="decimal"
                                value={lines[l.grnItemId]?.taxRate ?? String(l.taxRate)}
                                onChange={(e) => setLines({ ...lines, [l.grnItemId]: { ...lines[l.grnItemId], taxRate: onlyDecimal(e.target.value) } })}
                                className="h-9 text-right"
                              />
                            </Field>
                            <p className="pb-2 text-right font-medium tabular-nums">{money((line?.taxable || 0) + (line?.tax || 0))}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </section>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_16rem]">
          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <div className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-sm">
            <Row label="Taxable value" value={money(taxable)} />
            <Row label="Input tax" value={money(tax)} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Other charges</span>
              <Input
                inputMode="decimal"
                value={form.otherCharges}
                onChange={(e) => setForm({ ...form, otherCharges: onlyDecimal(e.target.value) })}
                placeholder="0.00"
                className="h-8 w-24 text-right"
                aria-label="Other charges"
              />
            </div>
            <div className="flex items-center justify-between border-t pt-1.5 font-semibold">
              <span>Bill total</span>
              <span className="tabular-nums">{money(total)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Final rounding follows your invoice setting. Freight / loading in other charges does not change stock cost.</p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground">{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);

function BillDetailDialog({ id, onClose, money }) {
  const { data: bill, isLoading } = useQuery({
    queryKey: [...PAYABLES_KEY, 'bill', id],
    queryFn: async () => (await api.get(`/v1/purchase-bills/${id}`)).data?.data,
  });
  return (
    <Dialog open onClose={onClose} size="lg" title={bill ? `${bill.billNo} · ${bill.supplierName}` : 'Bill'} description={bill ? `Supplier invoice ${bill.supplierInvoiceNo} dated ${formatDate(bill.supplierInvoiceDate)} · due ${formatDate(bill.dueDate)}` : ''}>
      {isLoading || !bill ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={bill.status}>{bill.status.replace(/_/g, ' ')}</StatusBadge>
            <span className="text-muted-foreground">GRN {(bill.grnNos || []).join(', ')}</span>
            {bill.supplierGstin && <span className="text-muted-foreground">GSTIN {bill.supplierGstin}</span>}
          </div>
          <ul className="divide-y rounded-xl border">
            {bill.items.map((l) => (
              <li key={l.id || l._id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(l.qty)} {l.unit} × {money(l.unitPrice)} · tax {l.taxRate}% · {l.grnNo}
                  </p>
                </div>
                <span className="shrink-0 font-medium tabular-nums">{money(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="ml-auto max-w-xs space-y-1">
            <Row label="Taxable value" value={money(bill.taxableTotal)} />
            {bill.taxBreakup?.cgst > 0 && <Row label="CGST" value={money(bill.taxBreakup.cgst)} />}
            {bill.taxBreakup?.sgst > 0 && <Row label="SGST" value={money(bill.taxBreakup.sgst)} />}
            {bill.taxBreakup?.igst > 0 && <Row label="IGST" value={money(bill.taxBreakup.igst)} />}
            {bill.otherCharges > 0 && <Row label="Other charges" value={money(bill.otherCharges)} />}
            {bill.roundOff !== 0 && <Row label="Round off" value={money(bill.roundOff)} />}
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(bill.total)}</span>
            </div>
            <Row label="Paid" value={`− ${money(bill.amountPaid)}`} />
            {bill.returnTotal > 0 && <Row label="Returned" value={`− ${money(bill.returnTotal)}`} />}
            <div className="flex justify-between font-semibold">
              <span>Balance</span>
              <span className="tabular-nums">{money(bill.balanceDue)}</span>
            </div>
          </div>
          {(bill.payments?.length > 0 || bill.returns?.length > 0) && (
            <div className="space-y-1">
              <h3 className="font-semibold">Set against this bill</h3>
              {bill.payments.map((p) => (
                <p key={p.id} className="flex justify-between text-muted-foreground">
                  <span>
                    {p.paymentNo} · {formatDate(p.paymentDate)} · {p.mode.replace(/_/g, ' ')}
                    {p.reference ? ` · ${p.reference}` : ''}
                  </span>
                  <span className="tabular-nums">{money(p.amount)}</span>
                </p>
              ))}
              {bill.returns.map((x) => (
                <p key={x.id} className="flex justify-between text-muted-foreground">
                  <span>
                    {x.returnNo} · return · {formatDate(x.returnDate)}
                  </span>
                  <span className="tabular-nums">{money(x.amount)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
