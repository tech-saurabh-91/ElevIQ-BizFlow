const mongoose = require('mongoose');

const otherParameterSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  parameterType: {
    type: String,
    required: [true, 'Parameter type is required'],
    enum: [
      'item_classification',
      'brand',
      'unit',
      'payment_mode',
      'expense_type',
      'customer_type',
      'designation',
      'visit_purpose',
      'attendance_status',
      'order_status',
      'other',
    ],
    trim: true,
  },
  parameterValue: {
    type: String,
    required: [true, 'Parameter value is required'],
    trim: true,
  },
  parameterCode: {
    type: String,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  sortOrder: { type: Number, default: 0 },
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

otherParameterSchema.index({ companyId: 1, parameterType: 1, parameterValue: 1 }, { unique: true });

module.exports = mongoose.model('OtherParameter', otherParameterSchema);
