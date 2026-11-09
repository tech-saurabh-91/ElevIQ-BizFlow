import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Building2, Plus, Search, Eye, Users, MoreHorizontal, SquareCheck, CirclePause, CircleX, SlidersHorizontal } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { formatDate } from '@/utils/format';

const STATUS_CHIPS = ['ALL', 'ACTIVE', 'TRIAL', 'SUSPENDED', 'EXPIRED', 'CANCELLED'];

/** Allowed transition -> menu action presentation. */
const TRANSITION_ACTION = {
  ACTIVE: { label: 'Activate', icon: SquareCheck },
  SUSPENDED: { label: 'Suspend', icon: CirclePause },
  CANCELLED: { label: 'Cancel', icon: CircleX },
};

/**
 * Mirror of the server-side `allowedStatusTransitions` so the list can offer
 * quick actions without an extra request. The server re-validates regardless.
 */
const allowedTransitions = (status) => {
  if (status === 'CANCELLED') return ['ACTIVE'];
  if (status === 'EXPIRED') return ['ACTIVE', 'SUSPENDED'];
  if (status === 'SUSPENDED') return ['ACTIVE', 'CANCELLED'];
  if (status === 'ACTIVE') return ['SUSPENDED', 'CANCELLED'];
  if (status === 'TRIAL') return ['ACTIVE', 'SUSPENDED', 'CANCELLED'];
  return [];
};

export default function Companies() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const search = params.get('search') || '';
  const status = params.get('status') || 'ALL';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);

  const [searchDraft, setSearchDraft] = useState(search);
  const [target, setTarget] = useState(null); // { company, nextStatus }

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '' || v === 'ALL') next.delete(k);
      else next.set(k, String(v));
    });
    setParams(next, { replace: true });
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['platform', 'companies', { search, status, page, limit }],
    queryFn: async () => {
      // 'ALL' is a client-side concept - the server only knows real statuses.
      const params = { search, page, limit };
      if (status && status !== 'ALL') params.status = status;
      const res = await api.get('/platform/companies', { params });
      return res.data;
    },
    keepPreviousData: true,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, nextStatus }) => api.patch(`/platform/companies/${id}/status`, { status: nextStatus }),
    onSuccess: (_res, vars) => {
      toast.success(`${vars.company.name} is now ${vars.nextStatus.toLowerCase()}`);
      setTarget(null);
      queryClient.invalidateQueries({ queryKey: ['platform', 'companies'] });
      queryClient.invalidateQueries({ queryKey: ['platform', 'company', vars.id] });
      queryClient.invalidateQueries({ queryKey: ['platform', 'dashboard'] });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const companies = data?.data || [];
  const meta = data?.meta || {};
  const statusCounts = meta.statusCounts || {};
  const total = Number(meta.total || 0);

  const submitSearch = (e) => {
    e.preventDefault();
    setParam({ search: searchDraft.trim(), page: 1 });
  };

  const targetTitle = target
    ? `${target.nextStatus === 'SUSPENDED' ? 'Suspend' : target.nextStatus === 'ACTIVE' ? 'Activate' : 'Cancel'} ${target.company.name}?`
    : '';
  const targetMessage = target
    ? target.nextStatus === 'SUSPENDED'
      ? 'Users of this company will no longer be able to sign in until it is re-activated.'
      : target.nextStatus === 'CANCELLED'
        ? 'The workspace will be marked as churned. Only a super admin can re-activate a cancelled company.'
        : 'Access will be restored immediately for every user of this company.'
    : '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description="Tenant accounts on the ElevIQ SFA platform"
        actions={
          <Link to="/platform/companies/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New company
            </Button>
          </Link>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center">
          <form onSubmit={submitSearch} className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search by name, code, slug, email or GSTIN…"
              className="pl-9"
              aria-label="Search companies"
            />
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_CHIPS.map((s) => {
              const count = s === 'ALL' ? total : Number(statusCounts[s] || 0);
              const active = status === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setParam({ status: s === 'ALL' ? undefined : s, page: 1 })}
                  className={
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-ring ' +
                    (active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground')
                  }
                >
                  {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
                  <span className="ml-1.5 opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState icon="error" title="Could not load companies" description={apiError(error).message} />
        </Card>
      ) : companies.length === 0 ? (
        <Card>
          <EmptyState
            icon={search || status !== 'ALL' ? 'search' : 'empty'}
            title="No companies found"
            description={
              search || status !== 'ALL'
                ? 'Try clearing the search or picking a different status.'
                : 'Create your first tenant to get started.'
            }
            action={
              <Link to="/platform/companies/new">
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New company
                </Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <Card>
          <Table cards>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Subscription ends</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead className="w-12 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      to={`/platform/companies/${c.id}`}
                      className="flex items-center gap-3 font-medium text-foreground hover:text-primary focus-ring rounded"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-xs font-bold text-brand-600 dark:text-brand-300">
                        {(c.name || '?').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.code} · {c.businessType}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex flex-col gap-1">
                      <StatusBadge status={c.status} />
                      {c.daysLeft !== null && c.daysLeft <= 30 && c.status !== 'SUSPENDED' && (
                        <span className="text-xs text-warning">{c.daysLeft}d left</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {c.plan ? <Badge tone="info">{c.plan.name}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.subscriptionEnd ? formatDate(c.subscriptionEnd) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.admin?.name || '—'}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu
                      align="end"
                      width="w-48"
                      trigger={
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Actions for {c.name}</span>
                        </span>
                      }
                    >
                      <DropdownMenuLabel>{c.code}</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => navigate(`/platform/companies/${c.id}`)}>
                        <Eye className="h-4 w-4" /> View 360°
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate(`/platform/companies/${c.id}/edit`)}>
                        <SlidersHorizontal className="h-4 w-4" /> Edit profile
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate(`/platform/companies/${c.id}?tab=users`)}>
                        <Users className="h-4 w-4" /> Team
                      </DropdownMenuItem>
                      {(c.allowedTransitions || allowedTransitions(c.status)).length > 0 && <DropdownMenuSeparator />}
                      {(c.allowedTransitions || allowedTransitions(c.status)).map((nextStatus) => {
                        const action = TRANSITION_ACTION[nextStatus];
                        if (!action) return null;
                        const Icon = action.icon;
                        return (
                          <DropdownMenuItem key={nextStatus} onClick={() => setTarget({ company: c, nextStatus })}>
                            <Icon className="h-4 w-4" /> {action.label}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination
        meta={meta}
        onPageChange={(p) => setParam({ page: p })}
        onLimitChange={(l) => setParam({ limit: l, page: 1 })}
      />

      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={targetTitle}
        message={targetMessage}
        confirmLabel={target?.nextStatus === 'SUSPENDED' ? 'Suspend' : target?.nextStatus === 'ACTIVE' ? 'Activate' : 'Cancel subscription'}
        tone={target?.nextStatus === 'ACTIVE' ? 'primary' : 'destructive'}
        loading={statusMutation.isLoading}
        onConfirm={() =>
          statusMutation.mutate({
            id: target.company.id,
            nextStatus: target.nextStatus,
            company: target.company,
          })
        }
      />
    </div>
  );
}
