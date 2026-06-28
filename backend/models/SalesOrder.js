const mongoose = require('mongoose');

const salesOrderItemSchema = new mongoose.Schema({
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true,
  },
  itemName: String,
  itemCode: String,
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1'],
  },
  unitPrice: {
    type: Number,
    required: true,
    min: [0, 'Price cannot be negative'],
  },
  basePrice: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  cgstAmount: { type: Number, default: 0 },
  sgstAmount: { type: Number, default: 0 },
  igstAmount: { type: Number, default: 0 },
  gstType: { type: String, default: '' },
  totalAmount: {
    type: Number,
    required: true,
    min: [0, 'Total cannot be negative'],
  },
});

const salesOrderSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  orderNumber: {
    type: String,
    trim: true,
    unique: true,
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
  orderDate: {
    type: Date,
    default: Date.now,
  },
  deliveryDate: { type: Date },
  items: [salesOrderItemSchema],
  subtotal: { type: Number, default: 0 },
  totalBasePrice: { type: Number, default: 0 },
  totalDiscount: { type: Number, default: 0 },
  totalTax: { type: Number, default: 0 },
  totalCgst: { type: Number, default: 0 },
  totalSgst: { type: Number, default: 0 },
  totalIgst: { type: Number, default: 0 },
  taxInclusive: { type: Boolean, default: false },
  grandTotal: {
    type: Number,
    required: [true, 'Grand total is required'],
    min: [0, 'Grand total cannot be negative'],
  },
  paymentMode: {
    type: String,
    enum: ['cash', 'credit', 'cheque', 'online', 'upi'],
    default: 'cash',
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'paid'],
    default: 'pending',
  },
  orderStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'dispatched', 'delivered', 'cancelled'],
    default: 'pending',
  },
  remarks: { type: String, trim: true },
  latitude: { type: Number },
  longitude: { type: Number },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
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

salesOrderSchema.pre('save', async function () {
  if (this.isNew && !this.orderNumber) {
    const count = await mongoose.model('SalesOrder').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.orderNumber = `SO-${prefix}-${String(count + 1).padStart(6, '0')}`;
  }
  if (this.items && this.items.length) {
    this.totalBasePrice = this.items.reduce((sum, item) => sum + (item.basePrice || item.totalAmount), 0);
    this.subtotal = this.items.reduce((sum, item) => sum + item.totalAmount, 0);
    this.totalDiscount = this.items.reduce((sum, item) => sum + (item.discount || 0), 0);
    this.totalTax = this.items.reduce((sum, item) => sum + (item.taxAmount || 0), 0);
    this.totalCgst = this.items.reduce((sum, item) => sum + (item.cgstAmount || 0), 0);
    this.totalSgst = this.items.reduce((sum, item) => sum + (item.sgstAmount || 0), 0);
    this.totalIgst = this.items.reduce((sum, item) => sum + (item.igstAmount || 0), 0);
  }
});;

module.exports = mongoose.model('SalesOrder', salesOrderSchema);
