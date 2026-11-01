import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Monitor, Smartphone, LogOut, ShieldCheck, RefreshCw } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog } from '@/components/ui/dialog';
import { formatDateTime, timeAgo } from '@/utils/format';
import { useAuth } from '@/hooks/useAuth';

const deviceIcon = (ua = '') => {
  if (/mobile|android|iphone/i.test(ua)) return Smartphone;
  return Monitor;
};

export default function Sessions() {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [confirm, setConfirm] = useState(null); // { id } | 'all'

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: async () => {
      const { data } = await api.get('/auth/sessions');
      return data?.data || [];
    },
  });

  const revokeOne = useMutation({
    mutationFn: (id) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      toast.success('Session revoked');
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      setConfirm(null);
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const revokeAll = useMutation({
    mutationFn: () => api.post('/auth/logout-all', {}),
    onSuccess: () => {
      toast.success('Signed out of all other devices');
      setConfirm(null);
      logout();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Active sessions"
        description="Review every device signed in to your account and revoke access."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Sessions' }]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirm('all')}>
              <LogOut className="h-4 w-4" /> Sign out everywhere
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Signed-in devices
          </CardTitle>
          <CardDescription>
            Your current browser is marked as <strong>Current</strong>. Revoking it will sign you
            out immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={3} cols={4} />
          ) : data.length === 0 ? (
            <EmptyState
              compact
              title="No active sessions"
              description="This should not happen — try refreshing."
            />
          ) : (
            <ul className="divide-y">
              {data.map((s) => {
                const Icon = deviceIcon(s.userAgent);
                const current = s.current;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 py-3.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {current ? 'This device' : 'Another device'}
                        {current && <Badge tone="success">Current</Badge>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={s.userAgent}>
                        {s.userAgent || 'Unknown device'}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        IP {s.ip || '—'} · last used {timeAgo(s.lastUsedAt)} · signed in{' '}
                        {formatDateTime(s.issuedAt)}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className={current ? 'opacity-60' : ''}
                      onClick={() => setConfirm(s.id)}
                    >
                      <LogOut className="h-3.5 w-3.5" /> {current ? 'Sign out' : 'Revoke'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 rounded-lg border bg-muted/40 p-4 text-xs text-muted-foreground">
        Sessions expire automatically after 7 days, or sooner if you change your password or use
        “Sign out everywhere”. Refresh tokens rotate on every use and replay is detected.
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => (confirm === 'all' ? revokeAll.mutate() : revokeOne.mutate(confirm))}
        title={confirm === 'all' ? 'Sign out of all devices?' : 'Revoke this session?'}
        message={
          confirm === 'all'
            ? 'Every device — including this one — will be signed out. You will need to sign in again.'
            : 'That device will lose access immediately and will need to sign in again.'
        }
        confirmLabel={confirm === 'all' ? 'Sign out everywhere' : 'Revoke'}
        loading={revokeOne.isPending || revokeAll.isPending}
      />
    </div>
  );
}
