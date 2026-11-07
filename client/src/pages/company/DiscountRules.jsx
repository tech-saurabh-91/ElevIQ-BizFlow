import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Percent } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import { FormActions, FormSection, dateInput, opt } from '@/components/company/form-utils';
import { ScopeFields, customerScopeText, productScopeText, scopeDefaults, scopeIssues, scopePayload } from '@/components/company/pricing-shared';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { useLookups } from '@/hooks/useLookups';
import { formatDate } from '@/utils/format';

/**
 * Discount master: standing trade discounts by customer and product. On a
 * sale line the most specific rule wins (a named customer beats a customer
 * type beats everyone; a named product beats its brand or category beats all
 * products); a matching rule replaces the price list's discount.
 */

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));

const schema = z
  .object({
    name: z.string().trim().min(2, 'Discount name is required').max(120),
    code: text(24),
    description: text(500),
    discountPercent: z
      .string()
      .trim()
      .min(1, 'Enter the discount')
      .regex(/^\d*\.?\d+$/, 'Enter a valid number')
      .refine((v) => Number(v) > 0 && Number(v) <= 100, 'Between 0 and 100%'),
    customerScope: z.enum(['ALL', 'CUSTOMER_TYPE', 'CUSTOMER']),
    customers: z.array(z.string()),
    customerTypes: z.array(z.string()),
    productScope: z.enum(['ALL', 'CATEGORY', 'BRAND', 'PRODUCT']),
    products: z.array(z.string()),
    categories: z.array(z.string()),
    brands: z.array(z.string()),
    validFrom: text(40),
    validTo: text(40),
    isActive: z.boolean(),
    notes: text(500),
  })
  .superRefine(scopeIssues);

const toDefaults = (initial) => ({
  name: initial?.name || '',
  code: initial?.code || '',
  description: initial?.description || '',
  discountPercent: initial?.discountPercent != null ? String(initial.discountPercent) : '',
  ...scopeDefaults(initial, 'ALL'),
  validFrom: dateInput(initial?.validFrom),
  validTo: dateInput(initial?.validTo),
  isActive: initial?.isActive ?? true,
  notes: initial?.notes || '',
});

function DiscountForm({ mode, initial, onClose, onSaved }) {
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { lookups } = useLookups();
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toDefaults(initial) });

  const onSubmit = async (v) => {
    setFormError('');
    setServerErrors([]);
    const payload = {
      name: v.name,
      code: opt(v.code),
      description: v.description,
      discountPercent: Number(v.discountPercent),
      ...scopePayload(v),
      validFrom: v.validFrom || '',
      validTo: v.validTo || '',
      isActive: v.isActive,
      notes: v.notes,
    };
    try {
      const res = mode === 'create' ? await api.post('/v1/discounts', payload) : await api.patch(`/v1/discounts/${initial.id}`, payload);
      toast.success(mode === 'create' ? 'Discount created' : 'Discount updated');
      onSaved(res.data?.data);
    } catch (err) {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([field, message]) => setError(field, { type: 'server', message }));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {(formError || serverErrors.length > 0) && (
        <ErrorAlert
          title="Could not save the discount"
          message={formError}
          errors={serverErrors.filter((e) => !e.field || e.field === '_')}
          onClose={() => {
            setFormError('');
            setServerErrors([]);
          }}
        />
      )}
      <FormSection title="Discount">
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Distributors - 5% on soaps" />
        </Field>
        <Field label="Discount %" required error={errors.discountPercent?.message}>
          <Input inputMode="decimal" {...register('discountPercent')} error={!!errors.discountPercent} placeholder="5" />
        </Field>
        <Field label="Code" error={errors.code?.message} hint="Leave blank to auto-generate">
          <Input {...register('code')} placeholder="DR-0001" className="uppercase" />
        </Field>
        <Field label="Description" error={errors.description?.message}>
          <Input {...register('description')} placeholder="Agreed in the 2026 trade terms" />
        </Field>
      </FormSection>
      <FormSection title="Applies to" description="The most specific rule wins on each line: a named customer over a customer type, a named product over its brand or category.">
        <ScopeFields register={register} watch={watch} setValue={setValue} errors={errors} lookups={lookups} />
      </FormSection>
      <FormSection title="Validity">
        <Field label="Valid from" error={errors.validFrom?.message} hint="Blank = from today">
          <Input type="date" {...register('validFrom')} />
        </Field>
        <Field label="Valid to" error={errors.validTo?.message} hint="Blank = open ended">
          <Input type="date" min={watch('validFrom') || undefined} {...register('validTo')} />
        </Field>
        <Field label="Notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register('notes')} placeholder="Internal notes…" />
        </Field>
        <Checkbox label="Active" description="Inactive discounts are not applied on new orders or invoices." className="sm:col-span-2" {...register('isActive')} />
      </FormSection>
      <FormActions onCancel={onClose} loading={isSubmitting} submitLabel={mode === 'create' ? 'Create discount' : 'Save changes'} />
    </form>
  );
}

