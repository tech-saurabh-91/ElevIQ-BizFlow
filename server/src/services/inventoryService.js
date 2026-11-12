import mongoose from 'mongoose';

import StockBalance from '../models/StockBalance.js';
import StockMovement from '../models/StockMovement.js';
import Product from '../models/Product.js';
import Warehouse from '../models/Warehouse.js';
import Setting from '../models/Setting.js';

import { AppError, BadRequestError, ConflictError, ErrorCodes } from '../utils/errors.js';
import { round2 } from '../models/helpers.js';
import { nextSeries, getFinancialYearTag } from '../utils/numberSeries.js';
import { getCompanyId } from '../middlewares/tenantContext.js';
import { MOVEMENT_TYPES, PO_TRANSITIONS, TRANSFER_TRANSITIONS } from '../config/constants.js';
import { baseQtyOf } from './catalogService.js';

/**
 * Inventory domain rules (Phase 7).
 *
 * This module OWNS stock. Every change to an on-hand quantity - whether it
 * arrives from a goods receipt, leaves on an order dispatch, is corrected by an
 * adjustment or moves between warehouses - is funnelled through
 * `recordMovement`, which is the single write path that:
 *
 *   1. applies the signed delta to the (product, warehouse) `StockBalance`,
 *   2. appends an immutable `StockMovement` row carrying the running balance,
 *   3. keeps the company-wide `Product.stock` total in lockstep, and
 *   4. refuses to go negative unless the tenant allows it.
 *
 * Nothing else in the codebase may mutate `Product.stock` or `StockBalance.qty`.
 */

const EPSILON = 0.0001;
const round4 = (n) => Math.round(Number(n || 0) * 10000) / 10000;

/**
 * Receipts that bring goods in at a known cost and so move the average:
 * a purchase, opening stock, a manual adjustment / count with a cost, and a
 * customer return booked at what it cost when sold. Everything else coming in
 * (transfers, van loads) and everything going out moves at the average.
 */
const COSTED_IN = new Set([
  MOVEMENT_TYPES.PURCHASE_RECEIPT,
  MOVEMENT_TYPES.OPENING,
  MOVEMENT_TYPES.ADJUSTMENT,
  MOVEMENT_TYPES.COUNT,
  MOVEMENT_TYPES.SALES_RETURN,
]);

/**
 * Moving average cost (per base unit, all warehouses together).
 *  - in at a known cost:  avg = (onHand x avg + qty x cost) / (onHand + qty)
 *  - anything else:       moves at the current average, which stays as it is
 *  - a reversal:          undoes the original movement at its original cost
 * Stock below zero counts as zero, so the first receipt after a shortage sets
 * the average to its own cost. Returns the cost this movement is booked at and
 * the product's new average.
 */
export const costMovement = ({ product, delta, type, unitCost = 0, reversal = false }) => {
  const onHand = Number(product.stock || 0);
  const given = Number(unitCost || 0);
  let avg = Number(product.avgCost || 0) || Number(product.purchasePrice || 0);
  let cost = avg;

  if (delta > 0) {
    const costed = given > 0 && (reversal || COSTED_IN.has(type));
    if (costed) {
      cost = given;
      const base = Math.max(onHand, 0);
      avg = base > EPSILON && avg > 0 ? (base * avg + delta * given) / (base + delta) : given;
    }
  } else if (reversal && given > 0) {
    // Taking back an earlier receipt (GRN / adjustment cancelled).
    cost = given;
    const left = onHand + delta;
    if (left > EPSILON) avg = Math.max(0, (onHand * avg + delta * given) / left);
  }
  return { cost: round4(cost), avg: round4(avg) };
};

/** Resolve the tenant's default warehouse (settings -> MAIN -> first active). */
export const resolveDefaultWarehouse = async (settings) => {
  const configured = settings?.inventory?.defaultWarehouse;
  if (configured) {
    const doc = await Warehouse.findById(configured);
    if (doc && doc.isActive !== false) return doc;
  }
  const main = await Warehouse.findOne({ type: 'MAIN', isActive: { $ne: false } }).sort({ createdAt: 1 });
  if (main) return main;
  return Warehouse.findOne({ isActive: { $ne: false } }).sort({ createdAt: 1 });
};

