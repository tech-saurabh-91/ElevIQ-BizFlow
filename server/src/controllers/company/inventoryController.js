import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';

import StockBalance from '../../models/StockBalance.js';
import StockMovement from '../../models/StockMovement.js';
import StockAdjustment from '../../models/StockAdjustment.js';
import StockTransfer from '../../models/StockTransfer.js';
import Product from '../../models/Product.js';
import Warehouse from '../../models/Warehouse.js';
import Setting from '../../models/Setting.js';

import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments, searchRegex } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, MOVEMENT_TYPES, ADJUSTMENT_STATUS, TRANSFER_STATUS } from '../../config/constants.js';
import { AppError, BadRequestError, ConflictError, ErrorCodes } from '../../utils/errors.js';
import { toPlain, loadDoc, refOrNull, dateOrNull } from './_helpers.js';
import {
  recordMovement,
  reverseMovementsFor,
  resolveDefaultWarehouse,
  loadWarehouse,
  nextAdjustmentNumber,
  nextTransferNumber,
  assertTransferTransition,
  lowStockProducts,
} from '../../services/inventoryService.js';

/**
 * Phase 7 - Inventory controller.
 *
 * Three surfaces: the stock ledger (balances + movements), manual adjustments
 * and warehouse transfers. Every quantity change is delegated to
 * `inventoryService.recordMovement`, the single write path that keeps the
 * ledger, the per-warehouse balance and the company-wide product total in sync.
 */

const POPULATE_BALANCE = [
  { path: 'product', select: 'name sku unit mrp sellingPrice purchasePrice gstRate lowStockLevel stock category brand' },
  { path: 'warehouse', select: 'name code type isDefault' },
];

const POPULATE_MOVEMENT = [
  { path: 'product', select: 'name sku unit stock lowStockLevel' },
  { path: 'warehouse', select: 'name code type' },
  { path: 'movedBy', select: 'name email' },
];

const POPULATE_ADJUSTMENT = [
  { path: 'warehouse', select: 'name code type' },
  { path: 'items.product', select: 'name sku unit' },
  { path: 'postedBy', select: 'name email' },
  { path: 'cancelledBy', select: 'name email' },
  { path: 'createdBy', select: 'name email' },
];

const POPULATE_TRANSFER = [
  { path: 'fromWarehouse', select: 'name code type' },
  { path: 'toWarehouse', select: 'name code type' },
  { path: 'items.product', select: 'name sku unit' },
  { path: 'dispatchedBy', select: 'name email' },
  { path: 'receivedBy', select: 'name email' },
  { path: 'cancelledBy', select: 'name email' },
  { path: 'createdBy', select: 'name email' },
];

const settingsOf = async (req) => req.settings || (await Setting.forCompany(req.companyId));

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const pushHistory = (doc, status, req, text = '') => {
  doc.statusHistory.push({
    status,
    at: new Date(),
    by: req.user.id,
    byName: req.user.name,
    note: text,
  });
};

const labelOf = (d, key) => d?.[key] || (d?._id ? String(d._id) : 'Record');

// ---------------------------------------------------------------------------
// Stock ledger: balances + movements
// ---------------------------------------------------------------------------

export const listStock = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.warehouseId) filter.warehouse = req.query.warehouseId;
  if (req.query.productId) filter.product = req.query.productId;

  if (req.query.lowStock === 'true' || req.query.outOfStock === 'true') {
    // Post-filter on the virtual thresholds by comparing qty vs lowStockLevel.
    if (req.query.outOfStock === 'true') filter.qty = { $lte: 0 };
    else filter.$expr = { $lte: ['$qty', { $ifNull: ['$lowStockLevel', 0] }] };
  }

  const result = await listDocuments(StockBalance, {
    filter,
    query: req.query,
    searchFields: ['productName', 'productSku', 'warehouseName', 'warehouseCode'],
    filtersSpec: {
      warehouse: { type: 'objectId' },
      product: { type: 'objectId' },
    },
    sortAllowed: ['productName', 'qty', 'lastMovementAt', 'createdAt', 'warehouseName'],
    defaultSort: 'productName',
    dateField: 'lastMovementAt',
    populate: POPULATE_BALANCE,
  });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const listMovements = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.warehouseId) filter.warehouse = req.query.warehouseId;
  if (req.query.productId) filter.product = req.query.productId;
  if (req.query.refType) filter.refType = req.query.refType;
  if (req.query.refId) filter.refId = req.query.refId;

  const result = await listDocuments(StockMovement, {
    filter,
    query: req.query,
    searchFields: ['productName', 'productSku', 'warehouseName', 'warehouseCode', 'refNo'],
    filtersSpec: {
      warehouse: { type: 'objectId' },
      product: { type: 'objectId' },
      type: { type: 'string' },
    },
    sortAllowed: ['movedAt', 'qty', 'type', 'productName', 'createdAt'],
    defaultSort: '-movedAt',
    dateField: 'movedAt',
    populate: POPULATE_MOVEMENT,
  });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

