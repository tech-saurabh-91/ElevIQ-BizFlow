import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, X } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/misc';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * Day cashouts: each van executive's end-of-day count and cash, waiting for a
 * manager. Approving books the stock differences into the van and lets the
 * executive mark out; rejecting sends it back to be counted again.
 */

const TONE = { SUBMITTED: 'warning', APPROVED: 'success', REJECTED: 'destructive' };
const LABEL = { SUBMITTED: 'Waiting approval', APPROVED: 'Approved', REJECTED: 'Rejected' };

function CashoutDialog({ row, canApprove, onClose }) {
  const queryClient = useQueryClient();
  const { company } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const act = async (kind) => {
    setBusy(kind);
    try {
      await api.post(`/v1/vans/day-closes/${row.id}/${kind}`, kind === 'reject' ? { reason } : {});
      toast.success(kind === 'approve' ? 'Day cashout approved' : 'Day cashout rejected');
      queryClient.invalidateQueries({ queryKey: ['company', 'day-cashouts'] });
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      setBusy('');
    }
  };
  const money = (v) => formatMoney(v, company?.currency);
  const pending = row.status === 'SUBMITTED' && canApprove;
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`${row.warehouse?.code || 'Van'} · ${formatDate(`${row.day}T12:00:00`)}`}
      description={`${row.executive?.name || row.closedBy?.name || ''} · ${LABEL[row.status] || row.status}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {pending && (
            <>
              <Button variant="destructive" onClick={() => act('reject')} loading={busy === 'reject'} disabled={reason.trim().length < 3}>
                <X className="h-4 w-4" /> Reject
              </Button>
              <Button onClick={() => act('approve')} loading={busy === 'approve'}>
                <Check className="h-4 w-4" /> Approve
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Cash expected</p>
            <p className="font-semibold tabular-nums">{money(row.cashExpected)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Cash handed over</p>
            <p className="font-semibold tabular-nums">{money(row.cashDeposited)}</p>
          </div>
          <div className={cn('rounded-lg border p-3', row.cashVariance && 'border-warning/50 bg-warning/10')}>
            <p className="text-xs text-muted-foreground">Difference</p>
            <p className="font-semibold tabular-nums">{money(row.cashVariance)}</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="table-cards w-full sm:min-w-[560px] text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-2 py-2 text-right font-medium">Loaded</th>
                <th className="px-2 py-2 text-right font-medium">Sold</th>
                <th className="px-2 py-2 text-right font-medium">Expected</th>
                <th className="px-2 py-2 text-right font-medium">Counted</th>
                <th className="px-3 py-2 text-right font-medium">Diff</th>
              </tr>
            </thead>
            <tbody>
              {(row.lines || []).map((l) => (
                <tr key={l.product} className="border-t">
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(l.loaded)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(l.sold)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(l.expected)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(l.counted)}</td>
                  <td className={cn('px-3 py-2 text-right tabular-nums', l.variance && 'font-medium text-warning')}>{formatNumber(l.variance)}</td>
                </tr>
              ))}
              {!row.lines?.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No stock moved on this van that day.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {row.notes && <p className="text-sm">Executive note: {row.notes}</p>}
        {row.rejectReason && <p className="text-sm text-destructive">Rejected: {row.rejectReason}</p>}
        {pending && (
          <Field label="Reason (only to reject)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cash short by 200, recount" />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

export default function DayCashouts() {
  const { company } = useAuth();
  const [status, setStatus] = useState('SUBMITTED');
  const [open, setOpen] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ['company', 'day-cashouts', status],
    queryFn: async () => (await api.get('/v1/vans/day-closes', { params: { status: status || undefined } })).data,
  });
  const rows = data?.data || [];
  const canApprove = Boolean(data?.meta?.canApprove);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Day cashouts"
        description="Approve each van's end-of-day stock count and cash. Executives cannot mark out until it is approved."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Day cashouts' }]}
      />
      <Card>
        <div className="border-b p-3">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto min-w-[12rem]" aria-label="Filter by status">
            <option value="SUBMITTED">Waiting approval</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All</option>
          </Select>
        </div>
        {isLoading ? (
          <LoadingState label="Loading cashouts…" />
        ) : !rows.length ? (
          <EmptyState icon="empty" title={status === 'SUBMITTED' ? 'Nothing waiting for approval' : 'No day cashouts'} description="Cashouts submitted by van executives appear here." />
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(r)} className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left hover:bg-accent/50">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {r.warehouse?.code} · {formatDate(`${r.day}T12:00:00`)}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.executive?.name || r.closedBy?.name || '—'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="tabular-nums">Cash {formatMoney(r.cashDeposited, company?.currency)}</span>
                    {r.cashVariance ? <Badge tone="warning">Cash {formatMoney(r.cashVariance, company?.currency)}</Badge> : null}
                    {r.stockVarianceQty ? <Badge tone="warning">Stock {formatNumber(r.stockVarianceQty)}</Badge> : null}
                    <Badge tone={TONE[r.status]}>{LABEL[r.status] || r.status}</Badge>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open && <CashoutDialog row={open} canApprove={canApprove} onClose={() => setOpen(null)} />}
    </div>
  );
}
