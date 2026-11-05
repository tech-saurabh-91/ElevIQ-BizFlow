import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select, Field, Textarea } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { LoadingState } from '@/components/ui/misc';
import { ErrorAlert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useLookups } from '@/hooks/useLookups';
import { useAuth } from '@/hooks/useAuth';
import { describeQty, unitOf, unitOptions } from '@/utils/units';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * Van sales screens: what is on a van, loading / unloading it, and the
 * end-of-day settlement (stock count + cash).
 */

const today = () => new Date().toLocaleDateString('en-CA');
const qtyLabel = (qty, row) => (row?.packUnits?.length ? describeQty(qty, row) : `${formatNumber(qty)} ${row?.unit || ''}`);

/** Current van stock as a compact table. */
export function VanStockTable({ rows = [] }) {
  if (!rows.length) return <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">The van is empty.</p>;
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Product</th>
            <th className="px-3 py-2 text-right font-medium">On van</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.product} className="border-t">
              <td className="px-3 py-2">
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.sku}</p>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatNumber(r.qty)} {r.unit}
                {r.packUnits?.length ? <p className="text-xs text-muted-foreground">{describeQty(r.qty, r)}</p> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lines entered in any unit; sent to the server in base units. */
function MoveLines({ lines, setLines, products }) {
  const byId = (id) => products.find((p) => p.id === id);
  const update = (i, patch) => setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const product = byId(l.product);
        return (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_2rem] items-center gap-2">
            <Select value={l.product} onChange={(e) => update(i, { product: e.target.value, unit: byId(e.target.value)?.unit || '' })} aria-label={`Product ${i + 1}`}>
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.hint ? ` · ${p.hint}` : ''}
                </option>
              ))}
            </Select>
            <Input inputMode="decimal" value={l.qty} onChange={(e) => update(i, { qty: e.target.value.replace(/[^\d.]/g, '') })} placeholder="Qty" aria-label={`Quantity ${i + 1}`} />
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
        <Plus className="h-4 w-4" /> Add line
      </Button>
    </div>
  );
}

