const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  customerCode: {
    type: String,
    trim: true,
    unique: true,
  },
  customerName: {
    type: String,
    required: [true, 'Customer name is required'],
    trim: true,
    maxlength: [200, 'Customer name cannot exceed 200 characters'],
  },
  contactPerson: {
    type: String,
    trim: true,
  },
  phone: {
    type: String,
    required: [true, 'Phone is required'],
    match: [/^[0-9]{10}$/, 'Phone must be 10 digits'],
  },
  email: {
    type: String,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email'],
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true,
  },
  city: { type: String, trim: true },
  state: { type: String, trim: true },
  pincode: { type: String, trim: true },
  routeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Route',
  },
  locationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Location',
  },
  customerType: {
    type: String,
    enum: ['retailer', 'wholesaler', 'distributor', 'general'],
    default: 'retailer',
  },
  gstNumber: { type: String, trim: true },
  panNumber: { type: String, trim: true },
  creditLimit: { type: Number, default: 0 },
  outstandingAmount: { type: Number, default: 0 },
  latitude: { type: Number },
  longitude: { type: Number },
  warehouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
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

customerSchema.pre('save', async function () {
  if (this.isNew && !this.customerCode) {
    const count = await mongoose.model('Customer').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.customerCode = `CUST-${prefix}-${String(count + 1).padStart(5, '0')}`;
  }
});;

module.exports = mongoose.model('Customer', customerSchema);
