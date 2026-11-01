import dayjs from 'dayjs';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import { round2 } from '../models/helpers.js';
import { BadRequestError, AppError } from '../utils/errors.js';
import { nextSeries, getFinancialYearTag } from '../utils/numberSeries.js';
import { recalcInvoiceBalance, refreshInvoiceStatus } from './invoiceService.js';

/**
 * Payment domain rules (Phase 6).
 *
 * A payment only touches money once it is RECEIVED. Issue time is the single
 * place where allocations are confirmed: every requested allocation is capped
 * at the invoice's live balanceDue, the applied/unapplied split is persisted,
 * and the invoices + customer outstanding are updated. Cancel and bounce
 * reverse exactly what was applied, so history stays consistent.
 */

const EPSILON = 0.0001;
/** Invoice statuses a payment may settle. Drafts/cancelled invoices cannot be paid. */
export const PAYABLE_INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

const oid = (value) => (value?._id ? value._id : value);

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

export const nextPaymentNumber = async (companyId, settings, date = new Date()) => {
  const prefix = settings?.series?.payment?.prefix || 'RCPT';
  const pad = Number(settings?.series?.payment?.pad || 6);
  const startMonth = Number(settings?.financialYearStartMonth || 4);
  const fy = getFinancialYearTag(date, startMonth);
  return nextSeries(companyId, 'PAYMENT', { prefix, pad, fy });
};

// ---------------------------------------------------------------------------
// Apply / reverse
// ---------------------------------------------------------------------------

/**
 * Confirm allocations and settle the linked invoices.
 * Each allocation is capped at the invoice's live balanceDue; anything left
 * over after all allocations becomes an advance (`unappliedAmount`).
 * Returns { applied, unapplied, lines } where lines are the per-invoice
 * amounts actually knocked off.
 */
export const applyPayment = async (payment, invoicesById) => {
  let applied = 0;
  const lines = [];

  for (const alloc of payment.allocations || []) {
    const invoice = invoicesById.get(String(alloc.invoice));
    if (!invoice) continue; // validated upstream; defensive

    const requested = Number(alloc.amount || 0);
    if (requested <= EPSILON) continue;

    recalcInvoiceBalance(invoice);
    const knockedOff = Math.min(requested, Math.max(0, round2(Number(invoice.balanceDue || 0))));
    if (knockedOff <= EPSILON) {
      alloc.amount = 0;
      continue;
    }

    alloc.amount = knockedOff;
    invoice.amountPaid = round2(Number(invoice.amountPaid || 0) + knockedOff);
    invoice.lastPaymentAt = payment.paymentDate || new Date();
    recalcInvoiceBalance(invoice);
    refreshInvoiceStatus(invoice);
    await invoice.save();

    applied = round2(applied + knockedOff);
    lines.push({ invoice: invoice._id, invoiceNo: invoice.invoiceNo, amount: knockedOff });
  }

  const total = Number(payment.amount || 0);
  payment.amountApplied = applied;
  payment.unappliedAmount = Math.max(0, round2(total - applied));

  if (applied > EPSILON) {
    await Customer.updateOne({ _id: payment.customerId }, { $inc: { outstanding: -applied } });
  }

  return { applied, unapplied: payment.unappliedAmount, lines };
};

/** Undo everything `applyPayment` did (used on cancel / bounce). */
export const reversePayment = async (payment, invoicesById) => {
  let reversed = 0;

  for (const alloc of payment.allocations || []) {
    const knockedOff = Number(alloc.amount || 0);
    if (knockedOff <= EPSILON) continue;

    const invoice = invoicesById.get(String(alloc.invoice));
    if (!invoice) continue;

    invoice.amountPaid = Math.max(0, round2(Number(invoice.amountPaid || 0) - knockedOff));
    recalcInvoiceBalance(invoice);
    refreshInvoiceStatus(invoice);
    await invoice.save();

    reversed = round2(reversed + knockedOff);
  }

  if (reversed > EPSILON) {
    await Customer.updateOne({ _id: payment.customerId }, { $inc: { outstanding: reversed } });
  }

  return reversed;
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Load every invoice a draft payment wants to settle, verifying each is
 * payable (issued-ish, same tenant, balance remaining). Throws 422 with
 * per-line errors when a line cannot be settled.
 */
export const loadPayableInvoices = async (allocations = []) => {
  const ids = [...new Set(allocations.map((a) => String(oid(a.invoice))))]
    .filter((id) => id && id !== 'null' && id !== 'undefined');
  if (!ids.length) return new Map();

  const docs = await Invoice.find({ _id: { $in: ids } });
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const errors = [];
  allocations.forEach((alloc, index) => {
    const invoice = byId.get(String(oid(alloc.invoice)));
    if (!invoice) {
      errors.push({ field: `allocations.${index}.invoice`, message: 'Invoice not found' });
      return;
    }
    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      recalcInvoiceBalance(invoice);
      const balance = round2(Number(invoice.balanceDue || 0));
      if (balance <= EPSILON) {
        errors.push({
          field: `allocations.${index}.invoice`,
          message: `${invoice.invoiceNo} is already fully settled`,
        });
      } else {
        errors.push({
          field: `allocations.${index}.invoice`,
          message: `${invoice.invoiceNo} is ${invoice.status.toLowerCase().replace(/_/g, ' ')} and cannot be paid`,
        });
      }
    }
  });

  if (errors.length) {
    throw new AppError('One or more invoices cannot be settled by this payment', {
      status: 422,
      code: 'INVOICE_NOT_PAYABLE',
      errors,
    });
  }

  return byId;
};

/** Sum of all allocations (used to sanity-check against `amount`). */
export const allocationsTotal = (allocations = []) =>
  round2(allocations.reduce((sum, a) => sum + Number(a.amount || 0), 0));

/**
 * Validate that a payment's allocations do not exceed its total amount.
 * Over-payment of a single invoice is capped at issue time, but allocating
 * more than the money received is always a client bug.
 */
export const assertAllocationsWithinAmount = (amount, allocations = []) => {
  const total = allocationsTotal(allocations);
  if (total > Number(amount || 0) + EPSILON) {
    throw new BadRequestError(
      `Allocations (${total}) exceed the payment amount (${amount})`,
      'ALLOCATION_EXCEEDS_AMOUNT'
    );
  }
};

/** Earliest upcoming due date across a payment's invoices (display helper). */
export const dueDateHint = (invoicesById) => {
  let earliest = null;
  invoicesById.forEach((invoice) => {
    if (!invoice.dueDate) return;
    if (!earliest || dayjs(invoice.dueDate).isBefore(earliest)) earliest = invoice.dueDate;
  });
  return earliest;
};

export default {
  nextPaymentNumber,
  PAYABLE_INVOICE_STATUSES,
  applyPayment,
  reversePayment,
  loadPayableInvoices,
  allocationsTotal,
  assertAllocationsWithinAmount,
};
