import Product from '../../models/Product.js';
import { buildCrudController } from './_crud.js';
import { autoCode, markSetup } from './_helpers.js';

const crud = buildCrudController({
  Model: Product,
  entityType: 'Product',
  labelField: 'name',
  searchFields: ['name', 'sku', 'barcode', 'category', 'brand', 'hsnCode'],
  filtersSpec: {
    category: { type: 'string' },
    brand: { type: 'string' },
    isActive: { type: 'bool' },
  },
  sortAllowed: ['createdAt', 'name', 'sku', 'sellingPrice', 'stock', 'mrp'],
  label: 'Product',
  listFilter: (req) => {
    const filter = {};
    if (req.query.lowStock === 'true') {
      filter.$expr = { $lte: ['$stock', '$lowStockLevel'] };
    }
    return filter;
  },
  beforeCreate: async (payload, req) => {
    const out = { ...payload };
    if (!out.sku) out.sku = await autoCode(req, 'PRODUCT', 'PRD', 5);
    if (!out.category) out.category = 'General';
    if (out.stock === undefined) out.stock = out.openingStock ?? 0;
    return out;
  },
  beforeUpdate: async (payload) => {
    const out = { ...payload };
    if (out.openingStock !== undefined && out.stock === undefined) out.stock = out.openingStock;
    return out;
  },
  afterCreate: async () => {
    await markSetup('products');
  },
});

export const { list, get, create, update, remove } = crud;

export default crud;
