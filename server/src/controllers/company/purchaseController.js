import ExcelJS from 'exceljs';
import dayjs from 'dayjs';

import PurchaseOrder from '../../models/PurchaseOrder.js';
import GoodsReceipt from '../../models/GoodsReceipt.js';
import PurchaseBill from '../../models/PurchaseBill.js';
import PurchaseReturn from '../../models/PurchaseReturn.js';
import Supplier from '../../models/Supplier.js';
import Product from '../../models/Product.js';
import Warehouse from '../../models/Warehouse.js';
import Setting from '../../models/Setting.js';

import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments, searchRegex } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, MOVEMENT_TYPES, PURCHASE_ORDER_STATUS, GRN_STATUS } from '../../config/constants.js';
import { AppError, BadRequestError, ConflictError, ErrorCodes } from '../../utils/errors.js';
import { toPlain, loadDoc, refOrNull, dateOrNull } from './_helpers.js';
import { computeTotals, priceLineValues, taxBreakupFor, sellerStateOf, assertPackQty, wholeUnitCodes, assertWholeQty } from '../../services/orderService.js';
import { lineUnit } from '../../services/catalogService.js';
import {
  recordMovement,
  reverseMovementsFor,
  resolveDefaultWarehouse,
  loadWarehouse,
  nextPurchaseOrderNumber,
  nextGrnNumber,
  assertPoTransition,
} from '../../services/inventoryService.js';

/**
 * Phase 7 - Purchasing controller (Purchase Orders -> Goods Receipts).
 *
 * A PO records the intent to buy; it does not touch stock. Stock only moves
 * when a GRN is POSTED, at which point one PURCHASE_RECEIPT movement is written
 * per accepted line and the PO's received quantities + status are rolled
 * forward (DRAFT -> SENT -> PARTIALLY_RECEIVED -> RECEIVED).
 */

const POPULATE_PO = [
  { path: 'supplierId', select: 'name code gstin phone email address paymentTerms leadDays' },
  { path: 'warehouse', select: 'name code type' },
  { path: 'items.product', select: 'name sku unit purchasePrice gstRate hsnCode' },
  { path: 'cancelledBy', select: 'name email' },
  { path: 'createdBy', select: 'name email' },
];

const POPULATE_GRN = [
  { path: 'purchaseOrder', select: 'poNo status supplierId' },
  { path: 'supplierId', select: 'name code gstin phone' },
  { path: 'warehouse', select: 'name code type' },
  { path: 'items.product', select: 'name sku unit purchasePrice' },
  { path: 'postedBy', select: 'name email' },
  { path: 'cancelledBy', select: 'name email' },
  { path: 'createdBy', select: 'name email' },
];

const settingsOf = async (req) => req.settings || (await Setting.forCompany(req.companyId));
const pushHistory = (doc, status, req, text = '') => {
  doc.statusHistory.push({ status, at: new Date(), by: req.user.id, byName: req.user.name, note: text });
};
const labelOf = (d, key) => d?.[key] || (d?._id ? String(d._id) : 'Record');

// ===========================================================================
// Purchase orders
// ===========================================================================

const loadPo = (req, id) => loadDoc(PurchaseOrder, id, { populate: POPULATE_PO, label: 'Purchase order' });

export const listPos = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.supplierId) filter.supplierId = req.query.supplierId;
  if (req.query.warehouseId) filter.warehouse = req.query.warehouseId;

  const result = await listDocuments(PurchaseOrder, {
    filter,
    query: req.query,
    searchFields: ['poNo', 'supplierName', 'supplierCode', 'poReference'],
    filtersSpec: {
      supplierId: { type: 'objectId' },
      warehouse: { type: 'objectId' },
      status: { type: 'string' },
    },
    sortAllowed: ['poDate', 'createdAt', 'total', 'poNo', 'status', 'supplierName'],
    defaultSort: '-poDate',
    dateField: 'poDate',
    populate: POPULATE_PO,
  });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const getPo = asyncHandler(async (req, res) => {
  const doc = await loadPo(req, req.params.id);
  // Include linked GRNs so the detail view can show receipts against this PO.
  const grns = await GoodsReceipt.find({ purchaseOrder: doc._id })
    .select('grnNo grnDate status totalReceivedQty totalAcceptedQty totalValue warehouse')
    .populate('warehouse', 'name code')
    .sort({ grnDate: -1 })
    .lean();

  return success(res, { data: { ...toPlain(doc), grns: grns.map((g) => ({ ...g, id: String(g._id) })) } });
});

