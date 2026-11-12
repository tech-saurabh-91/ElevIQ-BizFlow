import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlarmClock,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Award,
  Boxes,
  ClipboardList,
  HandCoins,
  IndianRupee,
  Landmark,
  LayoutGrid,
  LineChart,
  Package,
  PackageX,
  PiggyBank,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Target,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';

import api from '@/api/client';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, formatNumber } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * Role-based home: the widgets the server says this user gets (admin can
 * change them per role), as colourful number tiles, a sales chart and short
 * lists, under a greeting banner with quick actions.
 */

const ICONS = { AlarmClock, Award, Boxes, ClipboardList, HandCoins, IndianRupee, Landmark, LineChart, Package, PackageX, PiggyBank, ReceiptText, ShieldCheck, Store, Target, TrendingUp, Truck, Users, Wallet };

// Tile colours by tone: gradient, icon chip.
const TONE = {
  brand: 'from-blue-600 to-indigo-500',
  success: 'from-emerald-600 to-teal-500',
  info: 'from-sky-600 to-cyan-500',
  warning: 'from-amber-500 to-orange-500',
  destructive: 'from-rose-600 to-pink-500',
  violet: 'from-violet-600 to-fuchsia-500',
  muted: 'from-slate-600 to-slate-500',
};
const LIST_TONE = {
  destructive: 'text-rose-600 dark:text-rose-400',
  warning: 'text-amber-600 dark:text-amber-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  brand: 'text-blue-600 dark:text-blue-400',
};
const BAR_TONE = { success: 'bg-emerald-500', brand: 'bg-blue-500', warning: 'bg-amber-500', destructive: 'bg-rose-500' };

export const WIDGETS_KEY = ['company', 'dashboard', 'widgets'];

export const useWidgets = () =>
  useQuery({
    queryKey: WIDGETS_KEY,
    queryFn: async () => (await api.get('/v1/dashboard/widgets')).data?.data || [],
    staleTime: 60_000,
  });

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

const ROLE_LABEL = { COMPANY_ADMIN: 'Owner / Admin', MANAGER: 'Sales manager', ACCOUNTANT: 'Accounts', WAREHOUSE: 'Warehouse', SALESMAN: 'Field sales' };

