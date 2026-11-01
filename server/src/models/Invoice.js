import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { addressSchema } from './common.js';
import { INVOICE_STATUS, INVOICE_STATUS_LIST, PAYMENT_TERMS } from '../config/constants.js';
import { ORDER_PAYMENT_MODES } from './Order.js';

/**
 * Tax invoice.
 *
 * An invoice can be raised directly (retail counter sale) or generated from a
 * confirmed sales order. Every line keeps the product/price/tax snapshot so a
 * later master-data change never rewrites an issued document.
 *
 * Financials are always recomputed on the server; the client only sends the
 * quantities to bill (and optional overrides on direct invoices).
 */

const invoiceItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    /** Order line this invoice line was generated from (order-based invoices). */
    orderItemId: { type: mongoose.Schema.Types.ObjectId, default: null },

    name: { type: String, default: '', trim: true },
    sku: { type: String, default: '', trim: true },
    unit: { type: String, default: 'PCS', trim: true },
    hsnCode: { type: String, default: '', trim: true },

    qty: { type: Number, required: true, min: 0.0001 },
    freeQty: { type: Number, default: 0, min: 0 },

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

const invoiceStatusEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: INVOICE_STATUS_LIST, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    note: { type: String, default: '', maxlength: 500 },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    invoiceNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    invoiceDate: { type: Date, default: Date.now, index: true },
    dueDate: { type: Date, default: null, index: true },

    /** Source sales order (null for a direct/counter invoice). */
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    orderNo: { type: String, default: '', trim: true },
    direct: { type: Boolean, default: false, index: true },

    // Customer + snapshot
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, default: '', trim: true },
    customerCode: { type: String, default: '', trim: true },
    customerPhone: { type: String, default: '', trim: true },
    customerGstin: { type: String, default: '', trim: true },
    billingAddress: { type: addressSchema, default: () => ({}) },
    shippingAddress: { type: addressSchema, default: () => ({}) },

    // Ownership / fulfilment
    salesman: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: null },
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },

    items: { type: [invoiceItemSchema], default: [] },
    itemCount: { type: Number, default: 0, min: 0 },

    // Money (all server-computed)
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

    /** Collections progress (Phase 6 payments maintain these). */
    amountPaid: money(),
    balanceDue: money(),
    creditNoteTotal: money(),
    creditNoteCount: { type: Number, default: 0, min: 0 },
    lastPaymentAt: { type: Date, default: null },

    // Commercial terms
    paymentMode: { type: String, enum: ORDER_PAYMENT_MODES, default: 'CREDIT' },
    paymentTerms: { type: String, enum: PAYMENT_TERMS, default: 'IMMEDIATE' },
    creditDays: { type: Number, default: 0, min: 0, max: 365 },
    poReference: { type: String, default: '', trim: true, maxlength: 60 },
    placeOfSupply: { type: String, default: '', trim: true, maxlength: 120 },

    // Document text
    notes: { type: String, default: '', maxlength: 1000 },
    terms: { type: String, default: '', maxlength: 2000 },
    footerNote: { type: String, default: '', maxlength: 500 },

    // Workflow
    status: { type: String, enum: INVOICE_STATUS_LIST, default: INVOICE_STATUS.DRAFT, index: true },
    statusHistory: { type: [invoiceStatusEntrySchema], default: [] },

    issuedAt: { type: Date, default: null },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },

    source: { type: String, enum: ['WEB', 'MOBILE', 'IMPORT', 'API'], default: 'WEB' },
  },
  { timestamps: true }
);

invoiceSchema.index(
  { companyId: 1, invoiceNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
invoiceSchema.index({ companyId: 1, customerId: 1, invoiceDate: -1 });
invoiceSchema.index({ companyId: 1, status: 1, invoiceDate: -1 });
invoiceSchema.index({ companyId: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ companyId: 1, order: 1 });
invoiceSchema.index({ companyId: 1, invoiceDate: -1 });

/** Recompute derived counters before validation. */
invoiceSchema.pre('validate', function syncCounters(next) {
  if (Array.isArray(this.items)) {
    this.itemCount = this.items.reduce((sum, i) => sum + Number(i.qty || 0), 0);
  }
  next();
});

invoiceSchema.plugin(tenantPlugin);

invoiceSchema.virtual('label').get(function label() {
  return this.invoiceNo || String(this._id);
});

/** Outstanding amount, clamped at zero (convenience for the UI/API). */
invoiceSchema.virtual('outstanding').get(function outstanding() {
  const value = Number(this.total || 0) - Number(this.amountPaid || 0) - Number(this.creditNoteTotal || 0);
  return value > 0 ? Math.round(value * 100) / 100 : 0;
});

const Invoice = mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);
export default Invoice;
