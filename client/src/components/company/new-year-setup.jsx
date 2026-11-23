import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarPlus, Copy, ExternalLink, Hash, Target } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatMoney } from '@/utils/format';

/**
 * Setting up the new financial year (on Year Closing): copy last year's
 * targets into this year, extend schemes / price lists / discounts that ended
 * around the year end, and see the first numbers of the new series.
 */

const TYPE_LABEL = { MONTH: 'monthly', QUARTER: 'quarterly', YEAR: 'yearly' };

export default function NewYearSetup() {
  const { company } = useAuth();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const money = (v) => formatMoney(v || 0, company?.currency, undefined, { decimals: 0 });
  const [percent, setPercent] = useState('0');
  const [picked, setPicked] = useState({});

  const { data, isLoading } = useQuery({
    queryKey: ['financial-years', 'new-year'],
    queryFn: async () => (await api.get('/v1/financial-years/new-year')).data.data,
    retry: false,
  });
  const validity = data?.validity || [];
  // Everything listed is ticked to start with.
  useEffect(() => {
    setPicked(Object.fromEntries((data?.validity || []).map((v) => [v.id, true])));
  }, [data]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['financial-years', 'new-year'] });
  const copy = useMutation({
    mutationFn: async () =>
      (await api.post('/v1/financial-years/new-year/targets', { percent: Number(percent) || 0 }))
        .data,
    onSuccess: (res) => {
      const s = res.data?.skipped || {};
      toast.success(
        `${res.message}${s.inactive ? ` · ${s.inactive} skipped (inactive salesman or route)` : ''}`
      );
      refresh();
      queryClient.invalidateQueries({ queryKey: ['company', 'targets'] });
    },
    onError: (err) => toast.error(apiError(err).message),
  });
  const extend = useMutation({
    mutationFn: async () =>
      (
        await api.post('/v1/financial-years/new-year/extend', {
          items: validity.filter((v) => picked[v.id]).map(({ kind, id }) => ({ kind, id })),
        })
      ).data,
    onSuccess: (res) => {
      toast.success(res.message);
      refresh();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;
  if (!data) return null;
  const chosen = validity.filter((v) => picked[v.id]).length;
  const pct = Number(percent);
  const pctOk = Number.isFinite(pct) && pct >= -90 && pct <= 500;

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-lg font-semibold">Set up {data.year.label}</h2>
        <p className="text-sm text-muted-foreground">
          Carry targets, schemes and prices into the new year ({formatDate(data.year.startDay)} -{' '}
          {formatDate(data.year.endDay)}).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {data.targets && (
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Target className="h-4 w-4 text-brand-600" /> Targets
            </h3>
            {data.targets.total === 0 ? (
              <p className="text-sm text-muted-foreground">
                No monthly, quarterly or yearly targets were set in {data.previous.label}.
              </p>
            ) : (
              <>
                <ul className="space-y-1 text-sm">
                  {Object.entries(data.targets.byType).map(([type, t]) => (
                    <li key={type} className="flex justify-between gap-2">
                      <span>
                        {t.total} {TYPE_LABEL[type] || type} target{t.total === 1 ? '' : 's'}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{money(t.value)}</span>
                    </li>
                  ))}
                </ul>
                {data.targets.toCopy === 0 ? (
                  <Badge tone="success">All copied into {data.year.label}</Badge>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Copy {data.targets.toCopy} of {data.previous.label}&apos;s targets into the
                      same months of {data.year.label}. Targets already set are kept; inactive
                      salesmen and routes are skipped.
                    </p>
                    <div className="flex items-end gap-2">
                      <label className="text-xs font-medium">
                        Change %
                        <Input
                          type="number"
                          className="mt-1 h-9 w-24"
                          value={percent}
                          min={-90}
                          max={500}
                          step="1"
                          onChange={(e) => setPercent(e.target.value)}
                        />
                      </label>
                      <Button
                        size="sm"
                        onClick={() => copy.mutate()}
                        loading={copy.isPending}
                        disabled={!pctOk}
                      >
                        <Copy className="h-4 w-4" /> Copy targets
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}

        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarPlus className="h-4 w-4 text-brand-600" /> Schemes, price lists and discounts
          </h3>
          {validity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing ended around the year end or ends in the next 45 days.
            </p>
          ) : (
            <>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto text-sm">
                {validity.map((v) => (
                  <li key={v.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-primary"
                      checked={Boolean(picked[v.id])}
                      onChange={(e) => setPicked((p) => ({ ...p, [v.id]: e.target.checked }))}
                      aria-label={`Extend ${v.name}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{v.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {v.label} · {new Date(v.validTo) < new Date() ? 'ended' : 'ends'}{' '}
                        {formatDate(v.validTo)}
                      </span>
                    </span>
                    <Link
                      to={v.to}
                      className="shrink-0 text-xs text-brand-600 hover:underline"
                      aria-label={`Open ${v.label.toLowerCase()}s`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                onClick={() => extend.mutate()}
                loading={extend.isPending}
                disabled={!chosen}
              >
                <CalendarPlus className="h-4 w-4" /> Extend {chosen} to{' '}
                {formatDate(data.year.endDay)}
              </Button>
            </>
          )}
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Hash className="h-4 w-4 text-brand-600" /> Numbering in {data.year.label}
          </h3>
          <ul className="space-y-1 text-sm">
            {data.numbering.map((n) => (
              <li key={n.key} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{n.label}</span>
                <span className="font-mono text-xs">
                  {n.used ? `${n.used} used · next ` : 'starts at '}
                  {n.next}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Every year starts its own series by itself.
            {can('settings.update') && (
              <>
                {' '}
                Change the prefixes in{' '}
                <Link to="/app/settings" className="text-brand-600 hover:underline">
                  Company settings
                </Link>
                .
              </>
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