export default function DiscountRules() {
  const columns = [
    {
      key: 'name',
      header: 'Discount',
      sortable: 'name',
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
            <Percent className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'discountPercent',
      header: 'Discount',
      sortable: 'discountPercent',
      className: 'text-right',
      render: (row) => <span className="font-medium tabular-nums">{row.discountPercent}%</span>,
    },
    {
      key: 'scope',
      header: 'Applies to',
      render: (row) => (
        <div className="text-sm">
          <p>{customerScopeText(row)}</p>
          <p className="text-xs text-muted-foreground">{productScopeText(row)}</p>
        </div>
      ),
    },
    {
      key: 'validity',
      header: 'Validity',
      render: (row) => (
        <div className="text-sm">
          <p>{row.validFrom ? formatDate(row.validFrom) : 'Any date'}</p>
          <p className="text-xs text-muted-foreground">{row.validTo ? `Until ${formatDate(row.validTo)}` : 'Open ended'}</p>
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
      <Select aria-label="Filter by customers" className="h-9 w-auto min-w-[9rem]" value={values.customerScope || ''} onChange={(e) => setParam({ customerScope: e.target.value || undefined, page: 1 })}>
        <option value="">All customer scopes</option>
        <option value="ALL">All customers</option>
        <option value="CUSTOMER_TYPE">Customer types</option>
        <option value="CUSTOMER">Selected customers</option>
      </Select>
      <Select aria-label="Filter by status" className="h-9 w-auto min-w-[8rem]" value={values.isActive || ''} onChange={(e) => setParam({ isActive: e.target.value || undefined, page: 1 })}>
        <option value="">All statuses</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </Select>
    </>
  );

  return (
    <ResourcePage
      title="Discounts"
      description="Standing trade discounts by customer and product, applied automatically on orders and invoices"
      breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Discounts' }]}
      queryKey={['company', 'discounts']}
      endpoint="/v1/discounts"
      permissionPrefix="discounts"
      columns={columns}
      filterKeys={['customerScope', 'isActive']}
      filters={filters}
      searchPlaceholder="Search by name or code…"
      createLabel="Add discount"
      createIcon={Percent}
      emptyTitle="No discounts yet"
      emptyDescription="Add a discount such as 5% for distributors on a category, or 3% for one shop on all items."
      formTitle={(mode) => (mode === 'create' ? 'Add discount' : 'Edit discount')}
      formDescription="Applied by the server when an order or invoice is saved. Users with the pricing override permission can still type a discount by hand."
      formSize="xl"
      renderForm={(props) => <DiscountForm {...props} />}
      deleteMessage={(row) => (row ? `“${row.name}” will no longer be applied. Saved orders and invoices keep their discounts.` : '')}
    />
  );
}
