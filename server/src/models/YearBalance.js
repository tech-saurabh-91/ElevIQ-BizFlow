import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * One closing balance of a closed financial year: what a customer owed, what
 * we owed a supplier, or the stock of a product in a warehouse on the last
 * day of the year. Rebuilt every time the year is closed.
 */
const yearBalanceSchema = new mongoose.Schema(
  {
    tag: { type: String, required: true, index: true },
    kind: { type: String, enum: ['CUSTOMER', 'SUPPLIER', 'STOCK'], required: true, index: true },
    ref: { type: mongoose.Schema.Types.ObjectId, default: null },
    name: { type: String, default: '' },
    code: { type: String, default: '' },
    warehouse: { type: mongoose.Schema.Types.ObjectId, default: null },
    warehouseName: { type: String, default: '' },
    qty: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
  },
  { timestamps: false }
);

yearBalanceSchema.index({ companyId: 1, tag: 1, kind: 1, name: 1 });
yearBalanceSchema.plugin(tenantPlugin);

const YearBalance = mongoose.models.YearBalance || mongoose.model('YearBalance', yearBalanceSchema);
export default YearBalance;
