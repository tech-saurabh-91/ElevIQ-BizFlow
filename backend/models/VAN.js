const mongoose = require('mongoose');

const vanSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  vanName: {
    type: String,
    required: [true, 'VAN name is required'],
    trim: true,
    maxlength: [200, 'VAN name cannot exceed 200 characters'],
  },
  vanCode: {
    type: String,
    trim: true,
    unique: true,
  },
  warehouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: [true, 'Warehouse ID is required'],
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
  },
  vehicleNumber: {
    type: String,
    trim: true,
    uppercase: true,
  },
  driverName: { type: String, trim: true },
  driverPhone: {
    type: String,
    match: [/^[0-9]{10}$/, 'Phone must be 10 digits'],
  },
  capacity: { type: Number, default: 0 },
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

vanSchema.pre('save', async function () {
  if (this.isNew && !this.vanCode) {
    const count = await mongoose.model('VAN').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.vanCode = `VAN-${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
});;

module.exports = mongoose.model('VAN', vanSchema);
