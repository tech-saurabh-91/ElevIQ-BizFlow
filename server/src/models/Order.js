import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money, round2 } from './helpers.js';
import { addressSchema } from './common.js';
import { ORDER_STATUS, ORDER_STATUS_LIST, PAYMENT_TERMS } from '../config/constants.js';

/**
 * Sales order (order booking).
 *
 * Financials are always computed on the server from the live product/price-list
 * data; the client may only send quantities, an optional manual price override
 * and a discount. Every line keeps a snapshot of the product details and tax
 * rate so a later price change never rewrites a historical order.
 */

export const ORDER_PAYMENT_MODES = Object.freeze([
  'CASH',
  'CREDIT',
  'UPI',
  'CHEQUE',
  'BANK_TRANSFER',
  'CARD',
  'OTHER',
]);

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
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

const statusEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: ORDER_STATUS_LIST, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    note: { type: String, default: '', maxlength: 500 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted are injected by tenantPlugin

    orderNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    orderDate: { type: Date, default: Date.now, index: true },
    expectedDeliveryDate: { type: Date, default: null },

    // Customer + snapshot (invoices and printed documents must not drift)
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
    priceList: { type: mongoose.Schema.Types.ObjectId, ref: 'PriceList', default: null },

    items: { type: [orderItemSchema], default: [] },
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

    // Commercial terms
    paymentMode: { type: String, enum: ORDER_PAYMENT_MODES, default: 'CREDIT' },
    paymentTerms: { type: String, enum: PAYMENT_TERMS, default: 'IMMEDIATE' },
    creditDays: { type: Number, default: 0, min: 0, max: 365 },
    poReference: { type: String, default: '', trim: true, maxlength: 60 },

    // Workflow
    status: { type: String, enum: ORDER_STATUS_LIST, default: ORDER_STATUS.DRAFT, index: true },
    statusHistory: { type: [statusEntrySchema], default: [] },
    approvalRequired: { type: Boolean, default: false },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '', maxlength: 500 },

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },

    // Fulfilment / invoicing progress (driven by later phases)
    dispatchedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    invoicedQty: { type: Number, default: 0, min: 0 },
    invoicedAmount: money(),

    /** True once this order has been counted in the customer's sales totals. */
    salesCounted: { type: Boolean, default: false },

    notes: { type: String, default: '', maxlength: 1000 },
    internalNotes: { type: String, default: '', maxlength: 1000 },
    deliveryInstructions: { type: String, default: '', maxlength: 1000 },

    source: { type: String, enum: ['WEB', 'MOBILE', 'IMPORT', 'API'], default: 'WEB' },
  },
  { timestamps: true }
);

orderSchema.index(
  { companyId: 1, orderNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
orderSchema.index({ companyId: 1, customerId: 1 });
orderSchema.index({ companyId: 1, status: 1, orderDate: -1 });
orderSchema.index({ companyId: 1, salesman: 1, status: 1 });
orderSchema.index({ companyId: 1, orderDate: -1 });

/** Recompute derived counters before validation. */
orderSchema.pre('validate', function syncCounters(next) {
  if (Array.isArray(this.items)) {
    this.itemCount = this.items.reduce((sum, i) => sum + Number(i.qty || 0), 0);
  }
  next();
});

/** Business-transaction docs are immutable once they leave DRAFT — no soft-delete needed here. */
orderSchema.plugin(tenantPlugin);

/** Human label used by audit logs. */
orderSchema.virtual('label').get(function label() {
  return this.orderNo || String(this._id);
});

/** Round to 2dp consistently (imported by the pricing service). */
orderSchema.statics.round2 = round2;

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
export default Order;