export const createPo = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const payload = { ...req.body };

  const supplier = await Supplier.findById(payload.supplierId);
  if (!supplier) throw new BadRequestError('Supplier not found', 'INVALID_REFERENCE');

  const warehouse = payload.warehouse
    ? await loadWarehouse(payload.warehouse, 'Warehouse')
    : await resolveDefaultWarehouse(settings);

  const { lines } = await buildPoLines(payload.items || [], settings);

  const doc = new PurchaseOrder({
    supplierId: supplier._id,
    supplierName: supplier.name || '',
    supplierCode: supplier.code || '',
    supplierGstin: supplier.gstin || '',
    supplierAddress: supplier.address || {},
    warehouse: warehouse?._id || null,
    poDate: dateOrNull(payload.poDate) || new Date(),
    expectedDate: dateOrNull(payload.expectedDate),
    paymentTerms: payload.paymentTerms || supplier.paymentTerms || settings?.purchase?.defaultPaymentTerms || 'NET_30',
    leadDays: Number(payload.leadDays ?? supplier.leadDays ?? settings?.purchase?.defaultLeadDays ?? 7),
    poReference: payload.poReference || '',
    notes: payload.notes || '',
    internalNotes: payload.internalNotes || '',
    terms: payload.terms || '',
    items: lines,
    status: PURCHASE_ORDER_STATUS.DRAFT,
    statusHistory: [],
    source: 'WEB',
  });

  applyPoTotals(doc, settings, req.company);
  pushHistory(doc, PURCHASE_ORDER_STATUS.DRAFT, req, 'Created');
  doc.poNo = await nextPurchaseOrderNumber(req.companyId, settings, doc.poDate);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'PurchaseOrder',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'poNo'),
    after: toPlain(doc),
    description: `Purchase order ${labelOf(doc, 'poNo')} created for ${supplier.name}`,
  });

  let message = 'Purchase order saved as draft';
  if (payload.send || settings?.purchase?.autoSendOnCreate) {
    await transitionPo(req, doc, PURCHASE_ORDER_STATUS.SENT, 'Sent on create');
    message = 'Purchase order sent';
  }

  const full = await loadDoc(PurchaseOrder, doc._id, { populate: POPULATE_PO, label: 'Purchase order' });
  return created(res, { message, data: toPlain(full) });
});

export const updatePo = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const doc = await loadPo(req, req.params.id);
  if (![PURCHASE_ORDER_STATUS.DRAFT, PURCHASE_ORDER_STATUS.SENT].includes(doc.status)) {
    throw new ConflictError('Only draft or sent purchase orders can be edited', 'PO_LOCKED');
  }
  if (Number(doc.receivedQty || 0) > 0) {
    throw new ConflictError('A partially received purchase order cannot be edited', 'PO_LOCKED');
  }

  const before = toPlain(doc);
  const payload = { ...req.body };

  if (payload.supplierId) {
    const supplier = await Supplier.findById(payload.supplierId);
    if (!supplier) throw new BadRequestError('Supplier not found', 'INVALID_REFERENCE');
    doc.supplierId = supplier._id;
    doc.supplierName = supplier.name || '';
    doc.supplierCode = supplier.code || '';
    doc.supplierGstin = supplier.gstin || '';
    doc.supplierAddress = supplier.address || {};
  }
  if (payload.warehouse) {
    const warehouse = await loadWarehouse(payload.warehouse, 'Warehouse');
    doc.warehouse = warehouse._id;
  }
  if (payload.poDate !== undefined) doc.poDate = dateOrNull(payload.poDate) || doc.poDate;
  if (payload.expectedDate !== undefined) doc.expectedDate = dateOrNull(payload.expectedDate);
  if (payload.paymentTerms !== undefined) doc.paymentTerms = payload.paymentTerms;
  if (payload.leadDays !== undefined) doc.leadDays = Number(payload.leadDays);
  if (payload.poReference !== undefined) doc.poReference = payload.poReference;
  if (payload.notes !== undefined) doc.notes = payload.notes;
  if (payload.internalNotes !== undefined) doc.internalNotes = payload.internalNotes;
  if (payload.terms !== undefined) doc.terms = payload.terms;

  if (payload.items !== undefined) {
    const { lines } = await buildPoLines(payload.items, settings);
    doc.items = lines;
    applyPoTotals(doc, settings, req.company);
  }

  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'PurchaseOrder',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'poNo'),
    before,
    after: toPlain(doc),
    description: `Purchase order ${labelOf(doc, 'poNo')} updated`,
  });

  const full = await loadDoc(PurchaseOrder, doc._id, { populate: POPULATE_PO, label: 'Purchase order' });
  return success(res, { message: 'Purchase order updated', data: toPlain(full) });
});

