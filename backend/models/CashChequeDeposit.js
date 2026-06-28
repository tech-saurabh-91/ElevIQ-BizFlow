const mongoose = require('mongoose');

const cashChequeDepositSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  depositNumber: {
    type: String,
    trim: true,
    unique: true,
  },
  executiveId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Executive ID is required'],
  },
  depositType: {
    type: String,
    enum: ['cash', 'cheque'],
    required: [true, 'Deposit type is required'],
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount cannot be negative'],
  },
  chequeNumber: { type: String, trim: true },
  chequeDate: { type: Date },
  bankName: { type: String, trim: true },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
  },
  depositDate: {
    type: Date,
    default: Date.now,
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
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

cashChequeDepositSchema.pre('save', async function () {
  if (this.isNew && !this.depositNumber) {
    const count = await mongoose.model('CashChequeDeposit').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.depositNumber = `CCD-${prefix}-${String(count + 1).padStart(6, '0')}`;
  }
});;

module.exports = mongoose.model('CashChequeDeposit', cashChequeDepositSchema);
