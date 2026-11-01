import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { apiError } from '@/api/client';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { titleCase } from '@/utils/format';

/**
 * Shared Phase 5 invoice / credit-note helpers: status vocabularies, action
 * availability, workflow dialogs, blob downloads and the cosmetic preview.
 *
 * The preview only mirrors `invoiceService.priceLineValues` for instant
 * feedback — the server always recomputes and returns the authoritative money.
 */

export const INVOICE_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
];

export const CREDIT_NOTE_STATUSES = ['DRAFT', 'ISSUED', 'CANCELLED'];

export const CREDIT_NOTE_REASONS = [
  'SALES_RETURN',
  'RATE_DIFFERENCE',
  'DAMAGE',
  'SHORTAGE',
  'DISCOUNT',
  'OTHER',
];

export const creditNoteReasonLabel = (value) =>
  String(value || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const statusLabel = (status) => titleCase(status || '');

export const idOf = (value) =>
  value && typeof value === 'object' ? value.id || value._id || '' : value || '';

/** Actions a user may take on an invoice. */
export const invoiceActionsFor = (invoice, can) => {
  if (!invoice) return [];
  const status = invoice.status;
  const out = [];

  if (status === 'DRAFT' && can('invoices.update')) out.push('issue');
  if (
    ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].includes(status) &&
    can('invoices.cancel') &&
    Number(invoice.amountPaid || 0) === 0 &&
    Number(invoice.creditNoteTotal || 0) === 0
  ) {
    out.push('cancel');
  }
  return out;
};

/** Actions a user may take on a credit note. */
export const creditNoteActionsFor = (note, can) => {
  if (!note) return [];
  const out = [];
  if (note.status === 'DRAFT' && can('creditnotes.update')) out.push('issue');
  if (note.status === 'ISSUED' && can('creditnotes.cancel')) out.push('cancel');
  return out;
};

const INVOICE_ACTION_META = {
  issue: {
    title: 'Issue this invoice?',
    description:
      'Issuing locks the invoice, raises the customer outstanding and starts the payment clock.',
    confirmLabel: 'Issue invoice',
    field: 'note',
    fieldLabel: 'Note (optional)',
    tone: 'primary',
  },
  cancel: {
    title: 'Cancel this invoice?',
    description:
      'Unpaid invoices can be cancelled. Cancelling reverses the outstanding balance and re-opens the linked order quantity for invoicing.',
    confirmLabel: 'Cancel invoice',
    field: 'reason',
    fieldLabel: 'Cancellation reason',
    required: true,
    tone: 'destructive',
  },
};

const CREDIT_NOTE_ACTION_META = {
  issue: {
    title: 'Issue this credit note?',
    description:
      'Issuing applies the credit to the linked invoice and reduces the customer outstanding.',
    confirmLabel: 'Issue credit note',
    field: 'note',
    fieldLabel: 'Note (optional)',
    tone: 'primary',
  },
  cancel: {
    title: 'Cancel this credit note?',
    description:
      'Cancelling reverses the applied amount, restoring the invoice balance and customer outstanding.',
    confirmLabel: 'Cancel credit note',
    field: 'reason',
    fieldLabel: 'Cancellation reason',
    required: true,
    tone: 'destructive',
  },
};

/**
 * Generic one-field workflow dialog. `endpoint` receives a POST with either
 * `{ note }` or `{ reason }` depending on the action.
 */
function WorkflowDialog({
  open,
  onClose,
  onDone,
  meta,
  subject,
  endpoint,
  errorTitle,
  invalidateKeys = [],
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText('');
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = text.trim() ? { [meta.field]: text.trim() } : {};
      const { data } = await api.post(endpoint, body);
      return data;
    },
    onSuccess: (payload) => {
      toast.success(payload?.message || 'Updated');
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
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
      description={subject || meta.description}
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
        {!meta.required && <p className="text-sm text-muted-foreground">{meta.description}</p>}
        <Field label={meta.fieldLabel} required={meta.required}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={meta.required ? 'Explain the reason…' : 'Optional note…'}
            autoFocus
          />
        </Field>
        {err && <ErrorAlert title={errorTitle} message={err.message} errors={err.errors} />}
      </div>
    </Dialog>
  );
}

export function InvoiceActionDialog({ action, invoice, open, onClose, onDone }) {
  const meta = INVOICE_ACTION_META[action];
  if (!meta) return null;

  return (
    <WorkflowDialog
      open={open}
      onClose={onClose}
      onDone={onDone}
      meta={meta}
      subject={invoice ? `${invoice.invoiceNo || 'Invoice'} · ${invoice.customerName || ''}` : undefined}
      endpoint={`/v1/invoices/${invoice?.id}/${action}`}
      errorTitle="Could not update the invoice"
      invalidateKeys={[
        ['company', 'invoices'],
        ['company', 'invoice', invoice?.id],
        ['company', 'credit-notes'],
        ['company', 'orders'],
        ['company', 'dashboard'],
        ['company', 'customers'],
      ]}
    />
  );
}