export const removePo = asyncHandler(async (req, res) => {
  const doc = await loadPo(req, req.params.id);
  if (doc.status !== PURCHASE_ORDER_STATUS.DRAFT) {
    throw new ConflictError('Only draft purchase orders can be deleted', 'PO_LOCKED');
  }
  if (Number(doc.receivedQty || 0) > 0) {
    throw new ConflictError('A received purchase order cannot be deleted', 'PO_LOCKED');
  }

  const snapshot = toPlain(doc);
  await doc.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'PurchaseOrder',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'poNo'),
    before: snapshot,
    description: `Draft purchase order ${labelOf(doc, 'poNo')} deleted`,
  });

  return success(res, { message: 'Purchase order deleted', data: { id: String(doc._id) } });
});

const transitionPo = async (req, doc, to, text = '') => {
  assertPoTransition(doc.status, to);
  const before = doc.status;
  doc.status = to;
  if (to === PURCHASE_ORDER_STATUS.SENT) doc.sentAt = new Date();
  pushHistory(doc, to, req, text);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'PurchaseOrder',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'poNo'),
    before: { status: before },
    after: { status: to },
    description: `Purchase order ${labelOf(doc, 'poNo')} ${to.toLowerCase()}`,
  });
  return doc;
};

export const sendPo = asyncHandler(async (req, res) => {
  const doc = await loadPo(req, req.params.id);
  await transitionPo(req, doc, PURCHASE_ORDER_STATUS.SENT, req.body?.note || 'Sent to supplier');

  const full = await loadDoc(PurchaseOrder, doc._id, { populate: POPULATE_PO, label: 'Purchase order' });
  return success(res, { message: 'Purchase order sent', data: toPlain(full) });
});

export const cancelPo = asyncHandler(async (req, res) => {
  const doc = await loadPo(req, req.params.id);
  const reason = req.body?.reason || '';

  if (doc.status === PURCHASE_ORDER_STATUS.CANCELLED) {
    throw new ConflictError('Purchase order is already cancelled', ErrorCodes.INVALID_STATUS_TRANSITION);
  }
  if (Number(doc.receivedQty || 0) > 0) {
    throw new ConflictError(
      'A partially received purchase order cannot be cancelled. Raise a purchase return instead.',
      ErrorCodes.INVALID_STATUS_TRANSITION
    );
  }

  const before = doc.status;
  doc.status = PURCHASE_ORDER_STATUS.CANCELLED;
  doc.cancelledAt = new Date();
  doc.cancelledBy = req.user.id;
  doc.cancelReason = reason;
  pushHistory(doc, PURCHASE_ORDER_STATUS.CANCELLED, req, reason || 'Cancelled');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'PurchaseOrder',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'poNo'),
    before: { status: before },
    after: { status: PURCHASE_ORDER_STATUS.CANCELLED },
    description: `Purchase order ${labelOf(doc, 'poNo')} cancelled${reason ? `: ${reason}` : ''}`,
  });

  const full = await loadDoc(PurchaseOrder, doc._id, { populate: POPULATE_PO, label: 'Purchase order' });
  return success(res, { message: 'Purchase order cancelled', data: toPlain(full) });
});

// ===========================================================================
// Goods receipt notes
// ===========================================================================

const loadGrn = (req, id) => loadDoc(GoodsReceipt, id, { populate: POPULATE_GRN, label: 'Goods receipt' });

export const listGrns = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.warehouseId) filter.warehouse = req.query.warehouseId;
  if (req.query.purchaseOrder) filter.purchaseOrder = req.query.purchaseOrder;
  if (req.query.supplierId) filter.supplierId = req.query.supplierId;

  const result = await listDocuments(GoodsReceipt, {
    filter,
    query: req.query,
    searchFields: ['grnNo', 'poNo', 'supplierName', 'invoiceNo'],
    filtersSpec: {
      warehouse: { type: 'objectId' },
      purchaseOrder: { type: 'objectId' },
      supplierId: { type: 'objectId' },
      status: { type: 'string' },
    },
    sortAllowed: ['grnDate', 'createdAt', 'grnNo', 'status', 'totalValue', 'supplierName'],
    defaultSort: '-grnDate',
    dateField: 'grnDate',
    populate: POPULATE_GRN,
  });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const getGrn = asyncHandler(async (req, res) => {
  const doc = await loadGrn(req, req.params.id);
  return success(res, { data: toPlain(doc) });
});

