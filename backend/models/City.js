const mongoose = require('mongoose');

const citySchema = new mongoose.Schema({
  country: {
    type: String,
    required: [true, 'Country is required'],
    trim: true,
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
  },
  cityCode: {
    type: String,
    trim: true,
    uppercase: true,
  },
  cityName: {
    type: String,
    required: [true, 'City name is required'],
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

citySchema.index({ country: 1, state: 1, cityName: 1 }, { unique: true });

module.exports = mongoose.model('City', citySchema);
