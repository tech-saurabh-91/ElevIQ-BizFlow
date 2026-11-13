import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Users,
  ShoppingCart,
  FileText,
  Boxes,
  UserRound,
  SquareCheck,
  CirclePause,
  CircleX,
  Pencil,
  Eye,
  CreditCard,
  Activity as ActivityIcon,
  Building2,
  Trash2,
  Mail,
  Phone,
  CalendarDays,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/misc';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { ErrorAlert } from '@/components/ui/alert';
import { formatMoney, formatNumber, formatDate, formatDateTime } from '@/utils/format';
import { useAuth } from '@/hooks/useAuth';

const TRANSITION_ACTION = {
  ACTIVE: { label: 'Activate', icon: SquareCheck },
  SUSPENDED: { label: 'Suspend', icon: CirclePause },
  CANCELLED: { label: 'Cancel', icon: CircleX },
};

function StatTile({ icon: Icon, label, value, hint }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold leading-tight">{value}</p>
          {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="break-words text-sm">{value || '—'}</p>
      </div>
    </div>
  );
}

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { enterImpersonation, user: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';

  const [statusTarget, setStatusTarget] = useState(null); // nextStatus
  const [statusReason, setStatusReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['platform', 'company', id],
    queryFn: async () => {
      const res = await api.get(`/platform/companies/${id}`);
      return res.data.data;
    },
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['platform', 'company', id] });
    queryClient.invalidateQueries({ queryKey: ['platform', 'companies'] });
    queryClient.invalidateQueries({ queryKey: ['platform', 'dashboard'] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ status, reason }) => api.patch(`/platform/companies/${id}/status`, { status, reason }),
    onSuccess: (_r, vars) => {
      toast.success(`Company is now ${vars.status.toLowerCase()}`);
      setStatusTarget(null);
      setStatusReason('');
      invalidate();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/platform/companies/${id}`),
    onSuccess: () => {
      toast.success('Company deleted');
      navigate('/platform/companies', { replace: true });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const handleImpersonate = async () => {
    setImpersonating(true);
    try {
      const result = await enterImpersonation(id);
      if (result.ok) {
        toast.success(`Entered ${result.data.company.name}`);
        navigate('/app', { replace: true });
      } else {
        toast.error(result.error?.message || 'Could not enter the workspace');
      }
    } finally {
      setImpersonating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Could not load this company"
          description={apiError(error).message}
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      </Card>
    );
  }

  const { company, stats, subscriptions, currentSubscription, users, activity, tenantCounts, platformContext } = data;
  const addr = company.address || {};
  const canEnter = ['ACTIVE', 'TRIAL'].includes(company.status) && me?.role !== 'PLATFORM_SUPPORT';
  const transitions = company.allowedTransitions || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description={`${company.code} · ${company.businessType} · created ${formatDate(company.createdAt)}`}
        breadcrumbs={[{ label: 'Companies', to: '/platform/companies' }, { label: company.name }]}
        actions={
          <>
            <Link to="/platform/companies">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            </Link>
            <Link to={`/platform/companies/${id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </Link>
            <Button size="sm" variant="success" disabled={!canEnter} loading={impersonating} onClick={handleImpersonate}
              title={canEnter ? 'Open this workspace as its administrator' : `Company is ${company.status.toLowerCase()}`}
            >
              <Eye className="mr-2 h-4 w-4" />
              Enter workspace
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={company.status} dot />
          <Badge tone="info">{company.plan?.name || 'No plan'}</Badge>
          {company.statusReason && <Badge tone="warning">{company.statusReason}</Badge>}
          {company.daysLeft !== null && (
            <span className="text-xs text-muted-foreground">
              {company.daysLeft >= 0 ? `${company.daysLeft} days remaining` : `${Math.abs(company.daysLeft)} days overdue`}
            </span>
          )}
        </div>
      </PageHeader>

      {/* Status actions */}
      {(transitions.length > 0 || company.status !== 'CANCELLED') && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-4">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</span>
            {transitions.map((nextStatus) => {
              const action = TRANSITION_ACTION[nextStatus];
              if (!action) return null;
              const Icon = action.icon;
              return (
                <Button
                  key={nextStatus}
                  size="sm"
                  variant={nextStatus === 'ACTIVE' ? 'success' : nextStatus === 'CANCELLED' ? 'destructive' : 'outline'}
                  onClick={() => setStatusTarget(nextStatus)}
                >
                  <Icon className="mr-1.5 h-4 w-4" />
                  {action.label}
                </Button>
              );
            })}
            <Button size="sm" variant="outline" onClick={() => setSubscriptionOpen(true)}>
              <CreditCard className="mr-1.5 h-4 w-4" />
              {currentSubscription ? 'Renew / change plan' : 'Assign plan'}
            </Button>
            {company.status === 'CANCELLED' && (
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete company
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* KPI tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Users}
          label="Users"
          value={`${formatNumber(tenantCounts.users)} / ${formatNumber(platformContext.userLimit)}`}
          hint={`${tenantCounts.activeUsers || 0} active`}
        />
        <StatTile icon={UserRound} label="Customers" value={formatNumber(tenantCounts.customers)} />
        <StatTile icon={ShoppingCart} label="Orders" value={formatNumber(tenantCounts.orders)} />
        <StatTile icon={FileText} label="Invoices" value={formatNumber(tenantCounts.invoices)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Seat usage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seat usage</CardTitle>
            <CardDescription>{company.plan?.name ? `${company.plan.name} plan limits` : 'Default limits'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={platformContext.usagePct} label={`${tenantCounts.users} of ${platformContext.userLimit} users`} showLabel />
            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Max customers</dt>
                <dd>{formatNumber(company.limits?.maxCustomers ?? '—')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Invoices / month</dt>
                <dd>{formatNumber(company.limits?.maxInvoicesPerMonth ?? '—')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subscription ends</dt>
                <dd>{company.subscriptionEnd ? formatDate(company.subscriptionEnd) : '—'}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Company profile */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border/60">
            <InfoRow icon={Building2} label="Legal name" value={company.legalName} />
            <InfoRow icon={Mail} label="Email" value={company.email} />
            <InfoRow icon={Phone} label="Phone" value={company.phone} />
            <InfoRow icon={CalendarDays} label="GSTIN" value={company.gstin} />
            <InfoRow
              icon={Building2}
              label="Address"
              value={[addr.line1, addr.line2, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean).join(', ')}
            />
          </CardContent>
        </Card>

        {/* Current subscription */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription</CardTitle>
          </CardHeader>
          <CardContent>
            {currentSubscription ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="font-medium">{currentSubscription.plan?.name || company.plan?.name || '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <StatusBadge status={currentSubscription.status} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Cycle</dt>
                  <dd>{currentSubscription.billingCycle || '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Price</dt>
                  <dd>{formatMoney(currentSubscription.price || 0, currentSubscription.currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Period</dt>
                  <dd>
                    {formatDate(currentSubscription.start)} → {formatDate(currentSubscription.end)}
                  </dd>
                </div>
              </dl>
            ) : (
              <EmptyState compact icon="empty" title="No active subscription" description="Assign a plan to activate billing." />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(v) => setParams((prev) => {
          const next = new URLSearchParams(prev);
          if (v === 'overview') next.delete('tab');
          else next.set('tab', v);
          return next;
        }, { replace: true })}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'users', label: 'Users', badge: tenantCounts.users },
          { value: 'subscriptions', label: 'Subscription history', badge: subscriptions.length },
          { value: 'activity', label: 'Activity', badge: activity.length },
        ]}
      />

      <TabPanel value="overview" active={tab}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
              <CardDescription>Latest platform actions on this tenant</CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <EmptyState compact icon="empty" title="No activity yet" />
              ) : (
                <ol className="space-y-3">
                  {activity.slice(0, 6).map((a, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span
                        className={
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full ' +
                          (a.severity === 'WARN' ? 'bg-warning' : a.severity === 'ERROR' ? 'bg-destructive' : 'bg-brand-500')
                        }
                      />
                      <div className="min-w-0">
                        <p>{a.description || `${a.action} · ${a.entityType}`}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.actor?.name || 'system'} · {formatDateTime(a.occurredAt || a.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provisioning</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Code</span>
                <span className="font-mono">{company.code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Slug</span>
                <span className="font-mono">{company.slug}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Timezone</span>
                <span>{company.timezone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Currency</span>
                <span>
                  {company.currency} ({company.currencySymbol})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Books closed up to</span>
                <span>{company.booksClosedThrough ? formatDate(company.booksClosedThrough) : 'No year closed'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Grace days</span>
                <span>{company.graceDays}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatDateTime(company.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last activity</span>
                <span>{company.lastActivityAt ? formatDateTime(company.lastActivityAt) : '—'}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabPanel>

      <TabPanel value="users" active={tab}>
        <Card>
          {users.length === 0 ? (
            <EmptyState icon="empty" title="No users" description="This tenant has no team members yet." />
          ) : (
            <Table cards>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last login</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id || u._id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{u.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{u.email || u.phone}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge tone="secondary">{u.role}</Badge>
                      {u.mustChangePassword && (
                        <Badge tone="warning" className="ml-1">
                          MUST RESET
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={u.isActive ? 'ACTIVE' : 'SUSPENDED'} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <p className="mt-2 text-xs text-muted-foreground">Showing the 8 most recent users.</p>
      </TabPanel>

      <TabPanel value="subscriptions" active={tab}>
        <Card>
          {subscriptions.length === 0 ? (
            <EmptyState icon="empty" title="No subscriptions" />
          ) : (
            <Table cards>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((s, i) => (
                  <TableRow key={s.id || i}>
                    <TableCell className="font-medium">{s.plan?.name || '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell>{s.billingCycle || '—'}</TableCell>
                    <TableCell>{formatMoney(s.price || 0, s.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(s.start)} → {formatDate(s.end)}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground" title={s.notes || ''}>
                      {s.notes || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </TabPanel>

      <TabPanel value="activity" active={tab}>
        <Card>
          {activity.length === 0 ? (
            <EmptyState icon="empty" title="No recorded activity" />
          ) : (
            <Table cards>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activity.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.occurredAt || a.createdAt)}</TableCell>
                    <TableCell>{a.actor?.name || a.actor || 'system'}</TableCell>
                    <TableCell>
                      <Badge tone="secondary">{a.action}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[420px]">
                      <span className="block truncate" title={a.description || ''}>
                        {a.description || `${a.entityType}${a.entityLabel ? ` · ${a.entityLabel}` : ''}`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge tone={a.severity === 'WARN' ? 'warning' : a.severity === 'ERROR' ? 'destructive' : 'muted'}>
                        {a.severity || 'INFO'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ActivityIcon className="h-3.5 w-3.5" /> Showing the 15 most recent platform events for this tenant.
        </p>
      </TabPanel>

      {/* Status change dialog (reason required) */}
      <Dialog
        open={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        title={`${statusTarget === 'SUSPENDED' ? 'Suspend' : statusTarget === 'ACTIVE' ? 'Activate' : 'Cancel'} ${company.name}`}
        description="The change is recorded in the audit trail and takes effect immediately."
        size="sm"
        dismissible={!statusMutation.isLoading}
        footer={
          <>
            <Button variant="outline" onClick={() => setStatusTarget(null)} disabled={statusMutation.isLoading}>
              Cancel
            </Button>
            <Button
              variant={statusTarget === 'ACTIVE' ? 'success' : 'destructive'}
              loading={statusMutation.isLoading}
              onClick={() => statusMutation.mutate({ status: statusTarget, reason: statusReason })}
            >
              Confirm
            </Button>
          </>
        }
      >
        <Field
          label="Reason"
          required={statusTarget !== 'ACTIVE'}
          error={statusTarget !== 'ACTIVE' && statusReason.trim().length > 0 && statusReason.trim().length < 3 ? 'At least 3 characters' : ''}
          hint="Visible in the audit trail (required for suspend/cancel)."
        >
          <Textarea
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            placeholder={statusTarget === 'SUSPENDED' ? 'Non-payment of invoices' : 'Payment received'}
            rows={3}
          />
        </Field>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${company.name}?`}
        message="The company is soft-deleted: it disappears from lists but its data is retained for compliance. This cannot be undone from the UI."
        confirmLabel="Delete company"
        tone="destructive"
        loading={deleteMutation.isLoading}
        onConfirm={() => deleteMutation.mutate()}
      />

      {/* Assign / renew subscription */}
      <AssignSubscriptionDialog
        open={subscriptionOpen}
        onClose={() => setSubscriptionOpen(false)}
        companyId={id}
        company={company}
        currentSubscription={currentSubscription}
        onDone={invalidate}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign / renew subscription dialog
// ---------------------------------------------------------------------------
function AssignSubscriptionDialog({ open, onClose, companyId, company, currentSubscription, onDone }) {
  const [planId, setPlanId] = useState(currentSubscription?.plan?.id || company.plan?.id || '');
  const [billingCycle, setBillingCycle] = useState(currentSubscription?.billingCycle || 'YEARLY');
  const [price, setPrice] = useState(currentSubscription?.price ?? '');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  const { data: plansData } = useQuery({
    queryKey: ['platform', 'plans', 'options'],
    queryFn: async () => {
      const res = await api.get('/platform/plans', { params: { active: 'true', limit: 100 } });
      return res.data;
    },
    enabled: open,
  });
  const plans = plansData?.data || [];

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/platform/companies/${companyId}/subscription`, {
        planId,
        billingCycle,
        price: price === '' ? undefined : Number(price),
        notes: notes || undefined,
      }),
    onSuccess: () => {
      toast.success('Subscription updated');
      setNotes('');
      setFormError('');
      onClose();
      onDone?.();
    },
    onError: (err) => setFormError(apiError(err).message),
  });

  const selected = plans.find((p) => p.id === planId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Assign or renew a subscription"
      description={`Current plan: ${company.plan?.name || 'none'}. A new record is added to the history and the company moves to ACTIVE.`}
      size="md"
      dismissible={!mutation.isLoading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isLoading}>
            Cancel
          </Button>
          <Button loading={mutation.isLoading} disabled={!planId} onClick={() => mutation.mutate()}>
            Save subscription
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <div className="sm:col-span-2">
            <ErrorAlert title="Could not save the subscription" message={formError} onClose={() => setFormError('')} />
          </div>
        )}
        <Field label="Plan" required>
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Select a plan…</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {formatMoney(p.price, p.currency)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Billing cycle">
          <Select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="YEARLY">Yearly</option>
            <option value="ONCE">One-time</option>
          </Select>
        </Field>
        <Field label="Price" hint={selected ? `Plan list price: ${formatMoney(selected.price, selected.currency)}` : 'Blank = plan price'}>
          <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Yearly renewal, PO #1234…" maxLength={500} />
        </Field>
      </div>
    </Dialog>
  );
}
