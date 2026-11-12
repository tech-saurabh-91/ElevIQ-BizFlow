import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import Company from '../src/models/Company.js';
import Product from '../src/models/Product.js';
import StockMovement from '../src/models/StockMovement.js';
import StockBalance from '../src/models/StockBalance.js';
import Invoice from '../src/models/Invoice.js';
import { costMovement } from '../src/services/inventoryService.js';
import { MOVEMENT_TYPES } from '../src/config/constants.js';

/**
 * Rebuilds moving average cost from the stock ledger, for data booked before
 * costing was in place. Per product it replays every movement in time order
 * and:
 *   1. sets Product.avgCost (and keeps the last purchase rate),
 *   2. rewrites each movement's unitCost / value - sales used to be booked at
 *      the SELLING price, which made stock value and profit wrong,
 *   3. fills the cost on issued invoice lines that have none (the average at
 *      the time the invoice was issued),
 *   4. repairs balances that were held at 0 when the ledger says they are
 *      below zero (stock used to be clamped at 0).
 *
 *   npm run rebuild-costs                     show what would change, write nothing
 *   npm run rebuild-costs -- --apply          write the changes
 *   npm run rebuild-costs -- --company CODE   one company only
 *
 * Safe to re-run: a second run finds nothing left to change.
 */

const apply = process.argv.includes('--apply');
const codeArg = process.argv.includes('--company') ? process.argv[process.argv.indexOf('--company') + 1] : null;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const same = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.0001;

const rebuildCompany = async (company) => {
  const companyId = company._id;
  const stats = { products: 0, avgChanged: 0, movementsFixed: 0, invoiceLines: 0, balancesFixed: 0 };
  const avgTimeline = new Map(); // productId -> [{ at, avg }]

  const products = await Product.find({ companyId }).skipTenant().select('name stock avgCost purchasePrice').lean();
  for (const product of products) {
    const moves = await StockMovement.find({ companyId, product: product._id })
      .skipTenant()
      .sort({ movedAt: 1, _id: 1 })
      .lean();

    // Stock that existed before the ledger (legacy Product.stock) starts the
    // replay at the master purchase price.
    const ledgerQty = moves.reduce((s, m) => s + Number(m.qty || 0), 0);
    const state = { stock: round2(Number(product.stock || 0) - ledgerQty), avgCost: 0, purchasePrice: Number(product.purchasePrice || 0) };
    if (state.stock > 0) state.avgCost = state.purchasePrice;
    const timeline = [{ at: new Date(0), avg: state.avgCost }];
    const costById = new Map();
    const saleCost = new Map(); // `${refId}` -> cost of the sale it reverses
    let lastPurchase = null;

    for (const m of moves) {
      const delta = Number(m.qty || 0);
      const reversalOf = /^Reversal of movement ([a-f0-9]{24})/.exec(m.note || '')?.[1];
      let unitCost = Number(m.unitCost || 0);
      let reversal = false;
      if (reversalOf && costById.has(reversalOf)) {
        unitCost = costById.get(reversalOf);
        reversal = true;
      } else if (m.type === MOVEMENT_TYPES.SALES_RETURN && m.refType === 'INVOICE' && saleCost.has(String(m.refId))) {
        unitCost = saleCost.get(String(m.refId)); // invoice cancelled: back at what it cost
        reversal = true;
      } else if (m.type === MOVEMENT_TYPES.SALES_RETURN) {
        unitCost = 0; // credit note return: at the average
      }

      const { cost, avg } = costMovement({ product: state, delta, type: m.type, unitCost, reversal });
      costById.set(String(m._id), cost);
      if (m.type === MOVEMENT_TYPES.SALES_OUT && m.refId) saleCost.set(String(m.refId), cost);
      if (m.type === MOVEMENT_TYPES.PURCHASE_RECEIPT && delta > 0 && !reversal && unitCost > 0) lastPurchase = unitCost;
      state.stock = round2(state.stock + delta);
      state.avgCost = avg;
      timeline.push({ at: m.movedAt || m.createdAt, avg });

      const value = round2(delta * cost);
      if (!same(m.unitCost, cost) || !same(m.value, value)) {
        stats.movementsFixed += 1;
        if (apply) await StockMovement.updateOne({ _id: m._id }, { $set: { unitCost: cost, value } }).skipTenant();
      }
    }

    stats.products += 1;
    avgTimeline.set(String(product._id), timeline);
    const patch = {};
    if (!same(product.avgCost, state.avgCost)) patch.avgCost = state.avgCost;
    if (lastPurchase && !same(product.purchasePrice, lastPurchase)) patch.purchasePrice = round2(lastPurchase);
    if (Object.keys(patch).length) {
      stats.avgChanged += 1;
      if (apply) await Product.updateOne({ _id: product._id }, { $set: patch }).skipTenant();
    }

    // Balances held at 0 although the ledger is below zero.
    const byWarehouse = new Map();
    moves.forEach((m) => {
      const k = String(m.warehouse || '');
      byWarehouse.set(k, round2((byWarehouse.get(k) || 0) + Number(m.qty || 0)));
    });
    for (const [wh, qty] of byWarehouse) {
      if (qty >= 0) continue;
      const bal = await StockBalance.findOne({ companyId, product: product._id, warehouse: wh || null }).skipTenant().lean();
      if (bal && same(bal.qty, 0)) {
        stats.balancesFixed += 1;
        if (apply) await StockBalance.updateOne({ _id: bal._id }, { $set: { qty } }).skipTenant();
      }
    }
  }

  // Invoice lines issued before costs were kept.
  const avgAt = (productId, at) => {
    const tl = avgTimeline.get(String(productId));
    if (!tl) return 0;
    let avg = tl[0].avg;
    for (const p of tl) {
      if (new Date(p.at) > new Date(at)) break;
      avg = p.avg;
    }
    return avg;
  };
  const invoices = await Invoice.find({ companyId, status: { $ne: 'DRAFT' }, 'items.costPrice': { $not: { $gt: 0 } } })
    .skipTenant()
    .select('items issuedAt invoiceDate createdAt')
    .lean();
  for (const inv of invoices) {
    const at = inv.issuedAt || inv.invoiceDate || inv.createdAt;
    const set = {};
    inv.items.forEach((line, i) => {
      if (Number(line.costPrice || 0) > 0) return;
      const cost = round2(avgAt(line.product, at) * Number(line.unitFactor || 1));
      if (cost > 0) set[`items.${i}.costPrice`] = cost;
    });
    if (Object.keys(set).length) {
      stats.invoiceLines += Object.keys(set).length;
      if (apply) await Invoice.updateOne({ _id: inv._id }, { $set: set }).skipTenant();
    }
  }
  return stats;
};

const run = async () => {
  await connectDB(1, 1000);
  mongoose.connection.config.autoIndex = false;
  const filter = codeArg ? { code: codeArg.toUpperCase() } : {};
  const companies = await Company.find(filter).skipTenant().select('code businessName').lean();
  if (!companies.length) console.log('No company found.');
  for (const company of companies) {
    const s = await rebuildCompany(company);
    console.log(
      `${company.code} ${company.businessName}: ${s.products} products, average changed on ${s.avgChanged}, ` +
        `${s.movementsFixed} movements re-costed, ${s.invoiceLines} invoice lines costed, ${s.balancesFixed} balances set below zero`
    );
  }
  console.log(apply ? 'Done - changes written.' : 'Dry run - nothing written. Add --apply to write these changes.');
  await disconnectDB();
};

run().catch(async (err) => {
  console.error(err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