/**
 * GRN form options: open PO lines (to receive against) or a spot-purchase
 * product picker when no PO is supplied.
 */
export const grnFormOptions = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const poId = refOrNull(req.query.purchaseOrder);
  const defaultWarehouse = await resolveDefaultWarehouse(settings);

  let po = null;
  let openLines = [];

  if (poId) {
    const doc = await PurchaseOrder.findById(poId).populate('supplierId', 'name code gstin').lean();
    if (!doc) throw new BadRequestError('Purchase order not found', 'INVALID_REFERENCE');
    if ([PURCHASE_ORDER_STATUS.CANCELLED, PURCHASE_ORDER_STATUS.RECEIVED].includes(doc.status)) {
      throw new AppError(`This purchase order is ${doc.status.toLowerCase()} and cannot be received`, {
        status: 422,
        code: 'PO_NOT_RECEIVABLE',
      });
    }

    po = {
      id: String(doc._id),
      poNo: doc.poNo,
      status: doc.status,
      supplierId: String(doc.supplierId?._id || doc.supplierId || ''),
      supplierName: doc.supplierName || doc.supplierId?.name || '',
      warehouse: doc.warehouse ? String(doc.warehouse._id || doc.warehouse) : null,
      items: (doc.items || []).map((i) => ({
        id: String(i._id),
        product: String(i.product?._id || i.product),
        name: i.name,
        sku: i.sku,
        unit: i.unit,
        qty: Number(i.qty || 0),
        receivedQty: Number(i.receivedQty || 0),
        pendingQty: Math.max(0, Number(i.qty || 0) - Number(i.receivedQty || 0)),
        unitPrice: Number(i.unitPrice || 0),
        taxRate: Number(i.taxRate || 0),
      })),
    };
    openLines = po.items.filter((i) => i.pendingQty > 0);
  }

  const [warehouses, products] = await Promise.all([
    Warehouse.find({ isActive: { $ne: false } }).select('name code type isDefault').sort({ name: 1 }).lean(),
    Product.find({ isActive: { $ne: false } })
      .select('name sku customCode unit packUnits purchasePrice gstRate hsnCode')
      .sort({ name: 1 })
      .limit(1000)
      .lean(),
  ]);

  return success(res, {
    data: {
      purchaseOrder: po,
      openLines,
      warehouses: warehouses.map((w) => ({ ...w, id: String(w._id) })),
      defaultWarehouseId: po?.warehouse || (defaultWarehouse ? String(defaultWarehouse._id) : null),
      products: products.map((p) => ({
        id: String(p._id),
        name: p.name,
        sku: p.sku || '',
        unit: p.unit || 'PCS',
        purchasePrice: Number(p.purchasePrice || 0),
        gstRate: Number(p.gstRate || 0),
        hsnCode: p.hsnCode || '',
      })),
    },
  });
});

export const createGrn = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const payload = { ...req.body };

  const poId = refOrNull(payload.purchaseOrder);
  let po = null;
  if (poId) {
    po = await PurchaseOrder.findById(poId);
    if (!po) throw new BadRequestError('Purchase order not found', 'INVALID_REFERENCE');
    if ([PURCHASE_ORDER_STATUS.CANCELLED, PURCHASE_ORDER_STATUS.RECEIVED].includes(po.status)) {
      throw new AppError(`This purchase order is ${po.status.toLowerCase()} and cannot be received`, {
        status: 422,
        code: 'PO_NOT_RECEIVABLE',
      });
    }
  }

  const warehouse = await loadWarehouse(
    payload.warehouse || po?.warehouse || (await resolveDefaultWarehouse(settings))?._id,
    'Warehouse'
  );

  const supplier = po?.supplierId
    ? await Supplier.findById(po.supplierId)
    : payload.supplierId
      ? await Supplier.findById(payload.supplierId)
      : null;

  const items = await buildGrnLines(payload.items || [], po);

  const doc = new GoodsReceipt({
    purchaseOrder: po?._id || null,
    poNo: po?.poNo || '',
    supplierId: supplier?._id || null,
    supplierName: supplier?.name || '',
    warehouse: warehouse._id,
    warehouseCode: warehouse.code || '',
    warehouseName: warehouse.name || '',
    grnDate: dateOrNull(payload.grnDate) || new Date(),
    invoiceNo: payload.invoiceNo || '',
    vehicleNo: payload.vehicleNo || '',
    eWayBillNo: payload.eWayBillNo || '',
    notes: payload.notes || '',
    items,
    status: GRN_STATUS.DRAFT,
    statusHistory: [],
    source: 'WEB',
  });
  pushHistory(doc, GRN_STATUS.DRAFT, req, 'Created');
  doc.grnNo = await nextGrnNumber(req.companyId, settings, doc.grnDate);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'GoodsReceipt',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'grnNo'),
    after: toPlain(doc),
    description: `Goods receipt ${labelOf(doc, 'grnNo')} created${po ? ` against ${po.poNo}` : ''}`,
  });

  let message = 'Goods receipt saved as draft';
  if (payload.post) {
    await postGrnDoc(req, doc, settings, 'Posted on create');
    message = 'Goods receipt posted';
  }

  const full = await loadDoc(GoodsReceipt, doc._id, { populate: POPULATE_GRN, label: 'Goods receipt' });
  return created(res, { message, data: toPlain(full) });
});