export function CreditNoteActionDialog({ action, note, open, onClose, onDone }) {
  const meta = CREDIT_NOTE_ACTION_META[action];
  if (!meta) return null;

  return (
    <WorkflowDialog
      open={open}
      onClose={onClose}
      onDone={onDone}
      meta={meta}
      subject={note ? `${note.creditNoteNo || 'Credit note'} · ${note.customerName || ''}` : undefined}
      endpoint={`/v1/credit-notes/${note?.id}/${action}`}
      errorTitle="Could not update the credit note"
      invalidateKeys={[
        ['company', 'credit-notes'],
        ['company', 'credit-note', note?.id],
        ['company', 'invoices'],
        ['company', 'invoice', idOf(note?.invoice)],
        ['company', 'dashboard'],
        ['company', 'customers'],
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Downloads (bearer token is memory-only, so blobs go through Axios)
// ---------------------------------------------------------------------------

const openBlobInTab = async (path, mime, label) => {
  const win = window.open('', '_blank');
  try {
    const { data } = await api.get(path, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    if (win) win.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    if (win) win.close();
    toast.error(apiError(err).message || `Could not open the ${label}`);
  }
};

const downloadBlob = async (path, params, filename, mime, successMessage) => {
  try {
    const { data } = await api.get(path, { params, responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast.success(successMessage);
  } catch (err) {
    toast.error(apiError(err).message);
  }
};

export const openInvoicePdf = (invoice) =>
  openBlobInTab(`/v1/invoices/${invoice.id}/pdf`, 'application/pdf', 'invoice');

export const openCreditNotePdf = (note) =>
  openBlobInTab(`/v1/credit-notes/${note.id}/pdf`, 'application/pdf', 'credit note');

export const downloadInvoicesXlsx = (params = {}) =>
  downloadBlob(
    '/v1/invoices/export',
    params,
    `invoices-${new Date().toISOString().slice(0, 10)}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Invoice register exported'
  );

export const downloadCreditNotesXlsx = (params = {}) =>
  downloadBlob(
    '/v1/credit-notes/export',
    params,
    `credit-notes-${new Date().toISOString().slice(0, 10)}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Credit note register exported'
  );

// ---------------------------------------------------------------------------
// Cosmetic preview (mirrors the server pricing engine)
// ---------------------------------------------------------------------------

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const findInvoicePriceEntry = (priceList, productId, qty) => {
  const items = priceList?.items || [];
  return (
    items
      .filter((i) => String(i.product) === String(productId))
      .filter((i) => Number(qty) >= Number(i.minQty || 1))
      .sort((a, b) => Number(b.minQty || 1) - Number(a.minQty || 1))[0] || null
  );
};

export const priceInvoiceLine = (row, { products, priceList, settings }) => {
  const product = products?.get(String(row.product)) || null;
  const qty = Number(row.qty) || 0;
  const entry = product ? findInvoicePriceEntry(priceList, product.id, qty) : null;

  const base =
    entry && Number(entry.price) > 0
      ? Number(entry.price)
      : Number(product?.sellingPrice ?? product?.mrp ?? row.unitPrice ?? 0);

  const unitPrice =
    row.unitPrice === '' || row.unitPrice == null ? base : Number(row.unitPrice);

  const discountPercent =
    row.discountPercent === '' || row.discountPercent == null
      ? Number(entry?.discountPercent || 0)
      : Number(row.discountPercent);

  const taxRate =
    row.taxRate === '' || row.taxRate == null
      ? Number(product?.gstRate ?? 0)
      : Number(row.taxRate);

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
    unitPrice: round2(unitPrice),
    discountPercent: round2(discountPercent),
    discountAmount,
    taxRate,
    taxableAmount,
    taxAmount,
    lineTotal,
  };
};

export const computeInvoicePreview = ({ items = [], products, priceList, settings }) => {
  const lines = items
    .map((row) => priceInvoiceLine(row, { products, priceList, settings }))
    .filter(Boolean);

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

  const splitCgst = settings?.tax?.enableCgstSgst !== false;
  const taxBreakup = splitCgst
    ? { cgst: round2(taxTotal / 2), sgst: round2(taxTotal - round2(taxTotal / 2)), igst: 0 }
    : { cgst: 0, sgst: 0, igst: taxTotal };

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

export default InvoiceActionDialog;
