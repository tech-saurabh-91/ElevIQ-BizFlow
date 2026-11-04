import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { Package, Plus, Trash2, Upload } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import BulkImport from '@/components/company/BulkImport';
import { FormActions, FormSection, num, numInput, opt } from '@/components/company/form-utils';
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
import { useAuthStore } from '@/store/authStore';
import { stockLabel } from '@/utils/units';

// Mirrors server/src/services/catalogService.js
const BARCODE = /^(\d{8}|\d{12,14})$/;
const HSN_IN = /^(\d{4}|\d{6}|\d{8})$/;
const GST_RATES_IN = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const amount = z
  .string()
  .trim()
  .regex(/^\d{0,12}(\.\d{0,2})?$/, 'Enter an amount with up to 2 decimals')
  .optional()
  .or(z.literal(''));
const quantity = z
  .string()
  .trim()
  .regex(/^\d{0,9}(\.\d{0,3})?$/, 'Enter a number')
  .optional()
  .or(z.literal(''));
const n = (v) => Number(v || 0);

const buildSchema = ({ isIndia, units, creating, hasWarehouses }) =>
  z
    .object({
      name: z.string().trim().min(2, 'Product name is required').max(180),
      customCode: text(40),
      barcode: z.string().trim().regex(/^(\d{8}|\d{12,14})?$/, 'Barcode must be 8, 12, 13 or 14 digits').optional().or(z.literal('')),
      brand: text(80),
      classificationId: text(40),
      categoryId: z.string().min(1, 'Choose a category'),
      subCategoryId: text(40),

      unit: z.string().min(1, 'Choose the base unit'),
      packUnits: z.array(
        z.object({
          unit: z.string().min(1, 'Choose a unit'),
          factor: quantity,
          price: amount,
          barcode: z.string().trim().regex(/^(\d{8}|\d{12,14})?$/, '8, 12, 13 or 14 digits').optional().or(z.literal('')),
        })
      ),

      hsnCode: text(20),
      gstRate: z.string().trim().regex(/^\d{0,3}(\.\d{0,2})?$/, 'Enter a rate').optional().or(z.literal('')),

      mrp: amount,
      sellingPrice: amount,
      dealerPrice: amount,
      purchasePrice: amount,

      openingStock: quantity,
      openingWarehouse: text(40),
      lowStockLevel: quantity,

      description: text(1000),
      tags: text(400),
      isReturnable: z.boolean(),
      isActive: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
      const base = units.find((u) => u.code === v.unit);
      const whole = base && !base.allowDecimals;
      const isWhole = (x) => Math.abs(x - Math.round(x)) < 1e-9;

      const seen = new Set([v.unit]);
      v.packUnits.forEach((p, i) => {
        if (p.unit === v.unit) issue(['packUnits', i, 'unit'], 'A pack cannot be the base unit');
        else if (seen.has(p.unit)) issue(['packUnits', i, 'unit'], `${p.unit} is listed twice`);
        seen.add(p.unit);
        if (!(n(p.factor) > 1)) issue(['packUnits', i, 'factor'], `How many ${v.unit} in one pack? More than 1`);
        else if (whole && !isWhole(n(p.factor))) issue(['packUnits', i, 'factor'], `${v.unit} is counted in whole numbers`);
        if (n(v.mrp) > 0 && n(p.price) > n(v.mrp) * n(p.factor)) issue(['packUnits', i, 'price'], 'More than MRP x contains');
      });
      const codes = [v.barcode, ...v.packUnits.map((p) => p.barcode)].filter(Boolean);
      if (new Set(codes).size !== codes.length) issue(['barcode'], 'The same barcode is used twice');

      if (n(v.mrp) > 0 && n(v.sellingPrice) > n(v.mrp)) issue(['sellingPrice'], 'Cannot be more than the MRP');
      if (n(v.mrp) > 0 && n(v.dealerPrice) > n(v.mrp)) issue(['dealerPrice'], 'Cannot be more than the MRP');
      if (n(v.gstRate) > 100) issue(['gstRate'], 'At most 100%');
      if (isIndia) {
        if (v.hsnCode && !HSN_IN.test(v.hsnCode)) issue(['hsnCode'], 'HSN/SAC must be 4, 6 or 8 digits');
        if (v.gstRate !== '' && !GST_RATES_IN.includes(n(v.gstRate))) issue(['gstRate'], 'Not a GST slab');
      }
      if (whole && v.lowStockLevel && !isWhole(n(v.lowStockLevel))) issue(['lowStockLevel'], `${v.unit} is counted in whole numbers`);
      if (creating) {
        if (whole && v.openingStock && !isWhole(n(v.openingStock))) issue(['openingStock'], `${v.unit} is counted in whole numbers`);
        if (n(v.openingStock) > 0 && hasWarehouses && !v.openingWarehouse) {
          issue(['openingWarehouse'], 'Choose the warehouse that holds it');
        }
      }
    });

