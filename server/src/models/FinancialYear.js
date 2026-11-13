import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * A closed (or reopened) financial year of a company.
 *
 * Closing locks every document dated inside the year and records what the
 * business looked like on its last day: totals here, and one YearBalance row
 * per customer / supplier / product x warehouse. Nothing is moved or deleted -
 * receivables, payables and stock simply keep running into the next year.
 */
const historySchema = new mongoose.Schema(
  {
    action: { type: String, enum: ['CLOSED', 'REOPENED'], required: true },
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: '' },
    note: { type: String, default: '', maxlength: 1000 },
  },
  { _id: false }
);

const financialYearSchema = new mongoose.Schema(
  {
    /** e.g. "2526" for April 2025 - March 2026. */
    tag: { type: String, required: true, match: /^\d{4}$/ },
    label: { type: String, default: '' },
    /** Company-local first and last day, 'YYYY-MM-DD'. */
    startDay: { type: String, required: true },
    endDay: { type: String, required: true },
    status: { type: String, enum: ['CLOSED', 'REOPENED'], default: 'CLOSED', index: true },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedByName: { type: String, default: '' },
    notes: { type: String, default: '', maxlength: 1000 },
    /** Warnings that were open when the year was closed (the checklist). */
    openItems: [{ key: String, label: String, count: Number, _id: false }],
    totals: {
      sales: { type: Number, default: 0 },
      salesTaxable: { type: Number, default: 0 },
      outputTax: { type: Number, default: 0 },
      costOfSales: { type: Number, default: 0 },
      grossProfit: { type: Number, default: 0 },
      creditNotes: { type: Number, default: 0 },
      collections: { type: Number, default: 0 },
      purchases: { type: Number, default: 0 },
      inputTax: { type: Number, default: 0 },
      supplierPayments: { type: Number, default: 0 },
      purchaseReturns: { type: Number, default: 0 },
      receivables: { type: Number, default: 0 },
      payables: { type: Number, default: 0 },
      stockValue: { type: Number, default: 0 },
      invoices: { type: Number, default: 0 },
      bills: { type: Number, default: 0 },
    },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

financialYearSchema.index({ companyId: 1, tag: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
financialYearSchema.plugin(tenantPlugin);

const FinancialYear = mongoose.models.FinancialYear || mongoose.model('FinancialYear', financialYearSchema);
export default FinancialYear;
