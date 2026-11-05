import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { apiError } from '@/api/client';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { titleCase } from '@/utils/format';
import { taxBreakupFor, effectiveTaxRate } from '@/utils/tax';
import { unitOf, unitPriceFor } from '@/utils/units';

/**
 * Shared Phase 4 order helpers: workflow actions, document downloads and the
 * client-side pricing preview that mirrors `orderService.buildOrderLines`.
 *
 * The preview is cosmetic only — the server always recomputes and returns the
 * authoritative totals when an order is saved.
 */

export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'CONFIRMED',
  'PARTIALLY_INVOICED',
  'FULLY_INVOICED',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
];

export const PAYMENT_MODES = [
  'CASH',
  'CREDIT',
  'UPI',
  'CHEQUE',
  'BANK_TRANSFER',
  'CARD',
  'OTHER',
];

export const PAYMENT_TERMS = ['IMMEDIATE', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'CUSTOM'];

export const statusLabel = (status) => titleCase(status || '');

export const paymentModeLabel = (mode) =>
  String(mode || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const orderIdOf = (value) =>
  value && typeof value === 'object' ? value.id || value._id || '' : value || '';

/** Actions the current user may run on a given order. */
export const orderActionsFor = (order, can) => {
  if (!order) return [];
  const status = order.status;
  const out = [];

  if (status === 'DRAFT' && can('orders.update')) out.push('submit');
  if (status === 'PENDING_APPROVAL' && can('orders.approve')) out.push('approve', 'reject');
  // Dispatch / deliver move godown stock - the warehouse team's job.
  if (['CONFIRMED', 'PARTIALLY_INVOICED', 'FULLY_INVOICED'].includes(status) && can('orders.dispatch')) {
    out.push('dispatch');
  }
  if (status === 'DISPATCHED' && can('orders.dispatch')) out.push('deliver');
  if (
    ['DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'PARTIALLY_INVOICED'].includes(status) &&
    can('orders.cancel')
  ) {
    out.push('cancel');
  }
  return out;
};

const ACTION_META = {
  submit: {
    title: 'Submit this order?',
    description: 'Stock and credit limits are checked again before the order is confirmed.',
    confirmLabel: 'Submit order',
    field: 'note',
    fieldLabel: 'Note (optional)',
  },
  approve: {
    title: 'Approve this order?',
    description: 'Approving confirms the order and counts it in the customer’s sales.',
    confirmLabel: 'Approve order',
    field: 'note',
    fieldLabel: 'Approval note (optional)',
    tone: 'primary',
  },
  reject: {
    title: 'Reject this order?',
    description: 'The salesman will see the rejection reason on the order.',
    confirmLabel: 'Reject order',
    field: 'reason',
    fieldLabel: 'Rejection reason',
    required: true,
    tone: 'destructive',
  },
  cancel: {
    title: 'Cancel this order?',
    description: 'Confirmed orders are removed from the customer’s sales totals when cancelled.',
    confirmLabel: 'Cancel order',
    field: 'reason',
    fieldLabel: 'Cancellation reason (optional)',
    tone: 'destructive',
  },
  dispatch: {
    title: 'Mark as dispatched?',
    description: 'Record that the goods have left the warehouse.',
    confirmLabel: 'Mark dispatched',
    field: 'note',
    fieldLabel: 'Dispatch note (optional)',
  },
  deliver: {
    title: 'Mark as delivered?',
    description: 'Confirm that the customer has received the goods.',
    confirmLabel: 'Mark delivered',
    field: 'note',
    fieldLabel: 'Delivery note (optional)',
  },
};

/**
 * Modal that runs one workflow transition (`submit`, `approve`, `reject`,
 * `cancel`, `dispatch`, `deliver`) and refreshes the affected queries.
 */
export function OrderActionDialog({ action, order, open, onClose, onDone }) {
  const queryClient = useQueryClient();
  const meta = ACTION_META[action] || ACTION_META.submit;
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText('');
  }, [open, action]);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = text.trim() ? { [meta.field]: text.trim() } : {};
      const { data } = await api.post(`/v1/orders/${order.id}/${action}`, body);
      return data;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Order updated');
      queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'order', order?.id] });
      queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
      onDone?.(payload?.data);
      onClose?.();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const err = mutation.error ? apiError(mutation.error) : null;
  const invalid = meta.required && text.trim().length < 3;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={meta.title}
      description={order ? `${order.orderNo || 'Order'} · ${order.customerName || ''}` : meta.description}
      size="sm"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant={meta.tone === 'destructive' ? 'destructive' : 'default'}
            onClick={() => mutation.mutate()}
            disabled={invalid}
            loading={mutation.isPending}
          >
            {meta.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {action !== 'reject' && (
          <p className="text-sm text-muted-foreground">{meta.description}</p>
        )}
        <Field
          label={meta.fieldLabel}
          required={meta.required}
          error={invalid && text.trim().length > 0 ? 'Enter at least 3 characters' : undefined}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={meta.required ? 'Explain why this order is being rejected…' : 'Optional note…'}
            autoFocus
          />
        </Field>
        {err && <ErrorAlert title="Could not update the order" message={err.message} errors={err.errors} />}
      </div>
    </Dialog>
  );
}

