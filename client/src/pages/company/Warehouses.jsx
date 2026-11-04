import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, History, Truck, Warehouse as WarehouseIcon } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import { useAuthStore } from '@/store/authStore';
import {
  AddressFields,
  FormActions,
  FormSection,
  dateInput,
  num,
  numInput,
  opt,
} from '@/components/company/form-utils';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { Dialog } from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { LoadingState } from '@/components/ui/misc';
import { useLookups } from '@/hooks/useLookups';
import { usePermissions } from '@/hooks/usePermissions';
import { formatDate, formatDateTime, formatNumber } from '@/utils/format';

/**
 * Warehouses: a shallow hierarchy (MAIN -> SUB/TRANSIT/DAMAGED, MAIN|SUB ->
 * VAN) plus the van assignment workflow. The parent rules below mirror the
 * server exactly, so the form refuses bad combinations before the API does.
 */
const TYPES = ['MAIN', 'SUB', 'VAN', 'TRANSIT', 'DAMAGED'];
const TYPE_LABEL = { MAIN: 'Main', SUB: 'Sub', VAN: 'Van', TRANSIT: 'Transit', DAMAGED: 'Damaged' };

/** Which types each type may nest under ([] = root warehouse). */
const PARENT_TYPES = {
  MAIN: [],
  SUB: ['MAIN'],
  TRANSIT: ['MAIN'],
  DAMAGED: ['MAIN'],
  VAN: ['MAIN', 'SUB'],
};

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

