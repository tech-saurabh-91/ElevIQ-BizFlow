import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * End-of-day settlement for a van (Phase C).
 *
 * For one van and one business day it freezes what the system expected
 * (opening + loaded - sold - unloaded) against what was physically counted,
 * and the cash the executive collected against what was deposited. Stock
 * variances are booked as COUNT movements in the van; a closed day is never
 * reopened.
 */
const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, default: '' },
    sku: { type: String, default: '' },
    unit: { type: String, default: 'PCS' },
    opening: { type: Number, default: 0 },
    loaded: { type: Number, default: 0 },
    sold: { type: Number, default: 0 },
    unloaded: { type: Number, default: 0 },
    adjusted: { type: Number, default: 0 },
    expected: { type: Number, default: 0 },
    counted: { type: Number, default: 0 },
    variance: { type: Number, default: 0 },
  },
  { _id: false }
);

const vanDayCloseSchema = new mongoose.Schema(
  {
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true, index: true },
    executive: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // Business day in the company's time zone, YYYY-MM-DD.
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },

    lines: { type: [lineSchema], default: [] },
    stockVarianceQty: { type: Number, default: 0 },

    cashExpected: { type: Number, default: 0 },
    cashDeposited: { type: Number, default: 0 },
    cashVariance: { type: Number, default: 0 },
    payments: { type: Number, default: 0 }, // number of cash receipts counted

    notes: { type: String, default: '', maxlength: 1000 },

    /**
     * Day cashout approval: the executive SUBMITS, a manager APPROVES (stock
     * differences are booked then) or REJECTS (the executive submits again).
     * Older rows predate approval and count as approved.
     */
    status: { type: String, enum: ['SUBMITTED', 'APPROVED', 'REJECTED'], default: 'APPROVED', index: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rejectReason: { type: String, default: '', maxlength: 500 },

    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One settlement per van per day.
vanDayCloseSchema.index({ companyId: 1, warehouse: 1, day: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

vanDayCloseSchema.plugin(tenantPlugin);

const VanDayClose = mongoose.models.VanDayClose || mongoose.model('VanDayClose', vanDayCloseSchema);
export default VanDayClose;
