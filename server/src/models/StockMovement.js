import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { MOVEMENT_TYPES, MOVEMENT_TYPE_LIST } from '../config/constants.js';

/**
 * Immutable stock ledger (Phase 7).
 *
 * Every change to on-hand stock writes exactly one row here. Rows are never
 * edited or deleted - corrections are posted as a compensating movement, so
 * the ledger is a complete, auditable history that can always be replayed to
 * reconstruct any (product, warehouse) balance at a point in time.
 *
 * `qty` is signed: positive = stock in, negative = stock out. `balanceAfter`
 * is the warehouse-level on-hand quantity immediately after this movement,
 * making the running total visible without recomputation.
 */
const stockMovementSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    type: { type: String, enum: MOVEMENT_TYPE_LIST, required: true, index: true },

    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    productName: { type: String, default: '', trim: true },
    productSku: { type: String, default: '', trim: true, uppercase: true },
    unit: { type: String, default: 'PCS', trim: true },

    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null, index: true },
    warehouseCode: { type: String, default: '', trim: true, uppercase: true },
    warehouseName: { type: String, default: '', trim: true },

    /** Signed quantity (+ in / - out). */
    qty: { type: Number, required: true },
    /** On-hand in this warehouse right after the movement (replay aid). */
    balanceAfter: { type: Number, default: 0 },

    unitCost: { type: Number, default: 0 },
    value: { type: Number, default: 0 },

    /** Source document that caused the movement. */
    refType: {
      type: String,
      enum: ['ORDER', 'INVOICE', 'CREDIT_NOTE', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'ADJUSTMENT', 'TRANSFER', 'MANUAL', 'IMPORT'],
      default: 'MANUAL',
      index: true,
    },
    refId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    refNo: { type: String, default: '', trim: true },

    reason: { type: String, default: '', trim: true, maxlength: 120 },
    note: { type: String, default: '', trim: true, maxlength: 500 },

    /** Who triggered it (field user or system). */
    movedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    movedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

stockMovementSchema.index({ companyId: 1, product: 1, movedAt: -1 });
stockMovementSchema.index({ companyId: 1, warehouse: 1, movedAt: -1 });
stockMovementSchema.index({ companyId: 1, refType: 1, refId: 1 });

stockMovementSchema.plugin(tenantPlugin);

stockMovementSchema.virtual('direction').get(function direction() {
  return Number(this.qty || 0) >= 0 ? 'IN' : 'OUT';
});

stockMovementSchema.virtual('label').get(function label() {
  return `${this.type} ${this.productName || this.productSku || ''}`.trim();
});

const StockMovement = mongoose.models.StockMovement || mongoose.model('StockMovement', stockMovementSchema);
export default StockMovement;