export const updateGrn = asyncHandler(async (req, res) => {
  const doc = await loadGrn(req, req.params.id);
  if (doc.status !== GRN_STATUS.DRAFT) {
    throw new ConflictError('Only draft goods receipts can be edited', 'GRN_LOCKED');
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
  if (payload.grnDate !== undefined) doc.grnDate = dateOrNull(payload.grnDate) || doc.grnDate;
  if (payload.invoiceNo !== undefined) doc.invoiceNo = payload.invoiceNo;
  if (payload.vehicleNo !== undefined) doc.vehicleNo = payload.vehicleNo;
  if (payload.eWayBillNo !== undefined) doc.eWayBillNo = payload.eWayBillNo;
  if (payload.notes !== undefined) doc.notes = payload.notes;

  if (payload.items !== undefined) {
    const po = doc.purchaseOrder ? await PurchaseOrder.findById(doc.purchaseOrder) : null;
    doc.items = await buildGrnLines(payload.items, po);
  }

  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'GoodsReceipt',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'grnNo'),
    before,
    after: toPlain(doc),
    description: `Goods receipt ${labelOf(doc, 'grnNo')} updated`,
  });

  const full = await loadDoc(GoodsReceipt, doc._id, { populate: POPULATE_GRN, label: 'Goods receipt' });
  return success(res, { message: 'Goods receipt updated', data: toPlain(full) });
});

export const removeGrn = asyncHandler(async (req, res) => {
  const doc = await loadGrn(req, req.params.id);
  if (doc.status !== GRN_STATUS.DRAFT) {
    throw new ConflictError('Only draft goods receipts can be deleted', 'GRN_LOCKED');
  }

  const snapshot = toPlain(doc);
  await doc.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'GoodsReceipt',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'grnNo'),
    before: snapshot,
    description: `Draft goods receipt ${labelOf(doc, 'grnNo')} deleted`,
  });

  return success(res, { message: 'Goods receipt deleted', data: { id: String(doc._id) } });
});

/** Book accepted quantities into stock and roll the PO forward. */
const postGrnDoc = async (req, doc, settings, text = '') => {
  if (doc.status !== GRN_STATUS.DRAFT) {
    throw new ConflictError('Only draft goods receipts can be posted', 'GRN_NOT_DRAFT');
  }
  if (!doc.items.length) throw new BadRequestError('Goods receipt has no lines', 'VALIDATION_ERROR');

  for (const line of doc.items) {
    const accepted = Number(line.acceptedQty || 0);
    if (accepted <= 0) continue;
    const factor = Number(line.unitFactor || 1);

    await recordMovement({
      product: line.product,
      warehouse: doc.warehouse,
      qty: accepted * factor, // stock is counted in base units
      type: MOVEMENT_TYPES.PURCHASE_RECEIPT,
      refType: 'GOODS_RECEIPT',
      refId: doc._id,
      refNo: doc.grnNo,
      reason: 'Goods received',
      note: doc.invoiceNo ? `Bill ${doc.invoiceNo}` : '',
      unitCost: Number(line.unitCost || 0) / factor,
      movedBy: req.user.id,
      settings,
    });
  }

  doc.status = GRN_STATUS.POSTED;
  doc.postedAt = new Date();
  doc.postedBy = req.user.id;
  pushHistory(doc, GRN_STATUS.POSTED, req, text || 'Posted');
  await doc.save();

  // Roll the received quantities back onto the linked PO and refresh status.
  if (doc.purchaseOrder) await rollForwardPo(doc.purchaseOrder);

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'GoodsReceipt',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'grnNo'),
    before: { status: GRN_STATUS.DRAFT },
    after: { status: GRN_STATUS.POSTED },
    description: `Goods receipt ${labelOf(doc, 'grnNo')} posted`,
  });

  return doc;
};

