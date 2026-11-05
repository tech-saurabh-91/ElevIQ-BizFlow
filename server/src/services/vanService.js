import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import Warehouse from '../models/Warehouse.js';
import VanAssignment from '../models/VanAssignment.js';
import VanDayClose from '../models/VanDayClose.js';
import StockBalance from '../models/StockBalance.js';
import StockMovement from '../models/StockMovement.js';
import StockTransfer from '../models/StockTransfer.js';
import Product from '../models/Product.js';
import Payment from '../models/Payment.js';
import { AppError, BadRequestError } from '../utils/errors.js';
import { MOVEMENT_TYPES, TRANSFER_STATUS } from '../config/constants.js';
import { recordMovement, nextTransferNumber, assertWarehouseStock } from './inventoryService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Van sales (Phases B + C): loading and unloading a van, selling from it, and
 * the end-of-day settlement of stock and cash.
 *
 * Business days are counted in the company's time zone.
 */

const round3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

export const tzOf = (company) => company?.timezone || 'Asia/Kolkata';
export const todayIn = (tz) => dayjs().tz(tz).format('YYYY-MM-DD');

/** [start, end) of a business day as Dates. */
export const dayBounds = (day, tz) => {
  const start = dayjs.tz(day, tz).startOf('day');
  return { start: start.toDate(), end: start.add(1, 'day').toDate() };
};

/** The van an executive is driving right now (or null). */
export const activeVanOf = async (userId) => {
  if (!userId) return null;
  const spell = await VanAssignment.findOne({ executive: userId, active: true }).lean();
  if (!spell) return null;
  const van = await Warehouse.findOne({ _id: spell.warehouse, type: 'VAN', isActive: { $ne: false } }).lean();
  return van ? { van, spell } : null;
};

export const loadVan = async (id) => {
  const van = await Warehouse.findOne({ _id: id }).lean();
  if (!van) throw new BadRequestError('Van not found', 'INVALID_REFERENCE');
  if (van.type !== 'VAN') throw new BadRequestError('That warehouse is not a van', 'NOT_A_VAN');
  return van;
};

