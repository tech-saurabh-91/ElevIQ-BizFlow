import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Warehouse as WarehouseIcon } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import { useAuthStore } from '@/store/authStore';
import { AddressFields, FormActions, FormSection, num, numInput, opt } from '@/components/company/form-utils';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { useLookups } from '@/hooks/useLookups';
import { formatNumber } from '@/utils/format';

const TYPES = ['MAIN', 'BRANCH', 'TRANSIT', 'DAMAGED'];
const TYPE_LABEL = { MAIN: 'Main', BRANCH: 'Branch', TRANSIT: 'Transit', DAMAGED: 'Damaged' };

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const amount = z
  .string()
  .trim()
  .regex(/^\d*\.?\d*$/, 'Enter a valid number')
  .optional()
  .or(z.literal(''));

const addressShape = z.object({
  line1: text(160),
  line2: text(160),
  city: text(80),
  state: text(80),
  pincode: text(12),
  country: text(80),
});

const schema = z.object({
  name: z.string().trim().min(2, 'Warehouse name is required').max(120),
  code: z.string().trim().min(2, 'Warehouse code is required').max(20),
  type: z.enum(TYPES),
  phone: text(20),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  manager: text(40),
  capacity: amount,
  address: addressShape,
  isDefault: z.boolean(),
  isActive: z.boolean(),
  notes: text(500),
});

// New addresses start in the company's own country.
const emptyAddress = () => ({
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
  country: useAuthStore.getState().company?.country || '',
});

const toDefaults = (initial) => ({
  name: initial?.name || '',
  code: initial?.code || '',
  type: initial?.type || 'MAIN',
  phone: initial?.phone || '',
  email: initial?.email || '',
  manager: initial?.manager?.id || initial?.manager || '',
  capacity: numInput(initial?.capacity),
  address: { ...emptyAddress(), ...(initial?.address || {}) },
  isDefault: initial?.isDefault ?? false,
  isActive: initial?.isActive ?? true,
  notes: initial?.notes || '',
});

function WarehouseForm({ mode, initial, onClose, onSaved }) {
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { lookups } = useLookups();

  const {
    register,
    handleSubmit,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toDefaults(initial) });

  const onSubmit = async (values) => {
    setFormError('');
    setServerErrors([]);

    const payload = {
      name: values.name,
      code: values.code,
      type: values.type,
      phone: values.phone,
      email: values.email,
      manager: opt(values.manager),
      capacity: num(values.capacity),
      address: values.address,
      isDefault: values.isDefault,
      isActive: values.isActive,
      notes: values.notes,
    };

    try {
      const res =
        mode === 'create'
          ? await api.post('/v1/warehouses', payload)
          : await api.patch(`/v1/warehouses/${initial.id}`, payload);
      toast.success(mode === 'create' ? 'Warehouse created' : 'Warehouse updated');
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
          title="Could not save the warehouse"
          message={formError}
          errors={serverErrors.filter((e) => !e.field || e.field === '_')}
          onClose={() => {
            setFormError('');
            setServerErrors([]);
          }}
        />
      )}

      <FormSection title="Warehouse details">
        <Field label="Warehouse name" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Main Warehouse" />
        </Field>
        <Field label="Warehouse code" required error={errors.code?.message}>
          <Input {...register('code')} error={!!errors.code} placeholder="WH-MAIN" className="uppercase" />
        </Field>
        <Field label="Type" error={errors.type?.message}>
          <Select {...register('type')}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Capacity" error={errors.capacity?.message} hint="Optional — units or pallets">
          <Input type="number" min="0" step="1" {...register('capacity')} placeholder="0" />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input {...register('phone')} placeholder="+91 98765 43210" />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" {...register('email')} error={!!errors.email} placeholder="warehouse@company.test" />
        </Field>
        <Field label="Manager" error={errors.manager?.message} className="sm:col-span-2">
          <Select {...register('manager')}>
            <option value="">Unassigned</option>
            {lookups.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
      </FormSection>

      <FormSection title="Address">
        <AddressFields register={register} watch={watch} setValue={setValue} errors={errors} prefix="address" />
      </FormSection>

      <FormSection title="Notes">
        <Field label="Internal notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register('notes')} placeholder="Loading bay, access hours…" />
        </Field>
        <Checkbox
          label="Default warehouse"
          description="Stock movements default to this location. Only one warehouse can be default."
          {...register('isDefault')}
        />
        <Checkbox
          label="Active"
          description="Inactive warehouses cannot be selected on new orders."
          {...register('isActive')}
        />
      </FormSection>

      <FormActions
        onCancel={onClose}
        loading={isSubmitting}
        submitLabel={mode === 'create' ? 'Create warehouse' : 'Save changes'}
      />
    </form>
  );
}

