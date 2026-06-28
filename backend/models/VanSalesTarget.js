const mongoose = require('mongoose');

const vanSalesTargetSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Executive ID is required'],
  },
  fyYear: {
    type: Number,
    required: [true, 'Financial year is required'],
  },
  fyLabel: {
    type: String,
    required: [true, 'Financial year label is required'],
  },
  monthInFY: {
    type: Number,
    required: [true, 'Month in FY is required'],
    min: 1,
    max: 12,
  },
  calendarMonth: {
    type: Number,
    required: [true],
    min: 1,
    max: 12,
  },
  calendarYear: {
    type: Number,
    required: [true],
  },
  targetAmount: {
    type: Number,
    required: [true, 'Target amount is required'],
    min: [0, 'Target cannot be negative'],
    default: 0,
  },
  achievedAmount: {
    type: Number,
    default: 0,
  },
  achievementPercentage: {
    type: Number,
    default: 0,
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

vanSalesTargetSchema.index({ companyId: 1, userId: 1, fyYear: 1, monthInFY: 1 }, { unique: true });

vanSalesTargetSchema.pre('save', function () {
  if (this.targetAmount > 0) {
    this.achievementPercentage = Math.round((this.achievedAmount / this.targetAmount) * 100);
  }
});

module.exports = mongoose.model('VanSalesTarget', vanSalesTargetSchema);
