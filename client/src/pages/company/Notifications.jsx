import { useSearchParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Bell,
  BellOff,
  CheckCheck,
  ExternalLink,
  Inbox,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/utils/cn';
import { formatDateTime, timeAgo, titleCase } from '@/utils/format';

/**
 * Phase 8 - Notification inbox.
 *
 * Shows every notification addressed to the signed-in user plus company-wide
 * broadcasts. Clicking one marks it read and follows its deep link; unread
 * items are visually emphasised and counted in the header.
 */

const TYPE_TONE = {
  OVERDUE_INVOICE: 'warning',
  LOW_STOCK: 'destructive',
  APPROVAL_REQUIRED: 'info',
  ORDER_REJECTED: 'destructive',
  ORDER_APPROVED: 'success',
  PAYMENT_RECEIVED: 'success',
  EXPENSE_APPROVED: 'success',
  TARGET_ACHIEVED: 'success',
  CREDIT_LIMIT: 'warning',
  ANNOUNCEMENT: 'info',
  SYSTEM: 'muted',
};

const PRIORITY_TONE = { HIGH: 'destructive', NORMAL: 'muted', LOW: 'muted' };

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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'notifications'] });
  };

  const markRead = useMutation({
    mutationFn: (id) => api.patch(`/v1/notifications/${id}/read`),
    onSuccess: invalidate,
    onError: (err) => toast.error(apiError(err).message),
  });

  const markAll = useMutation({
    mutationFn: () => api.post('/v1/notifications/read-all'),
    onSuccess: () => {
      toast.success('All notifications marked read');
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

  /** Mark read (if needed) then follow the deep link. */
  const openItem = (n) => {
    if (!n.isRead) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  const isLoadingAll = isLoading || isFetching;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Approvals, overdue invoices, stock alerts and announcements for your workspace."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Notifications' }]}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh notifications"
            >
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              onClick={() => markAll.mutate()}
              disabled={unread === 0 || markAll.isPending}
            >
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Unread
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{unread}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              On this page
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{rows.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{meta.total ?? rows.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-4">
          <Button
            size="sm"
            variant={!unreadOnly ? 'secondary' : 'ghost'}
            onClick={() => setParam({ unreadOnly: '', page: 1 })}
          >
            <Inbox className="h-4 w-4" />
            All
          </Button>
          <Button
            size="sm"
            variant={unreadOnly ? 'secondary' : 'ghost'}
            onClick={() => setParam({ unreadOnly: 'true', page: 1 })}
          >
            <Bell className="h-4 w-4" />
            Unread only
          </Button>

          <Select
            value={type}
            onChange={(e) => setParam({ type: e.target.value, page: 1 })}
            className="w-52"
            aria-label="Filter by type"
          >
            <option value="">All types</option>
            <option value="APPROVAL_REQUIRED">Approvals</option>
            <option value="OVERDUE_INVOICE">Overdue invoices</option>
            <option value="LOW_STOCK">Low stock</option>
            <option value="PAYMENT_RECEIVED">Payments</option>
            <option value="ORDER_APPROVED">Orders</option>
            <option value="EXPENSE_APPROVED">Expenses</option>
            <option value="ANNOUNCEMENT">Announcements</option>
            <option value="SYSTEM">System</option>
          </Select>
        </CardContent>
      </Card>

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
      ) : isLoadingAll && rows.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="empty"
          title={unreadOnly ? 'You are all caught up' : 'No notifications yet'}
          description={
            unreadOnly
              ? 'There are no unread notifications left.'
              : 'Approvals, alerts and announcements will show up here.'
          }
          action={
            unreadOnly || type ? (
              <Button variant="outline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border bg-card">
          {rows.map((n) => (
            <li
              key={n.id}
              className={cn(
                'flex gap-3 p-4 transition-colors hover:bg-accent/40',
                !n.isRead && 'bg-primary/[0.04]'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  n.isRead ? 'bg-muted text-muted-foreground' : 'bg-primary/12 text-primary'
                )}
                aria-hidden="true"
              >
                <Bell className="h-4 w-4" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={cn(
                      'truncate text-left text-sm font-semibold hover:underline focus-ring rounded',
                      !n.isRead && 'text-foreground'
                    )}
                  >
                    {n.title}
                  </button>
                  {!n.isRead && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                  )}
                  <Badge tone={TYPE_TONE[n.type] || 'muted'}>{titleCase(n.type)}</Badge>
                  {n.priority === 'HIGH' && (
                    <Badge tone={PRIORITY_TONE[n.priority]}>{n.priority}</Badge>
                  )}
                </div>

                {n.body && (
                  <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
                    {timeAgo(n.createdAt)}
                  </time>
                  {n.broadcast && <Badge tone="outline">Company-wide</Badge>}
                  {n.link && (
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className="inline-flex items-center gap-1 text-primary hover:underline focus-ring rounded"
                    >
                      Open
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-start gap-1">
                {!n.isRead && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markRead.mutate(n.id)}
                    aria-label="Mark as read"
                    title="Mark as read"
                  >
                    <BellOff className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove.mutate(n.id)}
                  aria-label="Delete notification"
                  title="Delete"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(meta.pages || 0) > 1 && (
        <Pagination
          meta={meta}
          onPageChange={(p) => setParam({ page: p })}
          onLimitChange={(l) => setParam({ limit: l, page: 1 })}
        />
      )}
    </div>
  );
}
