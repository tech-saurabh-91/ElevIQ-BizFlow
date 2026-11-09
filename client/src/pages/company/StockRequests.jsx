import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/misc';
import { ErrorAlert } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLookups } from '@/hooks/useLookups';
import { useAuthStore } from '@/store/authStore';
import { describeQty, unitOf, unitOptions } from '@/utils/units';
import { formatDateTime, formatNumber } from '@/utils/format';

/**
 * Van stock requests: the executive asks for stock, a manager adjusts and
 * approves it (issued from the godown), the executive confirms receipt.
 */

const STATUS_TONE = { SUBMITTED: 'warning', APPROVED: 'info', RECEIVED: 'success', REJECTED: 'destructive', CANCELLED: 'muted' };
const STATUS_LABEL = { SUBMITTED: 'Waiting for approval', APPROVED: 'Issued - confirm receipt', RECEIVED: 'Received', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

/** Lines typed in any unit, kept in base units for the server. */
function LineEditor({ lines, setLines, products, label = 'Qty' }) {
  const byId = (id) => products.find((p) => p.id === id);
  const update = (i, patch) => setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_2rem] gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>Product</span>
        <span>{label}</span>
        <span>Unit</span>
        <span />
      </div>
      {lines.map((l, i) => {
        const product = byId(l.product);
        return (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_2rem] items-center gap-2">
            <Select value={l.product} onChange={(e) => update(i, { product: e.target.value, unit: byId(e.target.value)?.unit || '' })} aria-label={`Product ${i + 1}`}>
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.sku ? `· ${p.sku}` : ''}
                </option>
              ))}
            </Select>
            <Input inputMode="decimal" value={l.qty} onChange={(e) => update(i, { qty: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`Quantity ${i + 1}`} />
            <Select value={l.unit || product?.unit || ''} onChange={(e) => update(i, { unit: e.target.value })} disabled={!product} aria-label={`Unit ${i + 1}`}>
              {unitOptions(product).map((u) => (
                <option key={u.unit} value={u.unit}>
                  {u.base ? u.unit : `${u.unit} (${u.factor})`}
                </option>
              ))}
            </Select>
            <button type="button" onClick={() => setLines((all) => all.filter((_, j) => j !== i))} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive" aria-label={`Remove line ${i + 1}`}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => setLines((all) => [...all, { product: '', qty: '', unit: '' }])}>
        <Plus className="h-4 w-4" /> Add product
      </Button>
    </div>
  );
}

const toBase = (lines, products) =>
  lines
    .filter((l) => l.product && Number(l.qty) > 0)
    .map((l) => {
      const p = products.find((x) => x.id === l.product);
      return { product: l.product, qty: Number(l.qty) * unitOf(p, l.unit || p?.unit).factor };
    });