export default function Warehouses() {
  const queryClient = useQueryClient();

  const setDefault = useMutation({
    mutationFn: (row) => api.post(`/v1/warehouses/${row.id}/set-default`),
    onSuccess: () => {
      toast.success('Default warehouse updated');
      queryClient.invalidateQueries({ queryKey: ['company', 'warehouses'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'lookups'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'settings'] });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const columns = [
    {
      key: 'name',
      header: 'Warehouse',
      sortable: 'name',
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
            <WarehouseIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.code} · {TYPE_LABEL[row.type] || row.type}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (row) => (
        <div className="text-sm">
          <p>{[row.address?.city, row.address?.state].filter(Boolean).join(', ') || '—'}</p>
          <p className="text-xs text-muted-foreground">{row.phone || row.email || 'No contact'}</p>
        </div>
      ),
    },
    {
      key: 'manager',
      header: 'Manager',
      render: (row) => (
        <span className="text-sm">
          {row.manager?.name || '—'}
          {row.manager?.role ? (
            <span className="block text-xs text-muted-foreground">{row.manager.role.replace(/_/g, ' ')}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'capacity',
      header: 'Capacity',
      className: 'text-right',
      render: (row) => (
        <span className="text-sm">{row.capacity ? formatNumber(row.capacity) : '—'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={row.isActive ? 'success' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</Badge>
          {row.isDefault && <Badge tone="info">Default</Badge>}
        </div>
      ),
    },
  ];

  const filters = ({ values, setParam }) => (
    <>
      <Select
        aria-label="Filter by warehouse type"
        className="h-9 w-auto min-w-[9rem]"
        value={values.type || ''}
        onChange={(e) => setParam({ type: e.target.value || undefined, page: 1 })}
      >
        <option value="">All types</option>
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by status"
        className="h-9 w-auto min-w-[8rem]"
        value={values.isActive || ''}
        onChange={(e) => setParam({ isActive: e.target.value || undefined, page: 1 })}
      >
        <option value="">All statuses</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </Select>
    </>
  );

  return (
    <ResourcePage
      title="Warehouses"
      description="Stock locations and their managers"
      breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Warehouses' }]}
      queryKey={['company', 'warehouses']}
      endpoint="/v1/warehouses"
      permissionPrefix="inventory"
      columns={columns}
      filterKeys={['type', 'isActive']}
      filters={filters}
      searchPlaceholder="Search by name, code, city or phone…"
      createLabel="Add warehouse"
      createIcon={WarehouseIcon}
      emptyTitle="No warehouses yet"
      emptyDescription="Create a warehouse to start tracking stock locations."
      formTitle={(mode) => (mode === 'create' ? 'Add warehouse' : 'Edit warehouse')}
      formDescription="Addresses and managers are tenant-scoped."
      formSize="lg"
      renderForm={(props) => <WarehouseForm {...props} />}
      rowActions={(row, { close }) =>
        !row.isDefault && row.isActive ? (
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent focus-ring"
            onClick={() => {
              close();
              setDefault.mutate(row);
            }}
          >
            <CheckCircle2 className="h-4 w-4" /> Set as default
          </button>
        ) : null
      }
      deleteMessage={(row) =>
        row
          ? `“${row.name}” will be removed. The default warehouse cannot be deleted — set another warehouse as default first.`
          : ''
      }
    />
  );
}
