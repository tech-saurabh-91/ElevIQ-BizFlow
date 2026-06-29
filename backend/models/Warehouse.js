const mongoose = require('mongoose');

const warehouseSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  warehouseName: {
    type: String,
    required: [true, 'Warehouse name is required'],
    trim: true,
    maxlength: [200, 'Warehouse name cannot exceed 200 characters'],
  },
  warehouseCode: {
    type: String,
    trim: true,
    unique: true,
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true,
  },
  city: { type: String, trim: true },
  state: { type: String, trim: true },
  pincode: { type: String, trim: true },
  country: { type: String, trim: true, default: 'India' },
  stateCode: { type: String, trim: true },
  natureOfWarehouse: {
    type: String,
    trim: true,
    required: [true, 'Nature of warehouse is required'],
  },
  isParentWarehouse: {
    type: Boolean,
    default: false,
  },
  parentWarehouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    default: null,
  },
  isVanWarehouse: {
    type: Boolean,
    default: false,
  },
  vanNumber: {
    type: String,
    trim: true,
  },
  vanParentWarehouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    default: null,
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

warehouseSchema.pre('save', async function () {
  if (this.isNew && !this.warehouseCode) {
    const name = this.warehouseName || 'WH';
    const initials = name.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase()).join('');
    const count = await mongoose.model('Warehouse').countDocuments({ companyId: this.companyId });
    this.warehouseCode = `${initials}${String(count + 1).padStart(2, '0')}`;
  }
});

warehouseSchema.post('save', async function (doc) {
  if (doc.isNew) {
    const Item = mongoose.model('Item');
    const StockSummary = mongoose.model('StockSummary');
    const items = await Item.find({ companyId: doc.companyId, isActive: true }).select('_id');
    if (items.length > 0) {
      const entries = items.map(item => ({
        companyId: doc.companyId,
        itemId: item._id,
        warehouseId: doc._id,
        balanceQty: 0,
        availableQty: 0,
        requestedQty: 0,
      }));
      await StockSummary.insertMany(entries, { ordered: false }).catch(() => {});
    }
  }
});

module.exports = mongoose.model('Warehouse', warehouseSchema);
