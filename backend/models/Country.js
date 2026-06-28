const mongoose = require('mongoose');

const countrySchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  countryName: {
    type: String,
    required: [true, 'Country name is required'],
    trim: true,
    maxlength: [100, 'Country name cannot exceed 100 characters'],
  },
  countryCode: {
    type: String,
    required: [true, 'Country code is required'],
    trim: true,
    uppercase: true,
    minlength: [2, 'Country code must be 2 characters'],
    maxlength: [3, 'Country code cannot exceed 3 characters'],
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    trim: true,
    maxlength: [10, 'Currency cannot exceed 10 characters'],
  },
  currencySymbol: {
    type: String,
    trim: true,
  },
  phoneCode: {
    type: String,
    trim: true,
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

module.exports = mongoose.model('Country', countrySchema);
