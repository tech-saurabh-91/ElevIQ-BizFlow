import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { BILL_STATUS, BILL_STATUS_LIST } from '../config/constants.js';

/**
 * Supplier bill (purchase invoice): the supplier's tax invoice for goods we
 * received on one or more posted GRNs. Lines come from the GRNs at the GRN
 * rate (so stock cost and the bill agree); tax is input GST split into
 * CGST + SGST (same state) or IGST. Posting adds the total to the supplier's
 * outstanding; payments and purchase returns bring the balance down.
 */
const billItemSchema = new mongoose.Schema(
  {
    grn: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt', required: true },
    grnNo: { type: String, default: '' },
    grnItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '' },
    sku: { type: String, default: '' },
    hsnCode: { type: String, default: '' },
    unit: { type: String, default: 'PCS' },
    unitFactor: { type: Number, default: 1, min: 0.0001 },
    qty: { type: Number, required: true, min: 0.0001 },
    unitPrice: money(), // GRN rate per `unit`, excl. tax
    discountAmount: money(),
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    taxableAmount: money(),
    taxAmount: money(),
    lineTotal: money(),
  },
  { _id: true }
);

const purchaseBillSchema = new mongoose.Schema(
  {
    billNo: { type: String, trim: true, uppercase: true, default: '' },
    billDate: { type: Date, default: Date.now, index: true },

    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    supplierName: { type: String, default: '' },
    supplierGstin: { type: String, default: '' },
    supplierState: { type: String, default: '' },
    /** The supplier's own invoice number and date (unique per supplier). */
    supplierInvoiceNo: { type: String, required: true, trim: true, maxlength: 60 },
    supplierInvoiceDate: { type: Date, required: true },
    dueDate: { type: Date, default: null, index: true },

    grns: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt' }],
    grnNos: { type: [String], default: [] },

    items: { type: [billItemSchema], default: [] },
    subtotal: money(),
    taxableTotal: money(),
    taxTotal: money(),
    taxBreakup: {
      cgst: money(),
      sgst: money(),
      igst: money(),
    },
    /** Freight, loading etc. on the bill (not part of stock cost). */
    otherCharges: money(),
    roundOff: money(),
    total: money(),

    amountPaid: money(),
    returnTotal: money(),
    balanceDue: money(),

    status: { type: String, enum: BILL_STATUS_LIST, default: BILL_STATUS.POSTED, index: true },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },
    notes: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true }
);

purchaseBillSchema.plugin(tenantPlugin);
purchaseBillSchema.index({ companyId: 1, billNo: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
purchaseBillSchema.index(
  { companyId: 1, supplierId: 1, supplierInvoiceNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, status: { $in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } } }
);
purchaseBillSchema.index({ companyId: 1, 'items.grnItemId': 1 });

/** Balance = total - paid - returned; status follows it (cancelled stays). */
purchaseBillSchema.methods.refreshBalance = function refreshBalance() {
  const due = Math.round((Number(this.total || 0) - Number(this.amountPaid || 0) - Number(this.returnTotal || 0)) * 100) / 100;
  this.balanceDue = Math.max(0, due);
  if (this.status === BILL_STATUS.CANCELLED) return;
  if (this.balanceDue <= 0.009) this.status = BILL_STATUS.PAID;
  else if (Number(this.amountPaid || 0) > 0 || Number(this.returnTotal || 0) > 0) this.status = BILL_STATUS.PARTIALLY_PAID;
  else this.status = BILL_STATUS.POSTED;
};

const PurchaseBill = mongoose.models.PurchaseBill || mongoose.model('PurchaseBill', purchaseBillSchema);
export default PurchaseBill;
