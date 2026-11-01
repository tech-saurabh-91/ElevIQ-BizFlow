import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { addressSchema } from './common.js';
import { CREDIT_NOTE_STATUS, CREDIT_NOTE_STATUS_LIST } from '../config/constants.js';

/**
 * Credit note (sales return / rate difference / damage).
 *
 * A credit note always points at an issued invoice. When issued it reduces the
 * invoice balance (`balanceDue`) and the customer outstanding by the amount it
 * could actually settle (`appliedAmount`). Any excess is kept as
 * `unappliedAmount` for future customer credit handling.
 */

export const CREDIT_NOTE_REASONS = Object.freeze([
  'SALES_RETURN',
  'RATE_DIFFERENCE',
  'DAMAGE',
  'SHORTAGE',
  'DISCOUNT',
  'OTHER',
]);

const creditNoteItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    /** Invoice line this credit note line reverses (optional for free-text lines). */
    invoiceItemId: { type: mongoose.Schema.Types.ObjectId, default: null },

    name: { type: String, default: '', trim: true },
    sku: { type: String, default: '', trim: true },
    unit: { type: String, default: 'PCS', trim: true },
    hsnCode: { type: String, default: '', trim: true },

    qty: { type: Number, required: true, min: 0.0001 },
    unitPrice: money(),
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: money(),

    taxRate: { type: Number, default: 0, min: 0, max: 28 },
    taxableAmount: money(),
    taxAmount: money(),
    lineTotal: money(),

    note: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { _id: true }
);

const creditNoteStatusEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: CREDIT_NOTE_STATUS_LIST, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    note: { type: String, default: '', maxlength: 500 },
  },
  { _id: false }
);

const creditNoteSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    creditNoteNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    creditNoteDate: { type: Date, default: Date.now, index: true },

    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    invoiceNo: { type: String, default: '', trim: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    orderNo: { type: String, default: '', trim: true },

    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    customerName: { type: String, default: '', trim: true },
    customerCode: { type: String, default: '', trim: true },
    customerPhone: { type: String, default: '', trim: true },
    customerGstin: { type: String, default: '', trim: true },
    billingAddress: { type: addressSchema, default: () => ({}) },

    salesman: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    reason: { type: String, enum: CREDIT_NOTE_REASONS, default: 'SALES_RETURN', index: true },
    reasonNote: { type: String, default: '', maxlength: 1000 },

    items: { type: [creditNoteItemSchema], default: [] },
    itemCount: { type: Number, default: 0, min: 0 },

    subtotal: money(),
    discountTotal: money(),
    taxableTotal: money(),
    taxTotal: money(),
    taxBreakup: {
      cgst: { type: Number, default: 0 },
      sgst: { type: Number, default: 0 },
      igst: { type: Number, default: 0 },
    },
    roundOff: { type: Number, default: 0 },
    total: money(),

    /** Amount actually knocked off the linked invoice when this note was issued. */
    appliedAmount: money(),
    unappliedAmount: money(),

    status: { type: String, enum: CREDIT_NOTE_STATUS_LIST, default: CREDIT_NOTE_STATUS.DRAFT, index: true },
    statusHistory: { type: [creditNoteStatusEntrySchema], default: [] },

    issuedAt: { type: Date, default: null },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },

    notes: { type: String, default: '', maxlength: 1000 },
    source: { type: String, enum: ['WEB', 'MOBILE', 'IMPORT', 'API'], default: 'WEB' },
  },
  { timestamps: true }
);

creditNoteSchema.index(
  { companyId: 1, creditNoteNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
creditNoteSchema.index({ companyId: 1, invoice: 1, status: 1 });
creditNoteSchema.index({ companyId: 1, customerId: 1, creditNoteDate: -1 });
creditNoteSchema.index({ companyId: 1, status: 1, creditNoteDate: -1 });

creditNoteSchema.pre('validate', function syncCounters(next) {
  if (Array.isArray(this.items)) {
    this.itemCount = this.items.reduce((sum, i) => sum + Number(i.qty || 0), 0);
  }
  next();
});

creditNoteSchema.plugin(tenantPlugin);

creditNoteSchema.virtual('label').get(function label() {
  return this.creditNoteNo || String(this._id);
});

const CreditNote = mongoose.models.CreditNote || mongoose.model('CreditNote', creditNoteSchema);
export default CreditNote;
