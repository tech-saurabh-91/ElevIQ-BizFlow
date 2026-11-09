import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Save, Send, Trash2 } from 'lucide-react';

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
import { dateInput, num, todayInput, notFutureDate, STICKY_ACTIONS } from '@/components/company/form-utils';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';
import {
  PAYMENT_MODES,
  PAYMENT_TERMS,
  paymentModeLabel,
} from '@/components/company/order-shared';
import {
  computeInvoicePreview,
  findInvoicePriceEntry,
  idOf,
} from '@/components/company/invoice-shared';
import { breakupRows, buyerStateOf } from '@/utils/tax';
import { useTaxLabels } from '@/hooks/useLocations';
import { unitOf, unitOptions, unitPriceFor } from '@/utils/units';
import { usePermissions } from '@/hooks/usePermissions';
import { FreeGoodsRows, LinePricingNote, OffersCard, effectiveRows, pricingInput, useSalePricing } from '@/components/company/sale-pricing';

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const numberText = (message) =>
  z.string().trim().optional().or(z.literal('')).refine((v) => v === '' || Number(v) >= 0, message);

const itemSchema = z.object({
  product: z.string().min(1, 'Select a product'),
  orderItemId: z.string().optional().or(z.literal('')),
  name: z.string().optional().or(z.literal('')),
  sku: z.string().optional().or(z.literal('')),
  unit: z.string().optional().or(z.literal('')),
  qty: z
    .string()
    .trim()
    .min(1, 'Enter a quantity')
    .refine((v) => Number(v) > 0, 'Quantity must be greater than zero'),
  unitPrice: numberText('Enter a valid price'),
  discountPercent: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine((v) => v === '' || (Number(v) >= 0 && Number(v) <= 100), 'Discount must be 0–100'),
  taxRate: numberText('Enter a valid tax rate'),
  maxQty: z.number().optional().nullable(),
  // Direct invoices: '1' when the user typed the price / discount.
  manualPrice: z.string().optional(),
  manualDiscount: z.string().optional(),
  // Order lines given free under a scheme.
  isFree: z.boolean().optional(),
  schemeName: z.string().optional(),
});

const schema = z.object({
  orderId: z.string().optional().or(z.literal('')),
  customerId: z.string().optional().or(z.literal('')),
  invoiceDate: z.string().optional().or(z.literal('')).refine(notFutureDate, 'Invoice date cannot be in the future'),
  dueDate: z.string().optional().or(z.literal('')),
  paymentMode: z.enum(PAYMENT_MODES),
  paymentTerms: z.enum(PAYMENT_TERMS),
  creditDays: numberText('Enter a valid number of days'),
  poReference: text(60),
  placeOfSupply: text(120),
  notes: text(1000),
  terms: text(2000),
  footerNote: text(500),
  items: z.array(itemSchema).min(1, 'Add at least one product'),
}).superRefine((v, ctx) => {
  if (v.dueDate && v.dueDate < (v.invoiceDate || todayInput())) {
    ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Due date cannot be before the invoice date' });
  }
});

const emptyRow = () => ({
  product: '',
  orderItemId: '',
  name: '',
  sku: '',
  unit: '',
  qty: '1',
  unitPrice: '',
  discountPercent: '',
  taxRate: '',
  maxQty: null,
  manualPrice: '',
  manualDiscount: '',
});

const addDaysInput = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const toFormValues = (invoice) => ({
  orderId: idOf(invoice.order?.id || invoice.order),
  customerId: idOf(invoice.customerId),
  invoiceDate: dateInput(invoice.invoiceDate),
  dueDate: dateInput(invoice.dueDate),
  paymentMode: invoice.paymentMode || 'CREDIT',
  paymentTerms: invoice.paymentTerms || 'IMMEDIATE',
  creditDays: invoice.creditDays == null ? '' : String(invoice.creditDays),
  poReference: invoice.poReference || '',
  placeOfSupply: invoice.placeOfSupply || '',
  notes: invoice.notes || '',
  terms: invoice.terms || '',
  footerNote: invoice.footerNote || '',
  // A direct invoice's free goods are rebuilt by the schemes; an order
  // invoice bills the order's free lines like any other line.
  items:
    Array.isArray(invoice.items) && invoice.items.some((i) => invoice.order || !i.isFree)
      ? invoice.items.filter((item) => invoice.order || !item.isFree).map((item) => ({
          product: idOf(item.product),
          orderItemId: item.orderItemId ? String(item.orderItemId) : '',
          name: item.name || '',
          sku: item.sku || '',
          unit: item.unit || 'PCS',
          qty: String(item.qty ?? 1),
          unitPrice: item.unitPrice == null ? '' : String(item.unitPrice),
          discountPercent:
            item.discountPercent == null || Number(item.discountPercent) === 0
              ? ''
              : String(item.discountPercent),
          taxRate: item.taxRate == null ? '' : String(item.taxRate),
          maxQty: null,
          manualPrice: item.manualPrice ? '1' : '',
          manualDiscount: item.manualDiscount ? '1' : '',
          isFree: Boolean(item.isFree),
          schemeName: item.schemeName || '',
        }))
      : [emptyRow()],
});