export const postGrn = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const doc = await loadGrn(req, req.params.id);
  await postGrnDoc(req, doc, settings, req.body?.note || '');

  const full = await loadDoc(GoodsReceipt, doc._id, { populate: POPULATE_GRN, label: 'Goods receipt' });
  return success(res, { message: 'Goods receipt posted', data: toPlain(full) });
});

export const cancelGrn = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const doc = await loadGrn(req, req.params.id);
  const reason = req.body?.reason || '';

  if (doc.status === GRN_STATUS.CANCELLED) {
    throw new ConflictError('Goods receipt is already cancelled', ErrorCodes.INVALID_STATUS_TRANSITION);
  }

  const before = doc.status;
  if (before === GRN_STATUS.POSTED) {
    // Billed or partly returned goods are part of the supplier account now.
    const [billed, returned] = await Promise.all([
      PurchaseBill.exists({ grns: doc._id, status: { $ne: 'CANCELLED' } }),
      PurchaseReturn.exists({ grn: doc._id, status: 'POSTED' }),
    ]);
    if (billed || returned) {
      throw new ConflictError(
        `${labelOf(doc, 'grnNo')} is on a supplier bill or purchase return - cancel that first`,
        'GRN_IN_USE'
      );
    }
    await reverseMovementsFor('GOODS_RECEIPT', doc._id, reason || 'GRN cancelled', settings, req.user.id);
    if (doc.purchaseOrder) await rollForwardPo(doc.purchaseOrder);
  }

  doc.status = GRN_STATUS.CANCELLED;
  doc.cancelledAt = new Date();
  doc.cancelledBy = req.user.id;
  doc.cancelReason = reason;
  pushHistory(doc, GRN_STATUS.CANCELLED, req, reason || 'Cancelled');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'GoodsReceipt',
    entityId: doc._id,
    entityLabel: labelOf(doc, 'grnNo'),
    before: { status: before },
    after: { status: GRN_STATUS.CANCELLED },
    description: `Goods receipt ${labelOf(doc, 'grnNo')} cancelled${reason ? `: ${reason}` : ''}`,
  });

  const full = await loadDoc(GoodsReceipt, doc._id, { populate: POPULATE_GRN, label: 'Goods receipt' });
  return success(res, { message: 'Goods receipt cancelled', data: toPlain(full) });
});

/**
 * Recompute a PO's received quantities from its POSTED GRNs and move its
 * status to PARTIALLY_RECEIVED / RECEIVED. Called after every GRN post/cancel.
 */
export const rollForwardPo = async (poId) => {
  const po = await PurchaseOrder.findById(poId);
  if (!po) return null;

  const posted = await GoodsReceipt.find({ purchaseOrder: po._id, status: GRN_STATUS.POSTED }).lean();
  const receivedByProduct = new Map();
  posted.forEach((grn) => {
    (grn.items || []).forEach((item) => {
      const key = String(item.product);
      receivedByProduct.set(key, (receivedByProduct.get(key) || 0) + Number(item.acceptedQty || 0));
    });
  });

  po.items.forEach((line) => {
    line.receivedQty = receivedByProduct.get(String(line.product)) || 0;
  });

  // NOTE: `orderedQty` / `receivedQty` on the header are only recomputed by
  // the model's pre-save hook, so reading them here would return the value
  // from the *previous* save (one roll behind). Derive them from the lines.
  const ordered = po.items.reduce((sum, i) => sum + Number(i.qty || 0), 0);
  const received = po.items.reduce((sum, i) => sum + Number(i.receivedQty || 0), 0);
  po.orderedQty = ordered;
  po.receivedQty = received;

  if (ordered > 0 && received >= ordered && received > 0) {
    po.status = PURCHASE_ORDER_STATUS.RECEIVED;
    if (!po.fullyReceivedAt) po.fullyReceivedAt = new Date();
  } else if (received > 0) {
    po.status = PURCHASE_ORDER_STATUS.PARTIALLY_RECEIVED;
    po.fullyReceivedAt = null;
  }

  await po.save();
  return po;
};

