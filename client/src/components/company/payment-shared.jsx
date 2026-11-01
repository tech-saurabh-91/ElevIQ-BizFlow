import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { apiError } from '@/api/client';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { ErrorAlert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { titleCase } from '@/utils/format';

/**
 * Shared Phase 6 payment helpers: status vocabularies, action availability,
 * workflow dialogs (receive / cancel / bounce) and blob downloads.
 *
 * Lifecycle: DRAFT -> RECEIVED -> (BOUNCED | CANCELLED). Drafts are editable;
 * receiving settles the linked invoices; cancel/bounce reverses exactly what
 * was applied.
 */

export const PAYMENT_STATUSES = ['DRAFT', 'RECEIVED', 'BOUNCED', 'CANCELLED'];

export const PAYMENT_MODES = ['CASH', 'UPI', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'OTHER'];

export const PAYMENT_REASONS = [
  'INVOICE_SETTLEMENT',
  'PART_PAYMENT',
  'ADVANCE',
  'OTHER',
];

export const paymentModeLabel = (value) => titleCase(String(value || '').replace(/_/g, ' '));

export const paymentReasonLabel = (value) => titleCase(String(value || '').replace(/_/g, ' '));

export const statusLabel = (status) => titleCase(String(status || '').replace(/_/g, ' '));

export const idOf = (value) =>
  value && typeof value === 'object' ? value.id || value._id || '' : value || '';

/** Actions a user may take on a payment. */
export const paymentActionsFor = (payment, can) => {
  if (!payment) return [];
  const status = payment.status;
  const out = [];

  if (status === 'DRAFT' && can('payments.update')) out.push('receive');
  if (status === 'RECEIVED' && can('payments.cancel')) out.push('bounce', 'cancel');
  return out;
};

const PAYMENT_ACTION_META = {
  receive: {
    title: 'Receive this payment?',
    description:
      'Receiving confirms the money and knocks the allocated amounts off the linked invoices, updating the customer outstanding.',
    confirmLabel: 'Receive payment',
    field: 'note',
    fieldLabel: 'Note (optional)',
    tone: 'primary',
  },
  cancel: {
    title: 'Cancel this payment?',
    description:
      'Cancelling reverses every allocation, restoring the invoice balances and customer outstanding. The receipt is kept for audit.',
    confirmLabel: 'Cancel payment',
    field: 'reason',
    fieldLabel: 'Cancellation reason',
    required: true,
    tone: 'destructive',
  },
  bounce: {
    title: 'Mark this payment as bounced?',
    description:
      'A bounced cheque or failed transfer reverses the applied amounts so the invoices become payable again.',
    confirmLabel: 'Mark as bounced',
    field: 'reason',
    fieldLabel: 'Bounce reason',
    required: true,
    tone: 'destructive',
  },
};

/**
 * Generic one-field workflow dialog. `endpoint` receives a POST with either
 * `{ note }` or `{ reason }` depending on the action.
 */
function PaymentWorkflowDialog({ open, onClose, onDone, meta, subject, endpoint, errorTitle, invalidateKeys = [] }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');

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

export function PaymentActionDialog({ action, payment, open, onClose, onDone }) {
  const meta = PAYMENT_ACTION_META[action];
  if (!meta) return null;

  return (
    <PaymentWorkflowDialog
      open={open}
      onClose={onClose}
      onDone={onDone}
      meta={meta}
      subject={payment ? `${payment.paymentNo || 'Payment'} · ${payment.customerName || ''}` : undefined}
      endpoint={`/v1/payments/${payment?.id}/${action}`}
      errorTitle="Could not update the payment"
      invalidateKeys={[
        ['company', 'payments'],
        ['company', 'payment', payment?.id],
        ['company', 'invoices'],
        ['company', 'invoice', idOf(payment?.allocations?.[0]?.invoice)],
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

export const openPaymentPdf = (payment) =>
  openBlobInTab(`/v1/payments/${payment.id}/pdf`, 'application/pdf', 'receipt');

export const downloadPaymentsXlsx = (params = {}) =>
  downloadBlob(
    '/v1/payments/export',
    params,
    `payments-${new Date().toISOString().slice(0, 10)}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Payment register exported'
  );

export default PaymentActionDialog;
