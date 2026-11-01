import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Package } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import { FormActions, FormSection, num, numInput, opt } from '@/components/company/form-utils';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { useLookups } from '@/hooks/useLookups';
import { formatMoney, formatNumber } from '@/utils/format';

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const amount = z
  .string()
  .trim()
  .regex(/^\d*\.?\d*$/, 'Enter a valid amount')
  .optional()
  .or(z.literal(''));
const numeric = z
  .string()
  .trim()
  .regex(/^\d*\.?\d*$/, 'Enter a valid number')
  .optional()
  .or(z.literal(''));

const schema = z.object({
  name: z.string().trim().min(2, 'Product name is required').max(180),
  sku: text(40),
  barcode: text(60),
  category: text(80),
  subCategory: text(80),
  brand: text(80),

  unit: text(16),
  unitType: z.enum(['BASE', 'ALT']),
  altUnit: text(16),
  conversion: numeric,

  hsnCode: text(20),
  gstRate: numeric,

  mrp: amount,
  sellingPrice: amount,
  dealerPrice: amount,
  purchasePrice: amount,

  openingStock: numeric,
  stock: numeric,
  lowStockLevel: numeric,

  description: text(1000),
  tags: text(400),

  isBatchTracked: z.boolean(),
  isReturnable: z.boolean(),
  isActive: z.boolean(),
});

const toDefaults = (initial) => ({
  name: initial?.name || '',
  sku: initial?.sku || '',
  barcode: initial?.barcode || '',
  category: initial?.category || '',
  subCategory: initial?.subCategory || '',
  brand: initial?.brand || '',

  unit: initial?.unit || 'PCS',
  unitType: initial?.unitType || 'BASE',
  altUnit: initial?.altUnit || '',
  conversion: numInput(initial?.conversion),

  hsnCode: initial?.hsnCode || '',
  gstRate: numInput(initial?.gstRate, '18'),

  mrp: numInput(initial?.mrp),
  sellingPrice: numInput(initial?.sellingPrice),
  dealerPrice: numInput(initial?.dealerPrice),
  purchasePrice: numInput(initial?.purchasePrice),

  openingStock: numInput(initial?.openingStock),
  stock: numInput(initial?.stock),
  lowStockLevel: numInput(initial?.lowStockLevel, '10'),

  description: initial?.description || '',
  tags: (initial?.tags || []).join(', '),

  isBatchTracked: initial?.isBatchTracked ?? false,
  isReturnable: initial?.isReturnable ?? true,
  isActive: initial?.isActive ?? true,
});

