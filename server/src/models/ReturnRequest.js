import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * ReturnRequest - a customer's return or complaint raised from the portal
 * (damaged, expired, wrong or short goods...), with photos.
 *
 * Staff accept it (then usually issue a credit note from the invoice),
 * reject it with a reason, or close it as resolved. The customer sees each
 * step. Stock and money only move through the credit note staff create.
 */
export const RETURN_KINDS = Object.freeze(['RETURN', 'COMPLAINT']);
export const RETURN_REASONS = Object.freeze(['DAMAGED', 'EXPIRED', 'WRONG_ITEM', 'SHORT_SUPPLY', 'QUALITY', 'OTHER']);
export const RETURN_STATUS = Object.freeze(['OPEN', 'ACCEPTED', 'REJECTED', 'RESOLVED']);

const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '' },
    unit: { type: String, default: '' },
    qty: { type: Number, required: true, min: 0.0001 },
  },
  { _id: false }
);

const returnRequestSchema = new mongoose.Schema(
  {
    requestNo: { type: String, default: '' },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, default: '' },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerAccount', default: null },

    kind: { type: String, enum: RETURN_KINDS, default: 'RETURN' },
    reason: { type: String, enum: RETURN_REASONS, default: 'DAMAGED' },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    invoiceNo: { type: String, default: '' },
    items: { type: [lineSchema], default: [] },
    note: { type: String, default: '', maxlength: 1000 },
    photos: { type: [String], default: [] },

    status: { type: String, enum: RETURN_STATUS, default: 'OPEN', index: true },
    staffNote: { type: String, default: '', maxlength: 500 },
    creditNote: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditNote', default: null },
    history: {
      type: [{ _id: false, status: String, at: Date, byName: String, note: String }],
      default: [],
    },
  },
  { timestamps: true }
);

returnRequestSchema.plugin(tenantPlugin);
returnRequestSchema.index({ companyId: 1, customer: 1, createdAt: -1 });

const ReturnRequest = mongoose.models.ReturnRequest || mongoose.model('ReturnRequest', returnRequestSchema);
export default ReturnRequest;
