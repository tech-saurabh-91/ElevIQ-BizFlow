const mongoose = require('mongoose');

const salesReturnItemSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true,
  },
  itemName: String,
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1'],
  },
  unitPrice: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  reason: { type: String, trim: true },
});

const salesReturnSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  returnNumber: {
    type: String,
    trim: true,
    unique: true,
  },
  originalOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesOrder',
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: [true, 'Customer ID is required'],
  },
  executiveId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Executive ID is required'],
  },
  warehouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: [true, 'Warehouse ID is required'],
  },
  returnDate: {
    type: Date,
    default: Date.now,
  },
  items: [salesReturnItemSchema],
  totalReturnAmount: { type: Number, default: 0 },
  returnReason: {
    type: String,
    required: [true, 'Return reason is required'],
    trim: true,
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

salesReturnSchema.pre('save', async function () {
  if (this.isNew && !this.returnNumber) {
    const count = await mongoose.model('SalesReturn').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.returnNumber = `SR-${prefix}-${String(count + 1).padStart(6, '0')}`;
  }
  if (this.items && this.items.length) {
    this.totalReturnAmount = this.items.reduce((sum, item) => sum + item.totalAmount, 0);
  }
});;

module.exports = mongoose.model('SalesReturn', salesReturnSchema);
