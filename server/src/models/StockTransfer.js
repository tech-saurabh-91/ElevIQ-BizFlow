import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { TRANSFER_STATUS, TRANSFER_STATUS_LIST } from '../config/constants.js';

/**
 * Warehouse-to-warehouse stock transfer (Phase 7 - Inventory).
 *
 * Lifecycle:
 *   DRAFT      - lines entered, nothing booked.
 *   DISPATCHED - stock leaves the source warehouse (TRANSFER_OUT movements).
 *   RECEIVED   - stock lands in the destination warehouse (TRANSFER_IN).
 *   CANCELLED  - only allowed before dispatch (nothing was booked).
 *
 * Dispatch and receive are separate steps so goods in transit are visible: a
 * DISPATCHED transfer has already left the source but has not yet arrived at
 * the destination. Quantity can be received partially (short receipt), with the
 * remainder staying in transit.
 */

const transferItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '', trim: true },
    sku: { type: String, default: '', trim: true },
    unit: { type: String, default: 'PCS', trim: true },

    qty: { type: Number, required: true, min: 0.0001 },
    /** Qty already dispatched out of the source. */
    dispatchedQty: { type: Number, default: 0, min: 0 },
    /** Qty already received into the destination. */
    receivedQty: { type: Number, default: 0, min: 0 },

    note: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { _id: true }
);

const statusEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: TRANSFER_STATUS_LIST, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '', trim: true },
    note: { type: String, default: '', maxlength: 500 },
  },
  { _id: false }
);

const stockTransferSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    transferNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    transferDate: { type: Date, default: Date.now, index: true },

    // Why stock moved: a normal transfer, or loading / unloading a van.
    purpose: { type: String, enum: ['TRANSFER', 'VAN_LOAD', 'VAN_UNLOAD'], default: 'TRANSFER', index: true },

    fromWarehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    fromWarehouseCode: { type: String, default: '', trim: true, uppercase: true },
    fromWarehouseName: { type: String, default: '', trim: true },

    toWarehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    toWarehouseCode: { type: String, default: '', trim: true, uppercase: true },
    toWarehouseName: { type: String, default: '', trim: true },

    items: { type: [transferItemSchema], default: [] },
    itemCount: { type: Number, default: 0, min: 0 },
    totalQty: { type: Number, default: 0, min: 0 },
    dispatchedQty: { type: Number, default: 0, min: 0 },
    receivedQty: { type: Number, default: 0, min: 0 },
    /** Qty still moving (dispatched but not yet received). */
    inTransitQty: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: TRANSFER_STATUS_LIST, default: TRANSFER_STATUS.DRAFT, index: true },
    statusHistory: { type: [statusEntrySchema], default: [] },

    dispatchedAt: { type: Date, default: null },
    dispatchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receivedAt: { type: Date, default: null },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },

    vehicleNo: { type: String, default: '', trim: true, maxlength: 30 },
    notes: { type: String, default: '', maxlength: 1000 },
    source: { type: String, enum: ['WEB', 'MOBILE', 'IMPORT', 'API'], default: 'WEB' },
  },
  { timestamps: true }
);

stockTransferSchema.index(
  { companyId: 1, transferNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
stockTransferSchema.index({ companyId: 1, status: 1, transferDate: -1 });
stockTransferSchema.index({ companyId: 1, fromWarehouse: 1, transferDate: -1 });
stockTransferSchema.index({ companyId: 1, toWarehouse: 1, transferDate: -1 });

stockTransferSchema.pre('validate', function syncCounters(next) {
  if (Array.isArray(this.items)) {
    this.itemCount = this.items.length;
    this.totalQty = this.items.reduce((s, i) => s + Number(i.qty || 0), 0);
    this.dispatchedQty = this.items.reduce((s, i) => s + Number(i.dispatchedQty || 0), 0);
    this.receivedQty = this.items.reduce((s, i) => s + Number(i.receivedQty || 0), 0);
    this.inTransitQty = Math.max(0, this.dispatchedQty - this.receivedQty);
  }
  next();
});

stockTransferSchema.plugin(tenantPlugin);

stockTransferSchema.virtual('label').get(function label() {
  return this.transferNo || String(this._id);
});

const StockTransfer = mongoose.models.StockTransfer || mongoose.model('StockTransfer', stockTransferSchema);
export default StockTransfer;
