import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * Every print of a key document (invoice, credit note, receipt, purchase
 * order), plus the admin's permissions to print one more original.
 *
 *   PRINT  copy = ORIGINAL | DUPLICATE   (adminOriginal = printed as original by an admin)
 *   GRANT  one more original allowed for the next print
 */
export const PRINT_DOC_TYPES = ['INVOICE', 'CREDIT_NOTE', 'RECEIPT', 'PURCHASE_ORDER'];

const printLogSchema = new mongoose.Schema(
  {
    docType: { type: String, enum: PRINT_DOC_TYPES, required: true, index: true },
    docId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    docNo: { type: String, default: '', trim: true },
    partyName: { type: String, default: '', trim: true },
    action: { type: String, enum: ['PRINT', 'GRANT'], default: 'PRINT' },
    copy: { type: String, enum: ['ORIGINAL', 'DUPLICATE', ''], default: '' },
    adminOriginal: { type: Boolean, default: false },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    note: { type: String, default: '', trim: true, maxlength: 300 },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

printLogSchema.index({ companyId: 1, docType: 1, docId: 1, at: -1 });
printLogSchema.plugin(tenantPlugin);

const PrintLog = mongoose.models.PrintLog || mongoose.model('PrintLog', printLogSchema);
export default PrintLog;
