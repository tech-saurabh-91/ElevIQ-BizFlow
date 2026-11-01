import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Route as RouteIcon } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import { FormActions, FormSection, num, numInput, opt } from '@/components/company/form-utils';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { useLookups } from '@/hooks/useLookups';

const BEAT_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_LABEL = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));

const schema = z.object({
  name: z.string().trim().min(2, 'Route name is required').max(120),
  code: z.string().trim().min(2, 'Route code is required').max(20),
  description: text(500),
  territory: text(80),
  warehouse: text(40),
  assignedTo: text(40),
  beatDays: z.array(z.enum(BEAT_DAYS)),
  sequence: text(20),
  isActive: z.boolean(),
  notes: text(500),
});

const toDefaults = (initial) => ({
  name: initial?.name || '',
  code: initial?.code || '',
  description: initial?.description || '',
  territory: initial?.territory || '',
  warehouse: initial?.warehouse?.id || initial?.warehouse || '',
  assignedTo: initial?.assignedTo?.id || initial?.assignedTo || '',
  beatDays: initial?.beatDays || [],
  sequence: numInput(initial?.sequence),
  isActive: initial?.isActive ?? true,
  notes: initial?.notes || '',
});

function RouteForm({ mode, initial, onClose, onSaved }) {
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { lookups } = useLookups();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toDefaults(initial) });

  const onSubmit = async (values) => {
    setFormError('');
    setServerErrors([]);

    const payload = {
      name: values.name,
      code: values.code,
      description: values.description,
      territory: values.territory,
      warehouse: opt(values.warehouse),
      assignedTo: opt(values.assignedTo),
      beatDays: values.beatDays,
      sequence: num(values.sequence),
      isActive: values.isActive,
      notes: values.notes,
    };

    try {
      const res =
        mode === 'create'
          ? await api.post('/v1/routes', payload)
          : await api.patch(`/v1/routes/${initial.id}`, payload);
      toast.success(mode === 'create' ? 'Route created' : 'Route updated');
      onSaved(res.data?.data);
    } catch (err) {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([field, message]) => {
        setError(field, { type: 'server', message });
      });
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {(formError || serverErrors.length > 0) && (
        <ErrorAlert
          title="Could not save the route"
          message={formError}
          errors={serverErrors.filter((e) => !e.field || e.field === '_')}
          onClose={() => {
            setFormError('');
            setServerErrors([]);
          }}
        />
      )}

      <FormSection title="Route details">
        <Field label="Route name" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Pune East Beat 1" />
        </Field>
        <Field label="Route code" required error={errors.code?.message}>
          <Input {...register('code')} error={!!errors.code} placeholder="RTE-0001" className="uppercase" />
        </Field>
        <Field label="Territory" error={errors.territory?.message}>
          <Input {...register('territory')} placeholder="Pune East" />
        </Field>
        <Field label="Sequence" error={errors.sequence?.message} hint="Order in which the route appears">
          <Input type="number" min="0" step="1" {...register('sequence')} placeholder="0" />
        </Field>
        <Field label="Warehouse" error={errors.warehouse?.message}>
          <Select {...register('warehouse')}>
            <option value="">Default warehouse</option>
            {lookups.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Assigned salesman" error={errors.assignedTo?.message}>
          <Select {...register('assignedTo')}>
            <option value="">Unassigned</option>
            {lookups.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Input {...register('description')} placeholder="Areas covered by this beat" />
        </Field>
      </FormSection>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Beat days</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Days the salesman visits this route.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {BEAT_DAYS.map((day) => (
            <label
              key={day}
              className="flex cursor-pointer select-none items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="checkbox"
                value={day}
                className="h-4 w-4 rounded border-input accent-primary"
                {...register('beatDays')}
              />
              {DAY_LABEL[day]}
            </label>
          ))}
        </div>
        {errors.beatDays?.message && <p className="text-xs text-destructive">{errors.beatDays.message}</p>}
      </section>

      <FormSection title="Notes">
        <Field label="Internal notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register('notes')} placeholder="Traffic, market closure days…" />
        </Field>
        <Checkbox
          label="Active route"
          description="Inactive routes cannot be assigned to new customers."
          className="sm:col-span-2"
          {...register('isActive')}
        />
      </FormSection>

      <FormActions
        onCancel={onClose}
        loading={isSubmitting}
        submitLabel={mode === 'create' ? 'Create route' : 'Save changes'}
      />
    </form>
  );
}

export default function Routes() {
  const columns = [
    {
      key: 'name',
      header: 'Route',
      sortable: 'name',
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
            <RouteIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.code}
              {row.territory ? ` · ${row.territory}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'salesman',
      header: 'Salesman',
      render: (row) => (
        <div className="text-sm">
          <p>{row.assignedTo?.name || 'Unassigned'}</p>
          <p className="text-xs text-muted-foreground">{row.warehouse?.name || 'Default warehouse'}</p>
        </div>
      ),
    },
    {
      key: 'beatDays',
      header: 'Beat days',
      render: (row) =>
        row.beatDays?.length ? (
          <div className="flex flex-wrap gap-1">
            {row.beatDays.map((d) => (
              <Badge key={d} tone="secondary" className="px-1.5 py-0 text-[10px]">
                {DAY_LABEL[d] || d}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Not scheduled</span>
        ),
    },
    {
      key: 'sequence',
      header: 'Sequence',
      sortable: 'sequence',
      className: 'text-right',
      render: (row) => <span className="text-sm">{row.sequence || 0}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.isActive ? 'success' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</Badge>
      ),
    },
  ];

  const filters = ({ values, setParam }) => (
    <Select
      aria-label="Filter by status"
      className="h-9 w-auto min-w-[9rem]"
      value={values.isActive || ''}
      onChange={(e) => setParam({ isActive: e.target.value || undefined, page: 1 })}
    >
      <option value="">All statuses</option>
      <option value="true">Active</option>
      <option value="false">Inactive</option>
    </Select>
  );

  return (
    <ResourcePage
      title="Routes & Beats"
      description="Sales routes, beat days and the salesman who covers them"
      breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Routes & Beats' }]}
      queryKey={['company', 'routes']}
      endpoint="/v1/routes"
      permissionPrefix="customers"
      columns={columns}
      filterKeys={['isActive']}
      filters={filters}
      searchPlaceholder="Search by name, code, territory or description…"
      createLabel="Add route"
      createIcon={RouteIcon}
      emptyTitle="No routes yet"
      emptyDescription="Create routes to organise customers into beats for your sales team."
      formTitle={(mode) => (mode === 'create' ? 'Add route' : 'Edit route')}
      formDescription="Assign a salesman and warehouse to keep visits and stock in sync."
      formSize="lg"
      renderForm={(props) => <RouteForm {...props} />}
      deleteMessage={(row) =>
        row ? `“${row.name}” will be removed. Customers on this route will have no beat assigned.` : ''
      }
    />
  );
}
