import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, FileMinus, Image as ImageIcon, Wallet, XCircle } from 'lucide-react';
import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs } from '@/components/ui/tabs';
import { Select, Field, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/alert';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatDateTime, formatMoney, titleCase } from '@/utils/format';

/**
 * What customers send from the online portal:
 *   Payments  - "I have paid" (record it as a receipt, or reject)
 *   Returns   - returns and complaints (accept, reject, resolve)
 */

const CLAIM_TONE = { SUBMITTED: 'warning', VERIFIED: 'success', REJECTED: 'destructive' };
const CLAIM_TEXT = { SUBMITTED: 'To check', VERIFIED: 'Recorded', REJECTED: 'Rejected' };
const RETURN_TONE = { OPEN: 'warning', ACCEPTED: 'info', REJECTED: 'destructive', RESOLVED: 'success' };

function Proof({ src, label = 'Proof' }) {
  if (!src) return null;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
      <ImageIcon className="h-3.5 w-3.5" /> {label}
    </a>
  );
}

function ReasonDialog({ open, title, label, confirm, tone, onClose, onSubmit, pending, error, required }) {
  const [text, setText] = useState('');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            loading={pending}
            disabled={required && text.trim().length < 3}
            onClick={() => onSubmit(text.trim())}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <Field label={label}>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
      </Field>
      {error && <ErrorAlert message={apiError(error).message} />}
    </Dialog>
  );
}

