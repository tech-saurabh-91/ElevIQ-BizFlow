const mongoose = require('mongoose');

const stockSummarySchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: [true, 'Item ID is required'],
  },
  warehouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: [true, 'Warehouse ID is required'],
  },
  balanceQty: {
    type: Number,
    default: 0,
    min: [0, 'Balance qty cannot be negative'],
  },
  availableQty: {
    type: Number,
    default: 0,
    min: [0, 'Available qty cannot be negative'],
  },
  requestedQty: {
    type: Number,
    default: 0,
    min: [0, 'Requested qty cannot be negative'],
  },
}, {
  timestamps: true,
});

stockSummarySchema.index({ companyId: 1, itemId: 1, warehouseId: 1 }, { unique: true });

module.exports = mongoose.model('StockSummary', stockSummarySchema);
