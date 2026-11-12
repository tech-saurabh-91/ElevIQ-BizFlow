import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { SUPPLIER_DOC_STATUS, SUPPLIER_DOC_STATUS_LIST } from '../config/constants.js';

/**
 * Purchase return (debit note): goods from a posted GRN sent back to the
 * supplier. Stock leaves the GRN's warehouse at the GRN cost (so the average
 * cost is undone, not distorted), and what we owe the supplier drops by the
 * value + tax. If the goods were already billed, the bill's balance drops too.
 */
const returnItemSchema = new mongoose.Schema(
  {
    grnItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // The bill this quantity was on (null: returned before it was billed, so
    // it simply is not billed). A line returning both is split in two.
    bill: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseBill', default: null },
    billNo: { type: String, default: '' },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '' },
    sku: { type: String, default: '' },
    unit: { type: String, default: 'PCS' },
    unitFactor: { type: Number, default: 1, min: 0.0001 },
    qty: { type: Number, required: true, min: 0.0001 },
    unitPrice: money(), // GRN rate per `unit`
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    taxableAmount: money(),
    taxAmount: money(),
    lineTotal: money(),
  },
  { _id: true }
);

const purchaseReturnSchema = new mongoose.Schema(
  {
    returnNo: { type: String, trim: true, uppercase: true, default: '' },
    returnDate: { type: Date, default: Date.now, index: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    supplierName: { type: String, default: '' },
    grn: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt', required: true, index: true },
    grnNo: { type: String, default: '' },
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    /** Part of the total set against bills (reduces what we owe). */
    billedTotal: money(),
    reason: { type: String, default: '', trim: true, maxlength: 300 },
    items: { type: [returnItemSchema], default: [] },
    taxableTotal: money(),
    taxTotal: money(),
    taxBreakup: { cgst: money(), sgst: money(), igst: money() },
    total: money(),
    status: { type: String, enum: SUPPLIER_DOC_STATUS_LIST, default: SUPPLIER_DOC_STATUS.POSTED, index: true },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },
    notes: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true }
);

purchaseReturnSchema.plugin(tenantPlugin);
purchaseReturnSchema.index({ companyId: 1, returnNo: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
purchaseReturnSchema.index({ companyId: 1, 'items.grnItemId': 1 });

const PurchaseReturn = mongoose.models.PurchaseReturn || mongoose.model('PurchaseReturn', purchaseReturnSchema);
export default PurchaseReturn;
