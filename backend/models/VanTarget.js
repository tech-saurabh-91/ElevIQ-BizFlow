const mongoose = require('mongoose');

const vanTargetSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  vanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VAN',
    required: [true, 'VAN ID is required'],
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
    min: [2020, 'Year must be 2020 or later'],
  },
  targetAmount: {
    type: Number,
    required: [true, 'Target amount is required'],
    min: [0, 'Target cannot be negative'],
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

vanTargetSchema.index({ companyId: 1, vanId: 1, month: 1, year: 1 }, { unique: true });

vanTargetSchema.pre('save', function () {
  if (this.targetAmount > 0) {
    this.achievementPercentage = Math.round((this.achievedAmount / this.targetAmount) * 100);
  }
});

module.exports = mongoose.model('VanTarget', vanTargetSchema);
