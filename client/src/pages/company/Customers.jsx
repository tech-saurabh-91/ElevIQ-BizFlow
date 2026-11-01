import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Users } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import { AddressFields, FormActions, FormSection, num, numInput, opt } from '@/components/company/form-utils';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { useLookups } from '@/hooks/useLookups';
import { formatMoney, formatNumber } from '@/utils/format';

const CUSTOMER_TYPES = ['RETAIL', 'WHOLESALE', 'DISTRIBUTOR', 'DEALER'];
const PAYMENT_TERMS = ['IMMEDIATE', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'CUSTOM'];

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const amount = z
  .string()
  .trim()
  .regex(/^\d*\.?\d*$/, 'Enter a valid amount')
  .optional()
  .or(z.literal(''));
const whole = z
  .string()
  .trim()
  .regex(/^\d*$/, 'Enter a whole number')
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
  name: z.string().trim().min(2, 'Customer name is required').max(160),
  code: text(24),
  type: z.enum(CUSTOMER_TYPES),
  contactPerson: text(120),
  phone: text(20),
  alternatePhone: text(20),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),

  gstin: text(20),
  pan: text(12),
  taxId: text(40),

  address: addressShape,
  shippingAddress: addressShape,

  creditLimit: amount,
  creditDays: whole,
  paymentTerms: z.enum(PAYMENT_TERMS),
  openingBalance: amount,

  priceList: text(40),
  assignedTo: text(40),
  route: text(40),
  warehouse: text(40),
  territory: text(80),

  tags: text(400),
  notes: text(1000),
  isActive: z.boolean(),
});

const emptyAddress = { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' };

const toDefaults = (initial) => ({
  name: initial?.name || '',
  code: initial?.code || '',
  type: initial?.type || 'RETAIL',
  contactPerson: initial?.contactPerson || '',
  phone: initial?.phone || '',
  alternatePhone: initial?.alternatePhone || '',
  email: initial?.email || '',

  gstin: initial?.gstin || '',
  pan: initial?.pan || '',
  taxId: initial?.taxId || '',

  address: { ...emptyAddress, ...(initial?.address || {}) },
  shippingAddress: { ...emptyAddress, ...(initial?.shippingAddress || {}) },

  creditLimit: numInput(initial?.creditLimit),
  creditDays: numInput(initial?.creditDays),
  paymentTerms: initial?.paymentTerms || 'IMMEDIATE',
  openingBalance: numInput(initial?.openingBalance),

  priceList: initial?.priceList?.id || initial?.priceList || '',
  assignedTo: initial?.assignedTo?.id || initial?.assignedTo || '',
  route: initial?.route?.id || initial?.route || '',
  warehouse: initial?.warehouse?.id || initial?.warehouse || '',
  territory: initial?.territory || '',

  tags: (initial?.tags || []).join(', '),
  notes: initial?.notes || '',
  isActive: initial?.isActive ?? true,
});

function CustomerForm({ mode, initial, onClose, onSaved }) {
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { lookups } = useLookups();
  const { company } = useAuth();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: toDefaults(initial),
  });

  const onSubmit = async (values) => {
    setFormError('');
    setServerErrors([]);

    const payload = {
      name: values.name,
      code: opt(values.code),
      type: values.type,
      contactPerson: values.contactPerson,
      phone: values.phone,
      alternatePhone: values.alternatePhone,
      email: values.email,
      gstin: values.gstin,
      pan: values.pan,
      taxId: values.taxId,
      address: values.address,
      shippingAddress: values.shippingAddress,
      creditLimit: num(values.creditLimit),
      creditDays: num(values.creditDays),
      paymentTerms: values.paymentTerms,
      openingBalance: num(values.openingBalance),
      priceList: opt(values.priceList),
      assignedTo: opt(values.assignedTo),
      route: opt(values.route),
      warehouse: opt(values.warehouse),
      territory: values.territory,
      tags: values.tags
        ? values.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      notes: values.notes,
      isActive: values.isActive,
    };

    try {
      const res =
        mode === 'create'
          ? await api.post('/v1/customers', payload)
          : await api.patch(`/v1/customers/${initial.id}`, payload);
      toast.success(mode === 'create' ? 'Customer created' : 'Customer updated');
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
          title="Could not save the customer"
          message={formError}
          errors={serverErrors.filter((e) => !e.field || e.field === '_')}
          onClose={() => {
            setFormError('');
            setServerErrors([]);
          }}
        />
      )}

      <FormSection title="Identity" description="Name, type and the people you deal with">
        <Field label="Customer name" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Sharma General Store" />
        </Field>
        <Field label="Customer code" error={errors.code?.message} hint="Leave blank to auto-generate">
          <Input {...register('code')} error={!!errors.code} placeholder="CUS-00001" className="uppercase" />
        </Field>
        <Field label="Customer type" required error={errors.type?.message}>
          <Select {...register('type')} error={!!errors.type}>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contact person" error={errors.contactPerson?.message}>
          <Input {...register('contactPerson')} placeholder="Ramesh Sharma" />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input {...register('phone')} placeholder="+91 98765 43210" />
        </Field>
        <Field label="Alternate phone" error={errors.alternatePhone?.message}>
          <Input {...register('alternatePhone')} placeholder="+91 98765 43211" />
        </Field>
        <Field label="Email" error={errors.email?.message} className="sm:col-span-2">
          <Input type="email" {...register('email')} error={!!errors.email} placeholder="store@example.com" />
        </Field>
      </FormSection>

      <FormSection title="Tax details" description="Used on invoices and GST reports">
        <Field label="GSTIN" error={errors.gstin?.message}>
          <Input {...register('gstin')} placeholder="27AAAAA0000A1Z5" className="uppercase" />
        </Field>
        <Field label="PAN" error={errors.pan?.message}>
          <Input {...register('pan')} placeholder="AAAAA0000A" className="uppercase" />
        </Field>
        <Field label="Other tax ID" error={errors.taxId?.message} className="sm:col-span-2">
          <Input {...register('taxId')} placeholder="Optional" />
        </Field>
      </FormSection>

      <FormSection title="Billing address">
        <AddressFields register={register} errors={errors} prefix="address" />
      </FormSection>

      <FormSection title="Shipping address" description="Leave blank to use the billing address">
        <AddressFields register={register} errors={errors} prefix="shippingAddress" />
      </FormSection>

      <FormSection title="Credit & pricing">
        <Field label="Credit limit" error={errors.creditLimit?.message} hint={`Currency: ${company?.currency || 'INR'}`}>
          <Input type="number" min="0" step="0.01" {...register('creditLimit')} placeholder="0.00" />
        </Field>
        <Field label="Credit days" error={errors.creditDays?.message}>
          <Input type="number" min="0" max="365" {...register('creditDays')} placeholder="0" />
        </Field>
        <Field label="Payment terms" error={errors.paymentTerms?.message}>
          <Select {...register('paymentTerms')}>
            {PAYMENT_TERMS.map((t) => (
              <option key={t} value={t}>
                {t === 'IMMEDIATE' ? 'Immediate' : t.replace('NET_', 'Net ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Opening balance" error={errors.openingBalance?.message}>
          <Input type="number" min="0" step="0.01" {...register('openingBalance')} placeholder="0.00" />
        </Field>
        <Field label="Price list" error={errors.priceList?.message}>
          <Select {...register('priceList')}>
            <option value="">Use product selling price</option>
            {lookups.priceLists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.isDefault ? '(default)' : ''}
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
      </FormSection>

      <FormSection title="Route & territory">
        <Field label="Route / beat" error={errors.route?.message}>
          <Select {...register('route')}>
            <option value="">No route</option>
            {lookups.routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.code})
              </option>
            ))}
          </Select>
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
        <Field label="Territory" error={errors.territory?.message}>
          <Input {...register('territory')} placeholder="Pune East" />
        </Field>
        <Field label="Tags" error={errors.tags?.message} hint="Comma separated">
          <Input {...register('tags')} placeholder="key account, festive" />
        </Field>
      </FormSection>

      <FormSection title="Notes">
        <Field label="Internal notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register('notes')} placeholder="Delivery instructions, preferences…" />
        </Field>
        <Checkbox
          label="Active customer"
          description="Inactive customers stay in reports but cannot be selected on new orders."
          className="sm:col-span-2"
          {...register('isActive')}
        />
      </FormSection>

      <FormActions
        onCancel={onClose}
        loading={isSubmitting}
        submitLabel={mode === 'create' ? 'Create customer' : 'Save changes'}
      />
    </form>
  );
}