/** Load a warehouse by id, or throw 400. */
export const loadWarehouse = async (id, label = 'Warehouse') => {
  if (!id) return null;
  const doc = await Warehouse.findById(id);
  if (!doc) throw new BadRequestError(`${label} not found`, 'INVALID_REFERENCE');
  return doc;
};

/** True when the tenant permits stock to go negative. */
const allowsNegative = (settings) => Boolean(settings?.order?.allowNegativeStock);

/**
 * The single write path for stock. Never call `Product.stock` / `StockBalance.qty`
 * updates anywhere else.
 *
 * @param {object} input
 * @param {mongoose.ObjectId|string} input.product   - product id (required)
 * @param {mongoose.ObjectId|string|null} input.warehouse - warehouse id (null = company-level)
 * @param {number} input.qty     - signed delta (+ in / - out)
 * @param {string} input.type    - MOVEMENT_TYPES value
 * @param {object} [input.settings] - cached tenant settings (for the negative-stock knob)
 * @returns {Promise<{movement, balance, product, previousQty, newQty}>}
 */
export const recordMovement = async ({
  product: productId,
  warehouse: warehouseId = null,
  qty,
  type,
  refType = 'MANUAL',
  refId = null,
  refNo = '',
  reason = '',
  note = '',
  unitCost = 0,
  movedBy = null,
  settings = null,
  reversal = false,
}) => {
  const delta = Number(qty || 0);
  if (!Number.isFinite(delta) || Math.abs(delta) < EPSILON) {
    throw new BadRequestError('Stock movement quantity must be a non-zero number', 'VALIDATION_ERROR');
  }

  const product = await Product.findById(productId);
  if (!product) throw new BadRequestError('Product not found', 'INVALID_REFERENCE');

  const cfg = settings || (await Setting.forCompany(product.companyId));
  const negativeAllowed = allowsNegative(cfg);

  let warehouse = null;
  if (warehouseId) {
    warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) throw new BadRequestError('Warehouse not found', 'INVALID_REFERENCE');
  }

  const balanceKey = {
    product: product._id,
    warehouse: warehouse ? warehouse._id : null,
  };

  let balance = await StockBalance.findOne(balanceKey);
  if (!balance) {
    // Migration path: products created before the ledger existed carry their
    // on-hand only in `Product.stock` with no StockBalance rows. The FIRST
    // balance ever created for such a product (at company level) is seeded
    // from that total so the very first movement (e.g. an order dispatch)
    // starts from the real quantity instead of zero. Once any row exists the
    // ledger is authoritative - `Product.stock` is kept in lockstep from then
    // on, so re-seeding would double-count.
    let legacyQty = 0;
    if (!warehouse && !(await StockBalance.exists({ product: product._id }))) {
      legacyQty = Number(product.stock || 0) > 0 ? Number(product.stock) : 0;
    }

    balance = new StockBalance({
      ...balanceKey,
      productName: product.name || '',
      productSku: product.sku || '',
      unit: product.unit || 'PCS',
      warehouseCode: warehouse?.code || '',
      warehouseName: warehouse?.name || '',
      qty: legacyQty,
      reservedQty: 0,
      lowStockLevel: Number(product.lowStockLevel || 0),
      lastCost: 0,
    });
  }

  const { cost, avg } = costMovement({ product, delta, type, unitCost, reversal });

  const previousQty = Number(balance.qty || 0);
  const newQty = round2(previousQty + delta);

  if (newQty < -EPSILON && !negativeAllowed) {
    throw new AppError(
      `Insufficient stock for ${product.name}: only ${previousQty} ${product.unit || 'unit'}(s) available, ${Math.abs(
        delta
      )} requested`,
      {
        status: 422,
        code: ErrorCodes.INSUFFICIENT_STOCK,
        errors: [{ field: 'qty', message: `Only ${previousQty} ${product.unit || 'unit'}(s) in stock` }],
      }
    );
  }

  // Keep the snapshot fields fresh so lists stay readable after a rename.
  balance.productName = product.name || '';
  balance.productSku = product.sku || '';
  balance.unit = product.unit || 'PCS';
  balance.lowStockLevel = Number(product.lowStockLevel || 0);
  balance.lastCost = round4(avg);
  // Below zero only when the company allows it (checked above): the shortage
  // stays visible until goods arrive instead of vanishing at 0.
  balance.qty = newQty;
  balance.lastMovementAt = new Date();
  balance.lastMovementType = type;
  await balance.save();

  const movement = await StockMovement.create({
    type,
    product: product._id,
    productName: product.name || '',
    productSku: product.sku || '',
    unit: product.unit || 'PCS',
    warehouse: warehouse ? warehouse._id : null,
    warehouseCode: warehouse?.code || '',
    warehouseName: warehouse?.name || '',
    qty: delta,
    balanceAfter: newQty,
    unitCost: cost,
    value: round2(delta * cost),
    refType,
    refId: refId || null,
    refNo: refNo || '',
    reason,
    note,
    movedBy: movedBy || null,
    movedAt: new Date(),
  });

  // Keep the company-wide total in lockstep. `Product.stock` is what order
  // booking and invoicing read, so it must always equal the net of all deltas.
  product.stock = round2(Number(product.stock || 0) + delta);
  if (type === MOVEMENT_TYPES.PURCHASE_RECEIPT && Math.abs(avg - Number(product.avgCost || 0)) >= 0.005) {
    product.costChangedAt = new Date(); // selling price may need a look
  }
  product.avgCost = avg;
  if (type === MOVEMENT_TYPES.PURCHASE_RECEIPT && delta > 0 && !reversal && Number(unitCost) > 0) {
    product.purchasePrice = round2(unitCost); // last purchase rate
  }
  await product.save();

  return { movement, balance, product, previousQty, newQty };
};

