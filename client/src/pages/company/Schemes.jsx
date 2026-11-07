import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Gift, Plus, Trash2 } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import { FormActions, FormSection, dateInput, opt, todayInput } from '@/components/company/form-utils';
import { ScopeFields, customerScopeText, productScopeText, scopeDefaults, scopeIssues, scopePayload } from '@/components/company/pricing-shared';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { useLookups } from '@/hooks/useLookups';
import { formatDate } from '@/utils/format';

/**
 * Trade schemes, applied automatically on orders and direct invoices:
 * buy X get Y free, quantity slab discounts and bill value slab discounts.
 */

export const SCHEME_TYPE_LABEL = {
  FREE_GOODS: 'Buy X get Y free',
  QTY_DISCOUNT: 'Quantity slab discount',
  VALUE_DISCOUNT: 'Value slab discount',
};

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const numText = (msg) => z.string().trim().regex(/^\d*\.?\d*$/, msg).optional().or(z.literal(''));

const schema = z
  .object({
    name: z.string().trim().min(2, 'Scheme name is required').max(120),
    code: text(24),
    description: text(500),
    type: z.enum(['FREE_GOODS', 'QTY_DISCOUNT', 'VALUE_DISCOUNT']),
    customerScope: z.enum(['ALL', 'CUSTOMER_TYPE', 'CUSTOMER']),
    customers: z.array(z.string()),
    customerTypes: z.array(z.string()),
    productScope: z.enum(['ALL', 'CATEGORY', 'BRAND', 'PRODUCT']),
    products: z.array(z.string()),
    categories: z.array(z.string()),
    brands: z.array(z.string()),
    buyQty: numText('Enter a valid quantity'),
    freeQty: numText('Enter a valid quantity'),
    freeProduct: text(40),
    repeat: z.boolean(),
    slabs: z.array(z.object({ from: numText('Enter a valid number'), discountPercent: numText('Enter a valid %') })),
    validFrom: z.string().trim().min(1, 'Choose the start date'),
    validTo: text(40),
    isActive: z.boolean(),
    notes: text(500),
  })
  .superRefine((v, ctx) => {
    scopeIssues(v, ctx);
    if (v.type === 'FREE_GOODS') {
      if (!(Number(v.buyQty) > 0)) ctx.addIssue({ code: 'custom', path: ['buyQty'], message: 'Enter the quantity to buy' });
      if (!(Number(v.freeQty) > 0)) ctx.addIssue({ code: 'custom', path: ['freeQty'], message: 'Enter the free quantity' });
      return;
    }
    if (!v.slabs.length) ctx.addIssue({ code: 'custom', path: ['slabs'], message: 'Add at least one slab' });
    const seen = new Set();
    v.slabs.forEach((s, i) => {
      if (s.from === '' || Number.isNaN(Number(s.from))) ctx.addIssue({ code: 'custom', path: ['slabs', i, 'from'], message: 'Enter where the slab starts' });
      else if (seen.has(Number(s.from))) ctx.addIssue({ code: 'custom', path: ['slabs', i, 'from'], message: 'Two slabs start here' });
      seen.add(Number(s.from));
      const pct = Number(s.discountPercent);
      if (!(pct > 0 && pct <= 100)) ctx.addIssue({ code: 'custom', path: ['slabs', i, 'discountPercent'], message: 'Between 0 and 100%' });
    });
  });

const toDefaults = (initial) => ({
  name: initial?.name || '',
  code: initial?.code || '',
  description: initial?.description || '',
  type: initial?.type || 'FREE_GOODS',
  ...scopeDefaults(initial, 'PRODUCT'),
  buyQty: initial?.buyQty ? String(initial.buyQty) : '',
  freeQty: initial?.freeQty ? String(initial.freeQty) : '',
  freeProduct: String(initial?.freeProduct?.id || initial?.freeProduct?._id || initial?.freeProduct || ''),
  repeat: initial?.repeat ?? true,
  slabs: (initial?.slabs || []).map((s) => ({ from: String(s.from), discountPercent: String(s.discountPercent) })),
  validFrom: dateInput(initial?.validFrom) || todayInput(),
  validTo: dateInput(initial?.validTo),
  isActive: initial?.isActive ?? true,
  notes: initial?.notes || '',
});

