import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Truck } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import { AddressFields, FormActions, FormSection, num, numInput, opt } from '@/components/company/form-utils';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { formatMoney } from '@/utils/format';

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

const bankShape = z.object({
  accountName: text(120),
  accountNumber: text(40),
  ifsc: text(16),
  bankName: text(120),
  branch: text(120),
  upiVpa: text(80),
});

const schema = z.object({
  name: z.string().trim().min(2, 'Supplier name is required').max(160),
  code: text(24),
  contactPerson: text(120),
  phone: text(20),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  website: text(200),

  gstin: text(20),
  pan: text(12),

  address: addressShape,
  bank: bankShape,

  paymentTerms: z.enum(PAYMENT_TERMS),
  creditDays: whole,
  openingBalance: amount,

  categories: text(400),
  notes: text(1000),
  isActive: z.boolean(),
});

const emptyAddress = { line1: '', line2: '', city: '', state: '', pincode: '', country: 'India' };
const emptyBank = { accountName: '', accountNumber: '', ifsc: '', bankName: '', branch: '', upiVpa: '' };

const toDefaults = (initial) => ({
  name: initial?.name || '',
  code: initial?.code || '',
  contactPerson: initial?.contactPerson || '',
  phone: initial?.phone || '',
  email: initial?.email || '',
  website: initial?.website || '',

  gstin: initial?.gstin || '',
  pan: initial?.pan || '',

  address: { ...emptyAddress, ...(initial?.address || {}) },
  bank: { ...emptyBank, ...(initial?.bank || {}) },

  paymentTerms: initial?.paymentTerms || 'IMMEDIATE',
  creditDays: numInput(initial?.creditDays),
  openingBalance: numInput(initial?.openingBalance),

  categories: (initial?.categories || []).join(', '),
  notes: initial?.notes || '',
  isActive: initial?.isActive ?? true,
});

