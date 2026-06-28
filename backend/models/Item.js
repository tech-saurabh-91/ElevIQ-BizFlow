const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  itemName: {
    type: String,
    required: [true, 'Item name is required'],
    trim: true,
    maxlength: [200, 'Item name cannot exceed 200 characters'],
  },
  itemCode: {
    type: String,
    trim: true,
    unique: true,
  },
  itemDescription: {
    type: String,
    trim: true,
  },
  category: {
    type: String,
    trim: true,
  },
  brand: {
    type: String,
    trim: true,
  },
  itemClassification: {
    type: String,
    trim: true,
  },
  unit: {
    type: String,
    required: [true, 'Unit is required'],
    trim: true,
  },
  unitPrice: {
    type: Number,
    required: [true, 'Unit price is required'],
    min: [0, 'Price cannot be negative'],
  },
  costPrice: {
    type: Number,
    default: 0,
    min: [0, 'Cost price cannot be negative'],
  },
  sellingPrice: {
    type: Number,
    required: [true, 'Selling price is required'],
    min: [0, 'Selling price cannot be negative'],
  },
  taxRate: {
    type: Number,
    default: 0,
    min: [0, 'Tax rate cannot be negative'],
    max: [100, 'Tax rate cannot exceed 100%'],
  },
  taxId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxMaster',
  },
  hsnId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'HsnMaster',
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ItemGroup',
  },
  subGroupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ItemSubGroup',
  },
  hsnCode: { type: String, trim: true },
  customerItemCode: { type: String, trim: true },
  sku: { type: String, trim: true, unique: true },
  barcode: { type: String, trim: true },
  minStock: { type: Number, default: 0 },
  maxStock: { type: Number, default: 0 },
  reorderLevel: { type: Number, default: 0 },
  image: { type: String },
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

itemSchema.pre('save', async function () {
  if (this.isNew && !this.itemCode) {
    const lastItem = await mongoose.model('Item').findOne({ companyId: this.companyId }).sort({ itemCode: -1 }).select('itemCode');
    let nextNum = 1;
    if (lastItem && lastItem.itemCode) {
      const num = parseInt(lastItem.itemCode, 10);
      if (!isNaN(num)) nextNum = num + 1;
    }
    this.itemCode = String(nextNum).padStart(7, '0');
  }
  if (this.isNew && !this.sku) {
    this.sku = `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }
});

itemSchema.post('save', async function (doc) {
  if (doc.isNew) {
    const Warehouse = mongoose.model('Warehouse');
    const StockSummary = mongoose.model('StockSummary');
    const warehouses = await Warehouse.find({ companyId: doc.companyId, isActive: true }).select('_id');
    if (warehouses.length > 0) {
      const entries = warehouses.map(wh => ({
        companyId: doc.companyId,
        itemId: doc._id,
        warehouseId: wh._id,
        balanceQty: 0,
        availableQty: 0,
        requestedQty: 0,
      }));
      await StockSummary.insertMany(entries, { ordered: false }).catch(() => {});
    }
  }
});;

module.exports = mongoose.model('Item', itemSchema);
