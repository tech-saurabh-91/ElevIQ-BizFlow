import { useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ChevronRight, ClipboardList, FileDown, FileText, KeyRound, LogOut, Repeat2, ShoppingBag, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertDescription, AlertTitle, ErrorAlert } from '@/components/ui/alert';
import { Dialog } from '@/components/ui/dialog';
import { apiError } from '@/api/client';
import { formatDate, formatDateTime, formatNumber } from '@/utils/format';
import { cn } from '@/utils/cn';
import portalApi, { openPortalPdf } from './portalApi';
import { cartActions, usePortalStore } from './portalStore';
import { InvoiceStatus, OrderStatus, portalPath, useMoney, usePortalCode } from './portal-shared';
import { SummaryRow } from './PortalShop';

/** Put an order's paid lines back in the cart (prices are worked out again). */
const useReorder = () => {
  const code = usePortalCode();
  const navigate = useNavigate();
  return (order) => {
    const lines = (order.items || [])
      .filter((l) => !l.isFree)
      .map((l) => ({ product: l.product, name: l.name, unit: l.unit, qty: l.qty, price: l.unitPrice }));
    cartActions(code).replace(lines);
    toast.success('Added to your cart. Check quantities and place the order.');
    navigate(portalPath(code, 'cart'));
  };
};

