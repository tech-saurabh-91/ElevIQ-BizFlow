import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { UNIT_TYPES } from '../config/constants.js';

/**
 * Product / SKU master.
 * Stock quantities live in the inventory module (Phase 7); this document keeps
 * the catalogue attributes plus an opening-stock snapshot for setup.
 */
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Product name is required'], trim: true, maxlength: 180 },
    // System product code from the numbering series; never edited.
    sku: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    // The company's own code for the item (old ERP / manufacturer code), optional.
    customCode: { type: String, trim: true, maxlength: 40, default: '' },
    barcode: { type: String, default: '', trim: true },

    // Grouping from the Classification -> Category -> Sub-category master.
    // Names are kept alongside the ids for lists, filters and reports.
    classification: { type: String, default: '', trim: true },
    classificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductCategory', default: null },
    category: { type: String, default: 'General', trim: true, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductCategory', default: null },
    subCategory: { type: String, default: '', trim: true },
    subCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductCategory', default: null },
    brand: { type: String, default: '', trim: true, index: true },

    // Units: stock is always counted in the base unit (e.g. PCS). Pack units
    // say how many base units they hold (Packet = 10 PCS, Carton = 120 PCS),
    // so a line can be sold or bought in any of them.
    unit: { type: String, default: 'PCS', trim: true, uppercase: true, maxlength: 10 },
    packUnits: {
      type: [
        {
          _id: false,
          unit: { type: String, required: true, trim: true, uppercase: true, maxlength: 10 },
          factor: { type: Number, required: true, min: 1 },
          barcode: { type: String, default: '', trim: true },
          // 0 = base selling price x factor
          price: { type: Number, default: 0, min: 0 },
        },
      ],
      default: [],
    },
    // Legacy single alternate unit (pre pack units); read once to migrate.
    unitType: { type: String, enum: UNIT_TYPES, default: 'BASE' },
    altUnit: { type: String, default: '', trim: true, maxlength: 16 },
    conversion: { type: Number, default: 1, min: 0.0001 },

    // Tax
    hsnCode: { type: String, default: '', trim: true },
    gstRate: { type: Number, default: 18, min: 0, max: 100 },

    // Pricing (price lists can override per customer)
    mrp: money(),
    sellingPrice: money(),
    dealerPrice: money(),
    // Last purchase rate per base unit (updated by every posted goods receipt).
    purchasePrice: money(),
    // Moving average cost per base unit across all warehouses - what the stock
    // on hand is worth and what each sale costs (see inventoryService).
    avgCost: { type: Number, default: 0, min: 0 },

    // Stock snapshot / alerts
    openingStock: { type: Number, default: 0 },
    // Warehouse the opening stock was booked into (set once, at creation).
    openingWarehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    stock: { type: Number, default: 0 },
    lowStockLevel: { type: Number, default: 10, min: 0 },

    image: { type: String, default: '' },
    description: { type: String, default: '', maxlength: 1000 },
    tags: { type: [String], default: [] },

    isBatchTracked: { type: Boolean, default: false },
    isReturnable: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

productSchema.index(
  { companyId: 1, sku: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, sku: { $type: 'string', $gt: '' } } }
);
productSchema.index({ companyId: 1, name: 1 });
productSchema.index({ companyId: 1, barcode: 1 });
productSchema.index({ companyId: 1, customCode: 1 });
productSchema.index({ companyId: 1, category: 1, isActive: 1 });

productSchema.plugin(tenantPlugin);

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);
export default Product;
