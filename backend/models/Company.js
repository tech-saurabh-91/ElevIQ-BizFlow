const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  companyCode: {
    type: String,
    unique: true,
    trim: true,
  },
  companyName: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true,
    maxlength: [200, 'Company name cannot exceed 200 characters'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email'],
  },
  phone: {
    type: String,
    required: [true, 'Phone is required'],
  },
  phoneCountryCode: {
    type: String,
    default: '+91',
  },
  address: {
    type: String,
    trim: true,
  },
  city: { type: String, trim: true },
  state: { type: String, trim: true },
  country: { type: String, trim: true },
  pincode: { type: String, trim: true },
  logo: { type: String },
  website: { type: String, trim: true },
  noOfUsers: {
    type: Number,
    default: 1,
    min: [1, 'Minimum 1 user required'],
  },
  activeUsers: {
    type: Number,
    default: 1,
  },
  licenseType: {
    type: String,
    enum: ['monthly', 'quarterly', 'half-yearly', 'yearly', 'custom'],
    default: 'monthly',
  },
  licenseValidFrom: {
    type: Date,
    required: [true, 'License start date is required'],
  },
  licenseValidTo: {
    type: Date,
    required: [true, 'License end date is required'],
  },
  isLicenseActive: {
    type: Boolean,
    default: true,
  },
  adminUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  gstNumber: {
    type: String,
    trim: true,
    maxlength: [15, 'GST Number cannot exceed 15 characters'],
    uppercase: true,
  },
  gstEnabled: {
    type: Boolean,
    default: false,
  },
  stateCode: {
    type: String,
    trim: true,
    maxlength: [2, 'State code must be 2 digits'],
  },
  taxInclusive: {
    type: Boolean,
    default: false,
  },
  taxInclusiveSetOn: {
    type: Date,
  },
  taxInclusiveLocked: {
    type: Boolean,
    default: false,
  },
  financialYearStart: {
    month: { type: Number, required: true, min: 1, max: 12, default: 1 },
    day: { type: Number, required: true, min: 1, max: 31, default: 1 },
  },
  defaultTaxId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxMaster',
  },
  defaultHsnId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HsnMaster',
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

companySchema.pre('save', async function () {
  if (this.isNew && !this.companyCode) {
    const count = await mongoose.model('Company').countDocuments();
    this.companyCode = String(count + 1).padStart(2, '0');
  }
  if (this.licenseValidTo && new Date() > this.licenseValidTo) {
    this.isLicenseActive = false;
  }
});

companySchema.methods.isLicenseValid = function () {
  const now = new Date();
  return this.isLicenseActive && now >= this.licenseValidFrom && now <= this.licenseValidTo;
};

companySchema.methods.canAddUser = function () {
  return this.activeUsers < this.noOfUsers;
};

companySchema.methods.canChangeTaxInclusive = function () {
  return !this.taxInclusiveLocked;
};

companySchema.methods.lockTaxInclusive = function () {
  this.taxInclusiveLocked = true;
  this.taxInclusiveSetOn = new Date();
};

companySchema.methods.calculateTax = function (basePrice, taxPercent, state) {
  if (this.taxInclusive) {
    // Tax is already included in price
    const taxAmount = basePrice - (basePrice / (1 + taxPercent / 100));
    const priceExcludingTax = basePrice - taxAmount;
    return {
      basePrice: priceExcludingTax,
      taxAmount: taxAmount,
      totalAmount: basePrice,
      isInclusive: true,
    };
  } else {
    // Tax is added on top
    const taxAmount = basePrice * (taxPercent / 100);
    return {
      basePrice: basePrice,
      taxAmount: taxAmount,
      totalAmount: basePrice + taxAmount,
      isInclusive: false,
    };
  }
};

module.exports = mongoose.model('Company', companySchema);
