import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarCheck2, CheckCircle2, ExternalLink, Info, Lock, LockOpen, Search, TriangleAlert } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea, Label } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorAlert } from '@/components/ui/alert';
import { formatDate, formatMoney } from '@/utils/format';
import { cn } from '@/utils/cn';

const STATUS = {
  CLOSED: { label: 'Closed', tone: 'success', icon: Lock },
  OPEN: { label: 'Open', tone: 'warning', icon: LockOpen },
  CURRENT: { label: 'Current year', tone: 'info', icon: CalendarCheck2 },
};
const range = (y) => `${formatDate(y.startDay)} - ${formatDate(y.endDay)}`;

function CloseDialog({ year, onClose, onDone }) {
  const [notes, setNotes] = useState('');
  const [sure, setSure] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-years', year.tag, 'checklist'],
    queryFn: async () => (await api.get(`/v1/financial-years/${year.tag}/checklist`)).data.data,
  });
  const close = useMutation({
    mutationFn: async () => (await api.post(`/v1/financial-years/${year.tag}/close`, { notes })).data,
    onSuccess: (res) => {
      toast.success(res.message || `${year.label} closed`);
      onDone();
    },
  });
  const warnings = (data?.items || []).filter((i) => i.severity === 'warning' && i.count > 0);

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      dismissible={!close.isPending}
      title={`Close ${year.label}`}
      description={`Documents dated ${formatDate(year.startDay)} to ${formatDate(year.endDay)} will be locked.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={close.isPending}>
            Cancel
          </Button>
          <Button onClick={() => close.mutate()} disabled={!sure || isLoading} loading={close.isPending}>
            <Lock className="h-4 w-4" /> Close {year.label}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {close.isError && <ErrorAlert title="The year could not be closed" message={apiError(close.error).message} />}
        <div>
          <p className="mb-2 text-sm font-semibold">Before you close</p>
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.items.map((i) => {
                const done = i.severity !== 'reminder' && i.count === 0;
                return (
                  <li key={i.key} className="flex items-start gap-3 p-3">
                    {done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : i.severity === 'warning' ? (
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    ) : (
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {i.label}
                        {i.severity !== 'reminder' && <Badge tone={i.count ? (i.severity === 'warning' ? 'warning' : 'info') : 'muted'}>{i.count}</Badge>}
                      </p>
                      {!done && <p className="mt-0.5 text-xs text-muted-foreground">{i.hint}</p>}
                    </div>
                    {!done && (
                      <Link to={i.to} className="shrink-0 text-xs font-medium text-brand-600 hover:underline" target="_blank" rel="noreferrer">
                        Open <ExternalLink className="inline h-3 w-3" />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {warnings.length > 0 && (
            <p className="mt-2 text-xs text-warning-foreground dark:text-warning">
              {warnings.length} item(s) still open. You can close anyway - they will stay as they are and drafts dated in this year can only be re-dated into the new year.
            </p>
          )}
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          Closing records the year&apos;s totals and every customer, supplier and stock balance on {formatDate(year.endDay)}. Nothing is deleted or carried
          over by hand: dues and stock simply continue into the new year, and new documents are numbered in the new year&apos;s series. An admin can reopen the
          year later with a reason.
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="close-notes">Notes (optional)</Label>
          <Textarea id="close-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Audited by CA on 20 Sept" />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          <span>
            I understand that nobody can add, change or cancel documents dated up to <b>{formatDate(year.endDay)}</b> after this.
          </span>
        </label>
      </div>
    </Dialog>
  );
}

function ReopenDialog({ year, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const reopen = useMutation({
    mutationFn: async () => (await api.post(`/v1/financial-years/${year.tag}/reopen`, { reason })).data,
    onSuccess: (res) => {
      toast.success(res.message || `${year.label} reopened`);
      onDone();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!reopen.isPending}
      title={`Reopen ${year.label}`}
      description="Documents of this year can be changed again until it is closed once more."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={reopen.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => reopen.mutate()} disabled={reason.trim().length < 5} loading={reopen.isPending}>
            <LockOpen className="h-4 w-4" /> Reopen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {reopen.isError && <ErrorAlert title="The year could not be reopened" message={apiError(reopen.error).message} />}
        <Label htmlFor="reopen-reason" required>
          Reason (kept in the audit trail)
        </Label>
        <Textarea id="reopen-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Auditor asked to correct invoice INV-2526-000412" />
      </div>
    </Dialog>
  );
}

const KINDS = [
  { value: 'CUSTOMER', label: 'Customers owed' },
  { value: 'SUPPLIER', label: 'We owed suppliers' },
  { value: 'STOCK', label: 'Stock' },
];

function ClosingBalances({ year, money }) {
  const [kind, setKind] = useState('CUSTOMER');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-years', year.tag, 'balances', kind, search, page],
    queryFn: async () => (await api.get(`/v1/financial-years/${year.tag}/balances`, { params: { kind, search: search || undefined, page, limit: 50 } })).data,
    keepPreviousData: true,
  });
  const t = year.totals || {};
  const tiles = [
    ['Sales (incl. tax)', t.sales],
    ['Gross profit', t.grossProfit],
    ['Collections', t.collections],
    ['Purchases (incl. tax)', t.purchases],
    ['Output tax', t.outputTax],
    ['Input tax', t.inputTax],
    ['Customers owed', t.receivables],
    ['We owed suppliers', t.payables],
    ['Closing stock value', t.stockValue],
  ];
  const rows = data?.data || [];
  const meta = data?.meta || {};

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-lg font-semibold">{year.label} - closing figures</h2>
        <p className="text-sm text-muted-foreground">As on {formatDate(year.endDay)}, recorded when the year was closed.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-muted/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1 text-base font-bold tabular-nums">{money(value)}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          items={KINDS}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPage(1);
          }}
        />
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name or code"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{kind === 'STOCK' ? 'Product' : kind === 'CUSTOMER' ? 'Customer' : 'Supplier'}</th>
              {kind === 'STOCK' && <th className="px-3 py-2">Warehouse</th>}
              {kind === 'STOCK' && <th className="px-3 py-2 text-right">Qty</th>}
              {kind === 'STOCK' && <th className="px-3 py-2 text-right">Avg cost</th>}
              <th className="px-3 py-2 text-right">{kind === 'STOCK' ? 'Value' : 'Balance'}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="p-4">
                  <Skeleton className="h-6 w-full" />
                </td>
              </tr>
            ) : rows.length ? (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.name}</span>
                    {r.code && <span className="ml-2 text-xs text-muted-foreground">{r.code}</span>}
                  </td>
                  {kind === 'STOCK' && <td className="px-3 py-2 text-muted-foreground">{r.warehouseName}</td>}
                  {kind === 'STOCK' && <td className="px-3 py-2 text-right tabular-nums">{r.qty}</td>}
                  {kind === 'STOCK' && <td className="px-3 py-2 text-right tabular-nums">{money(r.rate)}</td>}
                  <td className={cn('px-3 py-2 text-right font-medium tabular-nums', r.amount < 0 && 'text-success')}>{money(r.amount)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                  Nothing to show.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-muted/40 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={kind === 'STOCK' ? 4 : 1}>
                  Total ({meta.total})
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(meta.totalAmount)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {meta.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page} of {meta.pages}
          </span>
          <Button size="sm" variant="outline" disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export default function YearClosing() {
  const { company } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const money = (v) => formatMoney(v || 0, company?.currency);
  const [closing, setClosing] = useState(null);
  const [reopening, setReopening] = useState(null);
  const [viewTag, setViewTag] = useState(null);
  const canClose = can('books.close');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['financial-years'],
    queryFn: async () => (await api.get('/v1/financial-years')).data.data,
  });
  const refresh = () => {
    setClosing(null);
    setReopening(null);
    queryClient.invalidateQueries({ queryKey: ['financial-years'] });
  };
  const years = data?.years || [];
  const viewed = years.find((y) => y.tag === viewTag && y.status === 'CLOSED') || years.find((y) => y.status === 'CLOSED' && !viewTag);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Year closing"
        description="Lock a finished financial year so its invoices, payments, purchases and stock entries can no longer change."
      />

      {data?.booksClosedThrough && (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-3 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-success" />
          <span>
            Books are closed up to <b>{formatDate(data.booksClosedThrough)}</b>. Use dates after this for new documents.
          </span>
        </div>
      )}

      {isError && <ErrorAlert title="Could not load the financial years" message={apiError(error).message} />}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {isLoading
          ? [1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)
          : years.map((y) => {
              const s = STATUS[y.status] || STATUS.OPEN;
              return (
                <div key={y.tag} className={cn('flex flex-col rounded-xl border bg-card p-4 shadow-sm', viewed?.tag === y.tag && 'ring-2 ring-brand-500/40')}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-bold">{y.label}</p>
                      <p className="text-xs text-muted-foreground">{range(y)}</p>
                    </div>
                    <Badge tone={s.tone}>
                      <s.icon className="h-3 w-3" /> {s.label}
                    </Badge>
                  </div>
                  <p className="mt-3 flex-1 text-xs text-muted-foreground">
                    {y.status === 'CLOSED'
                      ? `Closed ${y.closedAt ? formatDate(y.closedAt) : ''}${y.closedByName ? ` by ${y.closedByName}` : ''}.`
                      : y.status === 'CURRENT'
                        ? `Running now. It can be closed after ${formatDate(y.endDay)}.`
                        : y.canClose
                          ? `Ended - ready to close.${y.reopened ? ' (Reopened earlier.)' : ''}`
                          : 'Close the earlier year first.'}
                  </p>
                  {y.history?.length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer font-medium text-muted-foreground">History ({y.history.length})</summary>
                      <ul className="mt-1.5 space-y-1 border-l pl-3">
                        {[...y.history].reverse().map((h, i) => (
                          <li key={i}>
                            <span className={cn('font-semibold', h.action === 'REOPENED' ? 'text-warning-foreground dark:text-warning' : 'text-success')}>
                              {h.action === 'REOPENED' ? 'Reopened' : 'Closed'}
                            </span>{' '}
                            {formatDate(h.at)}
                            {h.byName ? ` by ${h.byName}` : ''}
                            {h.note && <span className="block text-muted-foreground">“{h.note}”</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {y.status === 'CLOSED' && (
                      <Button size="sm" variant="outline" onClick={() => setViewTag(y.tag)}>
                        View closing figures
                      </Button>
                    )}
                    {canClose && y.canClose && (
                      <Button size="sm" onClick={() => setClosing(y)}>
                        <Lock className="h-4 w-4" /> Review &amp; close
                      </Button>
                    )}
                    {canClose && y.canReopen && (
                      <Button size="sm" variant="ghost" onClick={() => setReopening(y)}>
                        <LockOpen className="h-4 w-4" /> Reopen
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
      </div>

      {viewed && <ClosingBalances key={viewed.tag} year={viewed} money={money} />}

      {!isLoading && !years.some((y) => y.status === 'CLOSED') && (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No year has been closed yet. Once a financial year ends, close it here after the final entries and the stock count.
        </div>
      )}

      {closing && <CloseDialog year={closing} onClose={() => setClosing(null)} onDone={refresh} />}
      {reopening && <ReopenDialog year={reopening} onClose={() => setReopening(null)} onDone={refresh} />}
    </div>
  );
}