function ProductForm({ mode, initial, onClose, onSaved }) {
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { lookups } = useLookups();
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
      sku: opt(values.sku),
      barcode: values.barcode,
      category: values.category,
      subCategory: values.subCategory,
      brand: values.brand,

      unit: values.unit,
      unitType: values.unitType,
      altUnit: values.altUnit,
      conversion: num(values.conversion),

      hsnCode: values.hsnCode,
      gstRate: num(values.gstRate),

      mrp: num(values.mrp),
      sellingPrice: num(values.sellingPrice),
      dealerPrice: num(values.dealerPrice),
      purchasePrice: num(values.purchasePrice),

      openingStock: num(values.openingStock),
      stock: num(values.stock),
      lowStockLevel: num(values.lowStockLevel),

      description: values.description,
      tags: values.tags
        ? values.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [],

      isBatchTracked: values.isBatchTracked,
      isReturnable: values.isReturnable,
      isActive: values.isActive,
    };

    try {
      const res =
        mode === 'create'
          ? await api.post('/v1/products', payload)
          : await api.patch(`/v1/products/${initial.id}`, payload);
      toast.success(mode === 'create' ? 'Product created' : 'Product updated');
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
          title="Could not save the product"
          message={formError}
          errors={serverErrors.filter((e) => !e.field || e.field === '_')}
          onClose={() => {
            setFormError('');
            setServerErrors([]);
          }}
        />
      )}

      <FormSection title="Product details">
        <Field label="Product name" required error={errors.name?.message} className="sm:col-span-2">
          <Input {...register('name')} error={!!errors.name} placeholder="Basmati Rice 5kg" />
        </Field>
        <Field label="SKU" error={errors.sku?.message} hint="Leave blank to auto-generate">
          <Input {...register('sku')} error={!!errors.sku} placeholder="PRD-00001" className="uppercase" />
        </Field>
        <Field label="Barcode" error={errors.barcode?.message}>
          <Input {...register('barcode')} placeholder="8901234567890" />
        </Field>
        <Field label="Category" error={errors.category?.message} hint="Defaults to General">
          <Input {...register('category')} list="product-categories" placeholder="Grocery" />
        </Field>
        <datalist id="product-categories">
          {lookups.categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Field label="Sub-category" error={errors.subCategory?.message}>
          <Input {...register('subCategory')} placeholder="Rice" />
        </Field>
        <Field label="Brand" error={errors.brand?.message}>
          <Input {...register('brand')} placeholder="India Gate" />
        </Field>
      </FormSection>

      <FormSection title="Units & tax">
        <Field label="Base unit" error={errors.unit?.message}>
          <Input {...register('unit')} placeholder="PCS / KG / BOX" className="uppercase" />
        </Field>
        <Field label="Unit type" error={errors.unitType?.message}>
          <Select {...register('unitType')}>
            <option value="BASE">Base unit</option>
            <option value="ALT">Alternate unit</option>
          </Select>
        </Field>
        <Field label="Alternate unit" error={errors.altUnit?.message}>
          <Input {...register('altUnit')} placeholder="BOX" className="uppercase" />
        </Field>
        <Field label="Conversion factor" error={errors.conversion?.message} hint="Base units per alternate unit">
          <Input type="number" min="0" step="0.0001" {...register('conversion')} placeholder="1" />
        </Field>
        <Field label="HSN code" error={errors.hsnCode?.message}>
          <Input {...register('hsnCode')} placeholder="1006" />
        </Field>
        <Field label="GST rate (%)" error={errors.gstRate?.message}>
          <Input type="number" min="0" max="28" step="0.01" {...register('gstRate')} placeholder="18" />
        </Field>
      </FormSection>

      <FormSection title="Pricing" description={`All amounts in ${company?.currency || 'INR'}`}>
        <Field label="MRP" error={errors.mrp?.message}>
          <Input type="number" min="0" step="0.01" {...register('mrp')} placeholder="0.00" />
        </Field>
        <Field label="Selling price" error={errors.sellingPrice?.message}>
          <Input type="number" min="0" step="0.01" {...register('sellingPrice')} placeholder="0.00" />
        </Field>
        <Field label="Dealer price" error={errors.dealerPrice?.message}>
          <Input type="number" min="0" step="0.01" {...register('dealerPrice')} placeholder="0.00" />
        </Field>
        <Field label="Purchase price" error={errors.purchasePrice?.message}>
          <Input type="number" min="0" step="0.01" {...register('purchasePrice')} placeholder="0.00" />
        </Field>
      </FormSection>

      <FormSection title="Stock">
        <Field label="Opening stock" error={errors.openingStock?.message} hint="Used on first save">
          <Input type="number" step="0.01" {...register('openingStock')} placeholder="0" />
        </Field>
        <Field label="Current stock" error={errors.stock?.message}>
          <Input type="number" step="0.01" {...register('stock')} placeholder="0" />
        </Field>
        <Field label="Low stock alert level" error={errors.lowStockLevel?.message}>
          <Input type="number" min="0" step="0.01" {...register('lowStockLevel')} placeholder="10" />
        </Field>
      </FormSection>

      <FormSection title="Other details">
        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Textarea {...register('description')} placeholder="Pack size, ingredients, storage notes…" />
        </Field>
        <Field label="Tags" error={errors.tags?.message} className="sm:col-span-2" hint="Comma separated">
          <Input {...register('tags')} placeholder="fast-moving, premium" />
        </Field>
        <Checkbox label="Batch tracked" description="Track batch numbers and expiry." {...register('isBatchTracked')} />
        <Checkbox label="Returnable" description="Allow sales returns for this product." {...register('isReturnable')} />
        <Checkbox
          label="Active product"
          description="Inactive products cannot be added to new orders."
          className="sm:col-span-2"
          {...register('isActive')}
        />
      </FormSection>

      <FormActions
        onCancel={onClose}
        loading={isSubmitting}
        submitLabel={mode === 'create' ? 'Create product' : 'Save changes'}
      />
    </form>
  );
}

export default function Products() {
  const { company } = useAuth();
  const { lookups } = useLookups();

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
              {row.sku || 'No SKU'} {row.brand ? `· ${row.brand}` : ''}
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
          <p>{row.category || 'General'}</p>
          <p className="text-xs text-muted-foreground">{row.subCategory || '—'}</p>
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
          <p className="font-medium">{formatMoney(row.sellingPrice, company?.currency || 'INR')}</p>
          <p className="text-xs text-muted-foreground">MRP {formatMoney(row.mrp, company?.currency || 'INR')}</p>
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
            <p className={low ? 'font-semibold text-warning' : 'font-medium'}>{formatNumber(row.stock || 0)}</p>
            <p className="text-xs text-muted-foreground">{row.unit || 'PCS'}</p>
          </div>
        );
      },
    },
    {
      key: 'gst',
      header: 'GST',
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
        value={values.category || ''}
        onChange={(e) => setParam({ category: e.target.value || undefined, page: 1 })}
      >
        <option value="">All categories</option>
        {lookups.categories.map((c) => (
          <option key={c} value={c}>
            {c}
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
    <ResourcePage
      title="Products"
      description="Your sellable catalogue, pricing and stock snapshot"
      breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Products' }]}
      queryKey={['company', 'products']}
      endpoint="/v1/products"
      permissionPrefix="products"
      columns={columns}
      filterKeys={['category', 'lowStock', 'isActive']}
      filters={filters}
      searchPlaceholder="Search by name, SKU, barcode, category or brand…"
      createLabel="Add product"
      createIcon={Package}
      emptyTitle="No products yet"
      emptyDescription="Add products to build price lists and book orders."
      formTitle={(mode) => (mode === 'create' ? 'Add product' : 'Edit product')}
      formDescription="SKU, pricing and stock are tenant-scoped."
      formSize="xl"
      renderForm={(props) => <ProductForm {...props} />}
      deleteMessage={(row) =>
        row
          ? `“${row.name}” will be removed from the catalogue. Existing price lists that reference it may need updating.`
          : ''
      }
    />
  );
}
