import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { PAYMENT_MODES, SUPPLIER_DOC_STATUS, SUPPLIER_DOC_STATUS_LIST } from '../config/constants.js';

/**
 * Money paid to a supplier. It is set against bills (oldest first unless the
 * user chooses); whatever is not set against a bill is an advance. Posting
 * reduces the supplier's outstanding; cancelling puts it back.
 */
const allocationSchema = new mongoose.Schema(
  {
    bill: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseBill', required: true },
    billNo: { type: String, default: '' },
    supplierInvoiceNo: { type: String, default: '' },
    amount: money(),
  },
  { _id: false }
);

const supplierPaymentSchema = new mongoose.Schema(
  {
    paymentNo: { type: String, trim: true, uppercase: true, default: '' },
    paymentDate: { type: Date, default: Date.now, index: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    supplierName: { type: String, default: '' },
    amount: money(),
    mode: { type: String, enum: PAYMENT_MODES, default: 'BANK_TRANSFER' },
    reference: { type: String, default: '', trim: true, maxlength: 80 }, // UTR / cheque no.
    allocations: { type: [allocationSchema], default: [] },
    allocatedAmount: money(),
    advanceAmount: money(),
    status: { type: String, enum: SUPPLIER_DOC_STATUS_LIST, default: SUPPLIER_DOC_STATUS.POSTED, index: true },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },
    notes: { type: String, default: '', maxlength: 1000 },
  },
  { timestamps: true }
);

supplierPaymentSchema.plugin(tenantPlugin);
supplierPaymentSchema.index({ companyId: 1, paymentNo: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

const SupplierPayment = mongoose.models.SupplierPayment || mongoose.model('SupplierPayment', supplierPaymentSchema);
export default SupplierPayment;
