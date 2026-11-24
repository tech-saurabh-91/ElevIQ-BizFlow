import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Camera, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/alert';
import { apiError } from '@/api/client';
import { formatDate, formatDateTime } from '@/utils/format';
import { cn } from '@/utils/cn';
import portalApi from './portalApi';
import { portalPath, useMoney, usePortalCode } from './portal-shared';

const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };
const todayYmd = () => new Date().toLocaleDateString('en-CA');

/** Photo picker: up to `max` images, shown as thumbnails. */
function PhotoPicker({ files, onChange, max = 1, label = 'Add photo' }) {
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {previews.map((src, i) => (
        <button
          key={src}
          type="button"
          className="relative"
          onClick={() => onChange(files.filter((_, n) => n !== i))}
          title="Remove"
        >
          <img src={src} alt="" className="h-16 w-16 rounded-md border object-cover" />
          <span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">×</span>
        </button>
      ))}
      {files.length < max && (
        <label className="flex h-16 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground hover:bg-accent">
          <Camera className="h-4 w-4" /> {label}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) {
                toast.error('Choose a photo under 5 MB');
                return;
              }
              onChange([...files, file].slice(0, max));
              e.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "I have paid"
// ---------------------------------------------------------------------------
const CLAIM_TEXT = { SUBMITTED: ['Being checked', 'warning'], VERIFIED: ['Received', 'success'], REJECTED: ['Not found', 'destructive'] };
const MODES = [
  ['UPI', 'UPI'],
  ['BANK_TRANSFER', 'Bank transfer'],
  ['CHEQUE', 'Cheque'],
  ['CASH', 'Cash'],
  ['OTHER', 'Other'],
];

export function PortalPayments() {
  const code = usePortalCode();
  const money = useMoney();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const [form, setForm] = useState({ amount: params.get('amount') || '', paidOn: todayYmd(), mode: 'UPI', reference: '', note: '' });
  const [files, setFiles] = useState([]);
  const invoiceId = params.get('invoice') || '';

  const list = useQuery({ queryKey: ['portal', 'claims', code], queryFn: async () => (await portalApi.get('/payments')).data.data });
  const send = useMutation({
    mutationFn: async () => {
      const body = new FormData();
      Object.entries(form).forEach(([k, v]) => body.append(k, v));
      if (invoiceId) body.append('invoices', invoiceId);
      if (files[0]) body.append('proof', files[0]);
      return (await portalApi.post('/payments', body, MULTIPART)).data;
    },
    onSuccess: (payload) => {
      toast.success(payload.message);
      setOpen(false);
      setFiles([]);
      setForm({ amount: '', paidOn: todayYmd(), mode: 'UPI', reference: '', note: '' });
      queryClient.invalidateQueries({ queryKey: ['portal', 'claims'] });
    },
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const needsRef = ['UPI', 'BANK_TRANSFER', 'CHEQUE'].includes(form.mode);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Payments</h1>
        {!open && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> I have paid
          </Button>
        )}
      </div>

      {open && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">
              Tell the company about a payment you made. They check it and send you a receipt; your balance changes then.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount">
                <Input inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="0.00" />
              </Field>
              <Field label="Paid on">
                <Input type="date" max={todayYmd()} value={form.paidOn} onChange={set('paidOn')} />
              </Field>
            </div>
            <Field label="How">
              <Select value={form.mode} onChange={set('mode')}>
                {MODES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            {needsRef && (
              <Field label={form.mode === 'CHEQUE' ? 'Cheque number' : 'UPI / bank reference (UTR)'}>
                <Input value={form.reference} onChange={set('reference')} maxLength={80} />
              </Field>
            )}
            <Field label="Screenshot or photo (optional)">
              <PhotoPicker files={files} onChange={setFiles} label="Add screenshot" />
            </Field>
            <Field label="Note (optional)">
              <Textarea rows={2} value={form.note} onChange={set('note')} maxLength={500} />
            </Field>
            {send.error && <ErrorAlert message={apiError(send.error).message} />}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => send.mutate()} loading={send.isPending} disabled={!(Number(form.amount) > 0)}>
                Send
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        {list.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !list.data?.length ? (
          <EmptyState icon="empty" title="No payments sent yet" compact />
        ) : (
          <div className="divide-y">
            {list.data.map((c) => {
              const [label, tone] = CLAIM_TEXT[c.status] || [c.status, 'muted'];
              return (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold tabular-nums">{money(c.amount)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(c.paidOn)} · {MODES.find(([v]) => v === c.mode)?.[1] || c.mode}
                      {c.reference ? ` · ${c.reference}` : ''}
                    </p>
                    {c.rejectReason && <p className="text-xs text-destructive">{c.rejectReason}</p>}
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        <Link to={portalPath(code, 'invoices?unpaid=1')} className="underline">
          See unpaid invoices
        </Link>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Returns & complaints
// ---------------------------------------------------------------------------
const REASONS = [
  ['DAMAGED', 'Damaged'],
  ['EXPIRED', 'Expired / near expiry'],
  ['WRONG_ITEM', 'Wrong item'],
  ['SHORT_SUPPLY', 'Less than billed'],
  ['QUALITY', 'Quality problem'],
  ['OTHER', 'Other'],
];
const RETURN_TEXT = {
  OPEN: ['Sent', 'warning'],
  ACCEPTED: ['Accepted', 'info'],
  REJECTED: ['Not accepted', 'destructive'],
  RESOLVED: ['Resolved', 'success'],
};

function NewReturn({ onDone, onCancel }) {
  const [kind, setKind] = useState('RETURN');
  const [reason, setReason] = useState('DAMAGED');
  const [invoiceId, setInvoiceId] = useState('');
  const [qty, setQty] = useState({});
  const [note, setNote] = useState('');
  const [files, setFiles] = useState([]);
  const invoices = useQuery({
    queryKey: ['portal', 'invoices', 'for-returns'],
    queryFn: async () => (await portalApi.get('/invoices', { params: { limit: 30 } })).data.data,
  });
  const invoice = useQuery({
    queryKey: ['portal', 'invoice', invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: async () => (await portalApi.get(`/invoices/${invoiceId}`)).data.data,
  });
  const lines = (invoice.data?.items || []).filter((l) => !l.isFree);
  const keyOf = (l) => `${l.product}|${l.unit}`;
  const chosen = lines.filter((l) => Number(qty[keyOf(l)]) > 0).map((l) => ({ product: l.product, unit: l.unit, qty: Number(qty[keyOf(l)]) }));

  const send = useMutation({
    mutationFn: async () => {
      const body = new FormData();
      body.append('kind', kind);
      body.append('reason', reason);
      if (invoiceId) body.append('invoice', invoiceId);
      body.append('note', note);
      body.append('items', JSON.stringify(kind === 'RETURN' ? chosen : []));
      files.forEach((f) => body.append('photos', f));
      return (await portalApi.post('/returns', body, MULTIPART)).data;
    },
    onSuccess: (payload) => {
      toast.success(payload.message);
      onDone();
    },
  });
  const ready = kind === 'COMPLAINT' ? note.trim().length >= 3 : chosen.length > 0;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          {[
            ['RETURN', 'Return goods'],
            ['COMPLAINT', 'Complaint'],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setKind(v)}
              className={cn('rounded-lg border px-3 py-2 text-sm font-medium', kind === v ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}
            >
              {l}
            </button>
          ))}
        </div>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={kind === 'RETURN' ? 'Invoice' : 'Invoice (optional)'}>
          <Select value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setQty({}); }}>
            <option value="">{invoices.isLoading ? 'Loading…' : 'Choose the invoice'}</option>
            {(invoices.data || []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNo} · {formatDate(i.invoiceDate)}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'RETURN' && invoiceId && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">How many of each to return?</p>
            {invoice.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              lines.map((l) => (
                <div key={keyOf(l)} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {l.name} <span className="text-xs text-muted-foreground">(billed {l.qty} {l.unit})</span>
                  </span>
                  <Input
                    className="h-9 w-20 text-center"
                    inputMode="decimal"
                    value={qty[keyOf(l)] || ''}
                    placeholder="0"
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d.]/g, '');
                      setQty({ ...qty, [keyOf(l)]: Number(v) > Number(l.qty) ? String(l.qty) : v });
                    }}
                  />
                </div>
              ))
            )}
          </div>
        )}
        <Field label={kind === 'COMPLAINT' ? 'What happened?' : 'Note (optional)'}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <Field label="Photos (up to 4)">
          <PhotoPicker files={files} onChange={setFiles} max={4} />
        </Field>
        {send.error && <ErrorAlert message={apiError(send.error).message} />}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => send.mutate()} loading={send.isPending} disabled={!ready}>
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PortalReturns() {
  const code = usePortalCode();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const list = useQuery({ queryKey: ['portal', 'returns', code], queryFn: async () => (await portalApi.get('/returns')).data.data });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Returns & complaints</h1>
        {!open && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New
          </Button>
        )}
      </div>
      {open && (
        <NewReturn
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            queryClient.invalidateQueries({ queryKey: ['portal', 'returns'] });
          }}
        />
      )}
      <Card>
        {list.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !list.data?.length ? (
          <EmptyState icon="empty" title="Nothing raised yet" compact />
        ) : (
          <div className="divide-y">
            {list.data.map((r) => {
              const [label, tone] = RETURN_TEXT[r.status] || [r.status, 'muted'];
              return (
                <div key={r.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">
                      {r.requestNo} · {r.kind === 'RETURN' ? 'Return' : 'Complaint'}
                    </p>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {REASONS.find(([v]) => v === r.reason)?.[1]}
                    {r.invoiceNo ? ` · invoice ${r.invoiceNo}` : ''} · {formatDate(r.createdAt)}
                  </p>
                  {r.items?.length > 0 && (
                    <p className="text-sm">{r.items.map((i) => `${i.name} × ${i.qty} ${i.unit}`).join(', ')}</p>
                  )}
                  {r.staffNote && <p className="text-sm text-muted-foreground">Company: {r.staffNote}</p>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
export function PortalInbox() {
  const code = usePortalCode();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['portal', 'inbox', code],
    queryFn: async () => (await portalApi.get('/notifications')).data.data,
  });
  const readAll = useMutation({
    mutationFn: () => portalApi.post('/notifications/read'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal'] }),
  });
  const unread = (list.data || []).filter((n) => !n.read).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Updates</h1>
        {unread > 0 && (
          <Button size="sm" variant="outline" onClick={() => readAll.mutate()} loading={readAll.isPending}>
            Mark all read
          </Button>
        )}
      </div>
      <Card>
        {list.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : list.isError ? (
          <div className="p-4">
            <ErrorAlert message={apiError(list.error).message} />
          </div>
        ) : !list.data?.length ? (
          <EmptyState icon="empty" title="No updates yet" description="Order, invoice and payment updates appear here." compact />
        ) : (
          <div className="divide-y">
            {list.data.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => n.link && navigate(portalPath(code, n.link))}
                className={cn('block w-full px-4 py-3 text-left hover:bg-accent/50', !n.read && 'bg-primary/5')}
              >
                <p className={cn('text-sm', !n.read && 'font-semibold')}>{n.title}</p>
                {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                <p className="text-[11px] text-muted-foreground">{formatDateTime(n.at)}</p>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
