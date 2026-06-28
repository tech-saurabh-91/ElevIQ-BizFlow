const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  routeName: {
    type: String,
    required: [true, 'Route name is required'],
    trim: true,
    maxlength: [200, 'Route name cannot exceed 200 characters'],
  },
  routeNumber: {
    type: String,
    trim: true,
    unique: true,
  },
  routeDate: {
    type: Date,
    required: [true, 'Route date is required'],
  },
  routeDescription: {
    type: String,
    trim: true,
  },
  customers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
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

routeSchema.pre('save', async function () {
  if (this.isNew && !this.routeNumber) {
    const count = await mongoose.model('Route').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.routeNumber = `RT-${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('Route', routeSchema);
