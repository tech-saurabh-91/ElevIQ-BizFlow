const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
  },
  date: {
    type: Date,
    required: [true, 'Date is required'],
  },
  checkInTime: { type: Date },
  checkOutTime: { type: Date },
  checkInLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
    address: { type: String },
  },
  checkOutLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
    address: { type: String },
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'half_day', 'late', 'on_leave'],
    default: 'present',
  },
  totalHours: { type: Number, default: 0 },
  overtime: { type: Number, default: 0 },
  remarks: { type: String, trim: true },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

attendanceSchema.index({ companyId: 1, userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
