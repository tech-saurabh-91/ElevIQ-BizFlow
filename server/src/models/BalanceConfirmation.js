import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * BalanceConfirmation - a customer's answer, from the portal, to "is this your
 * balance with us?": CONFIRMED, or DISPUTED with a note. Staff see the latest
 * one on the customer's statement.
 */
export const BALANCE_CONFIRMATION_STATUS = Object.freeze(['CONFIRMED', 'DISPUTED']);

const balanceConfirmationSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerAccount', default: null },
    asOf: { type: Date, required: true },
    // Closing balance shown to the customer (+ = they owe the company).
    balance: { type: Number, required: true },
    status: { type: String, enum: BALANCE_CONFIRMATION_STATUS, required: true },
    note: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

balanceConfirmationSchema.plugin(tenantPlugin);
balanceConfirmationSchema.index({ companyId: 1, customer: 1, createdAt: -1 });

const BalanceConfirmation =
  mongoose.models.BalanceConfirmation || mongoose.model('BalanceConfirmation', balanceConfirmationSchema);
export default BalanceConfirmation;
