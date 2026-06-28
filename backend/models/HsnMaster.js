const mongoose = require('mongoose');

const hsnMasterSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  hsnCode: {
    type: String,
    required: [true, 'HSN Code is required'],
    trim: true,
    maxlength: [20, 'HSN Code cannot exceed 20 characters'],
  },
  hsnDescription: {
    type: String,
    required: [true, 'HSN Description is required'],
    trim: true,
    maxlength: [500, 'HSN Description cannot exceed 500 characters'],
  },
  effectiveFromDate: {
    type: Date,
    required: [true, 'Effective from date is required'],
  },
  effectiveToDate: {
    type: Date,
    required: [true, 'Effective to date is required'],
  },
  cgstTaxId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxMaster',
  },
  cgstDesc: {
    type: String,
    trim: true,
  },
  cgstPercent: {
    type: Number,
    default: 0,
    min: [0, 'CGST cannot be negative'],
    max: [100, 'CGST cannot exceed 100%'],
  },
  sgstTaxId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxMaster',
  },
  sgstDesc: {
    type: String,
    trim: true,
  },
  sgstPercent: {
    type: Number,
    default: 0,
    min: [0, 'SGST cannot be negative'],
    max: [100, 'SGST cannot exceed 100%'],
  },
  igstTaxId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxMaster',
  },
  igstDesc: {
    type: String,
    trim: true,
  },
  igstPercent: {
    type: Number,
    default: 0,
    min: [0, 'IGST cannot be negative'],
    max: [100, 'IGST cannot exceed 100%'],
  },
  cessTaxId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxMaster',
  },
  cessPercent: {
    type: Number,
    default: 0,
  },
  totalTaxPercent: {
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

hsnMasterSchema.index({ companyId: 1, hsnCode: 1 }, { unique: true });

hsnMasterSchema.pre('save', function () {
  this.totalTaxPercent = (this.cgstPercent || 0) + (this.sgstPercent || 0) + (this.igstPercent || 0) + (this.cessPercent || 0);
});

hsnMasterSchema.methods.isWithinEffectivePeriod = function () {
  const now = new Date();
  return this.isActive && now >= this.effectiveFromDate && now <= this.effectiveToDate;
};

module.exports = mongoose.model('HsnMaster', hsnMasterSchema);
