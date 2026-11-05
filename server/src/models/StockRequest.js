import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

export const STOCK_REQUEST_STATUS = Object.freeze({
  SUBMITTED: 'SUBMITTED', // raised by the van executive
  APPROVED: 'APPROVED', // manager fixed the quantities; stock left the godown
  RECEIVED: 'RECEIVED', // executive confirmed what reached the van
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
});

/**
 * Van stock request (indent): an executive asks for stock before going out,
 * a manager adjusts and approves it (stock is issued from the van's parent
 * warehouse), and the executive confirms receipt on the van. Quantities are
 * in base units.
 */
const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '' },
    sku: { type: String, default: '' },
    unit: { type: String, default: 'PCS' },
    requestedQty: { type: Number, default: 0, min: 0 }, // 0 = added by the manager
    approvedQty: { type: Number, default: 0, min: 0 },
    receivedQty: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const stockRequestSchema = new mongoose.Schema(
  {
    requestNo: { type: String, trim: true, uppercase: true, default: '' },
    van: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    vanCode: { type: String, default: '' },
    fromWarehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    executive: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    executiveName: { type: String, default: '' },
    status: {
      type: String,
      enum: Object.values(STOCK_REQUEST_STATUS),
      default: STOCK_REQUEST_STATUS.SUBMITTED,
      index: true,
    },
    neededOn: { type: Date, default: Date.now },
    items: { type: [lineSchema], default: [] },
    notes: { type: String, default: '', maxlength: 500 },
    managerNotes: { type: String, default: '', maxlength: 500 },
    rejectReason: { type: String, default: '', maxlength: 500 },
    receiveNotes: { type: String, default: '', maxlength: 500 },

    transfer: { type: mongoose.Schema.Types.ObjectId, ref: 'StockTransfer', default: null },
    transferNo: { type: String, default: '' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receivedAt: { type: Date, default: null },

    statusHistory: {
      type: [
        {
          _id: false,
          status: { type: String },
          at: { type: Date, default: Date.now },
          by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          byName: { type: String, default: '' },
          note: { type: String, default: '' },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

stockRequestSchema.index({ companyId: 1, requestNo: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
stockRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });

stockRequestSchema.plugin(tenantPlugin);

const StockRequest = mongoose.models.StockRequest || mongoose.model('StockRequest', stockRequestSchema);
export default StockRequest;
