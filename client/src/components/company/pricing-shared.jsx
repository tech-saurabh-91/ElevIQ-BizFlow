import { useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { Field, Input, Select } from '@/components/ui/input';
import { cn } from '@/utils/cn';

/**
 * Shared pieces of the Discount and Scheme masters: who a rule is for
 * (customer scope) and what it covers (product scope).
 */

export const CUSTOMER_SCOPE_LABEL = {
  ALL: 'All customers',
  CUSTOMER_TYPE: 'Customer types',
  CUSTOMER: 'Selected customers',
};
export const PRODUCT_SCOPE_LABEL = {
  ALL: 'All products',
  CATEGORY: 'Categories',
  BRAND: 'Brands',
  PRODUCT: 'Selected products',
};
export const CUSTOMER_TYPES = ['RETAIL', 'WHOLESALE', 'DISTRIBUTOR', 'DEALER'];
const titleCase = (v) => String(v || '').charAt(0) + String(v || '').slice(1).toLowerCase();

/** "Distributor, Dealer" / "3 customers" / "All customers". */
export const customerScopeText = (row) => {
  if (row.customerScope === 'CUSTOMER') {
    const names = (row.customers || []).map((c) => c?.name).filter(Boolean);
    return names.length <= 2 ? names.join(', ') || 'Selected customers' : `${names.length} customers`;
  }
  if (row.customerScope === 'CUSTOMER_TYPE') return (row.customerTypes || []).map(titleCase).join(', ');
  return 'All customers';
};
export const productScopeText = (row) => {
  if (row.productScope === 'PRODUCT') {
    const names = (row.products || []).map((p) => p?.name).filter(Boolean);
    return names.length <= 2 ? names.join(', ') || 'Selected products' : `${names.length} products`;
  }
  if (row.productScope === 'CATEGORY') return `Category: ${(row.categories || []).join(', ')}`;
  if (row.productScope === 'BRAND') return `Brand: ${(row.brands || []).join(', ')}`;
  return 'All products';
};

/** Ids of a populated or plain reference list. */
export const idsOf = (list) => (list || []).map((v) => String(v?.id || v?._id || v));

/**
 * Pick several values from a long list: a search box over checkboxes, the
 * picked ones shown as removable chips.
 */
export function PickList({ options, value = [], onChange, placeholder = 'Search…', error, emptyText = 'Nothing to pick' }) {
  const [q, setQ] = useState('');
  const picked = new Set(value.map(String));
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return options.filter((o) => !term || `${o.label} ${o.hint || ''}`.toLowerCase().includes(term)).slice(0, 100);
  }, [options, q]);
  const labelOf = (id) => options.find((o) => o.value === id)?.label || id;
  const toggle = (id) => onChange(picked.has(id) ? value.filter((v) => String(v) !== id) : [...value, id]);

  return (
    <div className={cn('space-y-2 rounded-lg border p-2', error && 'border-destructive')}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              {labelOf(String(id))}
              <button type="button" onClick={() => toggle(String(id))} aria-label={`Remove ${labelOf(String(id))}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-8" />
      <div className="max-h-40 space-y-0.5 overflow-y-auto">
        {!shown.length ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          shown.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
              <input type="checkbox" className="accent-primary" checked={picked.has(o.value)} onChange={() => toggle(o.value)} />
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="ml-auto truncate text-xs text-muted-foreground">{o.hint}</span>}
            </label>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Customer scope + product scope fields for a react-hook-form form whose
 * values hold customerScope, customers, customerTypes, productScope,
 * products, categories and brands.
 */
export function ScopeFields({ register, watch, setValue, errors, lookups, productLabel = 'Products covered' }) {
  const customerScope = watch('customerScope');
  const productScope = watch('productScope');
  const set = (name) => (v) => setValue(name, v, { shouldValidate: true, shouldDirty: true });
  const customerOptions = (lookups.customers || []).map((c) => ({ value: c.id, label: c.name, hint: c.code }));
  const productOptions = (lookups.products || []).map((p) => ({ value: p.id, label: p.name, hint: p.sku }));
  const tagOptions = (list) => (list || []).map((v) => ({ value: v, label: v }));

  return (
    <>
      <Field label="For customers" error={errors.customerScope?.message}>
        <Select {...register('customerScope')}>
          {Object.entries(CUSTOMER_SCOPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={productLabel} error={errors.productScope?.message}>
        <Select {...register('productScope')}>
          {Object.entries(PRODUCT_SCOPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      {customerScope === 'CUSTOMER' && (
        <Field label="Customers" required error={errors.customers?.message} className="sm:col-span-2">
          <PickList options={customerOptions} value={watch('customers') || []} onChange={set('customers')} placeholder="Search customers…" error={!!errors.customers} />
        </Field>
      )}
      {customerScope === 'CUSTOMER_TYPE' && (
        <Field label="Customer types" required error={errors.customerTypes?.message} className="sm:col-span-2">
          <PickList options={CUSTOMER_TYPES.map((t) => ({ value: t, label: titleCase(t) }))} value={watch('customerTypes') || []} onChange={set('customerTypes')} error={!!errors.customerTypes} />
        </Field>
      )}
      {productScope === 'PRODUCT' && (
        <Field label="Products" required error={errors.products?.message} className="sm:col-span-2">
          <PickList options={productOptions} value={watch('products') || []} onChange={set('products')} placeholder="Search products…" error={!!errors.products} />
        </Field>
      )}
      {productScope === 'CATEGORY' && (
        <Field label="Categories" required error={errors.categories?.message} className="sm:col-span-2">
          <PickList options={tagOptions(lookups.categories)} value={watch('categories') || []} onChange={set('categories')} emptyText="No categories on products yet" error={!!errors.categories} />
        </Field>
      )}
      {productScope === 'BRAND' && (
        <Field label="Brands" required error={errors.brands?.message} className="sm:col-span-2">
          <PickList options={tagOptions(lookups.brands)} value={watch('brands') || []} onChange={set('brands')} emptyText="No brands on products yet" error={!!errors.brands} />
        </Field>
      )}
    </>
  );
}

/** Client-side mirror of the server's "scope must name who / what" rule. */
export const scopeIssues = (v, ctx) => {
  const need = (cond, path, message) => cond && ctx.addIssue({ code: 'custom', path: [path], message });
  need(v.customerScope === 'CUSTOMER' && !v.customers?.length, 'customers', 'Pick at least one customer');
  need(v.customerScope === 'CUSTOMER_TYPE' && !v.customerTypes?.length, 'customerTypes', 'Pick at least one customer type');
  need(v.productScope === 'PRODUCT' && !v.products?.length, 'products', 'Pick at least one product');
  need(v.productScope === 'CATEGORY' && !v.categories?.length, 'categories', 'Pick at least one category');
  need(v.productScope === 'BRAND' && !v.brands?.length, 'brands', 'Pick at least one brand');
  need(v.validFrom && v.validTo && v.validTo < v.validFrom, 'validTo', 'Valid to cannot be before valid from');
};

/** Scope part of a save payload: only the list the chosen scope uses. */
export const scopePayload = (v) => ({
  customerScope: v.customerScope,
  customers: v.customerScope === 'CUSTOMER' ? v.customers : [],
  customerTypes: v.customerScope === 'CUSTOMER_TYPE' ? v.customerTypes : [],
  productScope: v.productScope,
  products: v.productScope === 'PRODUCT' ? v.products : [],
  categories: v.productScope === 'CATEGORY' ? v.categories : [],
  brands: v.productScope === 'BRAND' ? v.brands : [],
});

/** Scope part of the form defaults from a saved record. */
export const scopeDefaults = (initial, productScope = 'ALL') => ({
  customerScope: initial?.customerScope || 'ALL',
  customers: idsOf(initial?.customers),
  customerTypes: initial?.customerTypes || [],
  productScope: initial?.productScope || productScope,
  products: idsOf(initial?.products),
  categories: initial?.categories || [],
  brands: initial?.brands || [],
});
