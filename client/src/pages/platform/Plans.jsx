import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { CreditCard, Plus, Pencil, Trash2, Users, Search } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { ErrorAlert } from '@/components/ui/alert';
import { formatMoney, formatNumber } from '@/utils/format';

const CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONCE'];
const FEATURES = [
  ['gpsTracking', 'GPS tracking'],
  ['multiWarehouse', 'Multi-warehouse'],
  ['eInvoice', 'e-Invoicing'],
  ['apiAccess', 'API access'],
  ['fieldForce', 'Field force'],
  ['barcode', 'Barcode'],
  ['schemes', 'Schemes & discounts'],
  ['purchase', 'Purchase orders'],
];

const schema = z.object({
  code: z.string().trim().toUpperCase().min(2, 'At least 2 characters').max(20),
  name: z.string().trim().min(2, 'Plan name is required').max(80),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  price: z.coerce.number().min(0, 'Price cannot be negative').max(100000000),
  currency: z.string().trim().max(8).optional().or(z.literal('')),
  billingCycle: z.enum(CYCLES),
  trialDays: z.coerce.number().int().min(0, 'Cannot be negative').max(365, 'Max 365 days'),
  maxUsers: z.coerce.number().int().min(1, 'At least 1').max(10000),
  maxCustomers: z.coerce.number().int().min(1, 'At least 1').max(1000000),
  maxInvoicesPerMonth: z.coerce.number().int().min(1, 'At least 1').max(1000000),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  isActive: z.boolean(),
  highlights: z.string().optional(), // comma separated in the form
  // Feature toggles (checkboxes); stored as a features object server-side.
  ...Object.fromEntries(FEATURES.map(([key]) => [key, z.boolean().optional().default(false)])),
});

const DEFAULTS = {
  code: '',
  name: '',
  description: '',
  price: 0,
  currency: 'INR',
  billingCycle: 'YEARLY',
  trialDays: 14,
  maxUsers: 5,
  maxCustomers: 500,
  maxInvoicesPerMonth: 500,
  sortOrder: 0,
  isActive: true,
  highlights: '',
};