const orderRowFromOption = (row) => ({
  product: row.product,
  orderItemId: row.orderItemId,
  orderNo: row.orderNo || '',
  name: row.name || '',
  sku: row.sku || '',
  unit: row.unit || 'PCS',
  qty: String(row.remainingQty ?? row.qty ?? 1),
  unitPrice: String(row.unitPrice ?? ''),
  discountPercent:
    row.discountPercent == null || Number(row.discountPercent) === 0
      ? ''
      : String(row.discountPercent),
  taxRate: String(row.taxRate ?? ''),
  maxQty: Number(row.remainingQty ?? row.qty ?? 0),
  isFree: Boolean(row.isFree),
  schemeName: row.schemeName || '',
});

export default function InvoiceEditor() {
  const { taxIdLabel } = useTaxLabels();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [searchParams] = useSearchParams();
  // Opened from a shop visit: go back there after saving (check-out follows).
  const returnTo = (searchParams.get('returnTo') || '').startsWith('/app/') ? searchParams.get('returnTo') : '';
  const presetOrderId = searchParams.get('orderId') || '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { company, user } = useAuth();
  // Typing a price / discount by hand is a permission (direct invoices).
  const { can } = usePermissions();
  const canOverride = can('pricing.override');
  // A van salesman invoices the shop they are checked in at (Sales visit):
  // the customer is fixed, and only that shop's orders are offered. Stock
  // goes out of their van (set by the server).
  const lockedCustomer = user?.role === 'SALESMAN' ? searchParams.get('customerId') || '' : '';
  const { lookups } = useLookups();

  // From a customer visit there is no order to bill: start a direct (spot) invoice.
  const [mode, setMode] = useState(searchParams.get('customerId') && !presetOrderId ? 'direct' : 'order');
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
      orderId: presetOrderId,
      // Opened from a customer visit (My Beat): start with that customer.
      customerId: searchParams.get('customerId') || '',
      invoiceDate: todayInput(),
      dueDate: '',
      paymentMode: 'CREDIT',
      paymentTerms: 'IMMEDIATE',
      creditDays: '',
      poReference: '',
      placeOfSupply: '',
      notes: '',
      terms: '',
      footerNote: '',
      items: [],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' });
  const watchedItems = useWatch({ control, name: 'items' }) || [];
  const orderId = useWatch({ control, name: 'orderId' }) || '';
  // More orders of the same customer billed on this invoice (one delivery).
  const [extraOrderIds, setExtraOrderIds] = useState([]);
  useEffect(() => setExtraOrderIds((ids) => (ids.length ? [] : ids)), [orderId]);
  const customerId = useWatch({ control, name: 'customerId' }) || '';
  const invoiceDate = useWatch({ control, name: 'invoiceDate' }) || '';

  // ---- Existing draft ------------------------------------------------------
  const invoiceQuery = useQuery({
    queryKey: ['company', 'invoice', id],
    queryFn: async () => {
      const { data } = await api.get(`/v1/invoices/${id}`);
      return data?.data;
    },
    enabled: isEdit,
  });

  const invoice = invoiceQuery.data;
  const locked = isEdit && invoice && invoice.status !== 'DRAFT';

  useEffect(() => {
    if (!isEdit || !invoice || initialized) return;
    reset(toFormValues(invoice));
    setMode(invoice.direct || !invoice.order ? 'direct' : 'order');
    setInitialized(true);
  }, [isEdit, invoice, initialized, reset]);

  // ---- Form options (orders, products, price list, settings) ---------------
  const optionsQuery = useQuery({
    queryKey: [
      'company',
      'invoice-form-options',
      mode,
      mode === 'order' ? orderId || 'none' : 'na',
      mode === 'order' ? extraOrderIds.join(',') : 'na',
      mode === 'direct' ? customerId || 'none' : 'na',
    ],
    queryFn: async () => {
      const params = {};
      if (mode === 'order' && orderId) params.orderId = orderId;
      if (mode === 'order' && orderId && extraOrderIds.length) params.orderIds = [orderId, ...extraOrderIds].join(',');
      if (mode === 'direct' && customerId) params.customerId = customerId;
      const { data } = await api.get('/v1/invoices/form-options', { params });
      return data?.data;
    },
    enabled: initialized,
    staleTime: 30_000,
    // Keep the last lists on screen while the next order / customer loads.
    placeholderData: keepPreviousData,
  });

  const options = optionsQuery.data;
  const allowDirect = options?.settings?.invoice?.allowDirectInvoice !== false;

  const productMap = useMemo(() => {
    const map = new Map();
    (options?.products || []).forEach((p) => map.set(String(p.id), p));
    return map;
  }, [options?.products]);

  // Force a valid mode when the workspace disallows direct invoicing.
  useEffect(() => {
    if (!options || isEdit) return;
    if (!allowDirect && mode === 'direct') setMode('order');
  }, [options, allowDirect, isEdit, mode]);

  // Apply an order's remaining lines + header defaults.
  const appliedOrder = useRef(null);
  const skipOrderApply = useRef(isEdit);
  useEffect(() => {
    const order = options?.order;
    if (!order) return;
    const orderKey = (order.orderIds || [order.id]).join(',');
    if (appliedOrder.current === orderKey) return;

    if (skipOrderApply.current) {
      appliedOrder.current = orderKey;
      skipOrderApply.current = false;
      // Keep the saved quantities but learn the maximum billable quantity.
      const caps = new Map(
        (order.items || []).map((row) => [String(row.orderItemId), Number(row.remainingQty || 0)])
      );
      (getValues('items') || []).forEach((row, index) => {
        const cap = caps.get(String(row.orderItemId));
        setValue(`items.${index}.maxQty`, cap == null ? Number(row.qty) : cap);
      });
      if (!getValues('dueDate')) {
        setValue(
          'dueDate',
          dateInput(
            new Date(
              new Date(getValues('invoiceDate') || Date.now()).getTime() +
                Number(getValues('creditDays') || options?.defaults?.dueDays || 0) * 86400000
            )
          )
        );
      }
      return;
    }

    appliedOrder.current = orderKey;
    if (order.customerId) setValue('customerId', order.customerId);
    setValue('paymentMode', order.paymentMode || 'CREDIT');
    setValue('paymentTerms', order.paymentTerms || 'IMMEDIATE');
    setValue('creditDays', String(order.creditDays || 0));
    setValue('poReference', order.poReference || '');
    if (!getValues('dueDate')) {
      setValue(
        'dueDate',
        dateInput(
          new Date(
            new Date(getValues('invoiceDate') || Date.now()).getTime() +
              Number(order.creditDays || 0) * 86400000
          )
        )
      );
    }
    replace((order.items || []).map(orderRowFromOption));
  }, [options?.order, options?.defaults?.dueDays, getValues, setValue, replace]);

  // Apply customer defaults + the customer's price list on direct invoices.
  const appliedCustomer = useRef(null);
  const skipCustomerApply = useRef(isEdit);
  useEffect(() => {
    if (mode !== 'direct' || !options?.customer?.id) return;
    if (appliedCustomer.current === options.customer.id) return;

    if (skipCustomerApply.current) {
      appliedCustomer.current = options.customer.id;
      skipCustomerApply.current = false;
      return;
    }

    appliedCustomer.current = options.customer.id;
    const customer = options.customer;
    if (customer.paymentTerms) setValue('paymentTerms', customer.paymentTerms);
    if (customer.creditDays != null) setValue('creditDays', String(customer.creditDays));
    if (!getValues('dueDate')) {
      setValue(
        'dueDate',
        dateInput(
          new Date(
            new Date(getValues('invoiceDate') || Date.now()).getTime() +
              Number(customer.creditDays || 0) * 86400000
          )
        )
      );
    }

    // Reprice existing lines for the newly selected customer.
    getValues('items')?.forEach((row, index) => {
      const product = productMap.get(String(row.product));
      if (!product) return;
      const qty = Number(row.qty) || 1;
      const entry = findInvoicePriceEntry(options.priceList, product.id, qty * unitOf(product, row.unit).factor);
      setValue(`items.${index}.unitPrice`, String(priceFor(product, row.unit, qty)));
      setValue(
        `items.${index}.discountPercent`,
        entry?.discountPercent ? String(entry.discountPercent) : ''
      );
      setValue(`items.${index}.taxRate`, String(product.gstRate ?? 0));
    });
  }, [mode, options?.customer, options?.priceList, productMap, getValues, setValue]);

  // Defaults for a brand-new direct invoice.
  const defaultsApplied = useRef(false);
  useEffect(() => {
    if (!options || defaultsApplied.current) return;
    defaultsApplied.current = true;
    if (mode === 'order') {
      if (!getValues('paymentMode')) setValue('paymentMode', options.defaults?.paymentMode || 'CREDIT');
      return;
    }
    if (!getValues('paymentMode')) setValue('paymentMode', options.defaults?.paymentMode || 'CREDIT');
    if (!getValues('dueDate') && Number(options.defaults?.dueDays || 0) > 0) {
      setValue('dueDate', addDaysInput(options.defaults.dueDays));
    }
  }, [options, mode, getValues, setValue]);

  // ---- Live pricing from the server (direct: rules, schemes, free goods) --
  const pricing = useSalePricing({
    customerId,
    date: invoiceDate,
    rows: watchedItems,
    canOverride,
    enabled: initialized && mode === 'direct',
  });
  const livePricing = mode === 'direct';
  useEffect(() => {
    if (!livePricing) return;
    pricing.byRow.forEach((line, index) => {
      const row = getValues(`items.${index}`);
      if (!row) return;
      if (row.manualPrice !== '1' && row.unitPrice !== String(line.unitPrice)) setValue(`items.${index}.unitPrice`, String(line.unitPrice));
      if (row.manualDiscount !== '1') {
        const shown = Number(line.discountPercent) ? String(line.discountPercent) : '';
        if (row.discountPercent !== shown) setValue(`items.${index}.discountPercent`, shown);
      }
    });
  }, [livePricing, pricing.byRow, getValues, setValue]);

  // ---- Preview ------------------------------------------------------------
  const pricedRows = useMemo(
    () => (livePricing ? effectiveRows(watchedItems, pricing.byRow) : watchedItems),
    [livePricing, watchedItems, pricing.byRow]
  );
  const preview = useMemo(
    () =>
      computeInvoicePreview({
        items: pricedRows,
        products: productMap,
        priceList: options?.priceList,
        settings: options?.settings,
        buyerState: buyerStateOf(options?.customer),
      }),
    [pricedRows, productMap, options?.priceList, options?.settings, options?.customer]
  );

  const currency = options?.settings?.currency || company?.currency || 'INR';
  const money = (value) => formatMoney(value, currency);

  // ---- Save ---------------------------------------------------------------
  const pendingIntent = useRef('draft');

  const mutation = useMutation({
    mutationFn: async (payload) => {
      if (isEdit) {
        const { data } = await api.patch(`/v1/invoices/${id}`, payload);
        if (pendingIntent.current === 'issue') {
          const { data: issued } = await api.post(`/v1/invoices/${id}/issue`, {});
          return issued;
        }
        return data;
      }
      const { data } = await api.post('/v1/invoices', {
        ...payload,
        issue: pendingIntent.current === 'issue',
      });
      return data;
    },
    onSuccess: (payload) => {
      const saved = payload?.data;
      toast.success(payload?.message || 'Invoice saved');
      queryClient.invalidateQueries({ queryKey: ['company', 'invoices'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['company', 'credit-notes'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
      if (returnTo) navigate(returnTo, { replace: true });
      else if (saved?.id) navigate(`/app/invoices/${saved.id}`, { replace: true });
      else navigate('/app/invoices', { replace: true });
    },
    onError: (err) => {
      const e = apiError(err);
      setServerError(e);
      Object.entries(toFieldErrors(e.errors)).forEach(([field, message]) => {
        setError(field, { type: 'server', message });
      });
    },
  });

  const submitForm = (nextIntent) => {
    pendingIntent.current = nextIntent;
    setIntent(nextIntent);
    setServerError(null);
    handleSubmit((values) => {
      if (mode === 'order' && !values.orderId) {
        setError('orderId', { type: 'manual', message: 'Select the order to invoice' });
        return;
      }
      if (mode === 'direct' && !values.customerId) {
        setError('customerId', { type: 'manual', message: 'Select a customer' });
        return;
      }

      let qtyIssue = false;
      values.items.forEach((row, index) => {
        const cap = Number(row.maxQty);
        if (mode === 'order' && cap > 0 && Number(row.qty) > cap) {
          setError(`items.${index}.qty`, {
            type: 'manual',
            message: `Only ${formatNumber(cap)} left to invoice`,
          });
          qtyIssue = true;
        }
      });
      if (qtyIssue) return;

      const payload = {
        invoiceDate: values.invoiceDate || undefined,
        dueDate: values.dueDate || undefined,
        paymentMode: values.paymentMode,
        paymentTerms: values.paymentTerms,
        creditDays: num(values.creditDays),
        poReference: values.poReference || '',
        placeOfSupply: values.placeOfSupply || '',
        notes: values.notes || '',
        terms: values.terms || '',
        footerNote: values.footerNote || '',
        items:
          mode === 'order'
            ? values.items.map((item) => ({
                orderItemId: item.orderItemId,
                qty: num(item.qty),
              }))
            : // Only typed prices / discounts go up; the server prices the rest.
              values.items.map((item) => pricingInput(item, canOverride)),
      };

      if (mode === 'order' && extraOrderIds.length) payload.orderIds = [values.orderId, ...extraOrderIds];
      else if (mode === 'order') payload.orderId = values.orderId;
      else payload.customerId = values.customerId;

      mutation.mutate(payload);
    })();
  };

  const switchMode = (next) => {
    if (next === mode || isEdit) return;
    setMode(next);
    setServerError(null);
    appliedOrder.current = null;
    appliedCustomer.current = null;
    skipOrderApply.current = false;
    skipCustomerApply.current = false;
    if (next === 'order') {
      setValue('customerId', '');
      replace([]);
    } else {
      setValue('orderId', '');
      replace([emptyRow()]);
    }
  };

  /** Default price of `qty` x `unit` of a product (price list per base unit x pack size). */
  const priceFor = (product, unit, qty) => {
    const factor = unitOf(product, unit).factor;
    const entry = findInvoicePriceEntry(options?.priceList, product.id, qty * factor);
    const perBase = entry && Number(entry.price) > 0 ? Number(entry.price) : Number(product.sellingPrice ?? product.mrp ?? 0);
    return unitPriceFor(product, unit, perBase, Boolean(entry && Number(entry.price) > 0));
  };

  const changeUnit = (index, unit) => {
    const product = productMap.get(String(getValues(`items.${index}.product`)));
    if (!product) return;
    setValue(`items.${index}.unitPrice`, String(priceFor(product, unit, Number(getValues(`items.${index}.qty`)) || 1)));
  };

  const changeProduct = (index, productId) => {
    const product = productMap.get(String(productId));
    if (!product) return;
    const qty = Number(getValues(`items.${index}.qty`)) || 1;
    // A new product starts in its base unit, priced by the server again.
    setValue(`items.${index}.unit`, product.unit || 'PCS');
    setValue(`items.${index}.manualPrice`, '');
    setValue(`items.${index}.manualDiscount`, '');
    const entry = findInvoicePriceEntry(options?.priceList, productId, qty);
    setValue(`items.${index}.unitPrice`, String(priceFor(product, product.unit, qty)));
    setValue(
      `items.${index}.discountPercent`,
      entry?.discountPercent ? String(entry.discountPercent) : ''
    );
    setValue(`items.${index}.taxRate`, String(product.gstRate ?? 0));
  };

  const customerOptions = useMemo(() => {
    const list = lookups.customers || [];
    const current = invoice?.customerId;
    if (current?.id && !list.some((c) => c.id === current.id)) return [current, ...list];
    return list;
  }, [lookups.customers, invoice?.customerId]);

  // ---- Guards / loading ---------------------------------------------------
  if (isEdit && invoiceQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (isEdit && invoiceQuery.isError) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Could not load this invoice"
          description={apiError(invoiceQuery.error).message}
          action={
            <Button variant="outline" onClick={() => navigate('/app/invoices')}>
              <ArrowLeft className="h-4 w-4" /> Back to invoices
            </Button>
          }
        />
      </Card>
    );
  }

  if (locked) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={`Invoice ${invoice.invoiceNo}`}
          breadcrumbs={[
            { label: 'Invoices', to: '/app/invoices' },
            { label: invoice.invoiceNo || 'Invoice' },
          ]}
        />
        <Card>
          <EmptyState
            icon="error"
            title="This invoice can no longer be edited"
            description={`Only draft invoices can be edited. This invoice is currently ${invoice.status
              .replace(/_/g, ' ')
              .toLowerCase()}.`}
            action={
              <Button onClick={() => navigate(`/app/invoices/${invoice.id}`)}>View invoice</Button>
            }
          />
        </Card>
      </div>
    );
  }

  const itemsError = errors.items?.message || errors.items?.root?.message;
  const saving = isSubmitting || mutation.isPending;
  const direct = mode === 'direct';
  // Orders offered in the picker; the picked one always stays listed.
  const orderChoices = (() => {
    const list = (options?.orders || []).filter((o) => !lockedCustomer || o.customerId === lockedCustomer);
    const picked = options?.order;
    if (orderId && picked && picked.id === orderId && !list.some((o) => o.id === orderId)) {
      list.unshift({ id: picked.id, orderNo: picked.orderNo, customerName: picked.customerName, remainingQty: (picked.items || []).reduce((s, r) => s + Number(r.remainingQty || 0), 0) });
    }
    return list;
  })();
  const sameCustomerOrders = (options?.orders || []).filter(
    (o) => options?.order && o.customerId === options.order.customerId && o.id !== orderId && (!lockedCustomer || o.customerId === lockedCustomer)
  );
  // Where the goods come from and what is free there (van for a van salesman).
  const stockFrom = options?.stock?.warehouse || null;
  const availableFor = (row, product) => {
    if (!options?.stock || !row?.product) return null;
    const base = Number(options.stock.available?.[String(row.product)] ?? 0);
    const factor = product ? unitOf(product, row.unit).factor : 1;
    return Math.floor((base / (factor || 1)) * 100) / 100;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? `Edit ${invoice?.invoiceNo || 'draft invoice'}` : 'New invoice'}
        description={
          isEdit
            ? 'Update the draft. Totals are recalculated by the server when you save.'
            : 'Bill a confirmed order or raise a direct counter invoice. Totals are computed on save.'
        }
        breadcrumbs={[
          { label: 'Invoices', to: '/app/invoices' },
          { label: isEdit ? invoice?.invoiceNo || 'Edit draft' : 'New invoice' },
        ]}
        actions={
          <Button
            variant="outline"
            onClick={() => navigate(returnTo || (isEdit ? `/app/invoices/${id}` : '/app/invoices'))}
          >
            <ArrowLeft className="h-4 w-4" />
            Cancel
          </Button>
        }
      />

      {!isEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-card p-1">
            <button
              type="button"
              onClick={() => switchMode('order')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'order' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              From a sales order
            </button>
            <button
              type="button"
              disabled={!allowDirect}
              onClick={() => switchMode('direct')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                mode === 'direct' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              Direct invoice
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === 'order'
              ? 'Bill all or part of an order that is confirmed, dispatched or delivered.'
              : allowDirect
                ? 'Counter sale billed straight from the product price list.'
                : 'Direct invoicing is disabled in company settings.'}
          </p>
        </div>
      )}

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
            title="Could not save the invoice"
            message={serverError.message}
            errors={serverError.errors}
            onClose={() => setServerError(null)}
          />
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {/* ---- Source ---- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>{direct ? 'Customer & invoice details' : 'Order & invoice details'}</CardTitle>
                <CardDescription>
                  {direct
                    ? 'Who is being billed and when is payment due?'
                    : 'Choose the order to bill. Only unbilled quantities can be invoiced.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {direct ? (
                  <Field
                    label="Customer"
                    required
                    error={errors.customerId?.message}
                    className="sm:col-span-2"
                    hint={
                      options?.customer
                        ? `${options.customer.code || 'No code'} · ${
                            options.customer.phone || 'No phone'
                          }${options.customer.gstin ? ` · ${taxIdLabel} ${options.customer.gstin}` : ''}${
                            Number(options.customer.outstanding) > 0
                              ? ` · Outstanding ${formatMoney(
                                  options.customer.outstanding,
                                  currency
                                )}`
                              : ''
                          }`
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
                ) : (
                  <Field
                    label="Sales order"
                    required
                    error={errors.orderId?.message}
                    className="sm:col-span-2"
                    hint={
                      options?.order
                        ? `${options.order.orderNo} · ${options.order.customerName} · ordered ${formatDate(
                            options.order.orderDate
                          )}`
                        : 'Only confirmed, dispatched or delivered orders with unbilled quantity are listed.'
                    }
                  >
                    {/* Controlled: the list reloads when an order is picked, and an
                        uncontrolled select would fall back to the placeholder
                        (a blur then clears the picked order). */}
                    <Select {...register('orderId')} value={orderId} error={!!errors.orderId} disabled={isEdit}>
                      <option value="">Select an order…</option>
                      {orderChoices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.orderNo} · {o.customerName} · {formatNumber(o.remainingQty)} left
                        </option>
                      ))}
                    </Select>
                    {!isEdit && options?.order && sameCustomerOrders.length > 0 && (
                      <div className="mt-2 space-y-1 rounded-lg border p-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          More orders of {options.order.customerName} - bill them on this invoice (one delivery):
                        </p>
                        {sameCustomerOrders.map((o) => (
                          <label key={o.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="accent-primary"
                              checked={extraOrderIds.includes(o.id)}
                              onChange={(e) =>
                                setExtraOrderIds((ids) => (e.target.checked ? [...ids, o.id] : ids.filter((x) => x !== o.id)))
                              }
                            />
                            {o.orderNo} · {formatDate(o.orderDate)} · {formatNumber(o.remainingQty)} left
                          </label>
                        ))}
                      </div>
                    )}
                  </Field>
                )}

                <Field label="Invoice date" error={errors.invoiceDate?.message}>
                  <Input type="date" max={todayInput()} {...register('invoiceDate')} />
                </Field>
                <Field
                  label="Due date"
                  error={errors.dueDate?.message}
                  hint="Leave blank to derive it from the payment terms."
                >
                  <Input type="date" min={invoiceDate || todayInput()} {...register('dueDate')} />
                </Field>

                <Field label="Payment mode" error={errors.paymentMode?.message}>
                  <Select {...register('paymentMode')}>
                    {PAYMENT_MODES.map((value) => (
                      <option key={value} value={value}>
                        {paymentModeLabel(value)}
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
                <Field label="PO reference" error={errors.poReference?.message}>
                  <Input {...register('poReference')} placeholder="Customer PO / reference" />
                </Field>
                <Field label="Place of supply" error={errors.placeOfSupply?.message} className="sm:col-span-2">
                  <Input {...register('placeOfSupply')} placeholder="State used for GST supply" />
                </Field>
              </CardContent>
            </Card>

            {/* ---- Items ---- */}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <div>
                  <CardTitle>Invoice lines</CardTitle>
                  <CardDescription>
                    {direct
                      ? 'Prices default from the customer’s price list and can be overridden.'
                      : 'Quantities are capped at what is still unbilled on the order.'}
                  </CardDescription>
                </div>
                {direct && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append(emptyRow())}
                  >
                    <Plus className="h-4 w-4" /> Add item
                  </Button>
                )}
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
                        <th className="w-24 pb-2 px-2 font-medium">Qty</th>
                        <th className="w-28 pb-2 px-2 font-medium">Price</th>
                        <th className="w-20 pb-2 px-2 font-medium">Disc %</th>
                        <th className="w-24 pb-2 px-2 text-right font-medium">Amount</th>
                        {direct && <th className="w-10 pb-2 pl-2" />}
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field, index) => {
                        const row = watchedItems[index] || {};
                        const product = productMap.get(String(row.product));
                        const line = preview.lines[index];
                        const name = row.name || product?.name || '—';
                        const max = Number(row.maxQty);
                        return (
                          <tr key={field.id} className="mb-3 grid grid-cols-3 gap-x-3 rounded-lg border p-3 sm:mb-0 sm:table-row sm:rounded-none sm:border-x-0 sm:border-t-0 sm:p-0 sm:last:border-0">
                            <td className="col-span-3 py-1 pr-2 align-top sm:py-2">
                              {direct ? (
                                <>
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
                                  <LinePricingNote line={pricing.byRow.get(index)} />
                                </>
                              ) : (
                                <div>
                                  <p className="font-medium">
                                    {name}
                                    {row.isFree && (
                                      <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                        Free{row.schemeName ? ` · ${row.schemeName}` : ''}
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {row.orderNo && extraOrderIds.length ? `${row.orderNo} · ` : ''}
                                    {row.sku || product?.sku || '—'}
                                    {row.unit || product?.unit ? ` · ${row.unit || product.unit}` : ''}
                                    {max > 0 ? ` · ${formatNumber(max)} billable` : ''}
                                  </p>
                                </div>
                              )}
                              {stockFrom && row.product && (() => {
                                const avail = availableFor(row, product);
                                const short = avail != null && Number(row.qty || 0) > avail;
                                return (
                                  <p className={`mt-1 text-xs ${short ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                                    {stockFrom.type === 'VAN' ? 'Van' : 'Stock'} {stockFrom.code || stockFrom.name}: {formatNumber(avail ?? 0)} {row.unit || product?.unit || ''} available
                                  </p>
                                );
                              })()}
                            </td>
                            <td className="py-1 align-top sm:px-2 sm:py-2">
                              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:hidden">Qty</span>
                              <Input
                                type="number"
                                min="0.0001"
                                step="any"
                                max={max > 0 ? max : undefined}
                                {...register(`items.${index}.qty`)}
                                error={!!errors.items?.[index]?.qty}
                                aria-label={`Quantity for line ${index + 1}`}
                              />
                              {direct && unitOptions(product).length > 1 && (
                                <Select
                                  className="mt-1 h-8 text-xs"
                                  {...register(`items.${index}.unit`, { onChange: (e) => changeUnit(index, e.target.value) })}
                                  aria-label={`Unit for line ${index + 1}`}
                                >
                                  {unitOptions(product).map((u, i, all) => (
                                    <option key={u.unit} value={u.unit}>
                                      {u.base ? u.unit : `${u.unit} (${u.factor} ${all[0].unit})`}
                                    </option>
                                  ))}
                                </Select>
                              )}
                              {errors.items?.[index]?.qty && (
                                <p className="mt-1 text-xs text-destructive">
                                  {errors.items[index].qty.message}
                                </p>
                              )}
                            </td>
                            <td className="py-1 align-top sm:px-2 sm:py-2">
                              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:hidden">Price</span>
                              {direct ? (
                                <>
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
                                </>
                              ) : (
                                <span className="inline-flex h-10 items-center tabular-nums">
                                  {money(row.unitPrice || line?.unitPrice || 0)}
                                </span>
                              )}
                            </td>
                            <td className="py-1 align-top sm:px-2 sm:py-2">
                              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:hidden">Disc %</span>
                              {direct ? (
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
                              ) : (
                                <span className="inline-flex h-10 items-center tabular-nums text-muted-foreground">
                                  {Number(row.discountPercent) > 0 ? `${row.discountPercent}%` : '—'}
                                </span>
                              )}
                            </td>
                            <td className="col-span-2 py-1 align-top sm:px-2 sm:py-2 sm:text-right">
                              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:hidden">Amount</span>
                              <span className="font-medium tabular-nums">
                                {line ? money(line.lineTotal) : '—'}
                              </span>
                              {line && <p className="text-xs text-muted-foreground">{line.taxRate}% GST</p>}
                            </td>
                            {direct && (
                              <td className="flex items-end justify-end py-1 align-top sm:table-cell sm:py-2 sm:pl-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (fields.length === 1) replace([emptyRow()]);
                                    else remove(index);
                                  }}
                                  className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-destructive focus-ring"
                                  aria-label={`Remove line ${index + 1}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {livePricing && <FreeGoodsRows lines={pricing.freeLines} colSpan={6} />}
                    </tbody>
                  </table>
                </div>

                {fields.length === 0 && (
                  <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    {direct ? (
                      <>
                        No products yet.{' '}
                        <button
                          type="button"
                          className="font-medium text-brand-600 hover:underline"
                          onClick={() => append(emptyRow())}
                        >
                          Add your first item
                        </button>
                      </>
                    ) : options?.order ? (
                      'Everything on this order has already been invoiced.'
                    ) : (
                      'Select an order to load its unbilled lines.'
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ---- Notes ---- */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Document text</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Notes" error={errors.notes?.message} className="sm:col-span-2">
                  <Textarea {...register('notes')} rows={2} placeholder="Internal note for this invoice…" />
                </Field>
                <Field label="Terms & conditions" error={errors.terms?.message}>
                  <Textarea {...register('terms')} rows={3} placeholder="Printed on the invoice…" />
                </Field>
                <Field label="Footer note" error={errors.footerNote?.message}>
                  <Textarea {...register('footerNote')} rows={3} placeholder="Thank you for your business!" />
                </Field>
              </CardContent>
            </Card>
          </div>

          {/* ---- Summary ---- */}
          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Invoice summary</CardTitle>
                <CardDescription>
                  {preview.lines.length} line{preview.lines.length === 1 ? '' : 's'} ·{' '}
                  {formatNumber(preview.itemCount)} unit{preview.itemCount === 1 ? '' : 's'}
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
                    <span className="text-sm font-medium">Invoice total</span>
                    <span className="text-xl font-bold tabular-nums">{money(preview.total)}</span>
                  </div>
                </div>

                {!direct && options?.order && (
                  <Alert tone="info">
                    <AlertTitle>Billing {options.order.orderNo}</AlertTitle>
                    <AlertDescription>
                      This invoice can cover part or all of the order. Issue it to count the billed
                      quantity against the order.
                    </AlertDescription>
                  </Alert>
                )}

                {options?.customer && Number(options.customer.creditLimit) > 0 && (
                  <Alert
                    tone={
                      Number(options.customer.outstanding) + preview.total >
                      Number(options.customer.creditLimit)
                        ? 'warning'
                        : 'default'
                    }
                  >
                    <AlertTitle>Customer credit</AlertTitle>
                    <AlertDescription>
                      Outstanding {money(options.customer.outstanding)} of{' '}
                      {money(options.customer.creditLimit)} limit.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {livePricing && <OffersCard offers={pricing.offers} applied={pricing.applied} />}

            <div className={STICKY_ACTIONS}>
              <Button type="submit" variant="outline" disabled={saving}>
                <Save className="h-4 w-4" />
                {saving && intent === 'draft' ? 'Saving…' : 'Save draft'}
              </Button>
              <Button
                type="button"
                disabled={saving}
                loading={saving && intent === 'issue'}
                onClick={() => submitForm('issue')}
              >
                <Send className="h-4 w-4" />
                Save &amp; issue
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Issuing raises the customer outstanding immediately. Drafts can be edited or
                deleted.
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