/** Full movement history for one product (optionally within a warehouse). */
export const productHistory = asyncHandler(async (req, res) => {
  const filter = { product: req.params.id };
  if (req.query.warehouseId) filter.warehouse = req.query.warehouseId;

  const [product, balance, result] = await Promise.all([
    Product.findById(req.params.id).select('name sku unit stock lowStockLevel openingStock').lean(),
    StockBalance.find({ product: req.params.id, ...(req.query.warehouseId ? { warehouse: req.query.warehouseId } : {}) })
      .populate('warehouse', 'name code type')
      .lean(),
    listDocuments(StockMovement, {
      filter,
      query: req.query,
      sortAllowed: ['movedAt', 'qty', 'type'],
      defaultSort: '-movedAt',
      dateField: 'movedAt',
      populate: POPULATE_MOVEMENT,
    }),
  ]);

  if (!product) throw new BadRequestError('Product not found', 'INVALID_REFERENCE');

  return success(res, {
    data: {
      product: toPlain(product),
      balances: (Array.isArray(balance) ? balance : [balance]).filter(Boolean).map(toPlain),
      movements: result.data.map(toPlain),
      meta: result.meta,
    },
  });
});

export const stats = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const companyId = new mongoose.Types.ObjectId(req.companyId);
  const base = { companyId, isDeleted: { $ne: true } };

  const [byType, balanceAgg, lowStock, outOfStock, warehouses, adjustments, transfers] = await Promise.all([
    StockMovement.aggregate([
      { $match: base },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          qty: { $sum: '$qty' },
          value: { $sum: '$value' },
        },
      },
    ]),
    StockBalance.aggregate([
      { $match: base },
      {
        $group: {
          _id: null,
          lines: { $sum: 1 },
          qty: { $sum: '$qty' },
          reserved: { $sum: '$reservedQty' },
          value: { $sum: { $multiply: ['$qty', '$lastCost'] } },
        },
      },
    ]),
    lowStockProducts(settings, { limit: 1000 }),
    StockBalance.countDocuments({ ...base, qty: { $lte: 0 } }),
    Warehouse.countDocuments({ isDeleted: { $ne: true }, isActive: { $ne: false } }),
    StockAdjustment.aggregate([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    StockTransfer.aggregate([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const movementByType = {};
  byType.forEach((row) => {
    movementByType[row._id] = { count: row.count, qty: round2(row.qty), value: round2(row.value) };
  });

  const adjustmentsByStatus = {};
  adjustments.forEach((row) => {
    adjustmentsByStatus[row._id] = row.count;
  });
  const transfersByStatus = {};
  transfers.forEach((row) => {
    transfersByStatus[row._id] = row.count;
  });

  const bal = balanceAgg[0] || {};

  return success(res, {
    data: {
      totalLines: Number(bal.lines || 0),
      totalQty: round2(bal.qty),
      reservedQty: round2(bal.reserved),
      availableQty: round2(Number(bal.qty || 0) - Number(bal.reserved || 0)),
      stockValue: round2(bal.value),
      lowStockCount: lowStock.length,
      outOfStockCount: Number(outOfStock || 0),
      warehouseCount: Number(warehouses || 0),
      movementByType,
      adjustmentsByStatus,
      transfersByStatus,
      lowStock: lowStock.slice(0, 20).map((p) => ({
        id: String(p._id || p.product?._id || ''),
        name: p.name || p.productName || p.product?.name || '',
        sku: p.sku || p.productSku || p.product?.sku || '',
        unit: p.unit || p.product?.unit || '',
        stock: round2(p.qty ?? p.stock),
        lowStockLevel: Number(p.lowStockLevel ?? p.productDoc?.lowStockLevel ?? 0),
      })),
    },
  });
});

/** Products at/below their low-stock threshold. */
export const lowStock = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const rows = await lowStockProducts(settings, {
    warehouseId: refOrNull(req.query.warehouseId),
    limit: Math.min(1000, Number(req.query.limit) || 500),
  });

  return success(res, {
    data: rows.map((p) => ({
      id: String(p._id || ''),
      name: p.name || p.productName || '',
      sku: p.sku || p.productSku || '',
      unit: p.unit || '',
      stock: round2(p.qty ?? p.stock),
      lowStockLevel: Number(p.lowStockLevel ?? 0),
      category: p.category || '',
      brand: p.brand || '',
    })),
  });
});