const schema = z
  .object({
    name: z.string().trim().min(2, 'Warehouse name is required').max(120),
    code: z.string().trim().min(2, 'Warehouse code is required').max(20),
    type: z.enum(TYPES),
    parent: text(40),
    vehicleNumber: z.string().trim().max(20).optional().or(z.literal('')),
    vehicleType: text(40),
    image: text(500),
    phone: text(20),
    email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
    manager: text(40),
    capacity: amount,
    address: addressShape,
    isDefault: z.boolean(),
    isActive: z.boolean(),
    notes: text(500),
  })
  .superRefine((values, ctx) => {
    const allowed = PARENT_TYPES[values.type] || [];
    if (allowed.length === 0) {
      if (values.parent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['parent'],
          message: 'A main warehouse cannot have a parent.',
        });
      }
    } else if (!values.parent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parent'],
        message: `Nest this ${TYPE_LABEL[values.type].toLowerCase()} under a ${allowed
          .map((t) => TYPE_LABEL[t].toLowerCase())
          .join(' or ')} warehouse.`,
      });
    }
    if (values.type === 'VAN' && !values.vehicleNumber.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicleNumber'],
        message: 'Vehicle number is required for a van.',
      });
    }
    if (values.type !== 'MAIN' && values.isDefault) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isDefault'],
        message: 'Only the main warehouse can be the default.',
      });
    }
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
  parent: initial?.parent?.id || initial?.parent || '',
  vehicleNumber: initial?.vehicleNumber || '',
  vehicleType: initial?.vehicleType || '',
  image: initial?.image || '',
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

  const type = watch('type');
  const image = watch('image');
  const watchedParent = watch('parent');
  const allowedParents = PARENT_TYPES[type] || [];

  // Moving back to MAIN clears any parent the previous type had picked.
  useEffect(() => {
    if (type === 'MAIN' && watchedParent) setValue('parent', '');
  }, [type, watchedParent, setValue]);

  // Parent options: only valid parents of this type, never the record itself.
  const parentOptions = lookups.warehouses.filter(
    (w) => allowedParents.includes(w.type) && w.id !== initial?.id
  );
  // Keep a now-hidden current parent selectable so the value never blanks out.
  const currentParent = initial?.parent;
  if (
    currentParent?.id &&
    !parentOptions.some((w) => w.id === currentParent.id) &&
    allowedParents.includes(currentParent.type)
  ) {
    parentOptions.unshift(currentParent);
  }

  const onSubmit = async (values) => {
    setFormError('');
    setServerErrors([]);

    const payload = {
      name: values.name,
      code: values.code,
      type: values.type,
      parent: opt(values.parent),
      vehicleNumber: values.type === 'VAN' ? values.vehicleNumber : '',
      vehicleType: values.type === 'VAN' ? values.vehicleType : '',
      image: values.image,
      phone: values.phone,
      email: values.email,
      manager: opt(values.manager),
      capacity: num(values.capacity),
      address: values.address,
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
        <Field
          label="Type"
          error={errors.type?.message}
          hint={
            type === 'VAN'
              ? 'Mobile stock — must sit under a main or sub warehouse'
              : type === 'MAIN'
                ? 'Root warehouse — no parent, can hold the default flag'
                : undefined
          }
        >
          <Select {...register('type')}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>

        {allowedParents.length > 0 && (
          <Field
            label="Parent warehouse"
            required
            error={errors.parent?.message}
            hint={`Nest under a ${allowedParents.map((t) => TYPE_LABEL[t].toLowerCase()).join(' or ')}`}
          >
            <Select {...register('parent')} error={!!errors.parent}>
              <option value="">Select parent…</option>
              {parentOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.code}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {type === 'VAN' && (
          <>
            <Field label="Vehicle number" required error={errors.vehicleNumber?.message}>
              <Input
                {...register('vehicleNumber')}
                error={!!errors.vehicleNumber}
                placeholder="MH12AB1234"
                className="uppercase"
              />
            </Field>
            <Field label="Vehicle type" error={errors.vehicleType?.message}>
              <Input {...register('vehicleType')} placeholder="Tata Ace / Bolero pickup…" />
            </Field>
          </>
        )}

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
        <Field
          label="Image"
          error={errors.image?.message}
          className="sm:col-span-2"
          hint="URL or uploaded file path (for example /uploads/warehouses/van.jpg)"
        >
          <div className="flex items-center gap-3">
            <Input {...register('image')} placeholder="/uploads/warehouses/…" />
            {image ? (
              <span className="relative shrink-0">
                <img
                  src={image}
                  alt=""
                  className="h-10 w-10 rounded-lg border object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </span>
            ) : null}
          </div>
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

// ---------------------------------------------------------------------------
// Van assignments
// ---------------------------------------------------------------------------

const assignSchema = z.object({
  executive: z.string().min(1, 'Pick who takes this van'),
  fromDate: z.string().optional(),
  dayCloseMandatory: z.boolean(),
  notes: text(500),
});

/** Open a spell for this van (reassigning closes the previous one). */
function VanAssignDialog({ van, onClose }) {
  const queryClient = useQueryClient();
  const { lookups } = useLookups();
  const [formError, setFormError] = useState('');

  const activeQuery = useQuery({
    queryKey: ['company', 'warehouses', van.id, 'assignments', 'active'],
    queryFn: async () => {
      const { data } = await api.get(`/v1/warehouses/${van.id}/assignments`, {
        params: { active: true, limit: 1 },
      });
      return data?.data || [];
    },
  });
  const active = activeQuery.data?.[0];

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(assignSchema),
    defaultValues: {
      executive: '',
      fromDate: dateInput(new Date()),
      dayCloseMandatory: true,
      notes: '',
    },
  });

  const onSubmit = async (values) => {
    setFormError('');
    try {
      await api.post(`/v1/warehouses/${van.id}/assignments`, {
        executive: values.executive,
        fromDate: values.fromDate || undefined,
        dayCloseMandatory: values.dayCloseMandatory,
        notes: values.notes,
      });
      toast.success(`${van.name} assigned`);
      queryClient.invalidateQueries({ queryKey: ['company', 'warehouses'] });
      onClose();
    } catch (err) {
      setFormError(apiError(err).message);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Assign ${van.name}`}
      description={
        van.vehicleNumber
          ? `Van ${van.vehicleNumber}${van.vehicleType ? ` · ${van.vehicleType}` : ''}`
          : 'Van assignment'
      }
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button loading={isSubmitting} onClick={handleSubmit(onSubmit)}>
            <Truck className="mr-2 h-4 w-4" />
            Assign van
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {formError && (
          <div className="sm:col-span-2">
            <ErrorAlert title="Could not assign the van" message={formError} onClose={() => setFormError('')} />
          </div>
        )}

        {active && (
          <div className="sm:col-span-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
            Currently assigned to <strong>{active.executive?.name || '—'}</strong> since{' '}
            {formatDate(active.fromDate)}. Saving closes that spell and opens a new one.
          </div>
        )}

        <Field label="Executive" required error={errors.executive?.message}>
          <Select {...register('executive')} error={!!errors.executive}>
            <option value="">Select user…</option>
            {lookups.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="From date" error={errors.fromDate?.message}>
          <Input type="date" {...register('fromDate')} />
        </Field>

        <div className="sm:col-span-2">
          <Checkbox
            label="Day close mandatory"
            description="This executive must run the day-close (expected vs actual) for every day this van is on duty."
            {...register('dayCloseMandatory')}
          />
        </div>

        <Field label="Notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register('notes')} placeholder="Route, beat or handover notes…" />
        </Field>
      </form>
    </Dialog>
  );
}

/** Full assignment history for one van, with a close action per open spell. */
function VanHistoryDialog({ van, onClose }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManage = can('inventory.manage');

  const q = useQuery({
    queryKey: ['company', 'warehouses', van.id, 'assignments'],
    queryFn: async () => {
      const { data } = await api.get(`/v1/warehouses/${van.id}/assignments`, {
        params: { limit: 50 },
      });
      return data || { data: [], meta: {} };
    },
  });

  const closeMutation = useMutation({
    mutationFn: (assignmentId) =>
      api.post(`/v1/warehouses/${van.id}/assignments/${assignmentId}/close`, {}),
    onSuccess: () => {
      toast.success('Assignment closed');
      queryClient.invalidateQueries({ queryKey: ['company', 'warehouses'] });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const rows = q.data?.data || [];

  return (
    <Dialog
      open
      onClose={onClose}
      title="Assignment history"
      description={`${van.name}${van.vehicleNumber ? ` · ${van.vehicleNumber}` : ''} — spells are closed, never edited.`}
      size="lg"
    >
      {q.isLoading ? (
        <LoadingState label="Loading assignments…" />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No assignments yet. Use <strong>Assign van</strong> to put a driver on this van.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Executive</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="w-24 text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="text-sm font-medium">{row.executive?.name || '—'}</span>
                  {row.executive?.role ? (
                    <span className="block text-xs text-muted-foreground">
                      {row.executive.role.replace(/_/g, ' ')}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{formatDate(row.fromDate)}</TableCell>
                <TableCell className="text-sm">{row.toDate ? formatDate(row.toDate) : '—'}</TableCell>
                <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground">
                  {row.closeNotes || row.notes || '—'}
                </TableCell>
                <TableCell>
                  <Badge tone={row.active ? 'success' : 'muted'}>
                    {row.active ? 'Active' : 'Closed'}
                  </Badge>
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    {row.active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={closeMutation.isLoading && closeMutation.variables === row.id}
                        onClick={() => closeMutation.mutate(row.id)}
                      >
                        Close
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {row.closedAt ? formatDateTime(row.closedAt) : ''}
                      </span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Dialog>
  );
}

export default function Warehouses() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [assignVan, setAssignVan] = useState(null);
  const [historyVan, setHistoryVan] = useState(null);

  const setDefault = useMutation({
    mutationFn: (row) => api.post(`/v1/warehouses/${row.id}/set-default`),
    onSuccess: () => {
      toast.success('Primary main warehouse updated');
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
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
            {row.image ? (
              <img src={row.image} alt="" className="h-9 w-9 object-cover" />
            ) : (
              <WarehouseIcon className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.code} · {TYPE_LABEL[row.type] || row.type}
              {row.parent ? ` · under ${row.parent.code || row.parent.name}` : ''}
            </p>
            {row.type === 'VAN' && row.vehicleNumber ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-brand-600 dark:text-brand-300">
                <Truck className="h-3 w-3" aria-hidden />
                {row.vehicleNumber}
              </span>
            ) : null}
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
          {row.isDefault && (
            <Badge tone="info" title="Used when a document does not name a warehouse">
              Primary
            </Badge>
          )}
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

  // `key` lives on the element so the array returned below is keyed.
  const menuItem = (Icon, label, onClick) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent focus-ring"
      onClick={onClick}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );

  const rowActions = (row, { close }) => {
    const items = [];
    if (row.type === 'VAN') {
      if (can('inventory.manage')) {
        items.push(
          menuItem(Truck, 'Assign van', () => {
            close();
            setAssignVan(row);
          })
        );
      }
      if (can('inventory.view')) {
        items.push(
          menuItem(History, 'Assignment history', () => {
            close();
            setHistoryVan(row);
          })
        );
      }
    }
    if (row.type === 'MAIN' && !row.isDefault && row.isActive && can('inventory.manage')) {
      items.push(
        menuItem(CheckCircle2, 'Make primary main warehouse', () => {
          close();
          setDefault.mutate(row);
        })
      );
    }
    return items.length ? <>{items}</> : null;
  };

  return (
    <>
      <ResourcePage
        title="Warehouses"
        description="Stock locations, hierarchy and van assignments"
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Warehouses' }]}
        queryKey={['company', 'warehouses']}
        endpoint="/v1/warehouses"
        permissionPrefix="inventory"
        columns={columns}
        filterKeys={['type', 'isActive']}
        filters={filters}
        searchPlaceholder="Search by name, code, city, phone or plate…"
        createLabel="Add warehouse"
        createIcon={WarehouseIcon}
        emptyTitle="No warehouses yet"
        emptyDescription="Create a warehouse to start tracking stock locations."
        formTitle={(mode) => (mode === 'create' ? 'Add warehouse' : 'Edit warehouse')}
        formDescription="Every warehouse nests under a parent; vans carry a vehicle number."
        formSize="lg"
        renderForm={(props) => <WarehouseForm {...props} />}
        onSaved={(saved, mode) => {
          // A new van has no driver yet - open the assign step right away.
          if (mode === 'create' && saved?.type === 'VAN') setAssignVan(saved);
        }}
        rowActions={rowActions}
        deleteMessage={(row) =>
          row
            ? `“${row.name}” will be removed. Warehouses with stock, movement history or an open van assignment cannot be deleted, and the default warehouse must be replaced first.`
            : ''
        }
      />

      {assignVan && <VanAssignDialog van={assignVan} onClose={() => setAssignVan(null)} />}
      {historyVan && <VanHistoryDialog van={historyVan} onClose={() => setHistoryVan(null)} />}
    </>
  );
}