export const poFormOptions = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const defaultWarehouse = await resolveDefaultWarehouse(settings);

  const [suppliers, warehouses, products] = await Promise.all([
    Supplier.find({ isActive: { $ne: false } }).select('name code gstin paymentTerms leadDays').sort({ name: 1 }).limit(1000).lean(),
    Warehouse.find({ isActive: { $ne: false } }).select('name code type isDefault').sort({ name: 1 }).lean(),
    Product.find({ isActive: { $ne: false } })
      .select('name sku customCode unit packUnits purchasePrice gstRate hsnCode')
      .sort({ name: 1 })
      .limit(1000)
      .lean(),
  ]);

  return success(res, {
    data: {
      suppliers: suppliers.map((s) => ({ ...s, id: String(s._id) })),
      warehouses: warehouses.map((w) => ({ ...w, id: String(w._id) })),
      defaultWarehouseId: defaultWarehouse ? String(defaultWarehouse._id) : null,
      products: products.map((p) => ({
        id: String(p._id),
        name: p.name,
        sku: p.sku || '',
        unit: p.unit || 'PCS',
        purchasePrice: Number(p.purchasePrice || 0),
        gstRate: Number(p.gstRate || 0),
        hsnCode: p.hsnCode || '',
      })),
    },
  });
});