/** Post several movements as one unit (used by GRN / adjustment / transfer). */
export const recordMovements = async (movements, settings) => {
  const results = [];
  for (const m of movements) {
    results.push(await recordMovement({ ...m, settings }));
  }
  return results;
};

/**
 * Reverse movements previously booked by a document (GRN cancel, adjustment
 * cancel). Writes the opposite-signed delta with the original type retained in
 * the reason so the ledger stays self-explanatory.
 */
export const reverseMovementsFor = async (refType, refId, reason, settings, movedBy = null) => {
  const posted = await StockMovement.find({ refType, refId });
  if (!posted.length) return [];

  const reversals = [];
  for (const m of posted) {
    reversals.push({
      product: m.product,
      warehouse: m.warehouse,
      qty: -Number(m.qty || 0),
      type: m.type,
      refType,
      refId,
      refNo: m.refNo || '',
      reason: reason || 'Reversal',
      note: `Reversal of movement ${String(m._id)}`,
      unitCost: Number(m.unitCost || 0),
      reversal: true,
      movedBy,
    });
  }
  return recordMovements(reversals, settings);
};

/**
 * Aggregation stages that attach the product's moving average cost to each
 * StockBalance row as `unitCost`, so stock value = qty x average cost (one
 * cost per product, whichever warehouse holds it).
 */
export const withAvgCost = () => [
  { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: '_p', pipeline: [{ $project: { avgCost: 1 } }] } },
  { $addFields: { unitCost: { $ifNull: [{ $first: '$_p.avgCost' }, '$lastCost'] } } },
  { $project: { _p: 0 } },
];

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** On-hand for a product in a warehouse (0 when no balance row exists). */
export const onHand = async (productId, warehouseId = null) => {
  const balance = await StockBalance.findOne({ product: productId, warehouse: warehouseId });
  return Number(balance?.qty || 0);
};

/** Available to promise (on-hand minus reserved) for a product/warehouse. */
export const availableQty = async (productId, warehouseId = null) => {
  const balance = await StockBalance.findOne({ product: productId, warehouse: warehouseId });
  if (!balance) return 0;
  return Math.max(0, Number(balance.qty || 0) - Number(balance.reservedQty || 0));
};

/**
 * Aggregate available stock for a product across every warehouse (or a single
 * one). Returns the `Product.stock`-style company total.
 */
export const totalOnHand = async (productId) => {
  const rows = await StockBalance.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(getCompanyId()),
        isDeleted: { $ne: true },
        product: new mongoose.Types.ObjectId(String(productId)),
      },
    },
    { $group: { _id: null, qty: { $sum: '$qty' }, reserved: { $sum: '$reservedQty' } } },
  ]);
  const row = rows[0];
  return {
    qty: Number(row?.qty || 0),
    reserved: Number(row?.reserved || 0),
    available: Math.max(0, Number(row?.qty || 0) - Number(row?.reserved || 0)),
  };
};

// ---------------------------------------------------------------------------
// Reservation (order confirm -> dispatch)
// ---------------------------------------------------------------------------

