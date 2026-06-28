const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  expenseNumber: {
    type: String,
    trim: true,
    unique: true,
  },
  executiveId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Executive ID is required'],
  },
  expenseType: {
    type: String,
    required: [true, 'Expense type is required'],
    trim: true,
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount cannot be negative'],
  },
  expenseDate: {
    type: Date,
    default: Date.now,
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
  },
  receipt: { type: String },
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
  latitude: { type: Number },
  longitude: { type: Number },
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

expenseSchema.pre('save', async function () {
  if (this.isNew && !this.expenseNumber) {
    const count = await mongoose.model('Expense').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.expenseNumber = `EXP-${prefix}-${String(count + 1).padStart(6, '0')}`;
  }
});;

module.exports = mongoose.model('Expense', expenseSchema);
