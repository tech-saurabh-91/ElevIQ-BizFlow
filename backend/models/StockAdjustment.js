const mongoose = require('mongoose');

const stockAdjustmentItemSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: [true, 'Item ID is required'],
  },
  itemCode: { type: String, trim: true },
  itemName: { type: String, trim: true },
  unit: { type: String, trim: true },
  sfaQty: { type: Number, default: 0 },
  addSub: {
    type: String,
    enum: ['add', 'subtract'],
    required: [true, 'Add/Sub is required'],
  },
  adjustQty: {
    type: Number,
    required: [true, 'Adjust qty is required'],
    min: [1, 'Adjust qty must be at least 1'],
  },
});

const stockAdjustmentSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  warehouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: [true, 'Warehouse ID is required'],
  },
  adjustmentCode: {
    type: String,
    trim: true,
    unique: true,
  },
  adjustmentDate: {
    type: Date,
    default: Date.now,
  },
  adjustmentMode: {
    type: String,
    enum: ['manual', 'upload'],
    default: 'manual',
  },
  remarks: {
    type: String,
    trim: true,
  },
  items: [stockAdjustmentItemSchema],
  totalItems: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['draft', 'approved', 'rejected'],
    default: 'draft',
  },
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

stockAdjustmentSchema.pre('save', async function () {
  if (this.isNew && !this.adjustmentCode) {
    const count = await mongoose.model('StockAdjustment').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.adjustmentCode = `${String(count + 1).padStart(3, '0')}ADJ${prefix}`;
  }
  if (this.items && this.items.length) {
    this.totalItems = this.items.length;
  }
});

module.exports = mongoose.model('StockAdjustment', stockAdjustmentSchema);