export default function RoleDashboard({ user, company, quickActions = [], setupSteps = null, canCustomize = false }) {
  const { data: widgets = [], isLoading } = useWidgets();
  const money = (v) => formatMoney(v || 0, company?.currency || 'INR', undefined, { decimals: 0 });
  const kpis = widgets.filter((w) => w.type === 'kpi');
  const charts = widgets.filter((w) => w.type === 'chart');
  const lists = widgets.filter((w) => w.type === 'list');
  const pendingSetup = (setupSteps || []).filter((s) => !s.done);

  return (
    <div className="space-y-5">
      {/* ---- Greeting banner ---- */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-indigo-600 to-violet-600 p-5 text-white shadow-lg sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-20 right-24 h-48 w-48 rounded-full bg-white/5" aria-hidden="true" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-white/80">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {greeting()}, {user?.name?.split(' ')[0] || 'there'} 👋
            </h1>
            <p className="mt-1 text-sm text-white/85">
              {company?.name} · <span className="whitespace-nowrap rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold">{ROLE_LABEL[user?.role] || user?.role}</span>
            </p>
          </div>
          {canCustomize && (
            <Link
              to="/app/dashboard/customize"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-sm font-medium backdrop-blur transition-colors hover:bg-white/25 focus-ring"
            >
              <SlidersHorizontal className="h-4 w-4" /> Customize
            </Link>
          )}
        </div>
        {quickActions.length > 0 && (
          <div className="no-scrollbar relative -mx-1 mt-5 flex gap-2 overflow-x-auto px-1">
            {quickActions.map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition-transform hover:-translate-y-0.5 focus-ring"
              >
                <a.icon className="h-4 w-4 text-indigo-600" /> {a.label}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ---- Number tiles ---- */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        kpis.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {kpis.map((w) => (
              <KpiTile key={w.key} w={w} money={money} />
            ))}
          </div>
        )
      )}

      {/* ---- Charts + lists ---- */}
      {(charts.length > 0 || lists.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {charts.map((w) => (
            <ChartCard key={w.key} w={w} money={money} className="lg:col-span-2" />
          ))}
          {lists.map((w) => (
            <ListCard key={w.key} w={w} money={money} />
          ))}
        </div>
      )}

      {!isLoading && !widgets.length && (
        <div className="flex flex-col items-center rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <LayoutGrid className="h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-semibold">Your dashboard is empty</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Your admin chooses what each role sees on the dashboard.</p>
        </div>
      )}

      {/* ---- Getting started (admin, until done) ---- */}
      {pendingSetup.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <h2 className="font-semibold">Finish setting up</h2>
          <p className="text-sm text-muted-foreground">{pendingSetup.length} step(s) left</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pendingSetup.map((s) => (
              <Link key={s.label} to={s.to} className="flex items-center gap-3 rounded-xl border border-dashed p-3 text-sm font-medium transition-colors hover:bg-accent focus-ring">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
                {s.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function fmt(value, format, money) {
  if (format === 'money') return money(value);
  if (format === 'percent') return `${formatNumber(value)}%`;
  if (format === 'number') return formatNumber(value);
  return value ?? '—';
}

export function KpiTile({ w, money }) {
  const Icon = ICONS[w.icon] || TrendingUp;
  const d = w.data || {};
  const body = (
    <div className={cn('relative h-full overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-md transition-transform', TONE[d.tone] || TONE.brand, w.to || d.to ? 'hover:-translate-y-0.5' : '')}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/10" aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-white/85">{w.title}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/20">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {w.error ? (
        <p className="relative mt-3 text-sm text-white/80">{w.error}</p>
      ) : (
        <>
          <p className="relative mt-2 truncate text-2xl font-bold tabular-nums sm:text-[1.7rem]">{fmt(d.value, d.format, money)}</p>
          <div className="relative mt-1 flex flex-wrap items-center gap-1.5 text-xs text-white/85">
            {d.trend != null && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-white/20 px-1.5 py-0.5 font-semibold">
                {d.trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {Math.abs(d.trend)}%
              </span>
            )}
            <span className="line-clamp-1">{d.hint}</span>
          </div>
        </>
      )}
    </div>
  );
  const to = d.to || w.to;
  return to ? (
    <Link to={to} className="block rounded-2xl focus-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

export function ChartCard({ w, money, className }) {
  const points = w.data?.points || [];
  const total = points.reduce((s, p) => s + Number(p.value || 0), 0);
  return (
    <section className={cn('rounded-2xl border bg-card p-4 shadow-sm sm:p-5', className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{w.title}</h2>
          <p className="text-sm text-muted-foreground">Total {money(total)}</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/12 text-indigo-600 dark:text-indigo-400">
          <LineChart className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`g-${w.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => (v >= 100000 ? `${Math.round(v / 1000)}k` : formatNumber(v))} />
            <Tooltip
              formatter={(v) => [money(v), 'Sales']}
              contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: 12 }}
            />
            <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2.5} fill={`url(#g-${w.key})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ListCard({ w, money }) {
  const Icon = ICONS[w.icon] || Package;
  const rows = w.data?.rows || [];
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="font-semibold">{w.title}</h2>
      </div>
      {w.error ? (
        <p className="py-4 text-sm text-muted-foreground">{w.error}</p>
      ) : !rows.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{w.data?.empty || 'Nothing here yet'}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((r, i) => {
            const inner = (
              <div className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.subtitle}</p>
                  </div>
                  <span className={cn('shrink-0 text-sm font-semibold tabular-nums', LIST_TONE[r.tone])}>{fmt(r.value, r.format, money)}</span>
                </div>
                {r.progress != null && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full rounded-full', BAR_TONE[r.tone] || 'bg-blue-500')} style={{ width: `${r.progress}%` }} />
                  </div>
                )}
              </div>
            );
            return (
              <li key={i}>
                {r.to ? (
                  <Link to={r.to} className="block rounded-md hover:bg-accent/40 focus-ring">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Just the charts and lists (the salesman's home keeps its own day view on top). */
export function WidgetBoard({ company }) {
  const { data: widgets = [] } = useWidgets();
  const money = (v) => formatMoney(v || 0, company?.currency || 'INR', undefined, { decimals: 0 });
  const shown = widgets.filter((w) => w.type !== 'kpi');
  if (!shown.length) return null;
  return (
    <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
      {shown.map((w) => (w.type === 'chart' ? <ChartCard key={w.key} w={w} money={money} className="lg:col-span-2" /> : <ListCard key={w.key} w={w} money={money} />))}
    </div>
  );
}