function RequestDialog({ request, canApprove, myId, onClose }) {
  const queryClient = useQueryClient();
  const { lookups } = useLookups();
  const products = lookups.products || [];
  const creating = request === 'new';
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');

  const status = creating ? 'NEW' : request.status;
  const isMine = !creating && request.executive === myId;
  const editing = creating || (canApprove && status === 'SUBMITTED');
  const receiving = isMine && status === 'APPROVED';

  useEffect(() => {
    setError(null);
    setNotes('');
    if (creating) setLines([{ product: '', qty: '', unit: '' }]);
    else if (editing) setLines(request.items.map((i) => ({ product: i.product, qty: String(i.approvedQty || i.requestedQty), unit: i.unit })));
    else if (receiving) setLines(request.items.filter((i) => i.approvedQty > 0).map((i) => ({ product: i.product, qty: String(i.approvedQty), unit: i.unit })));
  }, [request]);

  const act = async (kind) => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'create') await api.post('/v1/stock-requests', { items: toBase(lines, products), notes });
      if (kind === 'approve') await api.post(`/v1/stock-requests/${request.id}/approve`, { items: toBase(lines, products), notes });
      if (kind === 'reject') await api.post(`/v1/stock-requests/${request.id}/reject`, { reason });
      if (kind === 'cancel') await api.post(`/v1/stock-requests/${request.id}/cancel`, {});
      if (kind === 'receive') {
        // The van takes exactly what was issued; nothing to edit here.
        await api.post(`/v1/stock-requests/${request.id}/receive`, {});
      }
      toast.success({ create: 'Request sent', approve: 'Approved and issued', reject: 'Rejected', cancel: 'Cancelled', receive: 'Van stock updated' }[kind]);
      queryClient.invalidateQueries({ queryKey: ['company', 'stock-requests'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'vans'] });
      onClose();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={creating ? 'New stock request' : `${request.requestNo} · ${request.van?.name || request.vanCode}`}
      description={creating ? 'Ask for stock for your van. A manager reviews it before it is issued.' : `${request.executiveName} · ${STATUS_LABEL[status]}`}
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {creating && (
            <Button type="button" onClick={() => act('create')} loading={busy === 'create'}>
              Send request
            </Button>
          )}
          {!creating && isMine && status === 'SUBMITTED' && (
            <Button type="button" variant="outline" onClick={() => act('cancel')} loading={busy === 'cancel'}>
              Cancel request
            </Button>
          )}
          {!creating && editing && (
            <>
              <Button type="button" variant="destructive" onClick={() => act('reject')} loading={busy === 'reject'} disabled={!reason.trim()}>
                Reject
              </Button>
              <Button type="button" onClick={() => act('approve')} loading={busy === 'approve'}>
                Approve &amp; issue
              </Button>
            </>
          )}
          {receiving && (
            <Button type="button" onClick={() => act('receive')} loading={busy === 'receive'}>
              Confirm received
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorAlert title="Could not save" message={error.message} errors={error.errors} onClose={() => setError(null)} />}
        {!creating && request.notes && <p className="rounded-lg bg-muted/50 p-3 text-sm">Note: {request.notes}</p>}

        {editing ? (
          <LineEditor lines={lines} setLines={setLines} products={products} label={creating ? 'Qty' : 'Approve'} />
        ) : receiving ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This stock was issued to your van. Confirm to add it to van stock - the quantities cannot be changed.
            </p>
            <ul className="divide-y rounded-lg border text-sm">
              {lines.map((l) => {
                const item = request.items.find((x) => x.product === l.product);
                return (
                  <li key={l.product} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 [overflow-wrap:anywhere]">{item.name}</span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatNumber(item.approvedQty)} {item.unit}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 text-right font-medium">Asked</th>
                  <th className="px-3 py-2 text-right font-medium">Approved</th>
                  <th className="px-3 py-2 text-right font-medium">Received</th>
                </tr>
              </thead>
              <tbody>
                {request.items.map((i) => (
                  <tr key={i.product} className="border-t">
                    <td className="px-3 py-2">
                      {i.name} <span className="text-xs text-muted-foreground">{i.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(i.requestedQty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(i.approvedQty)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{status === 'RECEIVED' ? formatNumber(i.receivedQty) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(creating || editing) && (
          <Field label={creating ? 'Notes' : 'Note to the executive'}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        )}
        {!creating && editing && (
          <Field label="Reason (only to reject)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Stock reserved for a bulk order" />
          </Field>
        )}
        {!creating && (request.managerNotes || request.rejectReason || request.receiveNotes) && (
          <p className="text-xs text-muted-foreground">
            {[request.managerNotes && `Manager: ${request.managerNotes}`, request.rejectReason && `Rejected: ${request.rejectReason}`, request.receiveNotes && `Receipt: ${request.receiveNotes}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export default function StockRequests() {
  const [open, setOpen] = useState(null);
  const [status, setStatus] = useState('');
  const me = useQuery({ queryKey: ['company', 'vans', 'mine'], queryFn: async () => (await api.get('/v1/vans/mine')).data?.data ?? null });
  const list = useQuery({
    queryKey: ['company', 'stock-requests', status],
    queryFn: async () => (await api.get('/v1/stock-requests', { params: { status: status || undefined, limit: 50 } })).data,
  });
  const rows = list.data?.data || [];
  const canApprove = Boolean(list.data?.meta?.canApprove);
  const myId = useAuthStore((st) => st.user?.id);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Van stock requests"
        description="Executives ask for van stock; managers approve and issue it; executives confirm receipt."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Van stock requests' }]}
        actions={
          me.data ? (
            <Button onClick={() => setOpen('new')}>
              <Plus className="h-4 w-4" /> New request
            </Button>
          ) : null
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto min-w-[12rem]" aria-label="Filter by status">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <LoadingState label="Loading requests…" />
        ) : !rows.length ? (
          <EmptyState icon="empty" title="No stock requests" description={me.data ? 'Ask for stock before you head out.' : 'Requests raised by van executives appear here.'} />
        ) : (
          <Table cards>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Van / executive</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Raised</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r)}>
                  <TableCell className="font-mono font-medium">
                    <ClipboardList className="mr-1 inline h-4 w-4 text-muted-foreground" />
                    {r.requestNo}
                  </TableCell>
                  <TableCell>
                    <p>{r.van?.name || r.vanCode}</p>
                    <p className="text-xs text-muted-foreground">{r.executiveName}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.items
                      .filter((i) => (r.status === 'SUBMITTED' ? i.requestedQty : i.approvedQty) > 0)
                      .map((i) => `${i.name} ${describeQty(r.status === 'SUBMITTED' ? i.requestedQty : i.approvedQty, { unit: i.unit })}`)
                      .join(', ')}
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{formatDateTime(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {open && <RequestDialog request={open} canApprove={canApprove} myId={myId} onClose={() => setOpen(null)} />}
    </div>
  );
}
