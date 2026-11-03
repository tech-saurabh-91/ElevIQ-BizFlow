import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Upload, Users } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import CustomerImport from '@/components/company/CustomerImport';
import { useAuthStore } from '@/store/authStore';
import { AddressFields, FormActions, FormSection, num, numInput, opt } from '@/components/company/form-utils';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { useLookups } from '@/hooks/useLookups';
import { usePermissions } from '@/hooks/usePermissions';
import { formatMoney, formatNumber } from '@/utils/format';
import { useTaxLabels } from '@/hooks/useLocations';

const CUSTOMER_TYPES = ['RETAIL', 'WHOLESALE', 'DISTRIBUTOR', 'DEALER'];
const PAYMENT_TERMS = ['IMMEDIATE', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'CUSTOM'];
const termLabel = (t) => (t === 'IMMEDIATE' ? 'Immediate' : t === 'CUSTOM' ? 'Custom' : t.replace('NET_', 'Net ') + ' days');
const termDays = (t) => (t === 'IMMEDIATE' ? 0 : /^NET_(\d+)$/.test(t) ? Number(t.slice(4)) : null);

// Mirrors server/src/services/customerService.js
const PHONE = /^\+?\d[\d\s-]{5,18}\d$/;
const GSTIN_IN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_IN = /^[A-Z]{5}\d{4}[A-Z]$/;
const digitsOf = (v) => String(v || '').replace(/\D/g, '');

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const amount = z
  .string()
  .trim()
  .regex(/^\d{0,12}(\.\d{0,2})?$/, 'Enter an amount with up to 2 decimals')
  .optional()
  .or(z.literal(''));
const address = z.object({
  line1: text(160),
  line2: text(160),
  city: text(80),
  state: text(80),
  pincode: text(12),
  country: text(80),
});

const buildSchema = (isIndia) =>
  z
    .object({
      name: z.string().trim().min(2, 'Customer name is required').max(160),
      type: z.enum(CUSTOMER_TYPES),
      contactPerson: text(120),
      phone: z.string().trim().min(1, 'Phone is required').regex(PHONE, 'Enter a valid phone number'),
      alternatePhone: z.string().trim().regex(PHONE, 'Enter a valid phone number').optional().or(z.literal('')),
      email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
      gstin: text(30),
      pan: text(20),
      taxId: text(40),
      address,
      shippingSameAsBilling: z.boolean(),
      shippingAddress: address,
      creditLimit: amount,
      creditDays: z.string().trim().regex(/^\d{0,3}$/, 'Whole days only').optional().or(z.literal('')),
      paymentTerms: z.enum(PAYMENT_TERMS),
      openingBalance: amount,
      priceList: text(40),
      assignedTo: text(40),
      warehouse: text(40),
      tags: text(400),
      notes: text(1000),
      isActive: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const need = (path, message) => ctx.addIssue({ code: 'custom', path, message });
      ['country', 'state', 'city'].forEach((k) => {
        if (!v.address[k]) need(['address', k], `${k.charAt(0).toUpperCase() + k.slice(1)} is required`);
        if (!v.shippingSameAsBilling && !v.shippingAddress[k]) {
          need(['shippingAddress', k], `${k.charAt(0).toUpperCase() + k.slice(1)} is required`);
        }
      });
      const d = digitsOf(v.phone).length;
      if (v.phone && (d < 7 || d > 15)) need(['phone'], 'Phone must have 7-15 digits');
      if (v.alternatePhone && digitsOf(v.alternatePhone) === digitsOf(v.phone)) {
        need(['alternatePhone'], 'Alternate phone must differ from the phone');
      }
      if (isIndia) {
        const gstin = v.gstin.toUpperCase();
        if (gstin && !GSTIN_IN.test(gstin)) need(['gstin'], 'GSTIN must be 15 characters, e.g. 27AAAAA0000A1Z5');
        if (v.pan && !PAN_IN.test(v.pan.toUpperCase())) need(['pan'], 'PAN must look like AAAAA0000A');
        if (gstin && v.pan && GSTIN_IN.test(gstin) && gstin.slice(2, 12) !== v.pan.toUpperCase()) {
          need(['pan'], 'PAN does not match the GSTIN');
        }
      }
      const days = Number(v.creditDays || 0);
      if (days > 365) need(['creditDays'], 'At most 365 days');
      if (v.paymentTerms === 'CUSTOM' && !(days > 0)) need(['creditDays'], 'Enter the credit days for custom terms');
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
  type: initial?.type || 'RETAIL',
  contactPerson: initial?.contactPerson || '',
  phone: initial?.phone || '',
  alternatePhone: initial?.alternatePhone || '',
  email: initial?.email || '',

  gstin: initial?.gstin || '',
  pan: initial?.pan || '',
  taxId: initial?.taxId || '',

  address: { ...emptyAddress(), ...(initial?.address || {}) },
  shippingSameAsBilling: initial ? initial.shippingSameAsBilling !== false : true,
  shippingAddress: { ...emptyAddress(), ...(initial?.shippingAddress || {}) },

  creditLimit: numInput(initial?.creditLimit),
  creditDays: numInput(initial?.creditDays),
  paymentTerms: initial?.paymentTerms || 'IMMEDIATE',
  openingBalance: numInput(initial?.openingBalance),

  priceList: initial?.priceList?.id || initial?.priceList || '',
  assignedTo: initial?.assignedTo?.id || initial?.assignedTo || '',
  warehouse: initial?.warehouse?.id || initial?.warehouse || '',

  tags: (initial?.tags || []).join(', '),
  notes: initial?.notes || '',
  isActive: initial?.isActive ?? true,
});

