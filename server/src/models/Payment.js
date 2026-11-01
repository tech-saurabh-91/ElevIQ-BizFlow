import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { PAYMENT_MODES, PAYMENT_STATUS, PAYMENT_STATUS_LIST } from '../config/constants.js';

/**
 * Payment receipt (Phase 6 - Payments & Collections).
 *
 * A payment is money received from a customer. It may be:
 *   - allocated across one or more issued invoices (`allocations`), or
 *   - left unallocated as an advance on the customer account.
 *
 * Lifecycle: DRAFT -> RECEIVED -> (BOUNCED | CANCELLED).
 * Amounts are always confirmed server-side on issue: each allocation is capped
 * at the invoice's live `balanceDue`, the applied/unapplied split is stored, and
 * the linked invoices + customer outstanding are updated by `paymentService`.
 * Cancel/bounce reverses every allocation so the invoices return to their
 * previous balances (the payment document itself is kept for audit).
 */

export const PAYMENT_REASONS = Object.freeze([
  'INVOICE_SETTLEMENT',
  'PART_PAYMENT',
  'ADVANCE',
  'OTHER',
]);

const paymentAllocationSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    invoiceNo: { type: String, default: '', trim: true },
    /** Amount of this payment knocked off this invoice (confirmed on issue). */
    amount: money(),
  },
  { _id: true }
);

const paymentStatusEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: PAYMENT_STATUS_LIST, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    note: { type: String, default: '', maxlength: 500 },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    paymentNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    paymentDate: { type: Date, default: Date.now, index: true },

    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    customerName: { type: String, default: '', trim: true },
    customerCode: { type: String, default: '', trim: true },
    customerPhone: { type: String, default: '', trim: true },

    /** Total money received on this receipt. */
    amount: money(),

    /** How the money is knocked off invoices. Empty => full advance. */
    allocations: { type: [paymentAllocationSchema], default: [] },

    /** Confirmed on issue: how much actually settled invoices vs. advance. */
    amountApplied: money(),
    unappliedAmount: money(),

    reason: { type: String, enum: PAYMENT_REASONS, default: 'INVOICE_SETTLEMENT', index: true },

    mode: { type: String, enum: PAYMENT_MODES, default: 'CASH', index: true },
    reference: { type: String, default: '', trim: true, maxlength: 100 }, // UTR / txn id / cheque no
    bankName: { type: String, default: '', trim: true, maxlength: 120 },
    chequeDate: { type: Date, default: null },
    notes: { type: String, default: '', maxlength: 1000 },

    /** Field user who collected the money (drives salesman/manager scoping). */
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    status: { type: String, enum: PAYMENT_STATUS_LIST, default: PAYMENT_STATUS.DRAFT, index: true },
    statusHistory: { type: [paymentStatusEntrySchema], default: [] },

    receivedAt: { type: Date, default: null },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    bouncedAt: { type: Date, default: null },
    bounceReason: { type: String, default: '', maxlength: 500 },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },

    source: { type: String, enum: ['WEB', 'MOBILE', 'IMPORT', 'API'], default: 'WEB' },
  },
  { timestamps: true }
);

paymentSchema.index(
  { companyId: 1, paymentNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
paymentSchema.index({ companyId: 1, customerId: 1, paymentDate: -1 });
paymentSchema.index({ companyId: 1, status: 1, paymentDate: -1 });
paymentSchema.index({ companyId: 1, 'allocations.invoice': 1, status: 1 });

paymentSchema.plugin(tenantPlugin);

paymentSchema.virtual('label').get(function label() {
  return this.paymentNo || String(this._id);
});

/** Allocation state derived from the applied amount (UNAPPLIED | PARTIALLY_APPLIED | FULLY_APPLIED). */
paymentSchema.virtual('allocationStatus').get(function allocationStatus() {
  const total = Number(this.amount || 0);
  const applied = Number(this.amountApplied || 0);
  if (applied <= 0.0001) return 'UNAPPLIED';
  if (applied + 0.0001 >= total) return 'FULLY_APPLIED';
  return 'PARTIALLY_APPLIED';
});

const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
export default Payment;