/**
 * Reserve stock for a confirmed order so two reps cannot book the same units.
 * Reservations are held per (product, warehouse); the warehouse defaults to the
 * tenant's default when the order does not name one. Reserving more than the
 * on-hand quantity is allowed (it is a soft commitment) but availability
 * reporting clamps at zero.
 */
export const reserveStock = async (lines = [], { warehouseId = null, settings = null } = {}) => {
  if (!settings?.order?.reserveStockOnConfirm) return;
  const warehouse = warehouseId || (await resolveDefaultWarehouse(settings))?._id || null;
  if (!warehouse) return;

  for (const line of lines) {
    const qty = baseQtyOf(line); // stock is counted in base units
    if (qty <= 0) continue;
    await StockBalance.updateOne(
      { product: line.product, warehouse },
      {
        $inc: { reservedQty: qty },
        $setOnInsert: {
          productName: line.name || '',
          productSku: line.sku || '',
          unit: line.unit || 'PCS',
        },
      },
      { upsert: true }
    ).skipTenant();
  }
};

/** Release a reservation (order cancelled / rejected before dispatch). */
export const releaseReservation = async (lines = [], { warehouseId = null, settings = null } = {}) => {
  if (!settings?.order?.reserveStockOnConfirm) return;
  const warehouse = warehouseId || (await resolveDefaultWarehouse(settings))?._id || null;

  for (const line of lines) {
    const qty = baseQtyOf(line); // stock is counted in base units
    if (qty <= 0) continue;
    await StockBalance.updateOne(
      { product: line.product, warehouse, reservedQty: { $gte: qty } },
      { $inc: { reservedQty: -qty } }
    ).skipTenant();
  }
};

/**
 * Refuse a sale that a warehouse cannot cover (all packs of a product added up
 * in base units) unless the company allows negative stock. Stock is checked in
 * THAT warehouse - stock sitting on vans or other godowns does not count.
 * `excludeReserved` keeps confirmed orders' reservations out of reach of
 * counter / van sales; a dispatch consumes its own reservation so checks on-hand.
 */
export const assertWarehouseStock = async (warehouse, lines, settings, { excludeReserved = true } = {}) => {
  if (settings?.order?.allowNegativeStock || !warehouse) return;
  const wh = warehouse._id ? warehouse : await Warehouse.findById(warehouse).select('name code').lean();
  const wanted = new Map();
  lines.forEach((l) => {
    const key = String(l.product);
    const qty = baseQtyOf(l);
    if (qty <= 0) return;
    wanted.set(key, { name: l.name, qty: (wanted.get(key)?.qty || 0) + qty });
  });
  if (!wanted.size) return;
  const balances = await StockBalance.find({ warehouse: wh._id, product: { $in: [...wanted.keys()] } }).lean();
  const free = new Map(
    balances.map((b) => [String(b.product), Number(b.qty || 0) - (excludeReserved ? Number(b.reservedQty || 0) : 0)])
  );
  const errors = [];
  wanted.forEach((w, key) => {
    const available = round2(Math.max(0, free.get(key) || 0));
    if (w.qty > available + EPSILON) {
      errors.push({ field: 'items', message: `${w.name || 'Item'}: ${available} available in ${wh.name || wh.code}, ${round2(w.qty)} needed` });
    }
  });
  if (errors.length) {
    throw new AppError(`Not enough stock in ${wh.name || wh.code || 'the warehouse'}`, {
      status: 422,
      code: ErrorCodes.INSUFFICIENT_STOCK,
      errors,
    });
  }
};

/** The company's damaged-goods warehouse, if it keeps one. */
export const damagedWarehouse = async () => Warehouse.findOne({ type: 'DAMAGED', isActive: { $ne: false } }).lean();

/**
 * Book stock OUT for a dispatched order. Consumes the reservation (if any) and
 * writes one SALES_OUT movement per line so the ledger reflects the sale.
 *
 * A pre-flight check validates every line against the company-wide on-hand
 * total BEFORE any write, so a shortage can never leave the ledger half-updated.
 */
