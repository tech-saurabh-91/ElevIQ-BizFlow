const mongoose = require('mongoose');

const discountItemSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: [true, 'Item ID is required'],
  },
}, { _id: true });

const discountSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  discountGroup: {
    type: String,
    required: [true, 'Discount group name is required'],
    trim: true,
  },
  effectiveFrom: {
    type: Date,
    required: [true, 'Effective from date is required'],
  },
  effectiveTo: {
    type: Date,
    required: [true, 'Effective to date is required'],
  },
  quantityFrom: {
    type: Number,
    required: [true, 'Quantity from is required'],
    min: [1, 'Minimum quantity is 1'],
  },
  discountPercent: {
    type: Number,
    required: [true, 'Discount percent is required'],
    min: [0, 'Discount cannot be negative'],
    max: [100, 'Discount cannot exceed 100%'],
  },
  items: [discountItemSchema],
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

discountSchema.pre('save', async function () {
  if (this.isNew) {
    const count = await mongoose.model('Discount').countDocuments({ companyId: this.companyId });
    this._doc._discountCode = `DISC${String(count + 1).padStart(7, '0')}`;
  }
});

discountSchema.methods.isValidDiscount = function () {
  const now = new Date();
  return this.isActive && now >= this.effectiveFrom && now <= this.effectiveTo;
};

module.exports = mongoose.model('Discount', discountSchema);
