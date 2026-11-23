import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import Company from '../src/models/Company.js';
import Product from '../src/models/Product.js';
import StockBalance from '../src/models/StockBalance.js';
import Warehouse from '../src/models/Warehouse.js';

/**
 * Product.stock is the SELLABLE stock: since damaged-goods warehouses stopped
 * counting, products that already had damaged returns show too much stock.
 * This sets Product.stock to the sum of its balances outside DAMAGED
 * warehouses.
 *
 *   node scripts/fix-damaged-stock.js                     show what would change, write nothing
 *   node scripts/fix-damaged-stock.js --apply             write the changes
 *   node scripts/fix-damaged-stock.js --company CODE      one company only
 *
 * Only products holding stock in a damaged warehouse are touched. Safe to re-run.
 */

const apply = process.argv.includes('--apply');
const codeArg = process.argv.includes('--company') ? process.argv[process.argv.indexOf('--company') + 1] : null;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const run = async () => {
  await connectDB();
  const companies = await Company.find(codeArg ? { code: codeArg.toUpperCase() } : {}).select('code businessName').skipTenant().lean();
  let changed = 0;
  for (const company of companies) {
    const damaged = await Warehouse.find({ companyId: company._id, type: 'DAMAGED' }).select('_id').skipTenant().lean();
    if (!damaged.length) continue;
    const damagedIds = damaged.map((w) => w._id);
    const affected = await StockBalance.distinct('product', { companyId: company._id, warehouse: { $in: damagedIds }, qty: { $ne: 0 } }).skipTenant();
    for (const productId of affected) {
      const [sum] = await StockBalance.aggregate([
        { $match: { companyId: company._id, product: productId, warehouse: { $nin: damagedIds }, isDeleted: { $ne: true } } },
        { $group: { _id: null, qty: { $sum: '$qty' } } },
      ]);
      const sellable = round2(sum?.qty || 0);
      const product = await Product.findOne({ _id: productId, companyId: company._id }).select('name stock').skipTenant().lean();
      if (!product || Math.abs(Number(product.stock || 0) - sellable) < 0.0001) continue;
      console.log(`${company.code}  ${product.name}: ${product.stock} -> ${sellable}`);
      changed += 1;
      if (apply) await Product.updateOne({ _id: productId }, { $set: { stock: sellable } }).skipTenant();
    }
  }
  console.log(`${changed} product(s) ${apply ? 'fixed' : 'to fix (run with --apply to write)'}`);
  await disconnectDB();
};

run().catch(async (err) => {
  console.error(err);
  await disconnectDB();
  process.exit(1);
});