const loadOrder = async (id) => (await portalApi.get(`/orders/${id}`)).data.data;

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
export function PortalHome() {
  const code = usePortalCode();
  const navigate = useNavigate();
  const money = useMoney();
  const reorder = useReorder();
  const me = useQuery({ queryKey: ['portal', 'me', code], queryFn: async () => (await portalApi.get('/me')).data.data });
  const recent = useQuery({
    queryKey: ['portal', 'orders', code, 'recent'],
    queryFn: async () => (await portalApi.get('/orders', { params: { limit: 5 } })).data.data,
  });
  const [reordering, setReordering] = useState(false);

  const doReorder = async () => {
    setReordering(true);
    try {
      reorder(await loadOrder(me.data.lastOrder.id));
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      setReordering(false);
    }
  };

  const data = me.data;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Hello, {data?.customer?.name || '…'}</h1>
        <p className="text-sm text-muted-foreground">Order anytime. The company confirms each order.</p>
      </div>

      {me.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : data?.customer?.outstanding !== undefined ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
              <Wallet className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">Balance due</p>
              <p className="text-xl font-bold tabular-nums">{money(data.customer.outstanding)}</p>
            </div>
            <Link to={portalPath(code, 'statement')} className="text-sm font-medium text-primary">
              Statement →
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Button className="h-14" onClick={() => navigate(portalPath(code, 'catalog'))}>
          <ShoppingBag className="h-5 w-5" /> New order
        </Button>
        <Button
          variant="outline"
          className="h-14"
          onClick={doReorder}
          loading={reordering}
          disabled={!data?.lastOrder}
          title={data?.lastOrder ? `Repeat ${data.lastOrder.orderNo}` : 'No earlier order yet'}
        >
          <Repeat2 className="h-5 w-5" /> Repeat last order
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Recent orders</CardTitle>
          <Link to={portalPath(code, 'orders')} className="text-sm font-medium text-primary">
            All →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {recent.isLoading ? (
            <div className="p-4">
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !recent.data?.length ? (
            <p className="p-4 text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <OrderRows orders={recent.data} />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Link to={portalPath(code, 'invoices')} className="flex items-center gap-2 rounded-xl border bg-card p-3 text-sm font-medium">
          <FileText className="h-4 w-4 text-muted-foreground" /> Invoices
        </Link>
        {data?.portal?.showOutstanding && (
          <Link to={portalPath(code, 'statement')} className="flex items-center gap-2 rounded-xl border bg-card p-3 text-sm font-medium">
            <ClipboardList className="h-4 w-4 text-muted-foreground" /> Statement
          </Link>
        )}
      </div>
    </div>
  );
}

function OrderRows({ orders }) {
  const code = usePortalCode();
  const money = useMoney();
  return (
    <div className="divide-y">
      {orders.map((o) => (
        <Link key={o.id} to={portalPath(code, `orders/${o.id}`)} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{o.orderNo}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(o.orderDate)} · {o.lines} product{o.lines === 1 ? '' : 's'}
            </p>
          </div>
          <div className="text-right">
            <p className="font-semibold tabular-nums">{money(o.total)}</p>
            <OrderStatus status={o.status} />
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
const ORDER_FILTERS = [
  ['', 'All'],
  ['REQUESTED', 'Waiting'],
  ['CONFIRMED', 'Confirmed'],
  ['FULLY_INVOICED', 'Billed'],
  ['DELIVERED', 'Delivered'],
];

export function PortalOrders() {
  const code = usePortalCode();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['portal', 'orders', code, status, page],
    queryFn: async () => (await portalApi.get('/orders', { params: { status, page, limit: 20 } })).data,
    placeholderData: (prev) => prev,
  });
  const rows = query.data?.data || [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">My orders</h1>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {ORDER_FILTERS.map(([value, label]) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-sm',
              status === value ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Card>
        {query.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.isError ? (
          <div className="p-4">
            <ErrorAlert message={apiError(query.error).message} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="empty" title="No orders here" compact />
        ) : (
          <OrderRows orders={rows} />
        )}
      </Card>
      {meta?.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <span className="text-muted-foreground">
            Page {meta.page} of {meta.pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= meta.pages} onClick={() => setPage(page + 1)}>
            Older
          </Button>
        </div>
      )}
    </div>
  );
}

export function PortalOrderDetail() {
  const code = usePortalCode();
  const { id } = useParams();
  const money = useMoney();
  const reorder = useReorder();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const query = useQuery({ queryKey: ['portal', 'order', id], queryFn: () => loadOrder(id) });
  const cancel = useMutation({
    mutationFn: async () => (await portalApi.post(`/orders/${id}/cancel`, { reason })).data,
    onSuccess: (payload) => {
      queryClient.setQueryData(['portal', 'order', id], payload.data);
      queryClient.invalidateQueries({ queryKey: ['portal', 'orders'] });
      toast.success('Order cancelled');
      setCancelling(false);
    },
  });

  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (query.isError) return <ErrorAlert message={apiError(query.error).message} />;
  const o = query.data;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link to={portalPath(code, 'orders')} className="text-sm text-muted-foreground">
            ← My orders
          </Link>
          <h1 className="text-lg font-semibold">{o.orderNo}</h1>
          <p className="text-sm text-muted-foreground">{formatDateTime(o.history?.[0]?.at || o.orderDate)}</p>
        </div>
        <OrderStatus status={o.status} />
      </div>

      {o.status === 'REQUESTED' && (
        <Alert tone="info">
          <AlertDescription>Sent to the company. Nothing is final until they confirm it.</AlertDescription>
        </Alert>
      )}
      {o.status === 'REJECTED' && (
        <Alert tone="destructive">
          <AlertTitle>Not accepted</AlertTitle>
          <AlertDescription>{o.rejectionReason || 'Please contact the company.'}</AlertDescription>
        </Alert>
      )}
      {o.status === 'EXPIRED' && (
        <Alert tone="warning">
          <AlertDescription>This order was not confirmed in time. You can order again.</AlertDescription>
        </Alert>
      )}
      {o.changes?.length > 0 && (
        <Alert tone="warning">
          <AlertTitle>The company changed your order</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5">
              {o.changes.map((c, i) => (
                <li key={i}>
                  {c.name}: you asked {formatNumber(c.asked)} {c.unit}, {c.now ? `now ${formatNumber(c.now)}` : 'removed'}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="divide-y p-0">
          {o.items.map((l, i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {l.name} {l.isFree && <span className="text-xs font-semibold text-emerald-600">FREE</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(l.qty)} {l.unit} × {money(l.unitPrice)}
                  {l.discountPercent > 0 ? ` · ${l.discountPercent}% off` : ''}
                </p>
              </div>
              <span className="font-semibold tabular-nums">{money(l.lineTotal)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1.5 p-4 text-sm">
          <SummaryRow label="Items" value={money(o.totals.subtotal)} />
          {o.totals.discountTotal > 0 && <SummaryRow label="Discount" value={`− ${money(o.totals.discountTotal)}`} />}
          <SummaryRow label="Tax" value={money(o.totals.taxTotal)} />
          <SummaryRow label="Total" value={money(o.totals.total)} strong />
        </CardContent>
      </Card>

      {o.note && <p className="text-sm text-muted-foreground">Your note: “{o.note}”</p>}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 border-l pl-4">
            {o.history.map((h, i) => (
              <li key={i} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                <OrderStatus status={h.status} />{' '}
                <span className="text-xs text-muted-foreground">{formatDateTime(h.at)}</span>
                {h.note && <p className="text-xs text-muted-foreground">{h.note}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={() => reorder(o)}>
          <Repeat2 className="h-4 w-4" /> Order again
        </Button>
        {o.canCancel && (
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setCancelling(true)}>
            Cancel order
          </Button>
        )}
      </div>

      <Dialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancel this order?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCancelling(false)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => cancel.mutate()} loading={cancel.isPending}>
              Cancel order
            </Button>
          </>
        }
      >
        <Field label="Reason (optional)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
        </Field>
        {cancel.error && <ErrorAlert message={apiError(cancel.error).message} />}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export function PortalInvoices() {
  const code = usePortalCode();
  const money = useMoney();
  const [unpaid, setUnpaid] = useState(false);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['portal', 'invoices', code, unpaid, page],
    queryFn: async () => (await portalApi.get('/invoices', { params: { unpaid, page, limit: 20 } })).data,
    placeholderData: (prev) => prev,
  });
  const rows = query.data?.data || [];
  const meta = query.data?.meta;
  const open = async (inv) => {
    try {
      await openPortalPdf(`/invoices/${inv.id}/pdf`, {}, `${inv.invoiceNo}.pdf`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Invoices</h1>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={unpaid} onChange={(e) => { setUnpaid(e.target.checked); setPage(1); }} />
          Unpaid only
        </label>
      </div>
      <Card>
        {query.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.isError ? (
          <div className="p-4">
            <ErrorAlert message={apiError(query.error).message} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="empty" title="No invoices" compact />
        ) : (
          <div className="divide-y">
            {rows.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{inv.invoiceNo}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(inv.invoiceDate)}
                    {inv.balanceDue > 0 && inv.dueDate ? ` · due ${formatDate(inv.dueDate)}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(inv.total)}</p>
                  {inv.balanceDue > 0 && inv.balanceDue < inv.total ? (
                    <p className="text-xs text-muted-foreground">{money(inv.balanceDue)} due</p>
                  ) : (
                    <InvoiceStatus status={inv.status} />
                  )}
                </div>
                <Button size="icon-sm" variant="ghost" onClick={() => open(inv)} aria-label={`Download ${inv.invoiceNo}`}>
                  <FileDown className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {meta?.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <span className="text-muted-foreground">
            Page {meta.page} of {meta.pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= meta.pages} onClick={() => setPage(page + 1)}>
            Older
          </Button>
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">
        <Link to={portalPath(code, 'statement')} className="underline">
          See your statement of account
        </Link>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statement + balance confirmation
// ---------------------------------------------------------------------------
export function PortalStatement() {
  const money = useMoney();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const params = { from: from || undefined, to: to || undefined };
  const query = useQuery({
    queryKey: ['portal', 'statement', from, to],
    queryFn: async () => (await portalApi.get('/statement', { params })).data.data,
  });
  const answer = useMutation({
    mutationFn: async (status) =>
      (await portalApi.post('/statement/confirm', { status, note: status === 'DISPUTED' ? note : undefined, asOf: query.data?.period?.to })).data,
    onSuccess: (payload) => {
      toast.success(payload.message);
      setDisputing(false);
      queryClient.invalidateQueries({ queryKey: ['portal', 'statement'] });
    },
  });
  const side = (v) => (Math.abs(v) < 0.005 ? '' : v > 0 ? ' due' : ' advance');

  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (query.isError) return <ErrorAlert message={apiError(query.error).message} />;
  const s = query.data;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Statement of account</h1>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From">
          <Input type="date" value={from || s.period.from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to || s.period.to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Opening</p>
            <p className="font-bold tabular-nums">
              {money(Math.abs(s.opening))}
              <span className="text-xs font-normal">{side(s.opening)}</span>
            </p>
          </CardContent>
        </Card>
        <Card className="border-primary/40">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Closing ({formatDate(s.period.to)})</p>
            <p className="font-bold tabular-nums">
              {money(Math.abs(s.closing))}
              <span className="text-xs font-normal">{side(s.closing)}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {s.rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No entries in this period.</p>
          ) : (
            s.rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {r.type} {r.no}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(r.date)}</p>
                </div>
                <div className="text-right tabular-nums">
                  {r.debit ? <p>{money(r.debit)}</p> : <p className="text-emerald-700 dark:text-emerald-400">− {money(r.credit)}</p>}
                  <p className="text-xs text-muted-foreground">
                    {money(Math.abs(r.balance))}
                    {side(r.balance)}
                  </p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => openPortalPdf('/statement/pdf', params, 'statement.pdf').catch((err) => toast.error(apiError(err).message))}
      >
        <FileDown className="h-4 w-4" /> Download PDF
      </Button>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm">
            Does your balance of <strong>{money(Math.abs(s.closing))}{side(s.closing)}</strong> as on{' '}
            {formatDate(s.period.to)} match your books?
          </p>
          {s.confirmation && (
            <p className="text-xs text-muted-foreground">
              Last answer: {s.confirmation.status === 'CONFIRMED' ? 'confirmed' : 'not matching'} on {formatDate(s.confirmation.at)}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => answer.mutate('CONFIRMED')} loading={answer.isPending && !disputing}>
              Yes, it matches
            </Button>
            <Button variant="outline" onClick={() => setDisputing(true)}>
              No, it does not
            </Button>
          </div>
          {disputing && (
            <div className="space-y-2">
              <Field label="What does not match?">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="e.g. payment of 5,000 on 12 Nov is missing" />
              </Field>
              <Button className="w-full" onClick={() => answer.mutate('DISPUTED')} loading={answer.isPending} disabled={note.trim().length < 3}>
                Send to the company
              </Button>
            </div>
          )}
          {answer.error && <ErrorAlert message={apiError(answer.error).message} />}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account + PIN
// ---------------------------------------------------------------------------
export function PortalAccount() {
  const code = usePortalCode();
  const { logout } = useOutletContext();
  const session = usePortalStore((s) => s.session);
  const { customer, company, account } = session;
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Account</h1>
      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <p className="text-base font-semibold">{customer.name}</p>
          <p className="text-muted-foreground">Code {customer.code}</p>
          <p className="text-muted-foreground">Signs in with {account.mobile}</p>
          <p className="pt-2 text-xs text-muted-foreground">Ordering from {company.name}</p>
        </CardContent>
      </Card>
      <div className="divide-y rounded-xl border bg-card">
        {[
          ['invoices', 'Invoices', FileText],
          ...(session.portal?.showOutstanding ? [['statement', 'Statement of account', ClipboardList]] : []),
          ['account/pin', 'Change PIN', KeyRound],
        ].map(([to, label, Icon]) => (
          <Link key={to} to={portalPath(code, to)} className="flex items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-accent/50">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">{label}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
      <Button variant="outline" className="w-full" onClick={logout}>
        <LogOut className="h-4 w-4" /> Sign out
      </Button>
    </div>
  );
}

export function PortalChangePin() {
  const code = usePortalCode();
  const navigate = useNavigate();
  const forced = usePortalStore((s) => s.session?.account?.mustChangePin);
  const [form, setForm] = useState({ currentPin: '', newPin: '', confirmPin: '' });
  const change = useMutation({
    mutationFn: async () => (await portalApi.post('/auth/change-pin', form)).data,
    onSuccess: () => {
      usePortalStore.getState().patchAccount({ mustChangePin: false });
      toast.success('PIN changed');
      navigate(portalPath(code), { replace: true });
    },
  });
  const digits = (key) => (e) => setForm({ ...form, [key]: e.target.value.replace(/\D/g, '').slice(0, 6) });
  const err = change.error ? apiError(change.error) : null;
  const ready = form.currentPin && /^\d{4,6}$/.test(form.newPin) && form.newPin === form.confirmPin;

  return (
    <div className="mx-auto max-w-sm space-y-3">
      <h1 className="text-lg font-semibold">{forced ? 'Set your own PIN' : 'Change PIN'}</h1>
      {forced && (
        <Alert tone="info">
          <AlertDescription>
            Choose a PIN only you know (4 to 6 digits). You will use it with your mobile number to sign in.
          </AlertDescription>
        </Alert>
      )}
      <Field label={forced ? 'PIN the company gave you' : 'Current PIN'}>
        <Input type="password" inputMode="numeric" value={form.currentPin} onChange={digits('currentPin')} />
      </Field>
      <Field label="New PIN">
        <Input type="password" inputMode="numeric" value={form.newPin} onChange={digits('newPin')} />
      </Field>
      <Field label="New PIN again" error={form.confirmPin && form.confirmPin !== form.newPin ? 'PINs do not match' : undefined}>
        <Input type="password" inputMode="numeric" value={form.confirmPin} onChange={digits('confirmPin')} />
      </Field>
      {err && <ErrorAlert message={err.message} />}
      <Button className="w-full" onClick={() => change.mutate()} loading={change.isPending} disabled={!ready}>
        Save PIN
      </Button>
    </div>
  );
}
