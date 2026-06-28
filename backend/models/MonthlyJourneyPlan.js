const mongoose = require('mongoose');

const monthlyJourneyPlanSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  executiveId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Executive ID is required'],
  },
  month: {
    type: Number,
    required: [true, 'Month is required'],
    min: [1, 'Month must be between 1-12'],
    max: [12, 'Month must be between 1-12'],
  },
  year: {
    type: Number,
    required: [true, 'Year is required'],
  },
  plans: [{
    day: { type: Number, required: true },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
    },
    routeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Route',
    },
    visitType: {
      type: String,
      enum: ['sales', 'collection', 'promotion', 'service'],
      default: 'sales',
    },
    purpose: { type: String, trim: true },
    remarks: { type: String, trim: true },
  }],
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

monthlyJourneyPlanSchema.index({ companyId: 1, executiveId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('MonthlyJourneyPlan', monthlyJourneyPlanSchema);