const idOf = (value) => (value && typeof value === 'object' ? value.name || value.code : value);

export default function Customers() {
  const { company } = useAuth();

  const columns = [
    {
      key: 'name',
      header: 'Customer',
      sortable: 'name',
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-xs font-bold text-brand-600 dark:text-brand-300">
            {(row.name || '?').slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.code} · {row.type}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (row) => (
        <div className="text-sm">
          <p>{row.contactPerson || row.phone || '—'}</p>
          <p className="text-xs text-muted-foreground">{row.phone || row.email || '—'}</p>
        </div>
      ),
    },
    {
      key: 'territory',
      header: 'Route / territory',
      render: (row) => (
        <div className="text-sm">
          <p>{idOf(row.route) || '—'}</p>
          <p className="text-xs text-muted-foreground">{row.territory || idOf(row.assignedTo) || '—'}</p>
        </div>
      ),
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      sortable: 'outstanding',
      className: 'text-right',
      render: (row) => (
        <div className="text-right">
          <p className="font-medium">{formatMoney(row.outstanding, company?.currency || 'INR')}</p>
          <p className="text-xs text-muted-foreground">
            Limit {formatMoney(row.creditLimit, company?.currency || 'INR')}
          </p>
        </div>
      ),
    },
    {
      key: 'orders',
      header: 'Orders',
      className: 'text-right',
      render: (row) => (
        <div className="text-right text-sm">
          <p className="font-medium">{formatNumber(row.totalOrders || 0)}</p>
          <p className="text-xs text-muted-foreground">lifetime</p>
        </div>
      ),
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
    <>
      <Select
        aria-label="Filter by customer type"
        className="h-9 w-auto min-w-[9rem]"
        value={values.type || ''}
        onChange={(e) => setParam({ type: e.target.value || undefined, page: 1 })}
      >
        <option value="">All types</option>
        {CUSTOMER_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.charAt(0) + t.slice(1).toLowerCase()}
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
      title="Customers"
      description="Outlets, distributors and dealers you sell to"
      breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Customers' }]}
      queryKey={['company', 'customers']}
      endpoint="/v1/customers"
      permissionPrefix="customers"
      columns={columns}
      filterKeys={['type', 'isActive']}
      filters={filters}
      searchPlaceholder="Search by name, code, phone, email or GSTIN…"
      createLabel="Add customer"
      createIcon={Users}
      emptyTitle="No customers yet"
      emptyDescription="Add your first customer to start booking orders."
      formTitle={(mode) => (mode === 'create' ? 'Add customer' : 'Edit customer')}
      formDescription="Credit limits and references are tenant-scoped."
      formSize="xl"
      renderForm={(props) => <CustomerForm {...props} />}
      deleteMessage={(row) =>
        row
          ? `“${row.name}” will be removed. Customers with transactions cannot be deleted — mark them inactive instead.`
          : ''
      }
    />
  );
}