const idOf = (v) => (v && typeof v === 'object' ? v.id || v._id : v) || '';

const toDefaults = (initial) => ({
  name: initial?.name || '',
  customCode: initial?.customCode || '',
  barcode: initial?.barcode || '',
  brand: initial?.brand || '',
  classificationId: idOf(initial?.classificationId),
  categoryId: idOf(initial?.categoryId),
  subCategoryId: idOf(initial?.subCategoryId),

  unit: initial?.unit || 'PCS',
  packUnits: (initial?.packUnits || []).map((p) => ({
    unit: p.unit,
    factor: String(p.factor ?? ''),
    price: p.price ? String(p.price) : '',
    barcode: p.barcode || '',
  })),

  hsnCode: initial?.hsnCode || '',
  // New products start on the company's default tax rate.
  gstRate: numInput(initial?.gstRate, String(useAuthStore.getState().settings?.tax?.defaultTaxRate ?? 18)),

  mrp: numInput(initial?.mrp),
  sellingPrice: numInput(initial?.sellingPrice),
  dealerPrice: numInput(initial?.dealerPrice),
  purchasePrice: numInput(initial?.purchasePrice),

  openingStock: '',
  openingWarehouse: '',
  lowStockLevel: numInput(initial?.lowStockLevel, '10'),

  description: initial?.description || '',
  tags: (initial?.tags || []).join(', '),
  isReturnable: initial?.isReturnable ?? true,
  isActive: initial?.isActive ?? true,
});

// Keep only what a numeric field may contain while typing.
const onlyNumber = (e) => {
  e.target.value = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
};
const onlyDigits = (e) => {
  e.target.value = e.target.value.replace(/\D/g, '');
};

const useCatalog = () => {
  const groups = useQuery({
    queryKey: ['company', 'product-categories'],
    queryFn: async () => (await api.get('/v1/product-categories')).data?.data || [],
    staleTime: 60000,
  });
  const units = useQuery({
    queryKey: ['company', 'units'],
    queryFn: async () => (await api.get('/v1/units')).data?.data || [],
    staleTime: 60000,
  });
  return { groups: groups.data || [], units: units.data || [] };
};