function ClaimsTab() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { company } = useAuth();
  const money = (v) => formatMoney(v, company?.currency || 'INR');
  const [status, setStatus] = useState('SUBMITTED');
  const [rejecting, setRejecting] = useState(null);
  const query = useQuery({
    queryKey: ['company', 'customer-requests', 'claims', status],
    queryFn: async () => (await api.get('/v1/payment-claims', { params: { status, limit: 50 } })).data,
  });
  const reject = useMutation({
    mutationFn: async ({ id, reason }) => (await api.post(`/v1/payment-claims/${id}/reject`, { reason })).data,
    onSuccess: () => {
      toast.success('Claim rejected. The customer can see why.');
      setRejecting(null);
      queryClient.invalidateQueries({ queryKey: ['company', 'customer-requests'] });
    },
  });
  const record = (c) => {
    const p = new URLSearchParams({
      customerId: c.customer?.id || '',
      claimId: c.id,
      amount: String(c.amount),
      mode: c.mode === 'OTHER' ? 'OTHER' : c.mode,
      reference: c.reference || '',
      paidOn: String(c.paidOn || '').slice(0, 10),
    });
    if (c.invoices?.[0]) p.set('invoiceId', c.invoices[0]);
    navigate(`/app/payments/new?${p.toString()}`);
  };
  const rows = query.data?.data || [];

  return (
    <div className="space-y-3">
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48" aria-label="Status">
        <option value="SUBMITTED">To check</option>
        <option value="VERIFIED">Recorded</option>
        <option value="REJECTED">Rejected</option>
        <option value="">All</option>
      </Select>
      <Card>
        {query.isLoading ? (
          <CardContent className="p-4">
            <Skeleton className="h-32 w-full" />
          </CardContent>
        ) : query.isError ? (
          <CardContent className="p-4">
            <ErrorAlert message={apiError(query.error).message} />
          </CardContent>
        ) : !rows.length ? (
          <EmptyState icon="empty" title="Nothing here" description="Payments customers tell you about online appear here." compact />
        ) : (
          <div className="divide-y">
            {rows.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {c.customer?.name || c.customerName}{' '}
                    <span className="text-xs text-muted-foreground">{c.customer?.code}</span>
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold tabular-nums">{money(c.amount)}</span> · {c.mode === 'UPI' ? 'UPI' : titleCase(c.mode)} · paid{' '}
                    {formatDate(c.paidOn)}
                    {c.reference ? ` · ref ${c.reference}` : ''}
                  </p>
                  {c.note && <p className="text-xs text-muted-foreground">“{c.note}”</p>}
                  {c.rejectReason && <p className="text-xs text-destructive">Rejected: {c.rejectReason}</p>}
                  <div className="mt-1 flex items-center gap-3">
                    <Proof src={c.proof} label="Screenshot" />
                    <span className="text-xs text-muted-foreground">sent {formatDateTime(c.createdAt)}</span>
                  </div>
                </div>
                <Badge tone={CLAIM_TONE[c.status]}>{CLAIM_TEXT[c.status]}</Badge>
                {c.status === 'SUBMITTED' && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => record(c)}>
                      <Wallet className="h-4 w-4" /> Record receipt
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRejecting(c)}>
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                  </div>
                )}
                {c.status === 'VERIFIED' && c.payment && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/app/payments/${c.payment}`)}>
                    View receipt
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      <ReasonDialog
        key={rejecting?.id || 'none'}
        open={Boolean(rejecting)}
        title={`Reject ${rejecting ? money(rejecting.amount) : ''} from ${rejecting?.customer?.name || ''}?`}
        label="Reason (the customer sees it)"
        confirm="Reject"
        tone="destructive"
        required
        pending={reject.isPending}
        error={reject.error}
        onClose={() => setRejecting(null)}
        onSubmit={(reason) => reject.mutate({ id: rejecting.id, reason })}
      />
    </div>
  );
}

function ReturnsTab() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [status, setStatus] = useState('OPEN');
  const [deciding, setDeciding] = useState(null); // { request, status }
  const query = useQuery({
    queryKey: ['company', 'customer-requests', 'returns', status],
    queryFn: async () => (await api.get('/v1/returns', { params: { status, limit: 50 } })).data,
  });
  const decide = useMutation({
    mutationFn: async ({ id, status: next, note }) => (await api.post(`/v1/returns/${id}/decide`, { status: next, note })).data,
    onSuccess: (payload) => {
      toast.success(payload.message);
      setDeciding(null);
      queryClient.invalidateQueries({ queryKey: ['company', 'customer-requests'] });
    },
  });
  const rows = query.data?.data || [];
  const COPY = {
    ACCEPTED: ['Accept this request?', 'Note for the customer (optional)', 'Accept'],
    REJECTED: ['Reject this request?', 'Reason (the customer sees it)', 'Reject'],
    RESOLVED: ['Mark as resolved?', 'What was done (optional)', 'Mark resolved'],
  };

  return (
    <div className="space-y-3">
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48" aria-label="Status">
        <option value="OPEN">Open</option>
        <option value="ACCEPTED">Accepted</option>
        <option value="RESOLVED">Resolved</option>
        <option value="REJECTED">Rejected</option>
        <option value="">All</option>
      </Select>
      <Card>
        {query.isLoading ? (
          <CardContent className="p-4">
            <Skeleton className="h-32 w-full" />
          </CardContent>
        ) : query.isError ? (
          <CardContent className="p-4">
            <ErrorAlert message={apiError(query.error).message} />
          </CardContent>
        ) : !rows.length ? (
          <EmptyState icon="empty" title="Nothing here" description="Returns and complaints customers raise online appear here." compact />
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <div key={r.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">
                    {r.requestNo} · {r.customer?.name || r.customerName}
                  </p>
                  <Badge tone={r.kind === 'RETURN' ? 'info' : 'secondary'}>{r.kind === 'RETURN' ? 'Return' : 'Complaint'}</Badge>
                  <Badge tone="outline">{titleCase(r.reason)}</Badge>
                  <Badge tone={RETURN_TONE[r.status]}>{titleCase(r.status)}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                </div>
                {r.invoiceNo && <p className="text-sm text-muted-foreground">Invoice {r.invoiceNo}</p>}
                {r.items?.length > 0 && (
                  <ul className="text-sm">
                    {r.items.map((i, n) => (
                      <li key={n}>
                        {i.name}: {i.qty} {i.unit}
                      </li>
                    ))}
                  </ul>
                )}
                {r.note && <p className="text-sm">“{r.note}”</p>}
                {r.photos?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {r.photos.map((src, n) => (
                      <a key={src} href={src} target="_blank" rel="noreferrer">
                        <img src={src} alt={`Photo ${n + 1}`} className="h-16 w-16 rounded-md border object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                {r.staffNote && <p className="text-xs text-muted-foreground">Your note: {r.staffNote}</p>}
                <div className="flex flex-wrap gap-2">
                  {r.status === 'OPEN' && (
                    <Button size="sm" onClick={() => setDeciding({ request: r, status: 'ACCEPTED' })}>
                      <CheckCircle2 className="h-4 w-4" /> Accept
                    </Button>
                  )}
                  {['OPEN', 'ACCEPTED'].includes(r.status) && (
                    <>
                      {r.kind === 'RETURN' && r.invoice && can('creditnotes.create') && (
                        <Button size="sm" variant="outline" onClick={() => navigate(`/app/credit-notes/new?invoiceId=${r.invoice}`)}>
                          <FileMinus className="h-4 w-4" /> Credit note
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setDeciding({ request: r, status: 'RESOLVED' })}>
                        Mark resolved
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeciding({ request: r, status: 'REJECTED' })}>
                        <XCircle className="h-4 w-4" /> Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <ReasonDialog
        key={deciding ? `${deciding.request.id}-${deciding.status}` : 'none'}
        open={Boolean(deciding)}
        title={deciding ? COPY[deciding.status][0] : ''}
        label={deciding ? COPY[deciding.status][1] : ''}
        confirm={deciding ? COPY[deciding.status][2] : ''}
        tone={deciding?.status === 'REJECTED' ? 'destructive' : 'default'}
        required={deciding?.status === 'REJECTED'}
        pending={decide.isPending}
        error={decide.error}
        onClose={() => setDeciding(null)}
        onSubmit={(note) => decide.mutate({ id: deciding.request.id, status: deciding.status, note })}
      />
    </div>
  );
}

export default function CustomerRequests({ initialTab }) {
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();
  const canClaims = can('payments.claims');
  const canReturns = can('returns.manage');
  const tab = params.get('tab') || initialTab || (canClaims ? 'payments' : 'returns');
  const counts = useQuery({
    queryKey: ['company', 'customer-requests', 'counts'],
    queryFn: async () => {
      const [claims, returns] = await Promise.all([
        canClaims ? api.get('/v1/payment-claims', { params: { status: 'SUBMITTED', limit: 1 } }) : null,
        canReturns ? api.get('/v1/returns', { params: { status: 'OPEN', limit: 1 } }) : null,
      ]);
      return { claims: claims?.data?.meta?.open || 0, returns: returns?.data?.meta?.open || 0 };
    },
  });
  const items = [
    ...(canClaims ? [{ value: 'payments', label: 'Payments', badge: counts.data?.claims || undefined }] : []),
    ...(canReturns ? [{ value: 'returns', label: 'Returns & complaints', badge: counts.data?.returns || undefined }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Online requests"
        description="What your customers send from the online portal: payments to check, returns and complaints to answer."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Online requests' }]}
      />
      <Tabs items={items} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} />
      {tab === 'payments' && canClaims && <ClaimsTab />}
      {tab === 'returns' && canReturns && <ReturnsTab />}
    </div>
  );
}