export const exportPos = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.supplierId) filter.supplierId = req.query.supplierId;
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ poNo: rx }, { supplierName: rx }];
  }

  const rows = await PurchaseOrder.find(filter)
    .populate('supplierId', 'name code')
    .populate('warehouse', 'name code')
    .sort({ poDate: -1 })
    .limit(5000)
    .lean();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ElevIQ SFA';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Purchase Orders', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'PO No', key: 'poNo', width: 20 },
    { header: 'Date', key: 'poDate', width: 14 },
    { header: 'Expected', key: 'expectedDate', width: 14 },
    { header: 'Supplier', key: 'supplier', width: 30 },
    { header: 'Warehouse', key: 'warehouse', width: 20 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Ordered Qty', key: 'orderedQty', width: 14 },
    { header: 'Received Qty', key: 'receivedQty', width: 14 },
    { header: 'Total', key: 'total', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };

  rows.forEach((r) => {
    sheet.addRow({
      poNo: r.poNo,
      poDate: r.poDate ? dayjs(r.poDate).format('YYYY-MM-DD') : '',
      expectedDate: r.expectedDate ? dayjs(r.expectedDate).format('YYYY-MM-DD') : '',
      supplier: r.supplierName || r.supplierId?.name || '',
      warehouse: r.warehouse?.name || '',
      status: r.status,
      orderedQty: Number(r.orderedQty || 0),
      receivedQty: Number(r.receivedQty || 0),
      total: Number(r.total || 0),
    });
  });

  if (rows.length) {
    sheet.addRow({});
    const totalRow = sheet.addRow({
      poNo: `Total (${rows.length} POs)`,
      total: rows.reduce((s, r) => s + Number(r.total || 0), 0),
    });
    totalRow.font = { bold: true };
  }

  const filename = `purchase-orders-${dayjs().format('YYYY-MM-DD')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'PurchaseOrder',
    entityLabel: 'Purchase order register',
    description: `Exported ${rows.length} purchase orders to Excel`,
  });

  res.end();
});

// ---------------------------------------------------------------------------
// Line builders / totals
// ---------------------------------------------------------------------------

/** Price PO lines server-side using the purchase rate, then compute totals. */
const buildPoLines = async (raw = [], settings) => {
  const ids = [...new Set(raw.map((l) => String(l.product)).filter(Boolean))];
  const docs = ids.length ? await Product.find({ _id: { $in: ids } }) : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const wholeUnits = await wholeUnitCodes();

  const lines = raw.map((input, index) => {
    const product = byId.get(String(input.product));
    if (!product) throw new BadRequestError(`Product not found for line ${index + 1}`, 'INVALID_REFERENCE');

    // Bought in the base unit or a pack (e.g. cartons); the purchase rate
    // defaults to the product's purchase price per base unit x pack size.
    const unit = lineUnit(product, input.unit);
    assertPackQty(input.qty, unit.factor, product, unit.unit, index);
    assertWholeQty(input.qty, unit.unit, wholeUnits, product, index);
    const unitPrice =
      input.unitPrice === undefined || input.unitPrice === null || input.unitPrice === ''
        ? Number(product.purchasePrice || 0) * unit.factor
        : Number(input.unitPrice);
    const taxRate =
      input.taxRate === undefined || input.taxRate === null || input.taxRate === ''
        ? Number(product.gstRate || 0)
        : Number(input.taxRate);

    return {
      product: product._id,
      name: product.name || '',
      sku: product.sku || '',
      unit: unit.unit,
      unitFactor: unit.factor,
      baseQty: Number(input.qty) * unit.factor,
      hsnCode: product.hsnCode || '',
      receivedQty: 0,
      freeQty: Number(input.freeQty || 0),
      ...priceLineValues({ ...input, unitPrice, taxRate }, settings),
    };
  });

  return { lines };
};

// On a purchase the supplier sells to us: their state vs ours decides the split.
const applyPoTotals = (doc, settings, company) => {
  const { totals } = computeTotals(doc.items, settings);
  const taxBreakup = taxBreakupFor(totals.taxTotal, settings, {
    sellerState: doc.supplierAddress?.state || '',
    buyerState: sellerStateOf(settings, company),
  });
  doc.subtotal = totals.subtotal;
  doc.discountTotal = totals.discountTotal;
  doc.taxableTotal = totals.taxableTotal;
  doc.taxTotal = totals.taxTotal;
  doc.taxBreakup = taxBreakup;
  doc.roundOff = totals.roundOff;
  doc.total = totals.total;
};

/** Validate GRN lines against the PO (never receive more than was ordered). */
const buildGrnLines = async (raw = [], po) => {
  const ids = [...new Set(raw.map((l) => String(l.product)).filter(Boolean))];
  const docs = ids.length ? await Product.find({ _id: { $in: ids } }) : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const poLineByProduct = new Map(
    ((po && po.items) || []).map((i) => [String(i.product), i])
  );
  const wholeUnits = await wholeUnitCodes();
  if (raw.length && raw.every((l) => !(Number(l.receivedQty) > 0))) {
    throw new AppError('Enter the quantity received on at least one line', {
      status: 422,
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'items.0.receivedQty', message: 'Enter the quantity received' }],
    });
  }

  return raw.map((input, index) => {
    const product = byId.get(String(input.product));
    if (!product) throw new BadRequestError(`Product not found for line ${index + 1}`, 'INVALID_REFERENCE');
    const lineUnitCode = poLineByProduct.get(String(input.product))?.unit || product.unit || 'PCS';
    assertWholeQty(input.receivedQty, lineUnitCode, wholeUnits, product, index, 'receivedQty');
    assertWholeQty(input.rejectedQty || 0, lineUnitCode, wholeUnits, product, index, 'rejectedQty');

    const received = Number(input.receivedQty || 0);
    const rejected = Math.min(Number(input.rejectedQty || 0), received);
    const accepted = Math.max(0, received - rejected);

    const poLine = poLineByProduct.get(String(input.product));
    if (poLine) {
      const pending = Math.max(0, Number(poLine.qty || 0) - Number(poLine.receivedQty || 0));
      if (accepted > pending + 0.0001) {
        throw new AppError(
          `${product.name}: only ${pending} pending on this purchase order, ${accepted} accepted`,
          {
            status: 422,
            code: 'OVER_RECEIPT',
            errors: [{ field: `items.${index}.receivedQty`, message: `Max pending is ${pending}` }],
          }
        );
      }
    }

    return {
      product: product._id,
      name: product.name || '',
      sku: product.sku || '',
      // Received in the PO line's unit (spot receipts: the base unit).
      unit: poLine?.unit || product.unit || 'PCS',
      unitFactor: Number(poLine?.unitFactor || 1),
      baseQty: accepted * Number(poLine?.unitFactor || 1),
      orderedQty: poLine ? Number(poLine.qty || 0) : 0,
      receivedQty: received,
      acceptedQty: accepted,
      rejectedQty: rejected,
      rejectReason: input.rejectReason || '',
      unitCost: Number(input.unitCost ?? poLine?.unitPrice ?? product.purchasePrice ?? 0),
      note: input.note || '',
    };
  });
};

export default {
  listPos,
  getPo,
  createPo,
  updatePo,
  removePo,
  sendPo,
  cancelPo,
  listGrns,
  getGrn,
  createGrn,
  updateGrn,
  removeGrn,
  postGrn,
  cancelGrn,
  grnFormOptions,
  poFormOptions,
  exportPos,
};
