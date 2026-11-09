import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Plus, Tags, Trash2 } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import { FormActions, FormSection, dateInput, num, numInput, todayInput } from '@/components/company/form-utils';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { useLookups } from '@/hooks/useLookups';
import { formatMoney, formatDate } from '@/utils/format';

const TYPES = ['RETAIL', 'WHOLESALE', 'DISTRIBUTOR', 'CUSTOM'];

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const amount = z
  .string()
  .trim()
  .regex(/^\d*\.?\d*$/, 'Enter a valid amount')
  .optional()
  .or(z.literal(''));

const itemSchema = z.object({
  product: z.string().min(1, 'Select a product'),
  price: z
    .string()
    .trim()
    .min(1, 'Enter a price')
    .regex(/^\d*\.?\d+$/, 'Enter a valid price'),
  discountPercent: amount,
  minQty: amount,
});

// `keepFrom`: an existing list's start date, which may stay even once past.
const makeSchema = (keepFrom = '') => z.object({
  name: z.string().trim().min(2, 'Price list name is required').max(120),
  description: text(500),
  type: z.enum(TYPES),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  validFrom: text(40),
  validTo: text(40),
  notes: text(500),
  items: z.array(itemSchema).max(5000),
}).superRefine((v, ctx) => {
  if (v.validFrom && v.validFrom !== keepFrom && v.validFrom < todayInput()) {
    ctx.addIssue({ code: 'custom', path: ['validFrom'], message: 'Valid from cannot be a past date' });
  }
  if (v.validFrom && v.validTo && v.validTo < v.validFrom) {
    ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Valid to cannot be before valid from' });
  }
});

const toDefaults = (initial) => ({
  name: initial?.name || '',
  description: initial?.description || '',
  type: initial?.type || 'RETAIL',
  isDefault: initial?.isDefault ?? false,
  isActive: initial?.isActive ?? true,
  validFrom: dateInput(initial?.validFrom),
  validTo: dateInput(initial?.validTo),
  notes: initial?.notes || '',
  items: (initial?.items || []).map((item) => ({
    product: item.product?.id || item.product?._id || item.product || '',
    price: numInput(item.price),
    discountPercent: numInput(item.discountPercent),
    minQty: numInput(item.minQty),
  })),
});

