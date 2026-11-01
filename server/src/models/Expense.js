import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { EXPENSE_CATEGORIES, EXPENSE_STATUS, EXPENSE_STATUS_LIST } from '../config/constants.js';

/**
 * Field expense claim (Phase 7 - Field Force).
 *
 * A rep logs a spend (travel, fuel, food, lodging...) with an optional receipt
 * image. The claim moves through a small approval workflow before it can be
 * marked paid:
 *
 *   DRAFT -> SUBMITTED -> APPROVED -> PAID
 *                     \-> REJECTED
 *
 * Drafts are editable by the claimant; once submitted only an approver can
 * move it, and the decision is stamped with who/when/why. Amounts that reach
 * PAID roll into the employee's reimbursable total for the period.
 */
const expenseSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    expenseNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    expenseDate: { type: Date, default: Date.now, index: true },

    /** The employee claiming the spend (drives salesman/manager scoping). */
    claimant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    claimantName: { type: String, default: '', trim: true },
    claimantRole: { type: String, default: '', trim: true },

    category: { type: String, enum: EXPENSE_CATEGORIES, required: true, index: true },
    amount: money(),

    description: { type: String, default: '', trim: true, maxlength: 500 },

    /** Optional link to the customer/visit that caused the spend. */
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    customerName: { type: String, default: '', trim: true },
    visit: { type: mongoose.Schema.Types.ObjectId, ref: 'Visit', default: null },

    /** Receipt image / PDF path (uploaded via the uploads endpoint). */
    receiptUrl: { type: String, default: '', trim: true },
    hasReceipt: { type: Boolean, default: false },

    /** Travel specifics (filled for TRAVEL/FUEL categories). */
    fromPlace: { type: String, default: '', trim: true, maxlength: 120 },
    toPlace: { type: String, default: '', trim: true, maxlength: 120 },
    distanceKm: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: EXPENSE_STATUS_LIST, default: EXPENSE_STATUS.DRAFT, index: true },
    statusHistory: {
      type: [
        new mongoose.Schema(
          {
            status: { type: String, enum: EXPENSE_STATUS_LIST, required: true },
            at: { type: Date, default: Date.now },
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
            byName: { type: String, default: '', trim: true },
            note: { type: String, default: '', maxlength: 500 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    submittedAt: { type: Date, default: null },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    approvedAmount: money(),

    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '', trim: true, maxlength: 500 },

    paidAt: { type: Date, default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paymentReference: { type: String, default: '', trim: true, maxlength: 100 },
    paymentMode: { type: String, default: '', trim: true, maxlength: 30 },

    notes: { type: String, default: '', trim: true, maxlength: 1000 },
    source: { type: String, enum: ['WEB', 'MOBILE', 'IMPORT', 'API'], default: 'WEB' },
  },
  { timestamps: true }
);

expenseSchema.index(
  { companyId: 1, expenseNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
expenseSchema.index({ companyId: 1, claimant: 1, expenseDate: -1 });
expenseSchema.index({ companyId: 1, status: 1, expenseDate: -1 });
expenseSchema.index({ companyId: 1, category: 1, expenseDate: -1 });

expenseSchema.plugin(tenantPlugin);

expenseSchema.virtual('label').get(function label() {
  return this.expenseNo || String(this._id);
});

/** Amount that will actually be reimbursed (approved amount if set, else claimed). */
expenseSchema.virtual('reimbursableAmount').get(function reimbursableAmount() {
  if (this.status === EXPENSE_STATUS.APPROVED || this.status === EXPENSE_STATUS.PAID) {
    return Number(this.approvedAmount ?? this.amount ?? 0);
  }
  return Number(this.amount || 0);
});

/** True when the claim is still editable by the claimant. */
expenseSchema.virtual('isEditable').get(function isEditable() {
  return this.status === EXPENSE_STATUS.DRAFT;
});

const Expense = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
export default Expense;