export const dispatchOrderStock = async (order, { settings = null, movedBy = null } = {}) => {
  const cfg = settings || (await Setting.forCompany(order.companyId));
  const warehouse = order.warehouse || (await resolveDefaultWarehouse(cfg))?._id || null;
  const negativeAllowed = Boolean(cfg?.order?.allowNegativeStock);
  // Units already handed over from a van (invoiced at the shop) left no
  // godown stock to ship: dispatch only the rest of each line.
  const fromVan = new Map();
  const vanInvoices = await mongoose
    .model('Invoice')
    .find({ $or: [{ order: order._id }, { orders: order._id }], stockPosted: true, status: { $nin: ['DRAFT', 'CANCELLED'] } })
    .select('order items')
    .lean();
  vanInvoices.forEach((inv) =>
    (inv.items || []).forEach((l) => {
      const ofThis = l.order ? String(l.order) === String(order._id) : String(inv.order) === String(order._id);
      if (ofThis && l.orderItemId) fromVan.set(String(l.orderItemId), (fromVan.get(String(l.orderItemId)) || 0) + Number(l.qty || 0));
    })
  );
  const lines = (order.items || [])
    .map((l) => {
      const done = fromVan.get(String(l._id)) || 0;
      if (!done) return l;
      const qty = Math.max(0, Number(l.qty || 0) - done);
      const plain = typeof l.toObject === 'function' ? l.toObject() : { ...l };
      return { ...plain, qty, baseQty: qty * Number(l.unitFactor || 1) };
    })
    .filter((l) => baseQtyOf(l) > 0);

  // ---- pre-flight: nothing is written unless the whole dispatch can go out ----
  // Checked against the dispatching warehouse, not the company total (stock on
  // vans or in other godowns cannot be shipped from here).
  if (!negativeAllowed && warehouse) {
    await assertWarehouseStock(warehouse, lines, cfg, { excludeReserved: false });
  } else if (!negativeAllowed) {
    // No warehouse set up at all: fall back to the company-wide total.
    for (const line of lines) {
      const product = await Product.findById(line.product).select('name unit stock');
      if (!product) throw new BadRequestError('Product not found', 'INVALID_REFERENCE');
      if (Number(product.stock || 0) + EPSILON < baseQtyOf(line)) {
        throw new AppError(`Insufficient stock for ${product.name}: only ${product.stock || 0} ${product.unit || 'unit'}(s) available`, {
          status: 422,
          code: ErrorCodes.INSUFFICIENT_STOCK,
          errors: [{ field: 'items', message: `Only ${product.stock || 0} ${product.unit || 'unit'}(s) in stock` }],
        });
      }
    }
  }

  for (const line of lines) {
    const qty = baseQtyOf(line); // stock is counted in base units

    // Consume the reservation first so available doesn't double-count.
    if (cfg?.order?.reserveStockOnConfirm && warehouse) {
      await StockBalance.updateOne(
        { product: line.product, warehouse, reservedQty: { $gte: qty } },
        { $inc: { reservedQty: -qty } }
      ).skipTenant();
    }

    await recordMovement({
      product: line.product,
      warehouse,
      qty: -qty,
      type: MOVEMENT_TYPES.SALES_OUT,
      refType: 'ORDER',
      refId: order._id,
      refNo: order.orderNo || '',
      reason: 'Order dispatched',
      movedBy,
      settings: cfg,
    });
  }
};

// ---------------------------------------------------------------------------
// Reservations -> available view (used by inventory list)
// ---------------------------------------------------------------------------

/** Recompute `Product.stock` from the sum of all warehouse balances. */
export const recomputeProductStock = async (productId) => {
  const totals = await StockBalance.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(getCompanyId()),
        isDeleted: { $ne: true },
        product: new mongoose.Types.ObjectId(String(productId)),
      },
    },
    { $group: { _id: null, qty: { $sum: '$qty' } } },
  ]);
  const qty = round2(Number(totals[0]?.qty || 0));
  await Product.updateOne({ _id: productId }, { $set: { stock: qty } }).skipTenant();
  return qty;
};

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

const seriesFor = (settings, key, fallbackPrefix, fallbackPad = 6) => ({
  prefix: settings?.series?.[key]?.prefix || fallbackPrefix,
  pad: Number(settings?.series?.[key]?.pad || fallbackPad),
});

export const nextPurchaseOrderNumber = async (companyId, settings, date = new Date()) => {
  const { prefix, pad } = seriesFor(settings, 'purchase', 'PO');
  const fy = getFinancialYearTag(date, Number(settings?.financialYearStartMonth || 4));
  return nextSeries(companyId, 'PURCHASE', { prefix, pad, fy });
};