export default function Plans() {
  const queryClient = useQueryClient();
  const [params, setParams] = useState({ page: 1, limit: 20, search: '' });
  const [searchDraft, setSearchDraft] = useState('');
  const [editing, setEditing] = useState(null); // plan | 'new' | null
  const [deleting, setDeleting] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['platform', 'plans', params],
    queryFn: async () => {
      const res = await api.get('/platform/plans', { params });
      return res.data;
    },
    keepPreviousData: true,
  });

  const deleteMutation = useMutation({
    mutationFn: (plan) => api.delete(`/platform/plans/${plan.id}`),
    onSuccess: (_r, plan) => {
      toast.success(`${plan.name} deleted`);
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ['platform', 'plans'] });
      queryClient.invalidateQueries({ queryKey: ['platform', 'companies'] });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const plans = data?.data || [];
  const meta = data?.meta || {};

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscription plans"
        description="Pricing, limits and features offered to tenants"
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="mr-2 h-4 w-4" />
            New plan
          </Button>
        }
      />

      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setParams((p) => ({ ...p, search: searchDraft.trim(), page: 1 }));
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search plans…"
              className="pl-9"
              aria-label="Search plans"
            />
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState icon="error" title="Could not load plans" description={apiError(error).message} />
        </Card>
      ) : plans.length === 0 ? (
        <Card>
          <EmptyState
            icon={params.search ? 'search' : 'empty'}
            title="No plans yet"
            description="Create your first plan to start provisioning companies with limits and pricing."
            action={
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="mr-2 h-4 w-4" />
                New plan
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} className={p.isActive ? '' : 'opacity-70'}>
              <CardContent className="flex h-full flex-col gap-3 py-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold">{p.name}</h3>
                      <Badge tone={p.isActive ? 'success' : 'muted'}>{p.isActive ? 'ACTIVE' : 'HIDDEN'}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{p.code}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleting(p)}
                      aria-label={`Delete ${p.name}`}
                      disabled={p.companyCount > 0}
                      title={p.companyCount > 0 ? `In use by ${p.companyCount} companies` : `Delete ${p.name}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <p className="text-2xl font-bold">
                  {formatMoney(p.price, p.currency)}
                  <span className="text-sm font-normal text-muted-foreground"> / {String(p.billingCycle).toLowerCase()}</span>
                </p>

                {p.description && <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p>}

                <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-md bg-muted/60 py-2">
                    <dt className="text-muted-foreground">Users</dt>
                    <dd className="font-semibold">{formatNumber(p.maxUsers)}</dd>
                  </div>
                  <div className="rounded-md bg-muted/60 py-2">
                    <dt className="text-muted-foreground">Customers</dt>
                    <dd className="font-semibold">{formatNumber(p.maxCustomers)}</dd>
                  </div>
                  <div className="rounded-md bg-muted/60 py-2">
                    <dt className="text-muted-foreground">Trial</dt>
                    <dd className="font-semibold">{p.trialDays}d</dd>
                  </div>
                </dl>

                {p.highlights?.length > 0 && (
                  <ul className="flex flex-wrap gap-1">
                    {p.highlights.slice(0, 4).map((h) => (
                      <li key={h}>
                        <Badge tone="info">{h}</Badge>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-auto flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {p.companyCount || 0} companies
                  </span>
                  <span>{p.maxInvoicesPerMonth}/mo invoices</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Pagination
        meta={meta}
        onPageChange={(page) => setParams((p) => ({ ...p, page }))}
        onLimitChange={(limit) => setParams((p) => ({ ...p, limit, page: 1 }))}
      />

      {editing && (
        <PlanDialog
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['platform', 'plans'] });
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name || ''}?`}
        message="The plan is soft-deleted and can no longer be assigned to companies."
        confirmLabel="Delete plan"
        tone="destructive"
        loading={deleteMutation.isLoading}
        onConfirm={() => deleteMutation.mutate(deleting)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit plan dialog
// ---------------------------------------------------------------------------
function PlanDialog({ plan, onClose, onSaved }) {
  const [serverErrors, setServerErrors] = useState([]);
  const [formError, setFormError] = useState('');

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: plan
      ? {
          code: plan.code,
          name: plan.name,
          description: plan.description || '',
          price: plan.price,
          currency: plan.currency || 'INR',
          billingCycle: plan.billingCycle || 'YEARLY',
          trialDays: plan.trialDays ?? 14,
          maxUsers: plan.maxUsers,
          maxCustomers: plan.maxCustomers,
          maxInvoicesPerMonth: plan.maxInvoicesPerMonth,
          sortOrder: plan.sortOrder ?? 0,
          isActive: plan.isActive,
          highlights: (plan.highlights || []).join(', '),
          // Feature flags: true when the plan already has them enabled.
          ...Object.fromEntries(FEATURES.map(([key]) => [key, Boolean(plan.features?.[key])])),
        }
      : { ...DEFAULTS, ...Object.fromEntries(FEATURES.map(([key]) => [key, false])) },
  });

  const isActive = watch('isActive');

  const mutation = useMutation({
    mutationFn: async (v) => {
      const features = Object.fromEntries(FEATURES.map(([key]) => [key, Boolean(v[key])]));
      const payload = {
        code: v.code,
        name: v.name,
        description: v.description,
        price: Number(v.price),
        currency: v.currency || 'INR',
        billingCycle: v.billingCycle,
        trialDays: Number(v.trialDays),
        maxUsers: Number(v.maxUsers),
        maxCustomers: Number(v.maxCustomers),
        maxInvoicesPerMonth: Number(v.maxInvoicesPerMonth),
        sortOrder: Number(v.sortOrder),
        isActive: Boolean(v.isActive),
        features,
        highlights: v.highlights
          ? v.highlights.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12)
          : [],
      };
      if (plan) {
        const res = await api.patch(`/platform/plans/${plan.id}`, payload);
        return res.data.data;
      }
      const res = await api.post('/platform/plans', payload);
      return res.data.data;
    },
    onSuccess: () => {
      toast.success(plan ? 'Plan updated' : 'Plan created');
      onSaved();
    },
    onError: (err) => {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([f, msg]) => setError(f, { type: 'server', message: msg }));
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={plan ? `Edit ${plan.name}` : 'New plan'}
      description={plan ? 'Changes apply to future subscriptions only.' : 'Plans can be assigned to companies once created.'}
      size="lg"
      dismissible={!mutation.isLoading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isLoading}>
            Cancel
          </Button>
          <Button loading={mutation.isLoading || isSubmitting} onClick={handleSubmit(mutation.mutate)}>
            <CreditCard className="mr-2 h-4 w-4" />
            {plan ? 'Save changes' : 'Create plan'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(mutation.mutate)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {(formError || serverErrors.length > 0) && (
          <div className="sm:col-span-2">
            <ErrorAlert
              title="The plan could not be saved"
              message={formError}
              errors={serverErrors.filter((e) => !e.field || e.field === '_')}
              onClose={() => {
                setFormError('');
                setServerErrors([]);
              }}
            />
          </div>
        )}

        <Field label="Code" required error={errors.code?.message} hint="Shown on invoices, e.g. GROWTH">
          <Input {...register('code')} error={!!errors.code} className="uppercase" placeholder="GROWTH" />
        </Field>
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Growth" />
        </Field>
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Input {...register('description')} error={!!errors.description} placeholder="For growing field teams" />
        </Field>
        <Field label="Price" required error={errors.price?.message}>
          <Input type="number" min={0} step="0.01" {...register('price')} error={!!errors.price} />
        </Field>
        <Field label="Currency" error={errors.currency?.message}>
          <Input {...register('currency')} error={!!errors.currency} className="uppercase" />
        </Field>
        <Field label="Billing cycle" required error={errors.billingCycle?.message}>
          <Select {...register('billingCycle')} error={!!errors.billingCycle}>
            {CYCLES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0) + c.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Trial days" error={errors.trialDays?.message}>
          <Input type="number" min={0} max={365} {...register('trialDays')} error={!!errors.trialDays} />
        </Field>
        <Field label="Max users" error={errors.maxUsers?.message}>
          <Input type="number" min={1} {...register('maxUsers')} error={!!errors.maxUsers} />
        </Field>
        <Field label="Max customers" error={errors.maxCustomers?.message}>
          <Input type="number" min={1} {...register('maxCustomers')} error={!!errors.maxCustomers} />
        </Field>
        <Field label="Invoices / month" error={errors.maxInvoicesPerMonth?.message}>
          <Input type="number" min={1} {...register('maxInvoicesPerMonth')} error={!!errors.maxInvoicesPerMonth} />
        </Field>
        <Field label="Sort order" error={errors.sortOrder?.message} hint="Lower numbers appear first">
          <Input type="number" min={0} {...register('sortOrder')} error={!!errors.sortOrder} />
        </Field>

        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium">Included features</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 sm:grid-cols-4">
            {FEATURES.map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" {...register(key)} className="h-4 w-4 rounded border-input" />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium">
            Highlights <span className="font-normal text-muted-foreground">(comma separated, max 12)</span>
          </p>
          <Input {...register('highlights')} placeholder="GPS tracking, Schemes, e-Invoicing" />
        </div>

        <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
          <input type="checkbox" {...register('isActive')} className="h-4 w-4 rounded border-input" />
          <span className="text-sm font-medium">
            Active <span className="font-normal text-muted-foreground">— {isActive ? 'visible when assigning plans' : 'hidden from plan assignment'}</span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}
