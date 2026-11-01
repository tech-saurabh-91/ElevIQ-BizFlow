import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { ADJUSTMENT_REASONS, ADJUSTMENT_STATUS, ADJUSTMENT_STATUS_LIST } from '../config/constants.js';

/**
 * Manual stock adjustment (Phase 7 - Inventory).
 *
 * Corrects on-hand quantities for a warehouse - stock-count variances, damage,
 * theft, expiry or a one-off data fix. Posting writes one signed
 * `StockMovement` per line (positive or negative). Cancelling a posted
 * adjustment reverses those movements, so the ledger always reflects reality.
 *
 * The reason is captured per document (and optionally per line) because it is
 * what makes the write-off auditable and reportable.
 */

const adjustmentItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '', trim: true },
    sku: { type: String, default: '', trim: true },
    unit: { type: String, default: 'PCS', trim: true },

    /** Signed delta: + adds stock, - removes stock. */
    qty: { type: Number, required: true },
    unitCost: money(),

    /** Per-line reason override (falls back to the document reason). Empty = use doc reason. */
    reason: { type: String, enum: ['', ...ADJUSTMENT_REASONS], default: '' },
    note: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { _id: true }
);

const statusEntrySchema = new mongoose.Schema(
  {
    status: { type: String, enum: ADJUSTMENT_STATUS_LIST, required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '', trim: true },
    note: { type: String, default: '', maxlength: 500 },
  },
  { _id: false }
);

const stockAdjustmentSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    adjustmentNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    adjustmentDate: { type: Date, default: Date.now, index: true },

    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    warehouseCode: { type: String, default: '', trim: true, uppercase: true },
    warehouseName: { type: String, default: '', trim: true },

    reason: { type: String, enum: ADJUSTMENT_REASONS, required: true, index: true },

    items: { type: [adjustmentItemSchema], default: [] },
    itemCount: { type: Number, default: 0, min: 0 },
    /** Net quantity change across all lines (sign preserved). */
    netQty: { type: Number, default: 0 },
    /** Value of stock added minus value removed (for P&L impact). */
    totalValue: money(),

    status: { type: String, enum: ADJUSTMENT_STATUS_LIST, default: ADJUSTMENT_STATUS.DRAFT, index: true },
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

stockAdjustmentSchema.index(
  { companyId: 1, adjustmentNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
stockAdjustmentSchema.index({ companyId: 1, warehouse: 1, adjustmentDate: -1 });
stockAdjustmentSchema.index({ companyId: 1, status: 1, adjustmentDate: -1 });

stockAdjustmentSchema.pre('validate', function syncCounters(next) {
  if (Array.isArray(this.items)) {
    this.itemCount = this.items.length;
    this.netQty = this.items.reduce((s, i) => s + Number(i.qty || 0), 0);
    this.totalValue = this.items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.unitCost || 0), 0);
  }
  next();
});

stockAdjustmentSchema.plugin(tenantPlugin);

stockAdjustmentSchema.virtual('label').get(function label() {
  return this.adjustmentNo || String(this._id);
});

/** +1 adds stock, -1 removes — used to build reversal movements. */
stockAdjustmentSchema.virtual('direction').get(function direction() {
  return Number(this.netQty || 0) >= 0 ? 'IN' : 'OUT';
});

const StockAdjustment =
  mongoose.models.StockAdjustment || mongoose.model('StockAdjustment', stockAdjustmentSchema);
export default StockAdjustment;
