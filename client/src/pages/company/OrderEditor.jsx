import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Plus,
  Save,
  Send,
  Trash2,
} from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertTitle, AlertDescription, ErrorAlert } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { useLookups } from '@/hooks/useLookups';
import { dateInput, num, opt, todayInput, notFutureDate, STICKY_ACTIONS } from '@/components/company/form-utils';
import { formatMoney } from '@/utils/format';
import {
  PAYMENT_MODES,
  PAYMENT_TERMS,
  basePriceFromProduct,
  computeOrderPreview,
  findPriceEntry,
  orderIdOf,
  paymentModeLabel,
} from '@/components/company/order-shared';
import { breakupRows, buyerStateOf } from '@/utils/tax';
import { useTaxLabels } from '@/hooks/useLocations';
import { unitOf, unitOptions, stockLabel, describeQty } from '@/utils/units';
import { usePermissions } from '@/hooks/usePermissions';
import { FreeGoodsRows, LinePricingNote, OffersCard, effectiveRows, pricingInput, useSalePricing } from '@/components/company/sale-pricing';

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const numberText = (message) =>
  z.string().trim().optional().or(z.literal('')).refine((v) => v === '' || Number(v) >= 0, message);

const itemSchema = z.object({
  product: z.string().min(1, 'Select a product'),
  qty: z
    .string()
    .trim()
    .min(1, 'Enter a quantity')
    .refine((v) => Number(v) > 0, 'Quantity must be greater than zero'),
  unit: z.string().optional().or(z.literal('')),
  unitPrice: numberText('Enter a valid price'),
  discountPercent: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => v === '' || (Number(v) >= 0 && Number(v) <= 100), 'Discount must be 0–100'),
  note: text(300),
  // '1' when the user typed the price / discount (else the server prices it).
  manualPrice: z.string().optional(),
  manualDiscount: z.string().optional(),
});

const schema = z.object({
  customerId: z.string().min(1, 'Select a customer'),
  orderDate: z.string().optional().or(z.literal('')).refine(notFutureDate, 'Order date cannot be in the future'),
  expectedDeliveryDate: z.string().optional().or(z.literal('')),
  salesman: z.string().optional().or(z.literal('')),
  route: z.string().optional().or(z.literal('')),
  warehouse: z.string().optional().or(z.literal('')),
  paymentMode: z.enum(PAYMENT_MODES),
  paymentTerms: z.enum(PAYMENT_TERMS),
  creditDays: numberText('Enter a valid number of days'),
  poReference: text(60),
  notes: text(1000),
  internalNotes: text(1000),
  deliveryInstructions: text(1000),
  items: z.array(itemSchema).min(1, 'Add at least one product'),
}).superRefine((v, ctx) => {
  if (v.expectedDeliveryDate && v.expectedDeliveryDate < (v.orderDate || todayInput())) {
    ctx.addIssue({ code: 'custom', path: ['expectedDeliveryDate'], message: 'Delivery cannot be before the order date' });
  }
});

const emptyRow = () => ({
  product: '',
  qty: '1',
  unit: '',
  unitPrice: '',
  discountPercent: '',
  note: '',
  manualPrice: '',
  manualDiscount: '',
});

const toFormValues = (order) => ({
  customerId: orderIdOf(order.customer?.id || order.customerId),
  orderDate: dateInput(order.orderDate),
  expectedDeliveryDate: dateInput(order.expectedDeliveryDate),
  salesman: orderIdOf(order.salesman),
  route: orderIdOf(order.route),
  warehouse: orderIdOf(order.warehouse),
  paymentMode: order.paymentMode || 'CREDIT',
  paymentTerms: order.paymentTerms || 'IMMEDIATE',
  creditDays: order.creditDays == null ? '' : String(order.creditDays),
  poReference: order.poReference || '',
  notes: order.notes || '',
  internalNotes: order.internalNotes || '',
  deliveryInstructions: order.deliveryInstructions || '',
  items:
    // Free goods are rebuilt by the schemes; only bought lines are edited.
    Array.isArray(order.items) && order.items.some((i) => !i.isFree)
      ? order.items
          .filter((item) => !item.isFree)
          .map((item) => {
            // A typed discount is shown without the scheme part added on top.
            const discount = item.manualDiscount
              ? Number(item.discountPercent || 0) - Number(item.schemeDiscountPercent || 0)
              : Number(item.discountPercent || 0);
            return {
              product: orderIdOf(item.product),
              qty: String(item.qty ?? 1),
              unit: item.unit || '',
              unitPrice: item.unitPrice == null ? '' : String(item.unitPrice),
              discountPercent: discount ? String(Math.round(discount * 100) / 100) : '',
              note: item.note || '',
              manualPrice: item.manualPrice ? '1' : '',
              manualDiscount: item.manualDiscount ? '1' : '',
            };
          })
      : [emptyRow()],
});

