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
    sku: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },
    barcode: { type: String, default: '', trim: true },
    category: { type: String, default: 'General', trim: true, index: true },
    subCategory: { type: String, default: '', trim: true },
    brand: { type: String, default: '', trim: true, index: true },

    // Units
    unit: { type: String, default: 'PCS', trim: true, maxlength: 16 },
    unitType: { type: String, enum: UNIT_TYPES, default: 'BASE' },
    altUnit: { type: String, default: '', trim: true, maxlength: 16 },
    conversion: { type: Number, default: 1, min: 0.0001 },

    // Tax
    hsnCode: { type: String, default: '', trim: true },
    gstRate: { type: Number, default: 18, min: 0, max: 28 },

    // Pricing (price lists can override per customer)
    mrp: money(),
    sellingPrice: money(),
    dealerPrice: money(),
    purchasePrice: money(),

    // Stock snapshot / alerts
    openingStock: { type: Number, default: 0 },
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
productSchema.index({ companyId: 1, category: 1, isActive: 1 });

productSchema.plugin(tenantPlugin);

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);
export default Product;
