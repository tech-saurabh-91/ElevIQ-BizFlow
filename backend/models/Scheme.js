const mongoose = require('mongoose');

const schemeItemSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { _id: false });

const schemeFreeItemSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true,
  },
  freeQty: {
    type: Number,
    required: true,
    min: 1,
  },
}, { _id: false });

const schemeSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  schemeName: {
    type: String,
    required: [true, 'Scheme name is required'],
    trim: true,
    maxlength: [200, 'Scheme name cannot exceed 200 characters'],
  },
  schemeCode: {
    type: String,
    trim: true,
    unique: true,
  },
  schemeType: {
    type: String,
    enum: ['free_promotional', 'return'],
    required: [true, 'Scheme type is required'],
    default: 'free_promotional',
  },
  schemeQty: {
    type: Number,
    required: [true, 'Scheme quantity is required'],
    min: [1, 'Quantity must be at least 1'],
  },
  effectiveStartDate: {
    type: Date,
    required: [true, 'Start date is required'],
  },
  effectiveEndDate: {
    type: Date,
    required: [true, 'End date is required'],
  },
  items: [schemeItemSchema],
  freeItems: [schemeFreeItemSchema],
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

schemeSchema.pre('save', async function () {
  if (this.isNew && !this.schemeCode) {
    const count = await mongoose.model('Scheme').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.schemeCode = `SCH-${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('Scheme', schemeSchema);