export const exportStock = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.warehouseId) filter.warehouse = req.query.warehouseId;
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ productName: rx }, { productSku: rx }];
  }

  const rows = await StockBalance.find(filter)
    .populate('product', 'name sku unit category brand gstRate')
    .populate('warehouse', 'name code')
    .sort({ productName: 1 })
    .limit(10000)
    .lean();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ElevIQ SFA';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Stock', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Product', key: 'name', width: 34 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Warehouse', key: 'warehouse', width: 22 },
    { header: 'On Hand', key: 'qty', width: 12 },
    { header: 'Reserved', key: 'reserved', width: 12 },
    { header: 'Available', key: 'available', width: 12 },
    { header: 'Low Stock Level', key: 'low', width: 16 },
    { header: 'Last Cost', key: 'cost', width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };

  rows.forEach((r) => {
    sheet.addRow({
      name: r.productName || r.product?.name || '',
      sku: r.productSku || r.product?.sku || '',
      unit: r.unit || r.product?.unit || '',
      warehouse: r.warehouseName || r.warehouse?.name || '',
      qty: round2(r.qty),
      reserved: round2(r.reservedQty),
      available: round2(Math.max(0, Number(r.qty || 0) - Number(r.reservedQty || 0))),
      low: Number(r.lowStockLevel || 0),
      cost: round2(r.lastCost),
    });
  });

  if (rows.length) {
    sheet.addRow({});
    const totalRow = sheet.addRow({
      name: `Total (${rows.length} SKUs)`,
      qty: rows.reduce((s, r) => s + Number(r.qty || 0), 0),
      reserved: rows.reduce((s, r) => s + Number(r.reservedQty || 0), 0),
    });
    totalRow.font = { bold: true };
  }

  const filename = `stock-${dayjs().format('YYYY-MM-DD')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'StockBalance',
    entityLabel: 'Stock report',
    description: `Exported ${rows.length} stock lines to Excel`,
  });

  res.end();
});

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

const loadAdjustment = (req, id) =>
  loadDoc(StockAdjustment, id, { populate: POPULATE_ADJUSTMENT, label: 'Adjustment' });

export const listAdjustments = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.warehouseId) filter.warehouse = req.query.warehouseId;
  if (req.query.reason) filter.reason = req.query.reason;

  const result = await listDocuments(StockAdjustment, {
    filter,
    query: req.query,
    searchFields: ['adjustmentNo', 'warehouseName', 'warehouseCode', 'notes'],
    filtersSpec: {
      warehouse: { type: 'objectId' },
      status: { type: 'string' },
      reason: { type: 'string' },
    },
    sortAllowed: ['adjustmentDate', 'createdAt', 'netQty', 'adjustmentNo', 'status'],
    defaultSort: '-adjustmentDate',
    dateField: 'adjustmentDate',
    populate: POPULATE_ADJUSTMENT,
  });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const getAdjustment = asyncHandler(async (req, res) => {
  const doc = await loadAdjustment(req, req.params.id);
  return success(res, { data: toPlain(doc) });
});

export const createAdjustment = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const payload = { ...req.body };

  const warehouse = await loadWarehouse(payload.warehouse, 'Warehouse');
  const items = await buildAdjustmentLines(payload.items || []);

  const doc = new StockAdjustment({
    warehouse: warehouse._id,
    warehouseCode: warehouse.code || '',
    warehouseName: warehouse.name || '',
    reason: payload.reason,
    adjustmentDate: dateOrNull(payload.adjustmentDate) || new Date(),
    notes: payload.notes || '',
    items,
    status: ADJUSTMENT_STATUS.DRAFT,
    statusHistory: [],
    source: 'WEB',
  });
  pushHistory(doc, ADJUSTMENT_STATUS.DRAFT, req, 'Created');
  doc.adjustmentNo = await nextAdjustmentNumber(req.companyId, settings, doc.adjustmentDate);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'StockAdjustment',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'adjustmentNo'),
    after: toPlain(doc),
    description: `Stock adjustment ${labelOf(doc, 'adjustmentNo')} created (${doc.reason})`,
  });

  let message = 'Adjustment saved as draft';
  if (payload.post) {
    await postAdjustmentDoc(req, doc, settings, 'Posted on create');
    message = 'Adjustment posted';
  }

  const full = await loadDoc(StockAdjustment, doc._id, { populate: POPULATE_ADJUSTMENT, label: 'Adjustment' });
  return created(res, { message, data: toPlain(full) });
});

export const updateAdjustment = asyncHandler(async (req, res) => {
  const doc = await loadAdjustment(req, req.params.id);
  if (doc.status !== ADJUSTMENT_STATUS.DRAFT) {
    throw new ConflictError('Only draft adjustments can be edited', 'ADJUSTMENT_LOCKED');
  }

  const before = toPlain(doc);
  const payload = { ...req.body };
  delete payload.post;

  if (payload.warehouse) {
    const warehouse = await loadWarehouse(payload.warehouse, 'Warehouse');
    doc.warehouse = warehouse._id;
    doc.warehouseCode = warehouse.code || '';
    doc.warehouseName = warehouse.name || '';
  }
  if (payload.reason) doc.reason = payload.reason;
  if (payload.adjustmentDate !== undefined) {
    doc.adjustmentDate = dateOrNull(payload.adjustmentDate) || doc.adjustmentDate;
  }
  if (payload.notes !== undefined) doc.notes = payload.notes;
  if (payload.items !== undefined) doc.items = await buildAdjustmentLines(payload.items);

  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'StockAdjustment',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'adjustmentNo'),
    before,
    after: toPlain(doc),
    description: `Stock adjustment ${labelOf(doc, 'adjustmentNo')} updated`,
  });

  const full = await loadDoc(StockAdjustment, doc._id, { populate: POPULATE_ADJUSTMENT, label: 'Adjustment' });
  return success(res, { message: 'Adjustment updated', data: toPlain(full) });
});

export const removeAdjustment = asyncHandler(async (req, res) => {
  const doc = await loadAdjustment(req, req.params.id);
  if (doc.status !== ADJUSTMENT_STATUS.DRAFT) {
    throw new ConflictError(
      'Only draft adjustments can be deleted. Cancel this adjustment instead.',
      'ADJUSTMENT_LOCKED'
    );
  }

  const snapshot = toPlain(doc);
  await doc.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'StockAdjustment',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'adjustmentNo'),
    before: snapshot,
    description: `Draft stock adjustment ${labelOf(doc, 'adjustmentNo')} deleted`,
  });

  return success(res, { message: 'Adjustment deleted', data: { id: String(doc._id) } });
});

/** Book the adjustment's signed quantities into the ledger. */
const postAdjustmentDoc = async (req, doc, settings, text = '') => {
  if (doc.status !== ADJUSTMENT_STATUS.DRAFT) {
    throw new ConflictError('Only draft adjustments can be posted', 'ADJUSTMENT_NOT_DRAFT');
  }
  if (!doc.items.length) throw new BadRequestError('Adjustment has no lines', 'VALIDATION_ERROR');

  for (const line of doc.items) {
    await recordMovement({
      product: line.product,
      warehouse: doc.warehouse,
      qty: Number(line.qty),
      type: MOVEMENT_TYPES.ADJUSTMENT,
      refType: 'ADJUSTMENT',
      refId: doc._id,
      refNo: doc.adjustmentNo,
      reason: line.reason || doc.reason,
      note: line.note || doc.notes || '',
      unitCost: Number(line.unitCost || 0),
      movedBy: req.user.id,
      settings,
    });
  }

  doc.status = ADJUSTMENT_STATUS.POSTED;
  doc.postedAt = new Date();
  doc.postedBy = req.user.id;
  pushHistory(doc, ADJUSTMENT_STATUS.POSTED, req, text || 'Posted');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'StockAdjustment',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'adjustmentNo'),
    before: { status: ADJUSTMENT_STATUS.DRAFT },
    after: { status: ADJUSTMENT_STATUS.POSTED },
    description: `Stock adjustment ${labelOf(doc, 'adjustmentNo')} posted`,
  });

  return doc;
};

export const postAdjustment = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const doc = await loadAdjustment(req, req.params.id);
  await postAdjustmentDoc(req, doc, settings, req.body?.note || '');

  const full = await loadDoc(StockAdjustment, doc._id, { populate: POPULATE_ADJUSTMENT, label: 'Adjustment' });
  return success(res, { message: 'Adjustment posted', data: toPlain(full) });
});

export const cancelAdjustment = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const doc = await loadAdjustment(req, req.params.id);
  const reason = req.body?.reason || '';

  if (doc.status === ADJUSTMENT_STATUS.CANCELLED) {
    throw new ConflictError('Adjustment is already cancelled', ErrorCodes.INVALID_STATUS_TRANSITION);
  }

  // A posted adjustment must be reversed before it can be voided.
  if (doc.status === ADJUSTMENT_STATUS.POSTED) {
    await reverseMovementsFor('ADJUSTMENT', doc._id, reason || 'Adjustment cancelled', settings, req.user.id);
  }

  const before = doc.status;
  doc.status = ADJUSTMENT_STATUS.CANCELLED;
  doc.cancelledAt = new Date();
  doc.cancelledBy = req.user.id;
  doc.cancelReason = reason;
  pushHistory(doc, ADJUSTMENT_STATUS.CANCELLED, req, reason || 'Cancelled');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'StockAdjustment',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'adjustmentNo'),
    before: { status: before },
    after: { status: ADJUSTMENT_STATUS.CANCELLED },
    description: `Stock adjustment ${labelOf(doc, 'adjustmentNo')} cancelled${reason ? `: ${reason}` : ''}`,
  });

  const full = await loadDoc(StockAdjustment, doc._id, { populate: POPULATE_ADJUSTMENT, label: 'Adjustment' });
  return success(res, { message: 'Adjustment cancelled', data: toPlain(full) });
});

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

const loadTransfer = (req, id) =>
  loadDoc(StockTransfer, id, { populate: POPULATE_TRANSFER, label: 'Transfer' });

export const listTransfers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.fromWarehouse) filter.fromWarehouse = req.query.fromWarehouse;
  if (req.query.toWarehouse) filter.toWarehouse = req.query.toWarehouse;

  const result = await listDocuments(StockTransfer, {
    filter,
    query: req.query,
    searchFields: ['transferNo', 'fromWarehouseName', 'toWarehouseName', 'notes'],
    filtersSpec: {
      fromWarehouse: { type: 'objectId' },
      toWarehouse: { type: 'objectId' },
      status: { type: 'string' },
    },
    sortAllowed: ['transferDate', 'createdAt', 'totalQty', 'transferNo', 'status'],
    defaultSort: '-transferDate',
    dateField: 'transferDate',
    populate: POPULATE_TRANSFER,
  });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const getTransfer = asyncHandler(async (req, res) => {
  const doc = await loadTransfer(req, req.params.id);
  return success(res, { data: toPlain(doc) });
});

export const createTransfer = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const payload = { ...req.body };

  if (String(payload.fromWarehouse) === String(payload.toWarehouse)) {
    throw new BadRequestError(
      'Source and destination warehouses must be different',
      'VALIDATION_ERROR'
    );
  }

  const [from, to, items] = await Promise.all([
    loadWarehouse(payload.fromWarehouse, 'Source warehouse'),
    loadWarehouse(payload.toWarehouse, 'Destination warehouse'),
    buildTransferLines(payload.items || []),
  ]);

  const doc = new StockTransfer({
    fromWarehouse: from._id,
    fromWarehouseCode: from.code || '',
    fromWarehouseName: from.name || '',
    toWarehouse: to._id,
    toWarehouseCode: to.code || '',
    toWarehouseName: to.name || '',
    transferDate: dateOrNull(payload.transferDate) || new Date(),
    vehicleNo: payload.vehicleNo || '',
    notes: payload.notes || '',
    items,
    status: TRANSFER_STATUS.DRAFT,
    statusHistory: [],
    source: 'WEB',
  });
  pushHistory(doc, TRANSFER_STATUS.DRAFT, req, 'Created');
  doc.transferNo = await nextTransferNumber(req.companyId, settings, doc.transferDate);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'StockTransfer',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'transferNo'),
    after: toPlain(doc),
    description: `Stock transfer ${labelOf(doc, 'transferNo')} created (${from.name} -> ${to.name})`,
  });

  const full = await loadDoc(StockTransfer, doc._id, { populate: POPULATE_TRANSFER, label: 'Transfer' });
  return created(res, { message: 'Transfer saved as draft', data: toPlain(full) });
});

export const updateTransfer = asyncHandler(async (req, res) => {
  const doc = await loadTransfer(req, req.params.id);
  if (doc.status !== TRANSFER_STATUS.DRAFT) {
    throw new ConflictError('Only draft transfers can be edited', 'TRANSFER_LOCKED');
  }

  const before = toPlain(doc);
  const payload = { ...req.body };

  if (payload.fromWarehouse && String(payload.fromWarehouse) !== String(doc.toWarehouse)) {
    const from = await loadWarehouse(payload.fromWarehouse, 'Source warehouse');
    doc.fromWarehouse = from._id;
    doc.fromWarehouseCode = from.code || '';
    doc.fromWarehouseName = from.name || '';
  }
  if (payload.toWarehouse && String(payload.toWarehouse) !== String(doc.fromWarehouse)) {
    const to = await loadWarehouse(payload.toWarehouse, 'Destination warehouse');
    doc.toWarehouse = to._id;
    doc.toWarehouseCode = to.code || '';
    doc.toWarehouseName = to.name || '';
  }
  if (payload.transferDate !== undefined) {
    doc.transferDate = dateOrNull(payload.transferDate) || doc.transferDate;
  }
  if (payload.vehicleNo !== undefined) doc.vehicleNo = payload.vehicleNo;
  if (payload.notes !== undefined) doc.notes = payload.notes;
  if (payload.items !== undefined) doc.items = await buildTransferLines(payload.items);

  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'StockTransfer',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'transferNo'),
    before,
    after: toPlain(doc),
    description: `Stock transfer ${labelOf(doc, 'transferNo')} updated`,
  });

  const full = await loadDoc(StockTransfer, doc._id, { populate: POPULATE_TRANSFER, label: 'Transfer' });
  return success(res, { message: 'Transfer updated', data: toPlain(full) });
});

export const removeTransfer = asyncHandler(async (req, res) => {
  const doc = await loadTransfer(req, req.params.id);
  if (doc.status !== TRANSFER_STATUS.DRAFT) {
    throw new ConflictError(
      'Only draft transfers can be deleted. Cancel this transfer instead.',
      'TRANSFER_LOCKED'
    );
  }

  const snapshot = toPlain(doc);
  await doc.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'StockTransfer',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'transferNo'),
    before: snapshot,
    description: `Draft stock transfer ${labelOf(doc, 'transferNo')} deleted`,
  });

  return success(res, { message: 'Transfer deleted', data: { id: String(doc._id) } });
});

/** Move stock out of the source warehouse (TRANSFER_OUT movements). */
export const dispatchTransfer = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const doc = await loadTransfer(req, req.params.id);
  assertTransferTransition(doc.status, TRANSFER_STATUS.DISPATCHED);

  for (const line of doc.items) {
    const qty = Number(line.qty || 0);
    if (qty <= 0) continue;
    await recordMovement({
      product: line.product,
      warehouse: doc.fromWarehouse,
      qty: -qty,
      type: MOVEMENT_TYPES.TRANSFER_OUT,
      refType: 'TRANSFER',
      refId: doc._id,
      refNo: doc.transferNo,
      reason: 'Transfer dispatched',
      note: `To ${doc.toWarehouseName}`,
      movedBy: req.user.id,
      settings,
    });
    line.dispatchedQty = qty;
  }

  doc.status = TRANSFER_STATUS.DISPATCHED;
  doc.dispatchedAt = new Date();
  doc.dispatchedBy = req.user.id;
  pushHistory(doc, TRANSFER_STATUS.DISPATCHED, req, req.body?.note || 'Dispatched');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'StockTransfer',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'transferNo'),
    before: { status: TRANSFER_STATUS.DRAFT },
    after: { status: TRANSFER_STATUS.DISPATCHED },
    description: `Stock transfer ${labelOf(doc, 'transferNo')} dispatched`,
  });

  const full = await loadDoc(StockTransfer, doc._id, { populate: POPULATE_TRANSFER, label: 'Transfer' });
  return success(res, { message: 'Transfer dispatched', data: toPlain(full) });
});

/** Receive stock into the destination warehouse (TRANSFER_IN movements). */
export const receiveTransfer = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const doc = await loadTransfer(req, req.params.id);
  if (doc.status !== TRANSFER_STATUS.DISPATCHED) {
    throw new ConflictError('Only dispatched transfers can be received', 'TRANSFER_NOT_DISPATCHED');
  }

  // Support short receipts: an optional per-line `received` map overrides qty.
  const overrides = new Map(
    (req.body?.received || []).map((r) => [String(r.product), Number(r.receivedQty || 0)])
  );

  for (const line of doc.items) {
    const dispatched = Number(line.dispatchedQty || 0);
    if (dispatched <= 0) continue;

    const received = overrides.has(String(line.product))
      ? Math.min(Number(overrides.get(String(line.product))), dispatched)
      : dispatched;

    if (received > 0) {
      await recordMovement({
        product: line.product,
        warehouse: doc.toWarehouse,
        qty: received,
        type: MOVEMENT_TYPES.TRANSFER_IN,
        refType: 'TRANSFER',
        refId: doc._id,
        refNo: doc.transferNo,
        reason: 'Transfer received',
        note: `From ${doc.fromWarehouseName}`,
        movedBy: req.user.id,
        settings,
      });
    }
    line.receivedQty = received;
  }

  doc.status = TRANSFER_STATUS.RECEIVED;
  doc.receivedAt = new Date();
  doc.receivedBy = req.user.id;
  pushHistory(doc, TRANSFER_STATUS.RECEIVED, req, req.body?.note || 'Received');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'StockTransfer',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'transferNo'),
    before: { status: TRANSFER_STATUS.DISPATCHED },
    after: { status: TRANSFER_STATUS.RECEIVED },
    description: `Stock transfer ${labelOf(doc, 'transferNo')} received`,
  });

  const full = await loadDoc(StockTransfer, doc._id, { populate: POPULATE_TRANSFER, label: 'Transfer' });
  return success(res, { message: 'Transfer received', data: toPlain(full) });
});

export const cancelTransfer = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const doc = await loadTransfer(req, req.params.id);
  const reason = req.body?.reason || '';

  if (doc.status === TRANSFER_STATUS.CANCELLED) {
    throw new ConflictError('Transfer is already cancelled', ErrorCodes.INVALID_STATUS_TRANSITION);
  }
  if (doc.status === TRANSFER_STATUS.RECEIVED) {
    throw new ConflictError(
      'A received transfer cannot be cancelled',
      ErrorCodes.INVALID_STATUS_TRANSITION
    );
  }

  // If it was already dispatched, put the stock back in the source warehouse.
  if (doc.status === TRANSFER_STATUS.DISPATCHED) {
    await reverseMovementsFor('TRANSFER', doc._id, reason || 'Transfer cancelled', settings, req.user.id);
    doc.items.forEach((line) => {
      line.dispatchedQty = 0;
    });
  }

  const before = doc.status;
  doc.status = TRANSFER_STATUS.CANCELLED;
  doc.cancelledAt = new Date();
  doc.cancelledBy = req.user.id;
  doc.cancelReason = reason;
  pushHistory(doc, TRANSFER_STATUS.CANCELLED, req, reason || 'Cancelled');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'StockTransfer',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'transferNo'),
    before: { status: before },
    after: { status: TRANSFER_STATUS.CANCELLED },
    description: `Stock transfer ${labelOf(doc, 'transferNo')} cancelled${reason ? `: ${reason}` : ''}`,
  });

  const full = await loadDoc(StockTransfer, doc._id, { populate: POPULATE_TRANSFER, label: 'Transfer' });
  return success(res, { message: 'Transfer cancelled', data: toPlain(full) });
});

/** Form options: warehouses + (optionally) low-stock products for a warehouse. */
export const formOptions = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const warehouseId = refOrNull(req.query.warehouseId);
  const defaultWarehouse = await resolveDefaultWarehouse(settings);

  const [warehouses, products] = await Promise.all([
    Warehouse.find({ isActive: { $ne: false } }).select('name code type isDefault').sort({ name: 1 }).lean(),
    Product.find({ isActive: { $ne: false } })
      .select('name sku unit stock lowStockLevel purchasePrice sellingPrice category brand')
      .sort({ name: 1 })
      .limit(1000)
      .lean(),
  ]);

  // Attach the per-warehouse on-hand so the picker can show availability.
  let balances = [];
  if (warehouseId) {
    balances = await StockBalance.find({ warehouse: warehouseId })
      .select('product qty reservedQty lowStockLevel')
      .lean();
  }
  const byProduct = new Map(balances.map((b) => [String(b.product), b]));

  return success(res, {
    data: {
      warehouses: warehouses.map((w) => ({ ...w, id: String(w._id) })),
      defaultWarehouseId: defaultWarehouse ? String(defaultWarehouse._id) : null,
      products: products.map((p) => {
        const bal = byProduct.get(String(p._id));
        const onHand = bal ? Number(bal.qty || 0) : Number(p.stock || 0);
        return {
          id: String(p._id),
          name: p.name,
          sku: p.sku || '',
          unit: p.unit || 'PCS',
          category: p.category || '',
          brand: p.brand || '',
          gstRate: Number(p.gstRate || 0),
          purchasePrice: Number(p.purchasePrice || 0),
          sellingPrice: Number(p.sellingPrice || 0),
          lowStockLevel: Number(p.lowStockLevel || 0),
          onHand,
          reservedQty: bal ? Number(bal.reservedQty || 0) : 0,
          available: Math.max(0, onHand - (bal ? Number(bal.reservedQty || 0) : 0)),
        };
      }),
    },
  });
});

// ---------------------------------------------------------------------------
// Line builders (validate referenced products, snapshot names)
// ---------------------------------------------------------------------------

const buildAdjustmentLines = async (raw = []) => {
  const ids = [...new Set(raw.map((l) => String(l.product)).filter(Boolean))];
  const docs = ids.length ? await Product.find({ _id: { $in: ids } }) : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  return raw.map((line, index) => {
    const product = byId.get(String(line.product));
    if (!product) {
      throw new BadRequestError(`Product not found for line ${index + 1}`, 'INVALID_REFERENCE');
    }
    return {
      product: product._id,
      name: product.name || '',
      sku: product.sku || '',
      unit: product.unit || 'PCS',
      qty: Number(line.qty),
      unitCost: Number(line.unitCost ?? product.purchasePrice ?? 0),
      reason: line.reason || '',
      note: line.note || '',
    };
  });
};

const buildTransferLines = async (raw = []) => {
  const ids = [...new Set(raw.map((l) => String(l.product)).filter(Boolean))];
  const docs = ids.length ? await Product.find({ _id: { $in: ids } }) : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  return raw.map((line, index) => {
    const product = byId.get(String(line.product));
    if (!product) {
      throw new BadRequestError(`Product not found for line ${index + 1}`, 'INVALID_REFERENCE');
    }
    return {
      product: product._id,
      name: product.name || '',
      sku: product.sku || '',
      unit: product.unit || 'PCS',
      qty: Number(line.qty),
      note: line.note || '',
    };
  });
};

export default {
  listStock,
  listMovements,
  productHistory,
  stats,
  lowStock,
  exportStock,
  listAdjustments,
  getAdjustment,
  createAdjustment,
  updateAdjustment,
  removeAdjustment,
  postAdjustment,
  cancelAdjustment,
  listTransfers,
  getTransfer,
  createTransfer,
  updateTransfer,
  removeTransfer,
  dispatchTransfer,
  receiveTransfer,
  cancelTransfer,
  formOptions,
};