function SupplierForm({ mode, initial, onClose, onSaved }) {
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { company } = useAuth();

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
      code: opt(values.code),
      contactPerson: values.contactPerson,
      phone: values.phone,
      email: values.email,
      website: values.website,
      gstin: values.gstin,
      pan: values.pan,
      address: values.address,
      bank: values.bank,
      paymentTerms: values.paymentTerms,
      creditDays: num(values.creditDays),
      openingBalance: num(values.openingBalance),
      categories: values.categories
        ? values.categories
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean)
        : [],
      notes: values.notes,
      isActive: values.isActive,
    };

    try {
      const res =
        mode === 'create'
          ? await api.post('/v1/suppliers', payload)
          : await api.patch(`/v1/suppliers/${initial.id}`, payload);
      toast.success(mode === 'create' ? 'Supplier created' : 'Supplier updated');
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
          title="Could not save the supplier"
          message={formError}
          errors={serverErrors.filter((e) => !e.field || e.field === '_')}
          onClose={() => {
            setFormError('');
            setServerErrors([]);
          }}
        />
      )}

      <FormSection title="Supplier details">
        <Field label="Supplier name" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Acme Distributors" />
        </Field>
        <Field label="Supplier code" error={errors.code?.message} hint="Leave blank to auto-generate">
          <Input {...register('code')} placeholder="SUP-00001" className="uppercase" />
        </Field>
        <Field label="Contact person" error={errors.contactPerson?.message}>
          <Input {...register('contactPerson')} placeholder="Vikram Rao" />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input {...register('phone')} placeholder="+91 98765 43210" />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" {...register('email')} error={!!errors.email} placeholder="accounts@acme.test" />
        </Field>
        <Field label="Website" error={errors.website?.message}>
          <Input {...register('website')} placeholder="https://acme.test" />
        </Field>
        <Field label="GSTIN" error={errors.gstin?.message}>
          <Input {...register('gstin')} placeholder="27AAAAA0000A1Z5" className="uppercase" />
        </Field>
        <Field label="PAN" error={errors.pan?.message}>
          <Input {...register('pan')} placeholder="AAAAA0000A" className="uppercase" />
        </Field>
      </FormSection>

      <FormSection title="Address">
        <AddressFields register={register} errors={errors} prefix="address" />
      </FormSection>

      <FormSection title="Bank details" description="Printed on purchase orders and used for payouts">
        <Field label="Account name" error={errors.bank?.accountName?.message}>
          <Input {...register('bank.accountName')} placeholder="Acme Distributors Pvt Ltd" />
        </Field>
        <Field label="Account number" error={errors.bank?.accountNumber?.message}>
          <Input {...register('bank.accountNumber')} placeholder="000123456789" />
        </Field>
        <Field label="IFSC" error={errors.bank?.ifsc?.message}>
          <Input {...register('bank.ifsc')} placeholder="HDFC0001234" className="uppercase" />
        </Field>
        <Field label="Bank name" error={errors.bank?.bankName?.message}>
          <Input {...register('bank.bankName')} placeholder="HDFC Bank" />
        </Field>
        <Field label="Branch" error={errors.bank?.branch?.message}>
          <Input {...register('bank.branch')} placeholder="Baner, Pune" />
        </Field>
        <Field label="UPI VPA" error={errors.bank?.upiVpa?.message}>
          <Input {...register('bank.upiVpa')} placeholder="acme@upi" />
        </Field>
      </FormSection>

      <FormSection title="Commercials">
        <Field label="Payment terms" error={errors.paymentTerms?.message}>
          <Select {...register('paymentTerms')}>
            {PAYMENT_TERMS.map((t) => (
              <option key={t} value={t}>
                {t === 'IMMEDIATE' ? 'Immediate' : t.replace('NET_', 'Net ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Credit days" error={errors.creditDays?.message}>
          <Input type="number" min="0" max="365" {...register('creditDays')} placeholder="0" />
        </Field>
        <Field label="Opening balance" error={errors.openingBalance?.message} hint={`Currency: ${company?.currency || 'INR'}`}>
          <Input type="number" min="0" step="0.01" {...register('openingBalance')} placeholder="0.00" />
        </Field>
        <Field label="Categories" error={errors.categories?.message} hint="Comma separated">
          <Input {...register('categories')} placeholder="grocery, staples" />
        </Field>
      </FormSection>

      <FormSection title="Notes">
        <Field label="Internal notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register('notes')} placeholder="Lead time, delivery preferences…" />
        </Field>
        <Checkbox
          label="Active supplier"
          description="Inactive suppliers cannot be used on new purchase orders."
          className="sm:col-span-2"
          {...register('isActive')}
        />
      </FormSection>

      <FormActions
        onCancel={onClose}
        loading={isSubmitting}
        submitLabel={mode === 'create' ? 'Create supplier' : 'Save changes'}
      />
    </form>
  );
}

export default function Suppliers() {
  const { company } = useAuth();

  const columns = [
    {
      key: 'name',
      header: 'Supplier',
      sortable: 'name',
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
            <Truck className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.code}</p>
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
      key: 'gstin',
      header: 'GSTIN',
      render: (row) => <span className="text-sm">{row.gstin || '—'}</span>,
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
            Terms {row.paymentTerms === 'IMMEDIATE' ? 'immediate' : String(row.paymentTerms || '').replace('NET_', 'net ')}
          </p>
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
      title="Suppliers"
      description="Vendors and distributors you purchase from"
      breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Suppliers' }]}
      queryKey={['company', 'suppliers']}
      endpoint="/v1/suppliers"
      permissionPrefix="products"
      columns={columns}
      filterKeys={['isActive']}
      filters={filters}
      searchPlaceholder="Search by name, code, phone, email or GSTIN…"
      createLabel="Add supplier"
      createIcon={Truck}
      emptyTitle="No suppliers yet"
      emptyDescription="Add suppliers to track purchases and payables."
      formTitle={(mode) => (mode === 'create' ? 'Add supplier' : 'Edit supplier')}
      formDescription="Bank details and payment terms are tenant-scoped."
      formSize="xl"
      renderForm={(props) => <SupplierForm {...props} />}
    />
  );
}