// Keep only what a field may contain while typing.
const onlyAmount = (e) => {
  e.target.value = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
};
const onlyDigits = (e) => {
  e.target.value = e.target.value.replace(/\D/g, '');
};
const onlyPhone = (e) => {
  e.target.value = e.target.value.replace(/[^\d+\s-]/g, '');
};

function CustomerForm({ mode, initial, onClose, onSaved }) {
  const { taxIdLabel, country } = useTaxLabels();
  const isIndia = country?.code === 'IN';
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { lookups } = useLookups();
  const { company } = useAuth();
  const viewOnly = mode === 'view';
  // Rough client hint; the server makes the final call.
  const balanceLocked = mode !== 'create' && Number(initial?.totalOrders || 0) > 0;
  const schema = useMemo(() => buildSchema(isIndia), [isIndia]);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: toDefaults(initial),
  });

  const sameAsBilling = watch('shippingSameAsBilling');
  const terms = watch('paymentTerms');
  const termsField = register('paymentTerms');

  const onSubmit = async (values) => {
    setFormError('');
    setServerErrors([]);

    const payload = {
      name: values.name,
      type: values.type,
      contactPerson: values.contactPerson,
      phone: values.phone,
      alternatePhone: values.alternatePhone,
      email: values.email,
      gstin: values.gstin.toUpperCase(),
      pan: values.pan.toUpperCase(),
      taxId: values.taxId,
      address: values.address,
      shippingSameAsBilling: values.shippingSameAsBilling,
      shippingAddress: values.shippingSameAsBilling ? values.address : values.shippingAddress,
      creditLimit: num(values.creditLimit),
      creditDays: num(values.creditDays),
      paymentTerms: values.paymentTerms,
      ...(balanceLocked ? {} : { openingBalance: num(values.openingBalance) }),
      priceList: opt(values.priceList),
      assignedTo: opt(values.assignedTo),
      warehouse: opt(values.warehouse),
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
      toast.success(mode === 'create' ? `Customer ${res.data?.data?.code || ''} created` : 'Customer updated');
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

  const fillPanFromGstin = (e) => {
    const gstin = e.target.value.trim().toUpperCase();
    if (isIndia && GSTIN_IN.test(gstin) && !watch('pan')) setValue('pan', gstin.slice(2, 12), { shouldDirty: true });
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

      {/* A disabled fieldset makes the whole form read-only in view mode. */}
      <fieldset disabled={viewOnly} className="space-y-6">
        {mode !== 'create' && (
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Customer code</p>
              <p className="font-mono font-semibold">{initial?.code}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="font-semibold">{formatMoney(initial?.outstanding, company?.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Orders</p>
              <p className="font-semibold">{formatNumber(initial?.totalOrders || 0)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Route / beat</p>
              <p className="font-semibold">{initial?.route?.name || '—'}</p>
            </div>
          </div>
        )}

        <FormSection title="Identity" description="Who the customer is">
          <Field label="Customer name" required error={errors.name?.message}>
            <Input {...register('name')} error={!!errors.name} placeholder="Sharma General Store" />
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
          {mode === 'create' && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              The customer code is generated automatically when you save and cannot be changed later.
            </p>
          )}
        </FormSection>

        <FormSection title="Contact">
          <Field label="Contact person" error={errors.contactPerson?.message}>
            <Input {...register('contactPerson')} placeholder="Ramesh Sharma" />
          </Field>
          <Field label="Phone" required error={errors.phone?.message}>
            <Input
              type="tel"
              inputMode="tel"
              {...register('phone')}
              onInput={onlyPhone}
              error={!!errors.phone}
              placeholder="+91 98765 43210"
            />
          </Field>
          <Field label="Alternate phone" error={errors.alternatePhone?.message}>
            <Input
              type="tel"
              inputMode="tel"
              {...register('alternatePhone')}
              onInput={onlyPhone}
              error={!!errors.alternatePhone}
              placeholder="+91 98765 43211"
            />
          </Field>
          <Field label="Email" error={errors.email?.message}>
            <Input type="email" {...register('email')} error={!!errors.email} placeholder="store@example.com" />
          </Field>
        </FormSection>

        <FormSection title="Tax details" description="Printed on invoices">
          <Field label={taxIdLabel} error={errors.gstin?.message} hint={isIndia ? '15 characters; the first 2 are the state code' : undefined}>
            <Input
              {...register('gstin', { onBlur: fillPanFromGstin })}
              error={!!errors.gstin}
              maxLength={isIndia ? 15 : 30}
              placeholder={isIndia ? '27AAAAA0000A1Z5' : ''}
              className="uppercase"
            />
          </Field>
          {isIndia ? (
            <Field label="PAN" error={errors.pan?.message} hint="Filled from the GSTIN">
              <Input {...register('pan')} error={!!errors.pan} maxLength={10} placeholder="AAAAA0000A" className="uppercase" />
            </Field>
          ) : (
            <Field label="Other tax ID" error={errors.taxId?.message}>
              <Input {...register('taxId')} placeholder="Optional" />
            </Field>
          )}
        </FormSection>

        <FormSection title="Billing address">
          <AddressFields register={register} watch={watch} setValue={setValue} errors={errors} prefix="address" disabled={viewOnly} />
        </FormSection>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Shipping address</h3>
            <Checkbox label="Same as billing address" {...register('shippingSameAsBilling')} />
          </div>
          {sameAsBilling ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Goods are delivered to the billing address.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <AddressFields
                register={register}
                watch={watch}
                setValue={setValue}
                errors={errors}
                prefix="shippingAddress"
                disabled={viewOnly}
              />
            </div>
          )}
        </section>

        <FormSection title="Credit & payment">
          <Field label="Payment terms" error={errors.paymentTerms?.message}>
            <Select
              {...termsField}
              onChange={(e) => {
                termsField.onChange(e);
                const days = termDays(e.target.value);
                if (days !== null) setValue('creditDays', String(days), { shouldValidate: true });
              }}
            >
              {PAYMENT_TERMS.map((t) => (
                <option key={t} value={t}>
                  {termLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Credit days"
            error={errors.creditDays?.message}
            hint={terms === 'CUSTOM' ? '1-365 days' : 'Set by the payment terms'}
          >
            <Input
              inputMode="numeric"
              {...register('creditDays')}
              onInput={onlyDigits}
              readOnly={terms !== 'CUSTOM'}
              className={terms !== 'CUSTOM' ? 'bg-muted/50' : ''}
              placeholder="0"
            />
          </Field>
          <Field label="Credit limit" error={errors.creditLimit?.message} hint={`In ${company?.currency || 'INR'}; 0 = no limit`}>
            <Input inputMode="decimal" {...register('creditLimit')} onInput={onlyAmount} placeholder="0.00" />
          </Field>
          <Field
            label="Opening balance"
            error={errors.openingBalance?.message}
            hint={balanceLocked ? '🔒 Locked: the customer already has transactions' : 'Amount the customer owes you today'}
          >
            <Input
              inputMode="decimal"
              {...register('openingBalance')}
              onInput={onlyAmount}
              readOnly={balanceLocked}
              className={balanceLocked ? 'bg-muted/50' : ''}
              placeholder="0.00"
            />
          </Field>
        </FormSection>

        <FormSection title="Sales defaults" description="Pre-filled on this customer's orders">
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
          <Field label="Dispatch warehouse" error={errors.warehouse?.message}>
            <Select {...register('warehouse')}>
              <option value="">Default warehouse</option>
              {lookups.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </Select>
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
      </fieldset>

      {viewOnly ? (
        <div className="flex justify-end border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <FormActions
          onCancel={onClose}
          loading={isSubmitting}
          submitLabel={mode === 'create' ? 'Create customer' : 'Save changes'}
        />
      )}
    </form>
  );
}

export default function Customers() {
  const { taxIdLabel } = useTaxLabels();
  const { company } = useAuth();
  const { can } = usePermissions();
  const [importing, setImporting] = useState(false);

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
      key: 'city',
      header: 'City / salesman',
      render: (row) => (
        <div className="text-sm">
          <p>{[row.address?.city, row.address?.state].filter(Boolean).join(', ') || '—'}</p>
          <p className="text-xs text-muted-foreground">{row.assignedTo?.name || 'Unassigned'}</p>
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
          <p className="font-medium">{formatMoney(row.outstanding, company?.currency)}</p>
          <p className="text-xs text-muted-foreground">Limit {formatMoney(row.creditLimit, company?.currency)}</p>
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
      render: (row) => <Badge tone={row.isActive ? 'success' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</Badge>,
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
    <>
      <ResourcePage
        title="Customers"
        description="Outlets, distributors and dealers you sell to"
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Customers' }]}
        queryKey={['company', 'customers']}
        endpoint="/v1/customers"
        permissionPrefix="customers"
        viewable
        columns={columns}
        filterKeys={['type', 'isActive']}
        filters={filters}
        searchPlaceholder={`Search by name, code, phone, email or ${taxIdLabel}…`}
        createLabel="Add customer"
        createIcon={Users}
        headerActions={
          can('customers.create') ? (
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" /> Import
            </Button>
          ) : null
        }
        emptyTitle="No customers yet"
        emptyDescription="Add your first customer, or import many at once from Excel."
        formTitle={(mode) => ({ create: 'Add customer', edit: 'Edit customer', view: 'Customer details' })[mode]}
        formSize="xl"
        renderForm={(props) => <CustomerForm {...props} />}
        deleteMessage={(row) =>
          row
            ? `“${row.name}” will be removed. Customers with transactions cannot be deleted — mark them inactive instead.`
            : ''
        }
      />
      <CustomerImport open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