/** Current stock in a van with product details (base units). */
export const vanStock = async (vanId) => {
  const rows = await StockBalance.find({ warehouse: vanId, qty: { $ne: 0 } }).lean();
  const products = await Product.find({ _id: { $in: rows.map((r) => r.product) } })
    .select('name sku unit packUnits sellingPrice')
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  return rows
    .map((r) => {
      const p = byId.get(String(r.product)) || {};
      return {
        product: String(r.product),
        name: p.name || r.productName,
        sku: p.sku || r.productSku,
        unit: p.unit || r.unit,
        packUnits: p.packUnits || [],
        qty: round3(r.qty),
        reserved: round3(r.reservedQty),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

// ---------------------------------------------------------------------------
// Day close
// ---------------------------------------------------------------------------

const lastClosedDay = async (vanId) =>
  (await VanDayClose.findOne({ warehouse: vanId }).sort({ day: -1 }).select('day').lean())?.day || null;

/**
 * Past business days on which the van moved stock or its executive took cash,
 * but which were never closed (oldest first).
 */
export const pendingDays = async (van, spell, tz) => {
  const closed = await lastClosedDay(van._id);
  const since = closed ? dayBounds(closed, tz).end : new Date(spell?.fromDate || 0);
  const { start: today } = dayBounds(todayIn(tz), tz);
  if (since >= today) return [];

  const days = new Set();
  const movements = await StockMovement.find({ warehouse: van._id, movedAt: { $gte: since, $lt: today } })
    .select('movedAt')
    .lean();
  movements.forEach((m) => days.add(dayjs(m.movedAt).tz(tz).format('YYYY-MM-DD')));
  if (spell?.executive) {
    const cash = await Payment.find({
      collectedBy: spell.executive,
      mode: 'CASH',
      status: 'RECEIVED',
      paymentDate: { $gte: since, $lt: today },
    })
      .select('paymentDate')
      .lean();
    cash.forEach((p) => days.add(dayjs(p.paymentDate).tz(tz).format('YYYY-MM-DD')));
  }
  return [...days].sort();
};

/**
 * Refuse new van activity while an earlier day is unsettled - only when the
 * executive's assignment says day close is mandatory.
 */
export const assertDayClosed = async (userId, company) => {
  const active = await activeVanOf(userId);
  if (!active || !active.spell.dayCloseMandatory) return;
  const pending = await pendingDays(active.van, active.spell, tzOf(company));
  if (pending.length) {
    throw new AppError(
      `Close van ${active.van.code} for ${pending.join(', ')} before starting new work.`,
      { status: 409, code: 'DAY_CLOSE_PENDING', details: { van: active.van.code, days: pending } }
    );
  }
};

/** Expected stock and cash of a van for one business day. */
export const daySummary = async (van, day, { tz, executiveId }) => {
  const { start, end } = dayBounds(day, tz);
  const [balances, dayMoves, laterMoves] = await Promise.all([
    StockBalance.find({ warehouse: van._id }).lean(),
    StockMovement.find({ warehouse: van._id, movedAt: { $gte: start, $lt: end } }).lean(),
    StockMovement.find({ warehouse: van._id, movedAt: { $gte: end } }).select('product qty').lean(),
  ]);

  const lines = new Map();
  const line = (productId, seed = {}) => {
    const key = String(productId);
    if (!lines.has(key)) {
      lines.set(key, { product: key, name: seed.productName || '', sku: seed.productSku || '', unit: seed.unit || 'PCS', current: 0, later: 0, loaded: 0, sold: 0, unloaded: 0, adjusted: 0 });
    }
    return lines.get(key);
  };
  balances.forEach((b) => {
    line(b.product, b).current = Number(b.qty || 0);
  });
  laterMoves.forEach((m) => {
    line(m.product).later += Number(m.qty || 0);
  });
  dayMoves.forEach((m) => {
    const l = line(m.product, m);
    const q = Number(m.qty || 0);
    if (m.type === MOVEMENT_TYPES.TRANSFER_IN) l.loaded += q;
    else if (m.type === MOVEMENT_TYPES.TRANSFER_OUT) l.unloaded += -q;
    else if (m.type === MOVEMENT_TYPES.SALES_OUT || m.type === MOVEMENT_TYPES.SALES_RETURN) l.sold += -q;
    else l.adjusted += q;
  });

  const products = await Product.find({ _id: { $in: [...lines.keys()] } }).select('name sku unit packUnits').lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const out = [...lines.values()]
    .map((l) => {
      const expected = round3(l.current - l.later);
      const opening = round3(expected - l.loaded + l.sold + l.unloaded - l.adjusted);
      const p = byId.get(l.product) || {};
      return {
        product: l.product,
        name: p.name || l.name,
        sku: p.sku || l.sku,
        unit: p.unit || l.unit,
        packUnits: p.packUnits || [],
        opening,
        loaded: round3(l.loaded),
        sold: round3(l.sold),
        unloaded: round3(l.unloaded),
        adjusted: round3(l.adjusted),
        expected,
      };
    })
    .filter((l) => l.opening || l.loaded || l.sold || l.unloaded || l.adjusted || l.expected)
    .sort((a, b) => a.name.localeCompare(b.name));

  let cashExpected = 0;
  let payments = 0;
  if (executiveId) {
    const cash = await Payment.find({
      collectedBy: executiveId,
      mode: 'CASH',
      status: 'RECEIVED',
      paymentDate: { $gte: start, $lt: end },
    })
      .select('amount')
      .lean();
    cashExpected = round2(cash.reduce((s, p) => s + Number(p.amount || 0), 0));
    payments = cash.length;
  }
  return { lines: out, cashExpected, payments };
};

/** Executive driving the van on a given day (spell covering that day). */
export const executiveOn = async (vanId, day, tz) => {
  const { start, end } = dayBounds(day, tz);
  const spell = await VanAssignment.findOne({
    warehouse: vanId,
    fromDate: { $lt: end },
    $or: [{ toDate: null }, { toDate: { $gte: start } }],
  })
    .sort({ fromDate: -1 })
    .lean();
  return spell?.executive || null;
};

// ---------------------------------------------------------------------------
// Load / unload
// ---------------------------------------------------------------------------

/**
 * Move stock between a van and its parent warehouse in one step
 * (dispatched and received at once - the van is loaded at the dock).
 */
export const moveVanStock = async ({ van, direction, items, notes = '', userId, settings, companyId }) => {
  const parent = await Warehouse.findOne({ _id: van.parent }).lean();
  if (!parent) throw new BadRequestError('This van has no parent warehouse to load from', 'WAREHOUSE_PARENT');
  const lines = (items || []).filter((i) => Number(i.qty) > 0);
  if (!lines.length) throw new BadRequestError('Add at least one product with a quantity', 'VALIDATION_ERROR');

  const from = direction === 'LOAD' ? parent : van;
  const to = direction === 'LOAD' ? van : parent;
  const products = await Product.find({ _id: { $in: lines.map((l) => l.product) } }).select('name sku unit').lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const seen = new Set();
  const docLines = lines.map((l, i) => {
    const p = byId.get(String(l.product));
    if (!p) throw new BadRequestError(`Product not found on line ${i + 1}`, 'INVALID_REFERENCE');
    if (seen.has(String(p._id))) throw new BadRequestError(`${p.name} is listed twice`, 'VALIDATION_ERROR');
    seen.add(String(p._id));
    return { product: p._id, name: p.name, sku: p.sku || '', unit: p.unit || 'PCS', qty: Number(l.qty), dispatchedQty: Number(l.qty), receivedQty: Number(l.qty) };
  });

  // Nothing is written unless the source holds every line.
  const balances = await StockBalance.find({ warehouse: from._id, product: { $in: docLines.map((l) => l.product) } }).lean();
  const onHand = new Map(balances.map((b) => [String(b.product), Number(b.qty || 0)]));
  const short = docLines.filter((l) => (onHand.get(String(l.product)) || 0) + 1e-9 < l.qty);
  if (short.length) {
    throw new AppError(`Not enough stock in ${from.name}`, {
      status: 422,
      code: 'INSUFFICIENT_STOCK',
      errors: short.map((l) => ({
        field: 'items',
        message: `${l.name}: ${round3(onHand.get(String(l.product)) || 0)} ${l.unit} in ${from.name}, ${l.qty} requested`,
      })),
    });
  }

  const now = new Date();
  const doc = new StockTransfer({
    purpose: direction === 'LOAD' ? 'VAN_LOAD' : 'VAN_UNLOAD',
    fromWarehouse: from._id,
    fromWarehouseCode: from.code || '',
    fromWarehouseName: from.name || '',
    toWarehouse: to._id,
    toWarehouseCode: to.code || '',
    toWarehouseName: to.name || '',
    transferDate: now,
    vehicleNo: van.vehicleNumber || '',
    notes,
    items: docLines,
    status: TRANSFER_STATUS.RECEIVED,
    dispatchedAt: now,
    dispatchedBy: userId,
    receivedAt: now,
    receivedBy: userId,
    statusHistory: [{ status: TRANSFER_STATUS.RECEIVED, at: now, by: userId, note: direction === 'LOAD' ? 'Van loaded' : 'Van unloaded' }],
    source: 'WEB',
  });
  doc.transferNo = await nextTransferNumber(companyId, settings, now);
  await doc.save();

  // Out of the source first so a shortage stops before anything lands.
  for (const l of docLines) {
    await recordMovement({
      product: l.product,
      warehouse: from._id,
      qty: -l.qty,
      type: MOVEMENT_TYPES.TRANSFER_OUT,
      refType: 'TRANSFER',
      refId: doc._id,
      refNo: doc.transferNo,
      reason: direction === 'LOAD' ? 'Van loaded' : 'Van unloaded',
      note: `To ${to.name}`,
      movedBy: userId,
      settings,
    });
  }
  for (const l of docLines) {
    await recordMovement({
      product: l.product,
      warehouse: to._id,
      qty: l.qty,
      type: MOVEMENT_TYPES.TRANSFER_IN,
      refType: 'TRANSFER',
      refId: doc._id,
      refNo: doc.transferNo,
      reason: direction === 'LOAD' ? 'Van loaded' : 'Van unloaded',
      note: `From ${from.name}`,
      movedBy: userId,
      settings,
    });
  }
  return doc;
};

export default { activeVanOf, loadVan, vanStock, pendingDays, assertDayClosed, daySummary, moveVanStock, todayIn, tzOf };

/**
 * A van order may only book what is on the van (base units, all packs of a
 * product added up) unless the company allows negative stock.
 */
export const assertVanStock = async (van, lines, settings) => assertWarehouseStock(van, lines, settings);


/**
 * Issue stock from the van's parent warehouse towards the van: a VAN_LOAD
 * transfer left DISPATCHED (stock out of the godown, not yet on the van)
 * until the executive confirms receipt with receiveOnVan().
 */
export const issueToVan = async ({ van, lines, userId, settings, companyId, notes = '', refNo = '' }) => {
  const parent = await Warehouse.findOne({ _id: van.parent }).lean();
  if (!parent) throw new BadRequestError('This van has no parent warehouse to load from', 'WAREHOUSE_PARENT');
  const balances = await StockBalance.find({ warehouse: parent._id, product: { $in: lines.map((l) => l.product) } }).lean();
  const onHand = new Map(balances.map((b) => [String(b.product), Number(b.qty || 0)]));
  const short = lines.filter((l) => (onHand.get(String(l.product)) || 0) + 1e-9 < l.qty);
  if (short.length) {
    throw new AppError(`Not enough stock in ${parent.name}`, {
      status: 422,
      code: 'INSUFFICIENT_STOCK',
      errors: short.map((l) => ({
        field: 'items',
        message: `${l.name}: ${round3(onHand.get(String(l.product)) || 0)} ${l.unit} in ${parent.name}, ${l.qty} approved`,
      })),
    });
  }

  const now = new Date();
  const doc = new StockTransfer({
    purpose: 'VAN_LOAD',
    fromWarehouse: parent._id,
    fromWarehouseCode: parent.code || '',
    fromWarehouseName: parent.name || '',
    toWarehouse: van._id,
    toWarehouseCode: van.code || '',
    toWarehouseName: van.name || '',
    transferDate: now,
    vehicleNo: van.vehicleNumber || '',
    notes: notes || (refNo ? `Stock request ${refNo}` : ''),
    items: lines.map((l) => ({ product: l.product, name: l.name, sku: l.sku, unit: l.unit, qty: l.qty, dispatchedQty: l.qty, receivedQty: 0 })),
    status: TRANSFER_STATUS.DISPATCHED,
    dispatchedAt: now,
    dispatchedBy: userId,
    statusHistory: [{ status: TRANSFER_STATUS.DISPATCHED, at: now, by: userId, note: refNo ? `Issued for ${refNo}` : 'Issued to van' }],
    source: 'WEB',
  });
  doc.transferNo = await nextTransferNumber(companyId, settings, now);
  await doc.save();
  for (const l of lines) {
    await recordMovement({
      product: l.product,
      warehouse: parent._id,
      qty: -l.qty,
      type: MOVEMENT_TYPES.TRANSFER_OUT,
      refType: 'TRANSFER',
      refId: doc._id,
      refNo: doc.transferNo,
      reason: 'Issued to van',
      note: refNo ? `For ${refNo}` : `To ${van.name}`,
      movedBy: userId,
      settings,
    });
  }
  return doc;
};

/**
 * The executive confirms what reached the van. Anything not received was
 * never sent, so it goes back into the parent warehouse.
 */
export const receiveOnVan = async ({ transfer, received, userId, settings }) => {
  for (const line of transfer.items) {
    const sent = Number(line.dispatchedQty || 0);
    const got = Math.min(sent, Math.max(0, Number(received.get(String(line.product)) ?? sent)));
    if (got > 0) {
      await recordMovement({
        product: line.product,
        warehouse: transfer.toWarehouse,
        qty: got,
        type: MOVEMENT_TYPES.TRANSFER_IN,
        refType: 'TRANSFER',
        refId: transfer._id,
        refNo: transfer.transferNo,
        reason: 'Received on van',
        movedBy: userId,
        settings,
      });
    }
    if (sent - got > 1e-9) {
      await recordMovement({
        product: line.product,
        warehouse: transfer.fromWarehouse,
        qty: sent - got,
        type: MOVEMENT_TYPES.TRANSFER_IN,
        refType: 'TRANSFER',
        refId: transfer._id,
        refNo: transfer.transferNo,
        reason: 'Not received on van - returned',
        movedBy: userId,
        settings,
      });
    }
    line.receivedQty = got;
  }
  const now = new Date();
  transfer.status = TRANSFER_STATUS.RECEIVED;
  transfer.receivedAt = now;
  transfer.receivedBy = userId;
  transfer.statusHistory.push({ status: TRANSFER_STATUS.RECEIVED, at: now, by: userId, note: 'Received on van' });
  await transfer.save();
  return transfer;
};