function ProductForm({ mode, initial, onClose, onSaved }) {
  const { taxLabel, country } = useTaxLabels();
  const isIndia = country?.code === 'IN';
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { lookups } = useLookups();
  const { company } = useAuth();
  const { groups, units } = useCatalog();
  const viewOnly = mode === 'view';
  const creating = mode === 'create';
  // Opening stock sits in a main or sub warehouse; vans are loaded by transfer.
  const warehouses = (lookups.warehouses || []).filter((w) => ['MAIN', 'SUB'].includes(w.type || 'MAIN'));

  const schema = useMemo(
    () => buildSchema({ isIndia, units, creating, hasWarehouses: warehouses.length > 0 }),
    [isIndia, units, creating, warehouses.length]
  );
  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toDefaults(initial) });
  const packs = useFieldArray({ control, name: 'packUnits' });

  const classificationId = watch('classificationId');
  const categoryId = watch('categoryId');
  const baseUnit = watch('unit');
  const inStock = !creating && Number(initial?.stock || 0) !== 0;

  // Active entries plus whatever this product already uses (even if inactive).
  const pickable = (level, parent) =>
    groups.filter(
      (g) =>
        g.level === level &&
        (parent === undefined || g.parent === parent) &&
        (g.isActive || [classificationId, categoryId, watch('subCategoryId')].includes(g.id))
    );
  const classifications = pickable('CLASSIFICATION');
  const categories = classificationId ? pickable('CATEGORY', classificationId) : pickable('CATEGORY');
  const subCategories = categoryId ? pickable('SUBCATEGORY', categoryId) : [];
  const activeUnits = units.filter((u) => u.isActive || u.code === baseUnit || packs.fields.some((p) => p.unit === u.code));

  const onClassification = (e) => {
    setValue('classificationId', e.target.value, { shouldDirty: true });
    setValue('categoryId', '', { shouldDirty: true });
    setValue('subCategoryId', '', { shouldDirty: true });
  };
  const onCategory = (e) => {
    const id = e.target.value;
    setValue('categoryId', id, { shouldDirty: true, shouldValidate: Boolean(errors.categoryId) });
    setValue('subCategoryId', '', { shouldDirty: true });
    // Picking a category first fills in its classification.
    const cat = groups.find((g) => g.id === id);
    if (cat && !classificationId) setValue('classificationId', cat.parent, { shouldDirty: true });
  };

  const onSubmit = async (values) => {
    setFormError('');
    setServerErrors([]);
    const payload = {
      name: values.name,
      customCode: values.customCode,
      barcode: values.barcode,
      brand: values.brand,
      classificationId: opt(values.classificationId),
      categoryId: values.categoryId,
      subCategoryId: opt(values.subCategoryId) || '',
      unit: values.unit,
      packUnits: values.packUnits.map((p) => ({
        unit: p.unit,
        factor: num(p.factor),
        price: num(p.price) || 0,
        barcode: p.barcode,
      })),
      hsnCode: values.hsnCode,
      gstRate: num(values.gstRate),
      mrp: num(values.mrp),
      sellingPrice: num(values.sellingPrice),
      dealerPrice: num(values.dealerPrice),
      purchasePrice: num(values.purchasePrice),
      lowStockLevel: num(values.lowStockLevel),
      ...(creating
        ? { openingStock: num(values.openingStock) || 0, openingWarehouse: opt(values.openingWarehouse) }
        : {}),
      description: values.description,
      tags: values.tags
        ? values.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      isReturnable: values.isReturnable,
      isActive: values.isActive,
    };

    try {
      const res = creating
        ? await api.post('/v1/products', payload)
        : await api.patch(`/v1/products/${initial.id}`, payload);
      toast.success(creating ? `Product ${res.data?.data?.sku || ''} created` : 'Product updated');
      onSaved(res.data?.data);
    } catch (err) {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([field, message]) => setError(field, { type: 'server', message }));
    }
  };

  const currency = company?.currency;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {(formError || serverErrors.length > 0) && (
        <ErrorAlert
          title="Could not save the product"
          message={formError}
          errors={serverErrors.filter((e) => !e.field || e.field === '_')}
          onClose={() => {
            setFormError('');
            setServerErrors([]);
          }}
        />
      )}

      <fieldset disabled={viewOnly} className="space-y-6">
        {!creating && (
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Product code</p>
              <p className="font-mono font-semibold">{initial?.sku}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">In stock</p>
              <p className="font-semibold">{stockLabel(initial)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Category</p>
              <p className="truncate font-semibold">
                {[initial?.classification, initial?.category, initial?.subCategory].filter(Boolean).join(' › ') || '—'}
              </p>
            </div>
          </div>
        )}

        <FormSection title="Identity">
          <Field label="Product name" required error={errors.name?.message}>
            <Input {...register('name')} error={!!errors.name} placeholder="Parle-G Biscuit 100g" />
          </Field>
          <Field label="Your product code" error={errors.customCode?.message} hint="Optional: your own / old ERP code">
            <Input {...register('customCode')} error={!!errors.customCode} placeholder="PG-100" />
          </Field>
          <Field label="Barcode" error={errors.barcode?.message} hint="EAN/UPC of one base unit">
            <Input {...register('barcode')} onInput={onlyDigits} inputMode="numeric" maxLength={14} error={!!errors.barcode} />
          </Field>
          <Field label="Brand" error={errors.brand?.message}>
            <Input {...register('brand')} placeholder="Parle" />
          </Field>
          {creating && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              The product code is generated automatically when you save and cannot be changed later.
            </p>
          )}
        </FormSection>

        <FormSection
          title="Grouping"
          description={
            <>
              From the{' '}
              <Link to="/app/catalog" className="text-brand-600 hover:underline">
                Categories &amp; Units
              </Link>{' '}
              master
            </>
          }
        >
          <Field label="Classification" error={errors.classificationId?.message}>
            <Select value={classificationId} onChange={onClassification}>
              <option value="">All classifications</option>
              {classifications.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" required error={errors.categoryId?.message}>
            <Select value={categoryId} onChange={onCategory} error={!!errors.categoryId}>
              <option value="">Select category</option>
              {categories.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Sub-category"
            error={errors.subCategoryId?.message}
            hint={categoryId && !subCategories.length ? 'This category has no sub-categories' : undefined}
          >
            <Select {...register('subCategoryId')} disabled={!subCategories.length}>
              <option value="">None</option>
              {subCategories.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
        </FormSection>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Units &amp; packs</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Stock is counted in the base unit. Add packs to sell or buy in them, e.g. 1 PKT = 10 PCS.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Base unit"
              required
              error={errors.unit?.message}
              hint={inStock ? `🔒 Locked while ${initial.stock} ${initial.unit} are in stock` : 'The smallest unit you count'}
            >
              <Select {...register('unit')} disabled={inStock} error={!!errors.unit}>
                {activeUnits.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} · {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {packs.fields.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Pack unit</th>
                    <th className="px-2 py-2 font-medium">Contains ({baseUnit})</th>
                    <th className="px-2 py-2 font-medium">Pack price</th>
                    <th className="px-2 py-2 font-medium">Pack barcode</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {packs.fields.map((field, i) => {
                    const e = errors.packUnits?.[i] || {};
                    return (
                      <tr key={field.id} className="border-t align-top">
                        <td className="px-2 py-2">
                          <Select {...register(`packUnits.${i}.unit`)} error={!!e.unit} aria-label={`Pack ${i + 1} unit`}>
                            <option value="">Select</option>
                            {activeUnits
                              .filter((u) => u.code !== baseUnit)
                              .map((u) => (
                                <option key={u.code} value={u.code}>
                                  {u.code} · {u.name}
                                </option>
                              ))}
                          </Select>
                          {e.unit && <p className="mt-1 text-xs text-destructive">{e.unit.message}</p>}
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            inputMode="decimal"
                            {...register(`packUnits.${i}.factor`)}
                            onInput={onlyNumber}
                            error={!!e.factor}
                            placeholder="10"
                            aria-label={`Pack ${i + 1} contains`}
                          />
                          {e.factor && <p className="mt-1 text-xs text-destructive">{e.factor.message}</p>}
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            inputMode="decimal"
                            {...register(`packUnits.${i}.price`)}
                            onInput={onlyNumber}
                            error={!!e.price}
                            placeholder={
                              n(watch('sellingPrice')) && n(watch(`packUnits.${i}.factor`))
                                ? String(Math.round(n(watch('sellingPrice')) * n(watch(`packUnits.${i}.factor`)) * 100) / 100)
                                : 'Auto'
                            }
                            aria-label={`Pack ${i + 1} price`}
                          />
                          {e.price && <p className="mt-1 text-xs text-destructive">{e.price.message}</p>}
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            inputMode="numeric"
                            maxLength={14}
                            {...register(`packUnits.${i}.barcode`)}
                            onInput={onlyDigits}
                            error={!!e.barcode}
                            aria-label={`Pack ${i + 1} barcode`}
                          />
                          {e.barcode && <p className="mt-1 text-xs text-destructive">{e.barcode.message}</p>}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => packs.remove(i)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive focus-ring"
                            aria-label={`Remove pack ${i + 1}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                Blank pack price = selling price × contains. Price lists still price one {baseUnit}.
              </p>
            </div>
          )}
          {!viewOnly && packs.fields.length < 10 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => packs.append({ unit: '', factor: '', price: '', barcode: '' })}
            >
              <Plus className="h-4 w-4" /> Add pack unit
            </Button>
          )}
        </section>

        <FormSection title={`Pricing (per ${baseUnit || 'unit'})`} description={`In ${currency || 'INR'}`}>
          <Field label="MRP" error={errors.mrp?.message}>
            <Input inputMode="decimal" {...register('mrp')} onInput={onlyNumber} error={!!errors.mrp} placeholder="0.00" />
          </Field>
          <Field label="Selling price" error={errors.sellingPrice?.message} hint="Default price when no price list applies">
            <Input inputMode="decimal" {...register('sellingPrice')} onInput={onlyNumber} error={!!errors.sellingPrice} placeholder="0.00" />
          </Field>
          <Field label="Dealer price" error={errors.dealerPrice?.message}>
            <Input inputMode="decimal" {...register('dealerPrice')} onInput={onlyNumber} error={!!errors.dealerPrice} placeholder="0.00" />
          </Field>
          <Field label="Purchase price" error={errors.purchasePrice?.message} hint="Default rate on purchase orders">
            <Input inputMode="decimal" {...register('purchasePrice')} onInput={onlyNumber} error={!!errors.purchasePrice} placeholder="0.00" />
          </Field>
        </FormSection>

        <FormSection title="Tax">
          <Field label="HSN/SAC code" error={errors.hsnCode?.message} hint={isIndia ? '4, 6 or 8 digits' : undefined}>
            <Input
              {...register('hsnCode')}
              onInput={isIndia ? onlyDigits : undefined}
              inputMode={isIndia ? 'numeric' : 'text'}
              maxLength={isIndia ? 8 : 20}
              error={!!errors.hsnCode}
              placeholder={isIndia ? '1905' : ''}
            />
          </Field>
          <Field label={`${taxLabel} rate (%)`} error={errors.gstRate?.message}>
            {isIndia ? (
              <Select {...register('gstRate')} error={!!errors.gstRate}>
                {!GST_RATES_IN.includes(n(watch('gstRate'))) && watch('gstRate') !== '' && (
                  <option value={watch('gstRate')}>{watch('gstRate')}% (not a GST slab)</option>
                )}
                {GST_RATES_IN.map((r) => (
                  <option key={r} value={String(r)}>
                    {r}%
                  </option>
                ))}
              </Select>
            ) : (
              <Input inputMode="decimal" {...register('gstRate')} onInput={onlyNumber} error={!!errors.gstRate} />
            )}
          </Field>
        </FormSection>

        <FormSection title="Stock">
          {creating ? (
            <>
              <Field label={`Opening stock (${baseUnit})`} error={errors.openingStock?.message} hint="What you hold today; booked into inventory">
                <Input inputMode="decimal" {...register('openingStock')} onInput={onlyNumber} error={!!errors.openingStock} placeholder="0" />
              </Field>
              <Field label="Warehouse" error={errors.openingWarehouse?.message}>
                <Select {...register('openingWarehouse')} error={!!errors.openingWarehouse}>
                  <option value="">{warehouses.length ? 'Primary main warehouse' : 'No warehouses yet'}</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.code})
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Stock changes through orders, goods receipts and Inventory adjustments, not here.
            </p>
          )}
          <Field label={`Low stock alert (${baseUnit})`} error={errors.lowStockLevel?.message}>
            <Input inputMode="decimal" {...register('lowStockLevel')} onInput={onlyNumber} error={!!errors.lowStockLevel} />
          </Field>
        </FormSection>

        <FormSection title="Other">
          <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
            <Textarea {...register('description')} />
          </Field>
          <Field label="Tags" error={errors.tags?.message} hint="Comma separated">
            <Input {...register('tags')} placeholder="fast moving, festive" />
          </Field>
          <div className="space-y-2">
            <Checkbox label="Returnable" description="Customers may return it (credit notes)" {...register('isReturnable')} />
            <Checkbox label="Active product" description="Inactive products cannot be ordered" {...register('isActive')} />
          </div>
        </FormSection>
      </fieldset>

      {viewOnly ? (
        <div className="flex justify-end border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : (
        <FormActions onCancel={onClose} loading={isSubmitting} submitLabel={creating ? 'Create product' : 'Save changes'} />
      )}
    </form>
  );
}

export default function Products() {
  const { taxLabel } = useTaxLabels();
  const { company } = useAuth();
  const { can } = usePermissions();
  const { groups } = useCatalog();
  const [importing, setImporting] = useState(false);
  const categories = groups.filter((g) => g.level === 'CATEGORY');

  const columns = [
    {
      key: 'name',
      header: 'Product',
      sortable: 'name',
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
            <Package className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.sku}
              {row.customCode ? ` · ${row.customCode}` : ''}
              {row.brand ? ` · ${row.brand}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => (
        <div className="text-sm">
          <p>{row.category || '—'}</p>
          <p className="text-xs text-muted-foreground">{[row.classification, row.subCategory].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    {
      key: 'pricing',
      header: 'Pricing',
      sortable: 'sellingPrice',
      className: 'text-right',
      render: (row) => (
        <div className="text-right text-sm">
          <p className="font-medium">
            {formatMoney(row.sellingPrice, company?.currency)} <span className="text-xs text-muted-foreground">/ {row.unit}</span>
          </p>
          <p className="text-xs text-muted-foreground">MRP {formatMoney(row.mrp, company?.currency)}</p>
        </div>
      ),
    },
    {
      key: 'stock',
      header: 'Stock',
      sortable: 'stock',
      className: 'text-right',
      render: (row) => {
        const low = Number(row.stock || 0) <= Number(row.lowStockLevel || 0);
        return (
          <div className="text-right text-sm">
            <p className={low ? 'font-semibold text-warning' : 'font-medium'}>
              {formatNumber(row.stock || 0)} {row.unit}
            </p>
            {row.packUnits?.length > 0 && (
              <p className="text-xs text-muted-foreground">{row.packUnits.map((p) => `${p.unit} ×${p.factor}`).join(', ')}</p>
            )}
          </div>
        );
      },
    },
    {
      key: 'gst',
      header: taxLabel,
      className: 'text-right',
      render: (row) => <span className="text-sm">{formatNumber(row.gstRate || 0)}%</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={row.isActive ? 'success' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</Badge>
          {Number(row.stock || 0) <= Number(row.lowStockLevel || 0) && <Badge tone="warning">Low stock</Badge>}
        </div>
      ),
    },
  ];

  const filters = ({ values, setParam }) => (
    <>
      <Select
        aria-label="Filter by category"
        className="h-9 w-auto min-w-[10rem]"
        value={values.categoryId || ''}
        onChange={(e) => setParam({ categoryId: e.target.value || undefined, page: 1 })}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by stock level"
        className="h-9 w-auto min-w-[9rem]"
        value={values.lowStock || ''}
        onChange={(e) => setParam({ lowStock: e.target.value || undefined, page: 1 })}
      >
        <option value="">Any stock</option>
        <option value="true">Low stock only</option>
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
        title="Products"
        description="Your sellable catalogue, pack sizes, pricing and stock"
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Products' }]}
        queryKey={['company', 'products']}
        endpoint="/v1/products"
        permissionPrefix="products"
        viewable
        columns={columns}
        filterKeys={['categoryId', 'lowStock', 'isActive']}
        filters={filters}
        searchPlaceholder="Search by name, code, barcode, category or brand…"
        createLabel="Add product"
        createIcon={Package}
        headerActions={
          can('products.create') ? (
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" /> Import
            </Button>
          ) : null
        }
        emptyTitle="No products yet"
        emptyDescription="Add products one by one, or import many at once from Excel."
        formTitle={(mode) => ({ create: 'Add product', edit: 'Edit product', view: 'Product details' })[mode]}
        formSize="xl"
        renderForm={(props) => <ProductForm {...props} />}
        deleteMessage={(row) =>
          row
            ? `“${row.name}” will be removed from the catalogue. Existing price lists that reference it may need updating.`
            : ''
        }
      />
      <BulkImport
        open={importing}
        onClose={() => setImporting(false)}
        endpoint="/v1/products"
        noun="products"
        invalidate={[['company', 'products']]}
        hint="Dropdowns list your categories, units, warehouses and tax rates."
      />
    </>
  );
}
