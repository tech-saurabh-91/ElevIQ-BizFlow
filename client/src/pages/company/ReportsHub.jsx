import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  Search,
  FileText,
  Undo2,
  Wallet,
  ShoppingCart,
  ReceiptText,
  PackageMinus,
  HandCoins,
  PackagePlus,
  ArrowLeftRight,
  TrendingUp,
  Hourglass,
  Timer,
  Boxes,
  Snail,
  Landmark,
  Award,
  Target,
  Users,
  Package,
  Truck,
  AlertTriangle,
  LayoutDashboard,
  LineChart,
  Banknote,
  Footprints,
  FileBarChart,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermissions } from '@/hooks/usePermissions';
import { cn } from '@/utils/cn';

/**
 * Reports hub: every report the user may open, as cards grouped into Register
 * (document books), MIS (summaries for decisions) and Listing (master lists),
 * plus the analytics dashboards. A card opens the report.
 */

// Group look: header colour and the icon tint palette its cards cycle through.
const GROUP_STYLE = {
  REGISTER: { head: 'from-sky-600 to-blue-500', hint: 'Document-by-document books for checking and filing' },
  MIS: { head: 'from-cyan-600 to-teal-500', hint: 'Summaries to run the business on' },
  LISTING: { head: 'from-teal-600 to-emerald-500', hint: 'Master lists to share or check' },
  DASHBOARDS: { head: 'from-indigo-600 to-violet-500', hint: 'Charts and trends' },
};
const TINTS = [
  'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  'bg-lime-500/20 text-lime-700 dark:text-lime-400',
  'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  'bg-rose-500/15 text-rose-600 dark:text-rose-400',
];

// The charts that used to be tabs on the Reports page.
const DASHBOARDS = [
  { code: 'overview', title: 'Business Overview', description: 'Sales, collections, dues and stock at a glance', icon: 'LayoutDashboard' },
  { code: 'sales', title: 'Sales Trends', description: 'Sales over time, top products and customers', icon: 'LineChart' },
  { code: 'receivables', title: 'Receivables', description: 'Outstanding and overdue invoices', icon: 'Wallet' },
  { code: 'collections', title: 'Collections', description: 'Money collected by mode and person', icon: 'Banknote' },
  { code: 'inventory', title: 'Inventory Trends', description: 'Stock value and movements', icon: 'Boxes' },
  { code: 'field-force', title: 'Field Force', description: 'Visits, attendance and productivity', icon: 'Footprints' },
];

// Icons named by the server's report registry (kept explicit so the bundle stays small).
const ICONS = { FileText, Undo2, Wallet, ShoppingCart, ReceiptText, PackageMinus, HandCoins, PackagePlus, ArrowLeftRight, TrendingUp, Hourglass, Timer, Boxes, Snail, Landmark, Award, Target, Users, Package, Truck, AlertTriangle, LayoutDashboard, LineChart, Banknote, Footprints, FileBarChart };
const iconOf = (name) => ICONS[name] || FileBarChart;

export default function ReportsHub() {
  const { can } = usePermissions();
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState({});

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'reports-hub', 'catalog'],
    queryFn: async () => (await api.get('/v1/reports/hub/catalog')).data?.data,
    retry: false,
  });

  const match = (r) => !q || `${r.title} ${r.description}`.toLowerCase().includes(q.toLowerCase());
  const groups = [
    ...(data?.groups || []).map((g) => ({ ...g, items: (data.reports || []).filter((r) => r.group === g.key && match(r)).map((r) => ({ ...r, to: `/app/reports/${r.code}` })) })),
    ...(can('reports.view')
      ? [{ key: 'DASHBOARDS', label: 'Dashboards', items: DASHBOARDS.filter(match).map((d) => ({ ...d, to: `/app/reports/analytics?tab=${d.code}` })) }]
      : []),
  ].filter((g) => g.items.length);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Registers, MIS and listings - pick a report to open it, filter it and export to Excel."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Reports' }]}
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a report…" className="pl-9" aria-label="Find a report" />
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : isError && !can('reports.view') ? (
        <EmptyState icon="error" title="No reports for your role" description={apiError(error).message} />
      ) : !groups.length ? (
        <EmptyState icon="empty" title="No report matches" description="Try another word." />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {groups.map((g) => {
            const style = GROUP_STYLE[g.key] || GROUP_STYLE.REGISTER;
            const open = !closed[g.key];
            return (
              <section key={g.key} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <button
                  type="button"
                  onClick={() => setClosed({ ...closed, [g.key]: open })}
                  className={cn('flex w-full items-center gap-3 bg-gradient-to-r px-4 py-3 text-left text-white focus-ring', style.head)}
                  aria-expanded={open}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-white/90 text-slate-700">
                    <ChevronDown className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{g.label}</span>
                    <span className="block text-xs text-white/80">{style.hint}</span>
                  </span>
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">{g.items.length}</span>
                </button>
                {open && (
                  <ul className="grid sm:grid-cols-2">
                    {g.items.map((r, i) => {
                      const Icon = iconOf(r.icon);
                      return (
                        <li key={r.code} className="border-b sm:odd:border-r [&:nth-last-child(-n+2)]:sm:border-b-0 last:border-b-0">
                          <Link to={r.to} className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-accent/50 focus-ring">
                            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', TINTS[i % TINTS.length])}>
                              <Icon className="h-[18px] w-[18px]" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-brand-700 group-hover:underline dark:text-brand-300">{r.title}</span>
                              <span className="line-clamp-2 text-xs text-muted-foreground">{r.description}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