export default function OrderEditor() {
  const { taxIdLabel } = useTaxLabels();
  const { id } = useParams();
  // Opened from a customer visit (My Beat): start with that customer.
  const [searchParams] = useSearchParams();
  // Opened from a shop visit: go back there after saving (check-out follows).
  const returnTo = (searchParams.get('returnTo') || '').startsWith('/app/') ? searchParams.get('returnTo') : '';
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { company, user } = useAuth();
  // A salesman books for the shop they are checked in at: the customer comes
  // from Sales visit and cannot be changed; salesman and godown are set by the
  // server (presale orders ship from the godown, not the van).
  const isSalesman = user?.role === 'SALESMAN';
  const lockedCustomer = isSalesman ? searchParams.get('customerId') || '' : '';
  const { lookups } = useLookups();
  // Typing a price / discount by hand is a permission; otherwise the price
  // list, discount rules and schemes decide (on the server).
  const { can } = usePermissions();
  const canOverride = can('pricing.override');

  const [initialized, setInitialized] = useState(!isEdit);
  const [serverError, setServerError] = useState(null);
  const [intent, setIntent] = useState('draft');

  const {
    register,
    control,
    handleSubmit,
    reset,
    getValues,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      customerId: searchParams.get('customerId') || '',
      orderDate: todayInput(),
      expectedDeliveryDate: '',
      salesman: '',
      route: '',
      warehouse: '',
      paymentMode: 'CREDIT',
      paymentTerms: 'IMMEDIATE',
      creditDays: '',
      poReference: '',
      notes: '',
      internalNotes: '',
      deliveryInstructions: '',
      items: [emptyRow()],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' });
  const watchedItems = useWatch({ control, name: 'items' }) || [];
  const customerId = useWatch({ control, name: 'customerId' }) || '';
  const orderDate = useWatch({ control, name: 'orderDate' }) || '';

  // ---- Existing draft ------------------------------------------------------
  const orderQuery = useQuery({
    queryKey: ['company', 'order', id],
    queryFn: async () => {
      const { data } = await api.get(`/v1/orders/${id}`);
      return data?.data;
    },
    enabled: isEdit,
  });

  const order = orderQuery.data;

  useEffect(() => {
    if (isEdit && order && !initialized) {
      reset(toFormValues(order));
      setInitialized(true);
    }
  }, [isEdit, order, initialized, reset]);

  // ---- Customer-aware pricing options -------------------------------------
  const optionsQuery = useQuery({
    queryKey: ['company', 'order-form-options', customerId || 'none'],
    queryFn: async () => {
      const { data } = await api.get('/v1/orders/form-options', {
        params: customerId ? { customerId } : undefined,
      });
      return data?.data;
    },
    enabled: initialized,
    staleTime: 30_000,
  });

  const options = optionsQuery.data;

  const productMap = useMemo(() => {
    const map = new Map();
    (options?.products || []).forEach((p) => map.set(String(p.id), p));
    return map;
  }, [options?.products]);

  // Apply customer defaults + customer-specific price list. On the first load
  // of an existing draft we keep the saved prices instead of repricing.
  const appliedCustomer = useRef(null);
  const skipFirstReprice = useRef(isEdit);

  useEffect(() => {
    if (!options) return;
    if (!options.customer?.id) return;
    if (appliedCustomer.current === options.customer.id) return;

    // An existing draft opens with its saved header values and prices; only a
    // deliberate customer change should re-apply the customer's defaults.
    if (skipFirstReprice.current) {
      appliedCustomer.current = options.customer.id;
      skipFirstReprice.current = false;
      return;
    }

    appliedCustomer.current = options.customer.id;
    const customer = options.customer;

    if (customer.assignedTo) setValue('salesman', customer.assignedTo);
    if (customer.route) setValue('route', customer.route);
    if (customer.warehouse) setValue('warehouse', customer.warehouse);
    if (customer.paymentTerms) setValue('paymentTerms', customer.paymentTerms);
    if (customer.creditDays != null) setValue('creditDays', String(customer.creditDays));

    const rows = getValues('items') || [];
    rows.forEach((row, index) => {
      const product = productMap.get(String(row.product));
      if (!product) return;
      const qty = Number(row.qty) || 1;
      const entry = findPriceEntry(options.priceList, product.id, qty * unitOf(product, row.unit).factor);
      setValue(`items.${index}.unitPrice`, String(basePriceFromProduct(product, options.priceList, qty, row.unit)));
      setValue(`items.${index}.discountPercent`, entry?.discountPercent ? String(entry.discountPercent) : '');
    });
  }, [options, productMap, getValues, setValue]);

  // Defaults for a brand-new order (first options load, no customer yet).
  const defaultsApplied = useRef(false);
  useEffect(() => {
    if (!options || defaultsApplied.current) return;
    defaultsApplied.current = true;
    if (!getValues('paymentMode')) setValue('paymentMode', options.defaults?.paymentMode || 'CREDIT');
    if (!getValues('warehouse') && options.defaults?.warehouse) {
      setValue('warehouse', options.defaults.warehouse);
    }
  }, [options, getValues, setValue]);

  // ---- Live pricing from the server (rules, schemes, free goods) ----------
  const pricing = useSalePricing({ customerId, date: orderDate, rows: watchedItems, canOverride, enabled: initialized });

  // Show the server's price / discount in rows the user did not type into.
  useEffect(() => {
    pricing.byRow.forEach((line, index) => {
      const row = getValues(`items.${index}`);
      if (!row) return;
      if (row.manualPrice !== '1' && row.unitPrice !== String(line.unitPrice)) setValue(`items.${index}.unitPrice`, String(line.unitPrice));
      if (row.manualDiscount !== '1') {
        const shown = Number(line.discountPercent) ? String(line.discountPercent) : '';
        if (row.discountPercent !== shown) setValue(`items.${index}.discountPercent`, shown);
      }
    });
  }, [pricing.byRow, getValues, setValue]);

  // ---- Preview (server remains authoritative) -----------------------------
  const pricedRows = useMemo(() => effectiveRows(watchedItems, pricing.byRow), [watchedItems, pricing.byRow]);
  const preview = useMemo(
    () =>
      computeOrderPreview({
        items: pricedRows,
        products: productMap,
        priceList: options?.priceList,
        settings: options?.settings,
        buyerState: buyerStateOf(options?.customer),
      }),
    [pricedRows, productMap, options?.priceList, options?.settings, options?.customer]
  );

  const money = (value) => formatMoney(value, options?.settings?.currency || company?.currency || 'INR');

  const credit = options?.customer;
  const creditLimit = Number(credit?.creditLimit || 0);
  const outstanding = Number(credit?.outstanding || 0);
  const exposure = outstanding + preview.total;
  const creditBlocked = creditLimit > 0 && exposure > creditLimit;
  const creditAction = options?.settings?.order?.creditLimitAction || 'WARN';
  const approvalThreshold = Number(options?.settings?.order?.approvalThreshold || 0);
  const needsApproval = approvalThreshold > 0 && preview.total >= approvalThreshold;
  const showStock = options?.settings?.order?.showStockOnOrder !== false;
  const allowNegative = Boolean(options?.settings?.order?.allowNegativeStock);

  // A shortage never stops the order (stock is enforced at invoice / dispatch);
  // it is listed as a heads-up wherever live stock is shown.
  const stockIssues = useMemo(() => {
    if (!showStock) return [];
    const out = [];
    // Stock is in base units: add up every line of a product, whatever its pack.
    const wanted = new Map();
    watchedItems.forEach((row) => {
      const product = productMap.get(String(row.product));
      if (!product) return;
      const base = (Number(row.qty) || 0) * unitOf(product, row.unit).factor;
      wanted.set(product.id, { product, qty: (wanted.get(product.id)?.qty || 0) + base });
    });
    pricing.freeLines.forEach((line) => {
      const product = productMap.get(String(line.product));
      if (product) wanted.set(product.id, { product, qty: (wanted.get(product.id)?.qty || 0) + Number(line.qty || 0) });
    });
    wanted.forEach(({ product, qty }) => {
      const available = Number(product.stock || 0);
      if (qty > available) {
        out.push(`${product.name}: only ${stockLabel(product)} in stock, ${describeQty(qty, product)} requested.`);
      }
    });
    return out;
  }, [watchedItems, productMap, showStock, pricing.freeLines]);

  // ---- Save ---------------------------------------------------------------
  const pendingIntent = useRef('draft');

  const mutation = useMutation({
    mutationFn: async (payload) => {
      if (isEdit) {
        const { data } = await api.patch(`/v1/orders/${id}`, payload);
        if (pendingIntent.current === 'submit') {
          const { data: submitted } = await api.post(`/v1/orders/${id}/submit`, {});
          return submitted;
        }
        return data;
      }
      const { data } = await api.post('/v1/orders', {
        ...payload,
        submit: pendingIntent.current === 'submit',
      });
      return data;
    },
    onSuccess: (payload) => {
      const saved = payload?.data;
      const warnings = payload?.meta?.warnings || [];
      toast.success(payload?.message || 'Order saved');
      warnings.slice(0, 3).forEach((w) => toast(w, { icon: '⚠️' }));
      queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'order', id] });
      queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
      if (returnTo) navigate(returnTo, { replace: true });
      else if (saved?.id) navigate(`/app/orders/${saved.id}`, { replace: true });
      else navigate('/app/orders', { replace: true });
    },
    onError: (err) => {
      const e = apiError(err);
      setServerError(e);
      Object.entries(toFieldErrors(e.errors)).forEach(([field, message]) => {
        if (field.startsWith('items.')) return;
        setError(field, { type: 'server', message });
      });
    },
  });

  const submitForm = (nextIntent) => {
    pendingIntent.current = nextIntent;
    setIntent(nextIntent);
    setServerError(null);
    handleSubmit((values) => {
      const payload = {
        customerId: values.customerId,
        orderDate: values.orderDate || undefined,
        expectedDeliveryDate: values.expectedDeliveryDate || undefined,
        salesman: opt(values.salesman),
        route: opt(values.route),
        warehouse: opt(values.warehouse),
        paymentMode: values.paymentMode,
        paymentTerms: values.paymentTerms,
        creditDays: num(values.creditDays),
        poReference: values.poReference || '',
        notes: values.notes || '',
        internalNotes: values.internalNotes || '',
        deliveryInstructions: values.deliveryInstructions || '',
        // Only typed prices / discounts go up; the server prices the rest.
        items: values.items.map((item) => ({ ...pricingInput(item, canOverride), note: item.note || '' })),
      };
      mutation.mutate(payload);
    })();
  };

  const changeProduct = (index, productId) => {
    const product = productMap.get(String(productId));
    if (!product) return;
    const qty = Number(getValues(`items.${index}.qty`)) || 1;
    // A new product starts in its base unit, priced by the server again.
    setValue(`items.${index}.unit`, product.unit || 'PCS');
    setValue(`items.${index}.manualPrice`, '');
    setValue(`items.${index}.manualDiscount`, '');
    const entry = findPriceEntry(options?.priceList, productId, qty);
    setValue(`items.${index}.unitPrice`, String(basePriceFromProduct(product, options?.priceList, qty, product.unit)));
    setValue(
      `items.${index}.discountPercent`,
      entry?.discountPercent ? String(entry.discountPercent) : ''
    );
  };

  const changeUnit = (index, unit) => {
    const product = productMap.get(String(getValues(`items.${index}.product`)));
    if (!product) return;
    const qty = Number(getValues(`items.${index}.qty`)) || 1;
    setValue(`items.${index}.unitPrice`, String(basePriceFromProduct(product, options?.priceList, qty, unit)));
  };

  const customerOptions = useMemo(() => {
    const list = lookups.customers || [];
    const current = order?.customer;
    if (current?.id && !list.some((c) => c.id === current.id)) return [current, ...list];
    return list;
  }, [lookups.customers, order?.customer]);

  // ---- Guards / loading ---------------------------------------------------
  if (isEdit && orderQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (isEdit && orderQuery.isError) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Could not load this order"
          description={apiError(orderQuery.error).message}
          action={
            <Button variant="outline" onClick={() => navigate('/app/orders')}>
              <ArrowLeft className="h-4 w-4" /> Back to orders
            </Button>
          }
        />
      </Card>
    );
  }

  if (isEdit && order && order.status !== 'DRAFT') {
    return (
      <div className="space-y-4">
        <PageHeader
          title={`Order ${order.orderNo}`}
          breadcrumbs={[
            { label: 'Orders', to: '/app/orders' },
            { label: order.orderNo || 'Order' },
          ]}
        />
        <Card>
          <EmptyState
            icon="error"
            title="This order can no longer be edited"
            description={`Only draft orders can be edited. This order is currently ${order.status.replace(
              /_/g,
              ' '
            )}.`}
            action={
              <Button onClick={() => navigate(`/app/orders/${order.id}`)}>View order</Button>
            }
          />
        </Card>
      </div>
    );
  }

  const itemsError = errors.items?.message || errors.items?.root?.message;
  const saving = isSubmitting || mutation.isPending;

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? `Edit ${order?.orderNo || 'draft order'}` : 'New order'}
        description={
          isEdit
            ? 'Update the draft. Totals are recalculated by the server when you save.'
            : 'Book a sales order for a customer. Pricing, tax and totals are computed on save.'
        }
        breadcrumbs={[
          { label: 'Orders', to: '/app/orders' },
          { label: isEdit ? order?.orderNo || 'Edit draft' : 'New order' },
        ]}
        actions={
          <Button variant="outline" onClick={() => navigate(returnTo || (isEdit ? `/app/orders/${id}` : '/app/orders'))}>
            <ArrowLeft className="h-4 w-4" />
            Cancel
          </Button>
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitForm('draft');
        }}
        className="space-y-5"
        noValidate
      >
        {serverError && (
          <ErrorAlert
            title="Could not save the order"
            message={serverError.message}
            errors={serverError.errors}
            onClose={() => setServerError(null)}
          />
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {/* ---- Customer & header ---- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Customer & order details</CardTitle>
                <CardDescription>Who is buying and when should this order ship?</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Customer"
                  required
                  error={errors.customerId?.message}
                  className="sm:col-span-2"
                  hint={
                    options?.customer
                      ? `${options.customer.code || 'No code'} · ${
                          options.customer.phone || 'No phone'
                        }${options.customer.gstin ? ` · ${taxIdLabel} ${options.customer.gstin}` : ''}`
                      : undefined
                  }
                >
                  {lockedCustomer ? (
                    <>
                      <input type="hidden" {...register('customerId')} />
                      <Input value={options?.customer?.name || customerOptions.find((c) => c.id === lockedCustomer)?.name || ''} readOnly title="Booked for the shop you are checked in at (Sales visit)." />
                    </>
                  ) : (
                    <Select {...register('customerId')} error={!!errors.customerId}>
                      <option value="">Select a customer…</option>
                      {customerOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.code ? ` (${c.code})` : ''}
                          {c.phone ? ` · ${c.phone}` : ''}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Order date" error={errors.orderDate?.message}>
                  <Input type="date" max={todayInput()} {...register('orderDate')} />
                </Field>
                <Field label="Expected delivery" error={errors.expectedDeliveryDate?.message}>
                  <Input type="date" min={orderDate || todayInput()} {...register('expectedDeliveryDate')} />
                </Field>

                {!isSalesman && (
                <Field label="Salesman" error={errors.salesman?.message}>
                  <Select {...register('salesman')}>
                    <option value="">Use customer owner</option>
                    {(options?.salesmen || []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · {u.role.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </Field>
                )}
                <Field label="Route / beat" error={errors.route?.message}>
                  <Select {...register('route')}>
                    <option value="">No route</option>
                    {(options?.routes || []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.code ? ` (${r.code})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                {!isSalesman && (
                <Field label="Warehouse" error={errors.warehouse?.message}>
                  <Select {...register('warehouse')}>
                    <option value="">Default warehouse</option>
                    {(options?.warehouses || []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.code ? ` (${w.code})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                )}
                <Field label="PO reference" error={errors.poReference?.message}>
                  <Input {...register('poReference')} placeholder="Customer PO / order reference" />
                </Field>

                <Field label="Payment mode" error={errors.paymentMode?.message}>
                  <Select {...register('paymentMode')}>
                    {PAYMENT_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {paymentModeLabel(mode)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Payment terms" error={errors.paymentTerms?.message}>
                  <Select {...register('paymentTerms')}>
                    {PAYMENT_TERMS.map((term) => (
                      <option key={term} value={term}>
                        {term === 'IMMEDIATE' ? 'Immediate' : term.replace('NET_', 'Net ')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Credit days" error={errors.creditDays?.message}>
                  <Input type="number" min="0" max="365" {...register('creditDays')} placeholder="0" />
                </Field>

                {options?.priceList && (
                  <div className="flex items-end sm:col-span-2">
                    <p className="text-xs text-muted-foreground">
                      Pricing from{' '}
                      <span className="font-medium text-foreground">{options.priceList.name}</span>
                      <span className="ml-1">
                        ({options.priceList.items.length} product price
                        {options.priceList.items.length === 1 ? '' : 's'})
                      </span>
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ---- Items ---- */}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <div>
                  <CardTitle>Products</CardTitle>
                  <CardDescription>
                    Prices come from the customer’s price list; discounts and schemes apply on their own
                    {canOverride ? '. Type a price or discount to override it.' : '.'}
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append(emptyRow())}
                >
                  <Plus className="h-4 w-4" /> Add item
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {itemsError && (
                  <p className="text-xs font-medium text-destructive" role="alert">
                    {itemsError}
                  </p>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm sm:min-w-[640px]">
                    <thead className="hidden sm:table-header-group">
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-2 font-medium">Product</th>
                        <th className="w-20 pb-2 px-2 font-medium">Qty</th>
                        <th className="w-28 pb-2 px-2 font-medium">Price</th>
                        <th className="w-20 pb-2 px-2 font-medium">Disc %</th>
                        <th className="w-24 pb-2 px-2 text-right font-medium">Amount</th>
                        <th className="w-10 pb-2 pl-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field, index) => {
                        const row = watchedItems[index] || {};
                        const product = productMap.get(String(row.product));
                        const line = preview.lines[index];
                        const shortStock =
                          showStock &&
                          product &&
                          Number(row.qty) * unitOf(product, row.unit).factor > Number(product.stock || 0);
                        const units = unitOptions(product);
                        return (
                          <tr key={field.id} className="mb-3 grid grid-cols-3 gap-x-3 rounded-lg border p-3 sm:mb-0 sm:table-row sm:rounded-none sm:border-x-0 sm:border-t-0 sm:p-0 sm:last:border-0">
                            <td className="col-span-3 py-1 pr-2 align-top sm:py-2">
                              <Select
                                {...register(`items.${index}.product`, {
                                  onChange: (e) => changeProduct(index, e.target.value),
                                })}
                                error={!!errors.items?.[index]?.product}
                                aria-label={`Product for line ${index + 1}`}
                              >
                                <option value="">Select product…</option>
                                {(options?.products || []).map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                    {p.sku ? ` · ${p.sku}` : ''}
                                  </option>
                                ))}
                              </Select>
                              {errors.items?.[index]?.product && (
                                <p className="mt-1 text-xs text-destructive">
                                  {errors.items[index].product.message}
                                </p>
                              )}
                              {product && showStock && (
                                <p
                                  className={`mt-1 text-xs ${
                                    shortStock ? 'text-destructive' : 'text-muted-foreground'
                                  }`}
                                >
                                  Stock {stockLabel(product)}
                                  {shortStock && ' · short'}
                                </p>
                              )}
                              <LinePricingNote line={pricing.byRow.get(index)} />
                            </td>
                            <td className="py-1 align-top sm:px-2 sm:py-2">
                              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:hidden">Qty</span>
                              <Input
                                type="number"
                                min="0.0001"
                                step="any"
                                {...register(`items.${index}.qty`)}
                                error={!!errors.items?.[index]?.qty}
                                aria-label={`Quantity for line ${index + 1}`}
                              />
                              {units.length > 1 ? (
                                <Select
                                  className="mt-1 h-8 text-xs"
                                  {...register(`items.${index}.unit`, { onChange: (e) => changeUnit(index, e.target.value) })}
                                  aria-label={`Unit for line ${index + 1}`}
                                >
                                  {units.map((u) => (
                                    <option key={u.unit} value={u.unit}>
                                      {u.base ? u.unit : `${u.unit} (${u.factor} ${units[0].unit})`}
                                    </option>
                                  ))}
                                </Select>
                              ) : (
                                product && <p className="mt-1 text-xs text-muted-foreground">{product.unit}</p>
                              )}
                              {errors.items?.[index]?.qty && (
                                <p className="mt-1 text-xs text-destructive">
                                  {errors.items[index].qty.message}
                                </p>
                              )}
                            </td>
                            <td className="py-1 align-top sm:px-2 sm:py-2">
                              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:hidden">Price</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder={product ? String(product.sellingPrice ?? '') : 'Auto'}
                                {...register(`items.${index}.unitPrice`, {
                                  onChange: (e) => setValue(`items.${index}.manualPrice`, e.target.value === '' ? '' : '1'),
                                })}
                                readOnly={!canOverride}
                                title={canOverride ? undefined : 'Set by the price list'}
                                error={!!errors.items?.[index]?.unitPrice}
                                aria-label={`Unit price for line ${index + 1}`}
                              />
                              {errors.items?.[index]?.unitPrice && (
                                <p className="mt-1 text-xs text-destructive">
                                  {errors.items[index].unitPrice.message}
                                </p>
                              )}
                            </td>
                            <td className="py-1 align-top sm:px-2 sm:py-2">
                              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:hidden">Disc %</span>
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                {...register(`items.${index}.discountPercent`, {
                                  onChange: (e) => setValue(`items.${index}.manualDiscount`, e.target.value === '' ? '' : '1'),
                                })}
                                readOnly={!canOverride}
                                title={canOverride ? undefined : 'Set by discounts and schemes'}
                                error={!!errors.items?.[index]?.discountPercent}
                                aria-label={`Discount percent for line ${index + 1}`}
                              />
                              {errors.items?.[index]?.discountPercent && (
                                <p className="mt-1 text-xs text-destructive">
                                  {errors.items[index].discountPercent.message}
                                </p>
                              )}
                            </td>
                            <td className="col-span-2 py-1 align-top sm:px-2 sm:py-2 sm:text-right">
                              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:hidden">Amount</span>
                              <span className="font-medium tabular-nums">
                                {line ? money(line.lineTotal) : '—'}
                              </span>
                              {line && <p className="text-xs text-muted-foreground">{line.taxRate}% GST</p>}
                            </td>
                            <td className="flex items-end justify-end py-1 align-top sm:table-cell sm:py-2 sm:pl-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (fields.length === 1) {
                                    replace([emptyRow()]);
                                  } else {
                                    remove(index);
                                  }
                                }}
                                className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-destructive focus-ring"
                                aria-label={`Remove line ${index + 1}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      <FreeGoodsRows lines={pricing.freeLines} colSpan={6} />
                    </tbody>
                  </table>
                </div>

                {fields.length === 0 && (
                  <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    No products yet.{' '}
                    <button
                      type="button"
                      className="font-medium text-brand-600 hover:underline"
                      onClick={() => append(emptyRow())}
                    >
                      Add your first item
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ---- Notes ---- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Notes & delivery</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Notes to customer" error={errors.notes?.message} className="sm:col-span-2">
                  <Textarea {...register('notes')} rows={2} placeholder="Visible on the printed order…" />
                </Field>
                <Field label="Delivery instructions" error={errors.deliveryInstructions?.message}>
                  <Textarea
                    {...register('deliveryInstructions')}
                    rows={2}
                    placeholder="Gate timings, landmark…"
                  />
                </Field>
                <Field label="Internal notes" error={errors.internalNotes?.message}>
                  <Textarea
                    {...register('internalNotes')}
                    rows={2}
                    placeholder="Not shown to the customer"
                  />
                </Field>
              </CardContent>
            </Card>
          </div>

          {/* ---- Summary ---- */}
          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Order summary</CardTitle>
                <CardDescription>
                  {preview.lines.length} line{preview.lines.length === 1 ? '' : 's'} ·{' '}
                  {preview.itemCount} unit{preview.itemCount === 1 ? '' : 's'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Subtotal" value={money(preview.subtotal)} />
                <Row label="Discount" value={`− ${money(preview.discountTotal)}`} />
                <Row label="Taxable value" value={money(preview.taxableTotal)} />
                <Row label="Tax" value={money(preview.taxTotal)} />
                {breakupRows(preview.taxBreakup, options?.settings?.tax).map((r) => (
                  <Row key={r.label} label={r.label} value={r.value.map(money).join(' / ')} muted />
                ))}
                <Row
                  label="Round off"
                  value={`${preview.roundOff >= 0 ? '+' : '−'} ${money(Math.abs(preview.roundOff))}`}
                  muted
                />
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Total payable</span>
                    <span className="text-xl font-bold tabular-nums">{money(preview.total)}</span>
                  </div>
                </div>

                {needsApproval && (
                  <Alert tone="info">
                    <AlertTitle>Approval required</AlertTitle>
                    <AlertDescription>
                      Orders at or above {money(approvalThreshold)} need a manager’s approval before
                      confirmation.
                    </AlertDescription>
                  </Alert>
                )}

                {creditBlocked && (
                  <Alert tone={creditAction === 'BLOCK' ? 'destructive' : 'warning'}>
                    <AlertTitle>
                      {creditAction === 'BLOCK' ? 'Credit limit exceeded' : 'Credit limit warning'}
                    </AlertTitle>
                    <AlertDescription>
                      Limit {money(creditLimit)}, outstanding {money(outstanding)}, this order{' '}
                      {money(preview.total)}.
                      {creditAction === 'BLOCK'
                        ? ' This order will be blocked on save.'
                        : ' You can still save, but the customer is over their limit.'}
                    </AlertDescription>
                  </Alert>
                )}

                {stockIssues.length > 0 && (
                  <Alert tone="warning">
                    <AlertTitle>Short on stock</AlertTitle>
                    <AlertDescription>
                      <ul className="list-inside list-disc space-y-0.5">
                        {stockIssues.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                      <p className="mt-1">
                        {allowNegative
                          ? 'The order can be saved. Stock will go below zero when it is invoiced.'
                          : 'The order can be saved, but it can only be invoiced or dispatched once stock arrives.'}
                      </p>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <OffersCard offers={pricing.offers} applied={pricing.applied} />

            <div className={STICKY_ACTIONS}>
              <Button
                type="submit"
                variant="outline"
                disabled={saving}
              >
                <Save className="h-4 w-4" />
                {saving && intent === 'draft' ? 'Saving…' : 'Save draft'}
              </Button>
              <Button
                type="button"
                disabled={saving}
                loading={saving && intent === 'submit'}
                onClick={() => submitForm('submit')}
              >
                <Send className="h-4 w-4" />
                Save &amp; submit
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {needsApproval
                  ? 'Submitting sends this order for approval.'
                  : 'Submitting confirms this order immediately.'}
              </p>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function Row({ label, value, muted = false }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={muted ? 'text-xs text-muted-foreground' : 'text-muted-foreground'}>
        {label}
      </span>
      <span className={`tabular-nums ${muted ? 'text-xs text-muted-foreground' : 'font-medium'}`}>
        {value}
      </span>
    </div>
  );
}
