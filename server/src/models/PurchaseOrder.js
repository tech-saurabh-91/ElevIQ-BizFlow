import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { addressSchema } from './common.js';
import {
  PURCHASE_ORDER_STATUS,
  PURCHASE_ORDER_STATUS_LIST,
  PAYMENT_TERMS,
} from '../config/constants.js';

/**
 * Purchase order (Phase 7 - Inventory).
 *
 * Buys stock from a supplier into a destination warehouse. Receiving is driven
 * by Goods Receipt Notes (GRN): each GRN books actual quantities into stock and
 * rolls the PO's `receivedQty` forward, so the PO status (DRAFT -> SENT ->
 * PARTIALLY_RECEIVED -> RECEIVED) is derived from what was actually received,
 * never from what was ordered. Money is server-computed from live supplier
 * pricing, mirroring the sales-order rules.
 */

const purchaseItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '', trim: true },
    sku: { type: String, default: '', trim: true },
    unit: { type: String, default: 'PCS', trim: true },
    hsnCode: { type: String, default: '', trim: true },

    qty: { type: Number, required: true, min: 0.0001 },
    /** Qty already booked in by GRNs (denormalized from linked GRNs). */
    receivedQty: { type: Number, default: 0, min: 0 },
    freeQty: { type: Number, default: 0, min: 0 },

    unitPrice: money(), // purchase rate (excl. tax)
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
    status: { type: String, enum: PURCHASE_ORDER_STATUS_LIST, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '', trim: true },
    note: { type: String, default: '', maxlength: 500 },
  },
  { _id: false }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    poNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    poDate: { type: Date, default: Date.now, index: true },
    expectedDate: { type: Date, default: null },

    // Supplier + snapshot
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    supplierName: { type: String, default: '', trim: true },
    supplierCode: { type: String, default: '', trim: true },
    supplierGstin: { type: String, default: '', trim: true },
    supplierAddress: { type: addressSchema, default: () => ({}) },

    /** Destination warehouse the goods land in on GRN. */
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null, index: true },

    items: { type: [purchaseItemSchema], default: [] },
    itemCount: { type: Number, default: 0, min: 0 },
    /** Total units ordered across all lines (denormalized). */
    orderedQty: { type: Number, default: 0, min: 0 },
    /** Total units actually received across all lines (from GRNs). */
    receivedQty: { type: Number, default: 0, min: 0 },

    // Money (server-computed)
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

    paymentTerms: { type: String, enum: PAYMENT_TERMS, default: 'NET_30' },
    leadDays: { type: Number, default: 7, min: 0, max: 365 },
    poReference: { type: String, default: '', trim: true, maxlength: 60 },

    status: { type: String, enum: PURCHASE_ORDER_STATUS_LIST, default: PURCHASE_ORDER_STATUS.DRAFT, index: true },
    statusHistory: { type: [statusEntrySchema], default: [] },

    sentAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },

    /** Set once every ordered unit has been received by GRNs. */
    fullyReceivedAt: { type: Date, default: null },

    notes: { type: String, default: '', maxlength: 1000 },
    internalNotes: { type: String, default: '', maxlength: 1000 },
    terms: { type: String, default: '', maxlength: 2000 },

    source: { type: String, enum: ['WEB', 'MOBILE', 'IMPORT', 'API'], default: 'WEB' },
  },
  { timestamps: true }
);

purchaseOrderSchema.index(
  { companyId: 1, poNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
purchaseOrderSchema.index({ companyId: 1, supplierId: 1, poDate: -1 });
purchaseOrderSchema.index({ companyId: 1, status: 1, poDate: -1 });
purchaseOrderSchema.index({ companyId: 1, warehouse: 1, status: 1 });

/** Recompute derived counters before validation. */
purchaseOrderSchema.pre('validate', function syncCounters(next) {
  if (Array.isArray(this.items)) {
    this.itemCount = this.items.length;
    this.orderedQty = this.items.reduce((sum, i) => sum + Number(i.qty || 0), 0);
    this.receivedQty = this.items.reduce((sum, i) => sum + Number(i.receivedQty || 0), 0);
  }
  next();
});

purchaseOrderSchema.plugin(tenantPlugin);

purchaseOrderSchema.virtual('label').get(function label() {
  return this.poNo || String(this._id);
});

/** Overall receive progress across all lines (0..1). */
purchaseOrderSchema.virtual('receiveProgress').get(function receiveProgress() {
  const ordered = Number(this.orderedQty || 0);
  if (ordered <= 0) return 0;
  return Math.min(1, Number(this.receivedQty || 0) / ordered);
});

/** True when every line has been fully received. */
purchaseOrderSchema.virtual('isFullyReceived').get(function isFullyReceived() {
  const ordered = Number(this.orderedQty || 0);
  return ordered > 0 && Number(this.receivedQty || 0) >= ordered;
});

const PurchaseOrder =
  mongoose.models.PurchaseOrder || mongoose.model('PurchaseOrder', purchaseOrderSchema);
export default PurchaseOrder;
