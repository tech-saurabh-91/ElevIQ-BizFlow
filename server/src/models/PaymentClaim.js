import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * PaymentClaim - a customer telling the company, from the portal, "I have
 * paid": amount, how, the UPI / bank reference and a screenshot.
 *
 * Nothing changes in the books until an accountant checks the bank and
 * records it: that creates the normal payment receipt (linked here as
 * `payment`) and the claim becomes VERIFIED. Or they reject it with a reason.
 */
export const PAYMENT_CLAIM_STATUS = Object.freeze(['SUBMITTED', 'VERIFIED', 'REJECTED']);
export const PAYMENT_CLAIM_MODES = Object.freeze(['UPI', 'BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER']);

const paymentClaimSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, default: '' },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerAccount', default: null },

    amount: { type: Number, required: true, min: 0.01 },
    paidOn: { type: Date, required: true },
    mode: { type: String, enum: PAYMENT_CLAIM_MODES, default: 'UPI' },
    reference: { type: String, default: '', trim: true, maxlength: 80 },
    note: { type: String, default: '', maxlength: 500 },
    // Uploaded proof (screenshot / photo), served under /uploads/claims.
    proof: { type: String, default: '' },
    // Invoices the customer says it pays (optional).
    invoices: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' }], default: [] },

    status: { type: String, enum: PAYMENT_CLAIM_STATUS, default: 'SUBMITTED', index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectReason: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true }
);

paymentClaimSchema.plugin(tenantPlugin);
paymentClaimSchema.index({ companyId: 1, customer: 1, createdAt: -1 });

const PaymentClaim = mongoose.models.PaymentClaim || mongoose.model('PaymentClaim', paymentClaimSchema);
export default PaymentClaim;