/** Fetch the PDF with the bearer token, then show it in a new tab. */
export const openOrderPdf = async (order) => {
  const win = window.open('', '_blank');
  try {
    const { data } = await api.get(`/v1/orders/${order.id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    if (win) win.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    if (win) win.close();
    toast.error(apiError(err).message);
  }
};

/** Download the filtered order register as Excel. */
export const downloadOrdersXlsx = async (params = {}) => {
  try {
    const { data } = await api.get('/v1/orders/export', { params, responseType: 'blob' });
    const url = URL.createObjectURL(
      new Blob([data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast.success('Order register exported');
  } catch (err) {
    toast.error(apiError(err).message);
  }
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const findPriceEntry = (priceList, productId, qty) => {
  const items = priceList?.items || [];
  return (
    items
      .filter((i) => String(i.product) === String(productId))
      .filter((i) => Number(qty) >= Number(i.minQty || 1))
      .sort((a, b) => Number(b.minQty || 1) - Number(a.minQty || 1))[0] || null
  );
};

/** Default price of one `unit` (base unit or a pack) for `qty` of that unit. */
export const basePriceFromProduct = (product, priceList, qty, unit) => {
  const factor = unitOf(product, unit).factor;
  const entry = findPriceEntry(priceList, product?.id, Number(qty) * factor);
  const perBase = entry && Number(entry.price) > 0 ? Number(entry.price) : Number(product?.sellingPrice ?? product?.mrp ?? 0);
  return unitPriceFor(product, unit, perBase, Boolean(entry && Number(entry.price) > 0));
};

/** Derive one priced line exactly like the server does. */
export const priceLine = (row, { products, priceList, settings }) => {
  const product = products.get(String(row.product));
  if (!product) return null;

  const qty = Number(row.qty) || 0;
  const unit = unitOf(product, row.unit);
  const entry = findPriceEntry(priceList, product.id, qty * unit.factor);
  const base = basePriceFromProduct(product, priceList, qty, unit.unit);
  const unitPrice = row.unitPrice === '' || row.unitPrice == null ? base : Number(row.unitPrice);
  const discountPercent =
    row.discountPercent === '' || row.discountPercent == null
      ? Number(entry?.discountPercent || 0)
      : Number(row.discountPercent);
  const taxRate = effectiveTaxRate(product.gstRate ?? 0, settings);

  const gross = round2(qty * unitPrice);
  const discountAmount = round2((gross * discountPercent) / 100);
  const net = round2(gross - discountAmount);
  const taxInclusive = Boolean(settings?.tax?.taxInclusive);

  let taxableAmount;
  let taxAmount;
  let lineTotal;
  if (taxInclusive) {
    taxableAmount = round2(net / (1 + taxRate / 100));
    taxAmount = round2(net - taxableAmount);
    lineTotal = net;
  } else {
    taxableAmount = net;
    taxAmount = round2((net * taxRate) / 100);
    lineTotal = round2(net + taxAmount);
  }

  return {
    product,
    qty,
    unit: unit.unit,
    unitFactor: unit.factor,
    baseQty: qty * unit.factor,
    unitPrice: round2(unitPrice),
    discountPercent: round2(discountPercent),
    discountAmount,
    taxRate,
    taxableAmount,
    taxAmount,
    lineTotal,
  };
};

/** Whole-order preview (subtotal → discount → tax → rounding → total). */
export const computeOrderPreview = ({ items = [], products, priceList, settings, buyerState }) => {
  const lines = items.map((row) => priceLine(row, { products, priceList, settings })).filter(Boolean);

  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const discountTotal = round2(lines.reduce((s, l) => s + l.discountAmount, 0));
  const taxableTotal = round2(lines.reduce((s, l) => s + l.taxableAmount, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  const rawTotal = round2(taxableTotal + taxTotal);

  const mode = settings?.invoice?.rounding || 'NEAREST';
  const rounded =
    mode === 'NONE' ? rawTotal : mode === 'DOWN' ? Math.floor(rawTotal) : Math.round(rawTotal);
  const roundOff = round2(rounded - rawTotal);
  const total = round2(rounded);

  const taxBreakup = taxBreakupFor(taxTotal, settings, buyerState);

  return {
    lines,
    subtotal,
    discountTotal,
    taxableTotal,
    taxTotal,
    roundOff,
    total,
    taxBreakup,
    itemCount: items.reduce((s, i) => s + (Number(i.qty) || 0), 0),
  };
};

export default OrderActionDialog;
