import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * Current on-hand stock for one (product, warehouse) pair (Phase 7).
 *
 * This is the fast-read projection of the append-only `StockMovement` ledger:
 * every posted movement increments `qty` here so availability checks are a
 * single indexed lookup instead of a full ledger scan. The company-wide
 * `Product.stock` total is kept in sync (sum across warehouses) so existing
 * order/invoice screens continue to work unchanged.
 *
 * `reservedQty` holds stock committed to confirmed-but-undispatched orders
 * (when `Setting.order.reserveStockOnConfirm` is on). Available to promise =
 * `qty - reservedQty`.
 */
const stockBalanceSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    productName: { type: String, default: '', trim: true },
    productSku: { type: String, default: '', trim: true, uppercase: true },
    unit: { type: String, default: 'PCS', trim: true },

    /**
     * Stock location. `null` means "company-level / not yet assigned" - used
     * when an order dispatches before any warehouse is configured, so the
     * ledger and the company-wide total stay correct either way.
     */
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null, index: true },
    warehouseCode: { type: String, default: '', trim: true, uppercase: true },
    warehouseName: { type: String, default: '', trim: true },

    /** Physical on-hand quantity in this warehouse. */
    qty: { type: Number, default: 0 },
    /** Quantity committed to confirmed orders awaiting dispatch. */
    reservedQty: { type: Number, default: 0 },
    /** Snapshot of the product's low-stock level for alerting. */
    lowStockLevel: { type: Number, default: 0 },

    /** Last unit cost seen (drives FIFO/AVERAGE valuation later). */
    lastCost: { type: Number, default: 0 },
    lastMovementAt: { type: Date, default: null },
    lastMovementType: { type: String, default: '' },
  },
  { timestamps: true }
);

stockBalanceSchema.index(
  { companyId: 1, product: 1, warehouse: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
stockBalanceSchema.index({ companyId: 1, warehouse: 1, qty: 1 });
stockBalanceSchema.index({ companyId: 1, product: 1 });

stockBalanceSchema.plugin(tenantPlugin);

/** Available to promise = on-hand minus reserved. */
stockBalanceSchema.virtual('availableQty').get(function availableQty() {
  return Math.max(0, Number(this.qty || 0) - Number(this.reservedQty || 0));
});

/** True when on-hand (or available) has fallen to/below the low-stock level. */
stockBalanceSchema.virtual('isLowStock').get(function isLowStock() {
  const level = Number(this.lowStockLevel || 0);
  if (level <= 0) return false;
  return Number(this.qty || 0) <= level;
});

stockBalanceSchema.virtual('isOutOfStock').get(function isOutOfStock() {
  return Number(this.qty || 0) <= 0;
});

stockBalanceSchema.virtual('label').get(function label() {
  return this.productName || this.productSku || String(this._id);
});

const StockBalance = mongoose.models.StockBalance || mongoose.model('StockBalance', stockBalanceSchema);
export default StockBalance;