/** Stock on a van plus load (from its parent) and unload (back to the parent). */
export function VanStockDialog({ van, canManage, onClose }) {
  const queryClient = useQueryClient();
  const { lookups } = useLookups();
  const [tab, setTab] = useState('stock');
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const stock = useQuery({
    queryKey: ['company', 'vans', van?.id, 'stock'],
    queryFn: async () => (await api.get(`/v1/vans/${van.id}/stock`)).data?.data || [],
    enabled: Boolean(van),
  });

  useEffect(() => {
    setError(null);
    setNotes('');
    // Unloading starts from everything on the van; loading from a blank line.
    if (tab === 'unload') setLines((stock.data || []).map((r) => ({ product: r.product, qty: String(r.qty), unit: r.unit })));
    else setLines([{ product: '', qty: '', unit: '' }]);
  }, [tab, stock.data]);

  const products = useMemo(() => {
    if (tab === 'unload') {
      return (stock.data || []).map((r) => ({ id: r.product, name: r.name, unit: r.unit, packUnits: r.packUnits, hint: `${formatNumber(r.qty)} ${r.unit} on van` }));
    }
    return (lookups.products || []).map((p) => ({ ...p, hint: p.sku }));
  }, [tab, stock.data, lookups.products]);

  const submit = async () => {
    const items = lines
      .filter((l) => l.product && Number(l.qty) > 0)
      .map((l) => {
        const product = products.find((p) => p.id === l.product);
        return { product: l.product, qty: Number(l.qty) * unitOf(product, l.unit || product?.unit).factor };
      });
    if (!items.length) return setError({ message: 'Add at least one product with a quantity' });
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/vans/${van.id}/${tab}`, { items, notes });
      toast.success(tab === 'load' ? 'Van loaded' : 'Van unloaded');
      queryClient.invalidateQueries({ queryKey: ['company', 'vans'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'inventory'] });
      setTab('stock');
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
    return null;
  };

  const tabs = [{ value: 'stock', label: 'On the van' }, ...(canManage ? [{ value: 'load', label: 'Load' }, { value: 'unload', label: 'Unload' }] : [])];

  return (
    <Dialog
      open={Boolean(van)}
      onClose={onClose}
      title={van ? `${van.name} · ${van.vehicleNumber || van.code}` : ''}
      description={van?.parent ? `Loads from and unloads to ${van.parent.name || van.parent.code}` : undefined}
      size="lg"
      footer={
        tab === 'stock' ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => setTab('stock')} disabled={busy}>
              Back
            </Button>
            <Button type="button" onClick={submit} loading={busy}>
              {tab === 'load' ? 'Load van' : 'Unload van'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <Tabs size="sm" value={tab} onChange={setTab} items={tabs} />
        {error && <ErrorAlert title="Could not move stock" message={error.message} errors={error.errors} onClose={() => setError(null)} />}
        {tab === 'stock' ? (
          stock.isLoading ? <LoadingState label="Loading van stock…" /> : <VanStockTable rows={stock.data} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {tab === 'load'
                ? 'Stock moves from the parent warehouse onto the van in one step.'
                : 'Everything on the van is listed; reduce what stays on the van, then unload.'}
            </p>
            <MoveLines lines={lines} setLines={setLines} products={products} />
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** End-of-day settlement: count the van, deposit cash, explain differences. */
export function DayCloseDialog({ van, onClose }) {
  const queryClient = useQueryClient();
  const { company } = useAuth();
  const [tab, setTab] = useState('close');
  const [date, setDate] = useState(today());
  const [counts, setCounts] = useState({});
  const [cash, setCash] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ['company', 'vans', van?.id, 'day-close', date],
    queryFn: async () => (await api.get(`/v1/vans/${van.id}/day-close`, { params: { date } })).data?.data,
    enabled: Boolean(van && date),
  });
  const history = useQuery({
    queryKey: ['company', 'vans', van?.id, 'day-closes'],
    queryFn: async () => (await api.get(`/v1/vans/${van.id}/day-closes`)).data?.data || [],
    enabled: Boolean(van && tab === 'history'),
  });

  const data = preview.data;
  useEffect(() => {
    if (!data || data.closed) return;
    setCounts(Object.fromEntries((data.lines || []).map((l) => [l.product, String(l.expected)])));
    setCash(String(data.cashExpected ?? 0));
    setError(null);
  }, [data]);

  // Settle the oldest open day first.
  useEffect(() => {
    if (data?.pendingDays?.length && data.pendingDays[0] < date && !data.closed) setDate(data.pendingDays[0]);
  }, [data, date]);

  const lines = (data?.lines || []).map((l) => {
    const counted = counts[l.product] === '' || counts[l.product] == null ? null : Number(counts[l.product]);
    return { ...l, counted, variance: counted == null ? null : Math.round((counted - l.expected) * 1000) / 1000 };
  });
  const cashVariance = Math.round((Number(cash || 0) - Number(data?.cashExpected || 0)) * 100) / 100;
  const hasDifference = lines.some((l) => l.variance) || cashVariance !== 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(`/v1/vans/${van.id}/day-close`, {
        date,
        counts: lines.map((l) => ({ product: l.product, counted: l.counted ?? 0 })),
        cashDeposited: Number(cash || 0),
        notes,
      });
      toast.success(res.data?.message || `${van.code} closed for ${date}`);
      queryClient.invalidateQueries({ queryKey: ['company', 'vans'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'attendance'] });
      setNotes('');
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const closed = data?.closed;
  return (
    <Dialog
      open={Boolean(van)}
      onClose={onClose}
      title={van ? `Day cashout · ${van.name}` : ''}
      description="Count the van, hand over the cash collected, and explain any difference. A manager approves it before you mark out."
      size="xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {tab === 'close' && data && !closed && (
            <Button type="button" onClick={submit} loading={busy}>
              Submit cashout for {date}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Tabs size="sm" value={tab} onChange={setTab} items={[{ value: 'close', label: 'Day cashout' }, { value: 'history', label: 'History' }]} />
        {tab === 'history' ? (
          history.isLoading ? (
            <LoadingState label="Loading history…" />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Day</th>
                    <th className="px-3 py-2 font-medium">Executive</th>
                    <th className="px-3 py-2 text-right font-medium">Stock diff</th>
                    <th className="px-3 py-2 text-right font-medium">Cash diff</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(history.data || []).map((h) => (
                    <tr key={h.id} className="border-t">
                      <td className="px-3 py-2 tabular-nums">{formatDate(`${h.day}T12:00:00`)}</td>
                      <td className="px-3 py-2">{h.executive?.name || '—'}</td>
                      <td className={cn('px-3 py-2 text-right tabular-nums', h.stockVarianceQty && 'text-warning')}>{formatNumber(h.stockVarianceQty)}</td>
                      <td className={cn('px-3 py-2 text-right tabular-nums', h.cashVariance && 'text-warning')}>{formatMoney(h.cashVariance, company?.currency)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={{ APPROVED: 'success', SUBMITTED: 'warning', REJECTED: 'destructive' }[h.status || 'APPROVED']}>
                          {{ APPROVED: 'Approved', SUBMITTED: 'Waiting approval', REJECTED: 'Rejected' }[h.status || 'APPROVED']}
                        </Badge>
                        {h.approvedBy?.name ? <span className="ml-1 text-xs text-muted-foreground">{h.approvedBy.name}</span> : null}
                      </td>
                    </tr>
                  ))}
                  {!history.data?.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                        No day has been closed yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Day">
                <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="w-44" />
              </Field>
              {data?.pendingDays?.length > 0 && (
                <Badge tone="warning">Open days: {data.pendingDays.join(', ')}</Badge>
              )}
            </div>
            {error && <ErrorAlert title="Could not submit the cashout" message={error.message} errors={error.errors} onClose={() => setError(null)} />}
            {data?.rejected && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm">
                The cashout for {date} was rejected{data.rejected.reason ? `: ${data.rejected.reason}` : ''}. Count again and resubmit.
              </p>
            )}
            {preview.isLoading || !data ? (
              <LoadingState label="Working out the day…" />
            ) : closed ? (
              <div
                className={cn(
                  'rounded-lg border p-4 text-sm',
                  closed.status === 'SUBMITTED' ? 'border-warning/40 bg-warning/10' : 'border-success/40 bg-success/10'
                )}
              >
                <p className="font-medium">
                  {closed.status === 'SUBMITTED'
                    ? `${date} cashout submitted by ${closed.closedBy?.name || '—'} - waiting for manager approval.`
                    : `${date} is closed by ${closed.closedBy?.name || '—'}.`}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Stock difference {formatNumber(closed.stockVarianceQty)} · cash expected {formatMoney(closed.cashExpected, company?.currency)}, deposited{' '}
                  {formatMoney(closed.cashDeposited, company?.currency)}
                  {closed.notes ? ` · ${closed.notes}` : ''}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Product</th>
                        <th className="px-2 py-2 text-right font-medium">Opening</th>
                        <th className="px-2 py-2 text-right font-medium">Loaded</th>
                        <th className="px-2 py-2 text-right font-medium">Sold</th>
                        <th className="px-2 py-2 text-right font-medium">Unloaded</th>
                        <th className="px-2 py-2 text-right font-medium">Expected</th>
                        <th className="w-28 px-2 py-2 font-medium">Counted</th>
                        <th className="px-2 py-2 text-right font-medium">Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.product} className="border-t">
                          <td className="px-3 py-2">
                            <p className="font-medium">{l.name}</p>
                            <p className="text-xs text-muted-foreground">{l.unit}</p>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatNumber(l.opening)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatNumber(l.loaded)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatNumber(l.sold)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatNumber(l.unloaded)}</td>
                          <td className="px-2 py-2 text-right font-medium tabular-nums" title={qtyLabel(l.expected, l)}>
                            {formatNumber(l.expected)}
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              inputMode="decimal"
                              value={counts[l.product] ?? ''}
                              onChange={(e) => setCounts((c) => ({ ...c, [l.product]: e.target.value.replace(/[^\d.]/g, '') }))}
                              className="h-8 text-right"
                              aria-label={`Counted ${l.name}`}
                            />
                          </td>
                          <td className={cn('px-2 py-2 text-right tabular-nums', l.variance ? 'font-semibold text-warning' : 'text-muted-foreground')}>
                            {l.variance == null ? '—' : l.variance > 0 ? `+${formatNumber(l.variance)}` : formatNumber(l.variance)}
                          </td>
                        </tr>
                      ))}
                      {!lines.length && (
                        <tr>
                          <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                            No stock moved on this van on {date}.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Cash collected (system)" hint={`${data.payments} cash receipt(s)`}>
                    <Input value={formatMoney(data.cashExpected, company?.currency)} readOnly className="bg-muted/50" />
                  </Field>
                  <Field label="Cash deposited" error={error?.errors?.find((e) => e.field === 'body.cashDeposited')?.message}>
                    <Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ''))} />
                  </Field>
                  <Field label="Cash difference">
                    <Input value={formatMoney(cashVariance, company?.currency)} readOnly className={cn('bg-muted/50', cashVariance && 'text-warning')} />
                  </Field>
                </div>
                <Field
                  label={hasDifference ? 'Notes (required: explain the difference)' : 'Notes'}
                  error={error?.errors?.find((e) => e.field === 'body.notes')?.message}
                >
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 2 packets damaged, ₹50 short" />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Stock differences are booked into the van as count corrections. A closed day cannot be reopened.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
