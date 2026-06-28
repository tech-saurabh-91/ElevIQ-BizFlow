const mongoose = require('mongoose');

const tourVisitSchema = new mongoose.Schema({
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
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
  },
  visitDate: {
    type: Date,
    required: [true, 'Visit date is required'],
  },
  visitType: {
    type: String,
    enum: ['sales', 'collection', 'promotion', 'service', 'other'],
    default: 'sales',
  },
  checkInTime: { type: Date },
  checkOutTime: { type: Date },
  checkInLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
  },
  checkOutLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
  },
  purpose: { type: String, trim: true },
  outcome: { type: String, trim: true },
  remarks: { type: String, trim: true },
  orderPlaced: { type: Boolean, default: false },
  orderAmount: { type: Number, default: 0 },
  photos: [{ type: String }],
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

module.exports = mongoose.model('TourVisit', tourVisitSchema);
