const mongoose = require('mongoose');

const approvalSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  approvalType: {
    type: String,
    required: [true, 'Approval type is required'],
    enum: [
      'expense',
      'van_assignment',
      'sales_order',
      'day_cash_out',
      'cash_cheque_deposit',
      'sales_return',
      'adhoc_sales_return',
      'stock_request',
      'stock_receipt_variance',
      'stock_closing_variance',
    ],
  },
  referenceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: [true, 'Reference ID is required'],
    refPath: 'referenceModel',
  },
  referenceModel: {
    type: String,
    required: true,
    enum: [
      'Expense',
      'ExecutiveVanAssignment',
      'SalesOrder',
      'DayCashOut',
      'CashChequeDeposit',
      'SalesReturn',
      'AdhocSalesReturn',
      'StockRequest',
      'StockReceiptVariance',
      'StockClosingVariance',
    ],
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Requested by user is required'],
  },
  amount: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  approvedAt: { type: Date },
  remarks: { type: String, trim: true },
  rejectionReason: { type: String, trim: true },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

approvalSchema.index({ companyId: 1, approvalType: 1, status: 1 });
approvalSchema.index({ companyId: 1, requestedBy: 1 });

module.exports = mongoose.model('Approval', approvalSchema);