export const nextGrnNumber = async (companyId, settings, date = new Date()) => {
  const { prefix, pad } = seriesFor(settings, 'grn', 'GRN');
  const fy = getFinancialYearTag(date, Number(settings?.financialYearStartMonth || 4));
  return nextSeries(companyId, 'GRN', { prefix, pad, fy });
};

export const nextAdjustmentNumber = async (companyId, settings, date = new Date()) => {
  const { prefix, pad } = seriesFor(settings, 'adjustment', 'ADJ', 5);
  const fy = getFinancialYearTag(date, Number(settings?.financialYearStartMonth || 4));
  return nextSeries(companyId, 'ADJUSTMENT', { prefix, pad, fy });
};

export const nextTransferNumber = async (companyId, settings, date = new Date()) => {
  const { prefix, pad } = seriesFor(settings, 'transfer', 'TRF', 5);
  const fy = getFinancialYearTag(date, Number(settings?.financialYearStartMonth || 4));
  return nextSeries(companyId, 'TRANSFER', { prefix, pad, fy });
};

// ---------------------------------------------------------------------------
// Status transitions (shared guard)
// ---------------------------------------------------------------------------

/** Enforce a documented transition map; throws 409 when illegal. */
export const assertTransition = (map, from, to, label) => {
  const allowed = map[from] || [];
  if (!allowed.includes(to)) {
    throw new ConflictError(
      `${label} cannot move from ${from} to ${to}`,
      ErrorCodes.INVALID_STATUS_TRANSITION
    );
  }
};

export { PO_TRANSITIONS, TRANSFER_TRANSITIONS };

/** Purchase-order status transition guard. */
export const assertPoTransition = (from, to) =>
  assertTransition(PO_TRANSITIONS, from, to, 'Purchase order');

/** Transfer status transition guard. */
export const assertTransferTransition = (from, to) =>
  assertTransition(TRANSFER_TRANSITIONS, from, to, 'Transfer');

// ---------------------------------------------------------------------------
// Low stock
// ---------------------------------------------------------------------------

/**
 * Products whose on-hand has fallen to/below their low-stock level.
 *
 * Without a warehouse: compares the live company-wide `Product.stock` snapshot
 * against each product's `lowStockLevel`. With a warehouse: aggregates that
 * warehouse's `StockBalance` rows and compares against the same per-product
 * threshold (falling back to the tenant-wide setting when a product has none).
 */
export const lowStockProducts = async (settings, { warehouseId = null, limit = 500 } = {}) => {
  const fallback = Number(settings?.inventory?.lowStockThreshold || 0);
  const companyId = new mongoose.Types.ObjectId(getCompanyId());

  if (warehouseId) {
    return StockBalance.aggregate([
      {
        $match: {
          companyId,
          isDeleted: { $ne: true },
          warehouse: new mongoose.Types.ObjectId(String(warehouseId)),
        },
      },
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'productDoc' } },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          _threshold: {
            $ifNull: [{ $cond: [{ $gt: ['$productDoc.lowStockLevel', 0] }, '$productDoc.lowStockLevel', fallback] }, fallback],
          },
        },
      },
      { $match: { $expr: { $lte: ['$qty', '$_threshold'] } } },
      { $sort: { qty: 1 } },
      { $limit: limit },
    ]);
  }

  return Product.aggregate([
    { $match: { companyId, isDeleted: { $ne: true }, isActive: { $ne: false } } },
    {
      $addFields: {
        _threshold: { $ifNull: [{ $cond: [{ $gt: ['$lowStockLevel', 0] }, '$lowStockLevel', fallback] }, fallback] },
      },
    },
    { $match: { $expr: { $lte: ['$stock', '$_threshold'] } } },
    { $sort: { stock: 1 } },
    { $limit: limit },
  ]);
};

export default {
  resolveDefaultWarehouse,
  recordMovement,
  recordMovements,
  reverseMovementsFor,
  onHand,
  availableQty,
  totalOnHand,
  reserveStock,
  releaseReservation,
  dispatchOrderStock,
  recomputeProductStock,
  nextPurchaseOrderNumber,
  nextGrnNumber,
  nextAdjustmentNumber,
  nextTransferNumber,
  assertPoTransition,
  assertTransferTransition,
  lowStockProducts,
};
