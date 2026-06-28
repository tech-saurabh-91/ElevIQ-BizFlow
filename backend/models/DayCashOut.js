const mongoose = require('mongoose');

const dayCashOutSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  cashOutNumber: {
    type: String,
    trim: true,
    unique: true,
  },
  executiveId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Executive ID is required'],
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount cannot be negative'],
  },
  purpose: {
    type: String,
    required: [true, 'Purpose is required'],
    trim: true,
  },
  date: {
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

dayCashOutSchema.pre('save', async function () {
  if (this.isNew && !this.cashOutNumber) {
    const count = await mongoose.model('DayCashOut').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.cashOutNumber = `DCO-${prefix}-${String(count + 1).padStart(6, '0')}`;
  }
});;

module.exports = mongoose.model('DayCashOut', dayCashOutSchema);
