import { useSearchParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileWarning,
  Info,
  Megaphone,
  MoreVertical,
  PackageX,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Trophy,
  Truck,
  Wallet,
  XCircle,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/cn';
import { formatDateTime, timeAgo } from '@/utils/format';

/**
 * Notification inbox: every notification addressed to the signed-in user plus
 * company-wide broadcasts, grouped by day. Tapping one marks it read and
 * follows its link; read / delete sit in each row's menu.
 */

// Icon + colour per type. Classes are written out in full for Tailwind.
const KIND = {
  APPROVAL_REQUIRED: { icon: ShieldCheck, label: 'Approval', tint: 'bg-blue-500/12 text-blue-600 dark:text-blue-400' },
  ORDER_APPROVED: { icon: CheckCircle2, label: 'Order', tint: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' },
  ORDER_REJECTED: { icon: XCircle, label: 'Order', tint: 'bg-red-500/12 text-red-600 dark:text-red-400' },
  OVERDUE_INVOICE: { icon: FileWarning, label: 'Overdue', tint: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  PAYMENT_RECEIVED: { icon: Wallet, label: 'Payment', tint: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' },
  LOW_STOCK: { icon: PackageX, label: 'Stock', tint: 'bg-red-500/12 text-red-600 dark:text-red-400' },
  STOCK_REQUEST: { icon: Truck, label: 'Van stock', tint: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400' },
  EXPENSE_APPROVED: { icon: Receipt, label: 'Expense', tint: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' },
  EXPENSE_REJECTED: { icon: Receipt, label: 'Expense', tint: 'bg-red-500/12 text-red-600 dark:text-red-400' },
  LEAVE_REQUEST: { icon: Bell, label: 'Leave', tint: 'bg-sky-500/12 text-sky-600 dark:text-sky-400' },
  TARGET_ACHIEVED: { icon: Trophy, label: 'Target', tint: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' },
  CREDIT_LIMIT: { icon: CreditCard, label: 'Credit', tint: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  ANNOUNCEMENT: { icon: Megaphone, label: 'Announcement', tint: 'bg-violet-500/12 text-violet-600 dark:text-violet-400' },
  SYSTEM: { icon: Info, label: 'System', tint: 'bg-muted text-muted-foreground' },
};
const kindOf = (type) => KIND[type] || KIND.SYSTEM;

const FILTERS = [
  { value: '', label: 'All types' },
  { value: 'APPROVAL_REQUIRED', label: 'Approvals' },
  { value: 'ORDER_APPROVED', label: 'Orders' },
  { value: 'OVERDUE_INVOICE', label: 'Overdue' },
  { value: 'PAYMENT_RECEIVED', label: 'Payments' },
  { value: 'LOW_STOCK', label: 'Low stock' },
  { value: 'STOCK_REQUEST', label: 'Van stock' },
  { value: 'EXPENSE_APPROVED', label: 'Expenses' },
  { value: 'ANNOUNCEMENT', label: 'Announcements' },
  { value: 'SYSTEM', label: 'System' },
];

/** "Today", "Yesterday", "Earlier this week", else the month. */
const dayGroup = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((start.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

const groupByDay = (rows) => {
  const groups = [];
  rows.forEach((n) => {
    const label = dayGroup(n.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  });
  return groups;
};

export default function Notifications() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const unreadOnly = params.get('unreadOnly') === 'true';
  const type = params.get('type') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '' || v === 'ALL') next.delete(k);
      else next.set(k, String(v));
    });
    setParams(next, { replace: true });
  };

  const queryParams = { page, limit };
  if (unreadOnly) queryParams.unreadOnly = 'true';
  if (type) queryParams.type = type;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['company', 'notifications', queryParams],
    queryFn: async () => (await api.get('/v1/notifications', { params: queryParams })).data,
    keepPreviousData: true,
  });

  const { data: unreadData } = useQuery({
    queryKey: ['company', 'notifications', 'unread-count'],
    queryFn: async () => (await api.get('/v1/notifications/unread-count')).data?.data ?? { unread: 0 },
    refetchInterval: 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['company', 'notifications'] });

  const markRead = useMutation({
    mutationFn: (id) => api.patch(`/v1/notifications/${id}/read`),
    onSuccess: invalidate,
    onError: (err) => toast.error(apiError(err).message),
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/v1/notifications/read-all'),
    onSuccess: () => {
      toast.success('All caught up');
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/v1/notifications/${id}`),
    onSuccess: () => {
      toast.success('Notification removed');
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};
  const unread = unreadData?.unread ?? meta.unread ?? 0;
  const filtered = unreadOnly || Boolean(type);

  /** Mark read (if needed) then follow the link. */
  const openItem = (n) => {
    if (!n.isRead) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            Notifications
            {unread > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
                {unread} new
              </span>
            )}
          </span>
        }
        description="Approvals, overdue invoices, stock alerts and announcements."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Notifications' }]}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh notifications"
              title="Refresh"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
            <Button onClick={() => markAll.mutate()} disabled={unread === 0 || markAll.isPending}>
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
          </>
        }
      />

      {/* All / Unread, then the type chips (a swipeable row on phones). */}
      <div className="space-y-3">
        <div className="inline-flex rounded-xl bg-muted p-1" role="tablist" aria-label="Show">
          {[
            { on: false, label: 'All' },
            { on: true, label: 'Unread', count: unread },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={unreadOnly === t.on}
              onClick={() => setParam({ unreadOnly: t.on ? 'true' : '', page: 1 })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors focus-ring',
                unreadOnly === t.on ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
              {t.count > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:px-0">
          {FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => setParam({ type: f.value, page: 1 })}
              aria-pressed={type === f.value}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-ring',
                type === f.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isError ? (
        <EmptyState
          icon="error"
          title="Could not load notifications"
          description={apiError(error).message}
          action={
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          }
        />
      ) : isLoading && rows.length === 0 ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3 border-b p-4 last:border-0">
              <div className="skeleton h-10 w-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-2/3" />
                <div className="skeleton h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border bg-card px-6 py-14 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            {unreadOnly ? <CheckCheck className="h-7 w-7" /> : <BellRing className="h-7 w-7" />}
          </span>
          <h2 className="mt-4 text-base font-semibold">{unreadOnly ? 'You are all caught up' : 'No notifications yet'}</h2>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {unreadOnly
              ? 'There is nothing new. We will let you know when something needs you.'
              : 'Approvals, alerts and announcements will show up here.'}
          </p>
          {filtered && (
            <Button variant="outline" className="mt-4" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Show everything
            </Button>
          )}
        </div>
      ) : (
        <div className={cn('space-y-5 transition-opacity', isFetching && 'opacity-70')}>
          {groupByDay(rows).map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h2>
              <ul className="overflow-hidden rounded-xl border bg-card shadow-sm">
                {group.items.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    onOpen={() => openItem(n)}
                    onRead={() => markRead.mutate(n.id)}
                    onDelete={() => remove.mutate(n.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {(meta.pages || 0) > 1 && (
        <Pagination
          meta={meta}
          onPageChange={(p) => setParam({ page: p })}
          onLimitChange={(l) => setParam({ limit: l, page: 1 })}
          className="rounded-xl border bg-card"
        />
      )}
    </div>
  );
}

function NotificationRow({ n, onOpen, onRead, onDelete }) {
  const kind = kindOf(n.type);
  const Icon = kind.icon;
  const high = n.priority === 'HIGH';

  return (
    <li
      className={cn(
        'group relative flex gap-3 border-b px-3 py-3.5 transition-colors last:border-0 hover:bg-accent/40 sm:px-4',
        !n.isRead && 'bg-primary/[0.035]'
      )}
    >
      {/* Unread marker on the left edge. */}
      {!n.isRead && <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-primary" aria-hidden="true" />}

      <span
        className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', kind.tint)}
        aria-hidden="true"
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>

      {/* The whole text block opens the notification. */}
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 rounded-md text-left focus-ring"
        aria-label={`${n.isRead ? '' : 'Unread: '}${n.title}`}
      >
        <div className="flex items-start gap-2">
          <p
            className={cn(
              'min-w-0 flex-1 text-sm leading-snug [overflow-wrap:anywhere]',
              n.isRead ? 'font-medium text-foreground/80' : 'font-semibold text-foreground'
            )}
          >
            {n.title}
          </p>
          <time
            dateTime={n.createdAt}
            title={formatDateTime(n.createdAt)}
            className={cn(
              'hidden shrink-0 pt-0.5 text-[11px] tabular-nums sm:block',
              n.isRead ? 'text-muted-foreground' : 'font-medium text-primary'
            )}
          >
            {timeAgo(n.createdAt)}
          </time>
        </div>
        {n.body && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{n.body}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {/* Phones: the time sits here so the title keeps the full width. */}
          <span className={cn('tabular-nums sm:hidden', !n.isRead && 'font-medium text-primary')}>{timeAgo(n.createdAt)} ·</span>
          <span className="font-medium">{kind.label}</span>
          {high && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500/12 px-1.5 py-0.5 font-semibold text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" /> Urgent
            </span>
          )}
          {n.broadcast && <span className="rounded-full border px-1.5 py-0.5">Company-wide</span>}
          {n.link && (
            <span className="ml-auto inline-flex items-center gap-0.5 font-medium text-primary">
              Open <ChevronRight className="h-3 w-3" />
            </span>
          )}
        </div>
      </button>

      <div className="-mr-1 shrink-0 self-start">
        <DropdownMenu
          align="end"
          width="w-48"
          trigger={
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Actions for {n.title}</span>
            </span>
          }
        >
          {({ close }) => (
            <>
              {!n.isRead && (
                <DropdownMenuItem
                  onClick={() => {
                    close();
                    onRead();
                  }}
                >
                  <CheckCheck className="h-4 w-4" /> Mark as read
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenu>
      </div>
    </li>
  );
}
