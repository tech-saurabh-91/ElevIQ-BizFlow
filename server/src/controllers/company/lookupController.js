import Customer from '../../models/Customer.js';
import Product from '../../models/Product.js';
import Supplier from '../../models/Supplier.js';
import Warehouse from '../../models/Warehouse.js';
import Route from '../../models/Route.js';
import PriceList from '../../models/PriceList.js';
import User from '../../models/User.js';
import mongoose from 'mongoose';
import { searchRegex } from '../../utils/query.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const idOf = (d) => ({ ...d, id: String(d._id), _id: undefined });

const match = (q, fields) => (q ? { $or: fields.map((f) => ({ [f]: searchRegex(q) })) } : {});

/** Compact select options for the master-data forms. */
export const options = asyncHandler(async (req, res) => {
  const { q, limit = 50 } = req.query;
  const active = { isActive: true };

  const [customers, products, suppliers, warehouses, routes, priceLists, users, categories] =
    await Promise.all([
      Customer.find({ ...active, ...match(q, ['name', 'code', 'phone']) })
        .select('name code phone type assignedTo route')
        .sort({ name: 1 })
        .limit(limit)
        .lean(),
      Product.find({ ...active, ...match(q, ['name', 'sku', 'customCode', 'barcode']) })
        .select('name sku customCode category unit packUnits sellingPrice mrp purchasePrice gstRate stock lowStockLevel')
        .sort({ name: 1 })
        .limit(limit)
        .lean(),
      Supplier.find({ ...active, ...match(q, ['name', 'code', 'phone']) })
        .select('name code phone')
        .sort({ name: 1 })
        .limit(limit)
        .lean(),
      Warehouse.find({ ...active, ...match(q, ['name', 'code']) })
        .select('name code type isDefault')
        .sort({ isDefault: -1, name: 1 })
        .limit(limit)
        .lean(),
      Route.find({ ...active, ...match(q, ['name', 'code', 'territory']) })
        .select('name code territory assignedTo beatDays')
        .sort({ name: 1 })
        .limit(limit)
        .lean(),
      PriceList.find({ ...active, ...match(q, ['name', 'code']) })
        .select('name code type isDefault')
        .sort({ isDefault: -1, name: 1 })
        .limit(limit)
        .lean(),
      User.find({ isActive: true, ...match(q, ['name', 'email', 'phone']) })
        .select('name email role title territory')
        .sort({ name: 1 })
        .limit(limit)
        .lean(),
      // Aggregation does NOT receive the tenant plugin's auto filter, so the
      // company scope is matched explicitly here.
      Product.aggregate([
        {
          $match: {
            companyId: new mongoose.Types.ObjectId(req.companyId),
            isDeleted: { $ne: true },
            category: { $nin: ['', null] },
          },
        },
        { $group: { _id: '$category' } },
        { $sort: { _id: 1 } },
        { $limit: 200 },
      ]),
    ]);

  return success(res, {
    data: {
      customers: customers.map(idOf),
      products: products.map(idOf),
      suppliers: suppliers.map(idOf),
      warehouses: warehouses.map(idOf),
      routes: routes.map(idOf),
      priceLists: priceLists.map(idOf),
      users: users.map(idOf),
      categories: categories.map((c) => c._id).filter(Boolean).sort(),
    },
  });
});

export default { options };
