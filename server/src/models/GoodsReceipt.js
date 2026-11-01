import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { GRN_STATUS, GRN_STATUS_LIST } from '../config/constants.js';

/**
 * Goods Receipt Note (Phase 7 - Inventory).
 *
 * Books physically received stock into a warehouse. A GRN is created against a
 * purchase order (optional for spot purchases) with per-line accepted/rejected
 * quantities. Posting it writes one `StockMovement` per accepted line (type
 * PURCHASE_RECEIPT), bumps the `StockBalance`, and rolls the PO's received
 * quantity forward. Cancelling a posted GRN reverses those movements.
 *
 * Rejected quantity stays out of stock and is recorded against the line for
 * supplier debit-note follow-up.
 */

const grnItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '', trim: true },
    sku: { type: String, default: '', trim: true },
    unit: { type: String, default: 'PCS', trim: true },

    /** Ordered qty on the linked PO (snapshot; 0 for spot purchases). */
    orderedQty: { type: Number, default: 0, min: 0 },
    /** Qty that arrived physically. */
    receivedQty: { type: Number, required: true, min: 0 },
    /** Qty accepted into stock (= booked movement). */
    acceptedQty: { type: Number, default: 0, min: 0 },
    /** Qty refused (damaged / short / wrong item). */
    rejectedQty: { type: Number, default: 0, min: 0 },
    rejectReason: { type: String, default: '', trim: true, maxlength: 300 },

    /** Purchase rate used for valuation on this receipt. */
    unitCost: money(),

    note: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { _id: true }
);

const statusEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: GRN_STATUS_LIST, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '', trim: true },
    note: { type: String, default: '', maxlength: 500 },
  },
  { _id: false }
);

const goodsReceiptSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    grnNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    grnDate: { type: Date, default: Date.now, index: true },

    /** Linked PO (null for a spot/cash purchase booked straight to stock). */
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null, index: true },
    poNo: { type: String, default: '', trim: true, uppercase: true },

    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null, index: true },
    supplierName: { type: String, default: '', trim: true },

    /** Warehouse the goods are booked into. */
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    warehouseCode: { type: String, default: '', trim: true, uppercase: true },
    warehouseName: { type: String, default: '', trim: true },

    items: { type: [grnItemSchema], default: [] },
    itemCount: { type: Number, default: 0, min: 0 },
    totalReceivedQty: { type: Number, default: 0, min: 0 },
    totalAcceptedQty: { type: Number, default: 0, min: 0 },
    totalRejectedQty: { type: Number, default: 0, min: 0 },
    /** Total value of accepted goods (qty x unitCost). */
    totalValue: money(),

    /** Supplier's delivery challan / invoice reference. */
    invoiceNo: { type: String, default: '', trim: true, maxlength: 60 },
    vehicleNo: { type: String, default: '', trim: true, maxlength: 30 },
    eWayBillNo: { type: String, default: '', trim: true, maxlength: 30 },

    status: { type: String, enum: GRN_STATUS_LIST, default: GRN_STATUS.DRAFT, index: true },
    statusHistory: { type: [statusEntrySchema], default: [] },

    postedAt: { type: Date, default: null },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },

    notes: { type: String, default: '', maxlength: 1000 },
    source: { type: String, enum: ['WEB', 'MOBILE', 'IMPORT', 'API'], default: 'WEB' },
  },
  { timestamps: true }
);

goodsReceiptSchema.index(
  { companyId: 1, grnNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
goodsReceiptSchema.index({ companyId: 1, warehouse: 1, grnDate: -1 });
goodsReceiptSchema.index({ companyId: 1, status: 1, grnDate: -1 });

/** Keep accepted/rejected consistent: accepted + rejected === received. */
goodsReceiptSchema.pre('validate', function syncCounters(next) {
  if (Array.isArray(this.items)) {
    this.items.forEach((item) => {
      const received = Number(item.receivedQty || 0);
      const rejected = Number(item.rejectedQty || 0);
      const clampedRejected = Math.min(rejected, received);
      item.rejectedQty = clampedRejected;
      item.acceptedQty = Math.max(0, received - clampedRejected);
    });

    this.itemCount = this.items.length;
    this.totalReceivedQty = this.items.reduce((s, i) => s + Number(i.receivedQty || 0), 0);
    this.totalAcceptedQty = this.items.reduce((s, i) => s + Number(i.acceptedQty || 0), 0);
    this.totalRejectedQty = this.items.reduce((s, i) => s + Number(i.rejectedQty || 0), 0);
    this.totalValue = this.items.reduce(
      (s, i) => s + Number(i.acceptedQty || 0) * Number(i.unitCost || 0),
      0
    );
  }
  next();
});

goodsReceiptSchema.plugin(tenantPlugin);

goodsReceiptSchema.virtual('label').get(function label() {
  return this.grnNo || String(this._id);
});

const GoodsReceipt = mongoose.models.GoodsReceipt || mongoose.model('GoodsReceipt', goodsReceiptSchema);
export default GoodsReceipt;