function SchemeForm({ mode, initial, onClose, onSaved }) {
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { lookups } = useLookups();
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toDefaults(initial) });
  const { fields, append, remove } = useFieldArray({ control, name: 'slabs' });
  const type = watch('type');
  const freeGoods = type === 'FREE_GOODS';
  const valueSlabs = type === 'VALUE_DISCOUNT';

  const onSubmit = async (v) => {
    setFormError('');
    setServerErrors([]);
    const payload = {
      name: v.name,
      code: opt(v.code),
      description: v.description,
      type: v.type,
      ...scopePayload(v),
      ...(freeGoods
        ? { buyQty: Number(v.buyQty), freeQty: Number(v.freeQty), freeProduct: v.freeProduct || null, repeat: v.repeat }
        : { slabs: v.slabs.map((s) => ({ from: Number(s.from), discountPercent: Number(s.discountPercent) })) }),
      validFrom: v.validFrom,
      validTo: v.validTo || '',
      isActive: v.isActive,
      notes: v.notes,
    };
    try {
      const res = mode === 'create' ? await api.post('/v1/schemes', payload) : await api.patch(`/v1/schemes/${initial.id}`, payload);
      toast.success(mode === 'create' ? 'Scheme created' : 'Scheme updated');
      onSaved(res.data?.data);
    } catch (err) {
      const info = apiError(err);
      const fieldErrors = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fieldErrors).length ? '' : info.message);
      Object.entries(fieldErrors).forEach(([field, message]) => setError(field.replace(/\[(\d+)\]/g, '.$1'), { type: 'server', message }));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {(formError || serverErrors.length > 0) && (
        <ErrorAlert
          title="Could not save the scheme"
          message={formError}
          errors={serverErrors.filter((e) => !e.field || e.field === '_')}
          onClose={() => {
            setFormError('');
            setServerErrors([]);
          }}
        />
      )}
      <FormSection title="Scheme">
        <Field label="Name" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Diwali - Soap 10+1" />
        </Field>
        <Field label="Scheme type" required error={errors.type?.message}>
          <Select {...register('type')}>
            {Object.entries(SCHEME_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Code" error={errors.code?.message} hint="Leave blank to auto-generate">
          <Input {...register('code')} placeholder="SCH-0001" className="uppercase" />
        </Field>
        <Field label="Description" error={errors.description?.message}>
          <Input {...register('description')} placeholder="Shown to salesmen in the order screen" />
        </Field>
      </FormSection>

      <FormSection title="Applies to" description="A line gets the best one discount scheme and the best one free-goods scheme.">
        <ScopeFields register={register} watch={watch} setValue={setValue} errors={errors} lookups={lookups} productLabel="Products to buy" />
      </FormSection>

      {freeGoods ? (
        <FormSection title="Free goods" description="Counted per product, in its base unit (e.g. PCS). The free goods are added to the order as a zero-priced line.">
          <Field label="Buy quantity" required error={errors.buyQty?.message}>
            <Input inputMode="decimal" {...register('buyQty')} error={!!errors.buyQty} placeholder="10" />
          </Field>
          <Field label="Free quantity" required error={errors.freeQty?.message}>
            <Input inputMode="decimal" {...register('freeQty')} error={!!errors.freeQty} placeholder="1" />
          </Field>
          <Field label="Free product" error={errors.freeProduct?.message} hint="Blank = the same product the customer buys">
            <Select {...register('freeProduct')}>
              <option value="">Same product</option>
              {(lookups.products || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.sku ? ` (${p.sku})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox label="Repeat for every multiple" description="On: buying 25 with 10+1 gives 2 free. Off: 1 free once the 10 is reached." {...register('repeat')} />
        </FormSection>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Slabs</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {valueSlabs
                  ? 'Value of the covered products on the bill (before discount). The highest slab reached applies to all covered lines.'
                  : 'Quantity of one product on the bill, in its base unit. The highest slab reached applies to that line.'}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => append({ from: '', discountPercent: '' })}>
              <Plus className="h-4 w-4" /> Add slab
            </Button>
          </div>
          {fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-12 items-start gap-3">
              <Field label={valueSlabs ? 'Value from' : 'Quantity from'} error={errors.slabs?.[i]?.from?.message} className="col-span-5">
                <Input inputMode="decimal" {...register(`slabs.${i}.from`)} error={!!errors.slabs?.[i]?.from} placeholder={valueSlabs ? '5000' : '50'} />
              </Field>
              <Field label="Discount %" error={errors.slabs?.[i]?.discountPercent?.message} className="col-span-5">
                <Input inputMode="decimal" {...register(`slabs.${i}.discountPercent`)} error={!!errors.slabs?.[i]?.discountPercent} placeholder="2" />
              </Field>
              <div className="col-span-2 pt-7">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(i)} aria-label={`Remove slab ${i + 1}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          {(errors.slabs?.message || errors.slabs?.root?.message) && <p className="text-xs text-destructive">{errors.slabs.message || errors.slabs.root.message}</p>}
        </section>
      )}

      <FormSection title="Validity">
        <Field label="Valid from" required error={errors.validFrom?.message}>
          <Input type="date" {...register('validFrom')} error={!!errors.validFrom} />
        </Field>
        <Field label="Valid to" error={errors.validTo?.message} hint="Blank = open ended">
          <Input type="date" min={watch('validFrom') || undefined} {...register('validTo')} />
        </Field>
        <Field label="Notes" error={errors.notes?.message} className="sm:col-span-2">
          <Textarea {...register('notes')} placeholder="Internal notes…" />
        </Field>
        <Checkbox label="Active" description="Inactive schemes are not applied on new orders or invoices." className="sm:col-span-2" {...register('isActive')} />
      </FormSection>
      <FormActions onCancel={onClose} loading={isSubmitting} submitLabel={mode === 'create' ? 'Create scheme' : 'Save changes'} />
    </form>
  );
}

const liveState = (row) => {
  if (!row.isActive) return { tone: 'muted', label: 'Inactive' };
  const today = todayInput();
  if (row.validFrom && dateInput(row.validFrom) > today) return { tone: 'info', label: 'Upcoming' };
  if (row.validTo && dateInput(row.validTo) < today) return { tone: 'muted', label: 'Expired' };
  return { tone: 'success', label: 'Running' };
};

export default function Schemes() {
  const columns = [
    {
      key: 'name',
      header: 'Scheme',
      sortable: 'name',
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
            <Gift className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.code} · {SCHEME_TYPE_LABEL[row.type]}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'summary', header: 'Offer', render: (row) => <span className="text-sm">{row.summary}</span> },
    {
      key: 'scope',
      header: 'Applies to',
      render: (row) => (
        <div className="text-sm">
          <p>{productScopeText(row)}</p>
          <p className="text-xs text-muted-foreground">{customerScopeText(row)}</p>
        </div>
      ),
    },
    {
      key: 'validity',
      header: 'Validity',
      sortable: 'validFrom',
      render: (row) => (
        <div className="text-sm">
          <p>{formatDate(row.validFrom)}</p>
          <p className="text-xs text-muted-foreground">{row.validTo ? `Until ${formatDate(row.validTo)}` : 'Open ended'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const s = liveState(row);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
  ];

  const filters = ({ values, setParam }) => (
    <>
      <Select aria-label="Filter by scheme type" className="h-9 w-auto min-w-[10rem]" value={values.type || ''} onChange={(e) => setParam({ type: e.target.value || undefined, page: 1 })}>
        <option value="">All types</option>
        {Object.entries(SCHEME_TYPE_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
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
      title="Schemes"
      description="Trade schemes applied automatically on orders and invoices: buy X get Y free, quantity and value slabs"
      breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Schemes' }]}
      queryKey={['company', 'schemes']}
      endpoint="/v1/schemes"
      permissionPrefix="schemes"
      columns={columns}
      filterKeys={['type', 'isActive']}
      filters={filters}
      searchPlaceholder="Search by name or code…"
      createLabel="Add scheme"
      createIcon={Gift}
      emptyTitle="No schemes yet"
      emptyDescription="Add a scheme such as buy 10 get 1 free, or 2% off above 50 units."
      formTitle={(mode) => (mode === 'create' ? 'Add scheme' : 'Edit scheme')}
      formDescription="Applied by the server when an order or direct invoice is saved. Saved documents keep the scheme they got."
      formSize="xl"
      renderForm={(props) => <SchemeForm {...props} />}
      deleteMessage={(row) => (row ? `“${row.name}” will no longer be applied. Saved orders and invoices keep their free goods and discounts.` : '')}
    />
  );
}