function PriceListForm({ mode, initial, onClose, onSaved }) {
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { lookups } = useLookups();
  const { company } = useAuth();
  const keepFrom = dateInput(initial?.validFrom);
  const today = todayInput();

  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(makeSchema(keepFrom)),
    defaultValues: toDefaults(initial),
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const addItem = () => append({ product: '', price: '', discountPercent: '', minQty: '' });

  const pickProduct = (index, productId) => {
    const product = lookups.products.find((p) => p.id === productId);
    if (product && product.sellingPrice != null) {
      setValue(`items.${index}.price`, String(product.sellingPrice), { shouldValidate: true });
    }
  };

  /**
   * Registering the product <select> with a plain onChange would replace RHF's
   * own handler, leaving the field unregistered ("Select a product" forever).
   * Compose both so RHF gets the value and we can auto-fill the list price.
   */
  const registerProduct = (index) => {
    const field = register(`items.${index}.product`);
    return {
      ...field,
      onChange: (event) => {
        field.onChange(event);
        pickProduct(index, event.target.value);
      },
    };
  };

  const onSubmit = async (values) => {
    setFormError('');
    setServerErrors([]);

    const payload = {
      name: values.name,
      description: values.description,
      type: values.type,
      isDefault: values.isDefault,
      isActive: values.isActive,
      validFrom: values.validFrom || '',
      validTo: values.validTo || '',
      notes: values.notes,
      items: values.items.map((item) => ({
        product: item.product,
        price: num(item.price),
        discountPercent: num(item.discountPercent),
        minQty: num(item.minQty),
      })),
    };

    try {
      const res =
        mode === 'create'
          ? await api.post('/v1/price-lists', payload)
          : await api.patch(`/v1/price-lists/${initial.id}`, payload);
      toast.success(mode === 'create' ? 'Price list created' : 'Price list updated');
      onSaved(res.data?.data);
    } catch (err) {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([field, message]) => {
        setError(field.replace(/\[(\d+)\]/g, '.$1'), { type: 'server', message });
      });
    }
  };

  const itemError = (index, key) => errors.items?.[index]?.[key]?.message;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {(formError || serverErrors.length > 0) && (
        <ErrorAlert
          title="Could not save the price list"
          message={formError}
          errors={serverErrors.filter((e) => !e.field || e.field === '_')}
          onClose={() => {
            setFormError('');
            setServerErrors([]);
          }}
        />
      )}

      <FormSection title="Price list details">
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Retail price list 2026" />
        </Field>
        <Field
          label="Code"
          hint={mode === 'create' ? 'Given automatically when the price list is created.' : 'Set by the system; it cannot be changed.'}
        >
          <Input value={mode === 'create' ? 'Auto (PL-…)' : initial?.code || '—'} readOnly disabled />
        </Field>
        <Field label="Type" error={errors.type?.message}>
          <Select {...register('type')}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency" hint="Your company's currency.">
          <Input value={(mode === 'create' ? company?.currency : initial?.currency || company?.currency) || 'INR'} readOnly disabled />
        </Field>
        <Field label="Valid from" error={errors.validFrom?.message} hint="Today or a later date.">
          <Input type="date" min={keepFrom && keepFrom < today ? keepFrom : today} {...register('validFrom')} />
        </Field>
        <Field label="Valid to" error={errors.validTo?.message}>
          <Input type="date" min={watch('validFrom') || undefined} {...register('validTo')} />
        </Field>
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Input {...register('description')} placeholder="Applies to all retail counters" />
        </Field>
        <Checkbox
          label="Default price list"
          description="New customers without a price list fall back to this one."
          className="sm:col-span-2"
          {...register('isDefault')}
        />
      </FormSection>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Products & pricing</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Override the product selling price for this schedule.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="h-4 w-4" /> Add product
          </Button>
        </div>

        {fields.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No products yet. Add a product to set a list price.
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div key={field.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-12">
                <Field
                  label="Product"
                  required
                  error={itemError(index, 'product')}
                  className="sm:col-span-5"
                >
                  <Select
                    {...registerProduct(index)}
                    error={!!itemError(index, 'product')}
                  >
                    <option value="">Select a product</option>
                    {lookups.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.sku ? ` (${p.sku})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Price" required error={itemError(index, 'price')} className="sm:col-span-3">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    {...register(`items.${index}.price`)}
                    error={!!itemError(index, 'price')}
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Discount %" error={itemError(index, 'discountPercent')} className="sm:col-span-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    {...register(`items.${index}.discountPercent`)}
                    placeholder="0"
                  />
                </Field>
                <Field label="Min qty" error={itemError(index, 'minQty')} className="sm:col-span-1">
                  <Input type="number" min="0" step="1" {...register(`items.${index}.minQty`)} placeholder="1" />
                </Field>
                <div className="flex items-end pb-1 sm:col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(index)}
                    aria-label={`Remove product ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {errors.items?.message && <p className="text-xs text-destructive">{errors.items.message}</p>}
      </section>

      <FormSection title="Notes">
        <Field label="Internal notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register('notes')} placeholder="When to apply this price list…" />
        </Field>
        <Checkbox
          label="Active price list"
          description="Inactive lists stay on existing customers but are hidden from new assignments."
          className="sm:col-span-2"
          {...register('isActive')}
        />
      </FormSection>

      <FormActions
        onCancel={onClose}
        loading={isSubmitting}
        submitLabel={mode === 'create' ? 'Create price list' : 'Save changes'}
      />
    </form>
  );
}

export default function PriceLists() {
  const { company } = useAuth();
  const currency = company?.currency || 'INR';

  const columns = [
    {
      key: 'name',
      header: 'Price list',
      sortable: 'name',
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
            <Tags className="h-4 w-4" />
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
      key: 'items',
      header: 'Products',
      className: 'text-right',
      render: (row) => (
        <div className="text-right text-sm">
          <p className="font-medium">{row.items?.length || 0}</p>
          <p className="text-xs text-muted-foreground">priced</p>
        </div>
      ),
    },
    {
      key: 'validity',
      header: 'Validity',
      render: (row) => (
        <div className="text-sm">
          <p>{row.validFrom ? formatDate(row.validFrom) : 'No start date'}</p>
          <p className="text-xs text-muted-foreground">
            {row.validTo ? `Until ${formatDate(row.validTo)}` : 'Open ended'}
          </p>
        </div>
      ),
    },
    {
      key: 'range',
      header: 'Price range',
      className: 'text-right',
      render: (row) => {
        const prices = (row.items || []).map((i) => Number(i.price || 0));
        if (!prices.length) return <span className="text-sm text-muted-foreground">—</span>;
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        return (
          <div className="text-right text-sm">
            <p className="font-medium">
              {min === max
                ? formatMoney(min, row.currency || currency)
                : `${formatMoney(min, row.currency || currency)} – ${formatMoney(max, row.currency || currency)}`}
            </p>
            <p className="text-xs text-muted-foreground">{row.currency || currency}</p>
          </div>
        );
      },
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
        aria-label="Filter by price list type"
        className="h-9 w-auto min-w-[9rem]"
        value={values.type || ''}
        onChange={(e) => setParam({ type: e.target.value || undefined, page: 1 })}
      >
        <option value="">All types</option>
        {TYPES.map((t) => (
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
      title="Price Lists"
      description="Named pricing schedules assigned to customers"
      breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Price Lists' }]}
      queryKey={['company', 'price-lists']}
      endpoint="/v1/price-lists"
      permissionPrefix="products"
      columns={columns}
      filterKeys={['type', 'isActive']}
      filters={filters}
      searchPlaceholder="Search by name, code or description…"
      createLabel="Add price list"
      createIcon={Tags}
      emptyTitle="No price lists yet"
      emptyDescription="Create a price list to price products differently for retail, wholesale or distributors."
      formTitle={(mode) => (mode === 'create' ? 'Add price list' : 'Edit price list')}
      formDescription="Products must already exist in your catalogue."
      formSize="xl"
      renderForm={(props) => <PriceListForm {...props} />}
      deleteMessage={(row) =>
        row
          ? `“${row.name}” will be removed. Customers assigned to it will fall back to the default price list.`
          : ''
      }
    />
  );
}
