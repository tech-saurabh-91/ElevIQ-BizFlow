import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pdfLocale, taxRows } from '../../utils/pdfLocale.js';
import dayjs from 'dayjs';

import Order from '../../models/Order.js';
import Customer from '../../models/Customer.js';
import Product from '../../models/Product.js';
import PriceList from '../../models/PriceList.js';
import Route from '../../models/Route.js';
import Warehouse from '../../models/Warehouse.js';
import User from '../../models/User.js';
import Setting from '../../models/Setting.js';

import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments, searchRegex } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import {
  AUDIT_ACTIONS,
  ORDER_STATUS,
  ORDER_STATUS_LIST,
  ORDER_TRANSITIONS,
} from '../../config/constants.js';
import { AppError, BadRequestError, ConflictError, ErrorCodes } from '../../utils/errors.js';
import {
  toPlain,
  loadDoc,
  assertRef,
  refOrNull,
  dateOrNull,
  markSetup,
} from './_helpers.js';
import {
  buildOrderLines,
  assertStockAvailable,
  assertCreditLimit,
  nextOrderNumber,
  submittedStatus,
  taxBreakupFor,
  sellerStateOf,
  buyerStateOf,
} from '../../services/orderService.js';
import {
  reserveStock,
  releaseReservation,
  dispatchOrderStock,
} from '../../services/inventoryService.js';

/** Relations returned on every order read so the UI never needs a second call. */
const POPULATE = [
  { path: 'customerId', select: 'name code phone gstin type creditLimit creditDays paymentTerms outstanding priceList route warehouse address shippingAddress' },
  { path: 'salesman', select: 'name email role title' },
  { path: 'route', select: 'name code' },
  { path: 'warehouse', select: 'name code' },
  { path: 'priceList', select: 'name code type' },
  { path: 'createdBy', select: 'name email' },
  { path: 'approvedBy', select: 'name email' },
  { path: 'rejectedBy', select: 'name email' },
  { path: 'cancelledBy', select: 'name email' },
];

const SEARCH_FIELDS = ['orderNo', 'customerName', 'customerPhone', 'customerCode', 'poReference'];

const FILTERS_SPEC = {
  status: { type: 'string' },
  customerId: { type: 'objectId' },
  salesman: { type: 'objectId' },
  route: { type: 'objectId' },
  warehouse: { type: 'objectId' },
  paymentMode: { type: 'string' },
};

const SORT_ALLOWED = ['orderDate', 'createdAt', 'updatedAt', 'total', 'orderNo', 'status', 'customerName'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Field-level data scope: salesman -> own, manager -> team, others -> all. */
const scopeFilter = (req) => {
  const role = req.user?.role;
  if (role === 'SALESMAN') return { salesman: req.user.id };
  if (role === 'MANAGER') {
    const ids = [req.user.id, ...(req.dataScope?.teamIds || [])];
    return { salesman: { $in: ids } };
  }
  return {};
};

/** Same scope, but with ObjectIds because aggregate() skips casting/plugin hooks. */
const aggregateScope = (req) => {
  const role = req.user?.role;
  const oid = (id) => new mongoose.Types.ObjectId(id);
  if (role === 'SALESMAN') return { salesman: oid(req.user.id) };
  if (role === 'MANAGER') {
    return { salesman: { $in: [req.user.id, ...(req.dataScope?.teamIds || [])].map(oid) } };
  }
  return {};
};

const settingsOf = async (req) => req.settings || (await Setting.forCompany(req.companyId));

const serialize = (doc) => {
  const plain = toPlain(doc);
  const customer = plain?.customerId;
  if (customer && typeof customer === 'object' && customer.name) {
    plain.customer = {
      id: customer.id || String(customer._id),
      name: customer.name,
      code: customer.code || '',
    };
  }
  return plain;
};

const labelOf = (order) => order?.orderNo || (order?._id ? String(order._id) : 'Order');

const loadOrder = (req, id) =>
  loadDoc(Order, id, { populate: POPULATE, filter: scopeFilter(req), label: 'Order' });

const getCustomer = async (customerId) => {
  const customer = await Customer.findById(customerId);
  if (!customer) throw new BadRequestError('Customer not found', 'INVALID_REFERENCE');
  if (customer.isActive === false) {
    throw new AppError(`"${customer.name}" is inactive and cannot receive orders`, {
      status: 422,
      code: 'INACTIVE_CUSTOMER',
    });
  }
  return customer;
};

const getPriceList = async (customer, overrideId) => {
  const id = refOrNull(overrideId) || refOrNull(customer?.priceList);
  if (id) {
    const list = await PriceList.findById(id).lean();
    if (list) return list;
  }
  return PriceList.findOne({ isDefault: true }).lean();
};

const loadProducts = async (items = []) => {
  const ids = [...new Set(items.map((i) => String(i.product)))];
  const docs = await Product.find({ _id: { $in: ids } }).lean();
  return new Map(docs.map((d) => [String(d._id), d]));
};

const normalizeItems = (items = []) =>
  items.map((i) => ({
    product: String(i.product?._id || i.product),
    qty: Number(i.qty),
    freeQty: Number(i.freeQty || 0),
    unitPrice: i.unitPrice,
    discountPercent: i.discountPercent,
    taxRate: i.taxRate,
    note: i.note || '',
  }));

/** Validate optional reference fields that were actually sent. */
const validateRefs = async (payload) => {
  const out = { ...payload };
  const refs = [
    ['salesman', User, 'Salesman'],
    ['route', Route, 'Route'],
    ['warehouse', Warehouse, 'Warehouse'],
    ['priceList', PriceList, 'Price list'],
  ];
  for (const [key, Model, label] of refs) {
    if (key in out) out[key] = await assertRef(Model, out[key], label);
  }
  return out;
};

/** Header snapshot + defaults, resolved from payload, existing order and customer. */
const snapshotFrom = (customer, payload, settings, priceList, req, existing = null) => {
  const resolve = (key, fallback) => {
    if (payload[key] !== undefined) return payload[key];
    if (existing && existing[key] !== undefined && existing[key] !== null) return existing[key];
    return fallback;
  };

  const shipping = customer.shippingAddress?.line1
    ? customer.shippingAddress
    : customer.address || {};

  const salesmanFallback =
    customer.assignedTo ||
    (req.user.role === 'SALESMAN' ? req.user.id : null);

  return {
    customerId: customer._id,
    customerName: customer.name,
    customerCode: customer.code || '',
    customerPhone: customer.phone || '',
    customerGstin: customer.gstin || '',
    billingAddress: customer.address || {},
    shippingAddress: shipping,

    salesman: refOrNull(resolve('salesman', salesmanFallback)),
    route: refOrNull(resolve('route', customer.route)),
    warehouse: refOrNull(resolve('warehouse', customer.warehouse || settings?.inventory?.defaultWarehouse)),
    priceList: priceList?._id || null,

    orderDate: dateOrNull(resolve('orderDate', new Date())) || new Date(),
    expectedDeliveryDate: dateOrNull(resolve('expectedDeliveryDate', null)),

    paymentMode: resolve('paymentMode', settings?.order?.defaultPaymentMode || 'CREDIT'),
    paymentTerms: resolve('paymentTerms', customer.paymentTerms || 'IMMEDIATE'),
    creditDays: Number(resolve('creditDays', customer.creditDays || 0)),
    poReference: resolve('poReference', ''),

    notes: resolve('notes', ''),
    internalNotes: resolve('internalNotes', ''),
    deliveryInstructions: resolve('deliveryInstructions', ''),
  };
};

/** Run the pricing engine + stock/credit guards for a set of raw items. */
const priceOrder = async (req, customer, priceList, rawItems, settings) => {
  const products = await loadProducts(rawItems);
  const priced = buildOrderLines(rawItems, { products, priceList, settings });
  priced.taxBreakup = taxBreakupFor(priced.totals.taxTotal, settings, {
    sellerState: sellerStateOf(settings, req.company),
    buyerState: buyerStateOf(customer),
  });
  const stock = assertStockAvailable(priced.lines, products, settings);
  const credit = assertCreditLimit(customer, priced.totals.total, settings);

  return {
    priced,
    products,
    warnings: [...stock.warnings, ...(credit.warning ? [credit.warning] : [])],
  };
};

/** Push a status-history entry and persist. Enforces the transition matrix. */
const transition = async (req, order, nextStatus, { note = '', reason = '', extra = {}, action } = {}) => {
  const allowed = ORDER_TRANSITIONS[order.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new AppError(
      `Cannot move order from ${order.status} to ${nextStatus}`,
      { status: 409, code: ErrorCodes.INVALID_STATUS_TRANSITION }
    );
  }

  const before = order.status;
  order.status = nextStatus;
  order.statusHistory.push({
    status: nextStatus,
    at: new Date(),
    by: req.user.id,
    byName: req.user.name,
    note: note || reason || '',
  });
  Object.assign(order, extra);
  await order.save();

  audit(req, {
    action: action || AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Order',
    entityId: order._id,
    entityLabel: labelOf(order),
    before: { status: before },
    after: { status: nextStatus },
    description:
      nextStatus === ORDER_STATUS.CONFIRMED && action === AUDIT_ACTIONS.APPROVE
        ? `Order ${labelOf(order)} approved`
        : `Order ${labelOf(order)}: ${before} → ${nextStatus}`,
  });

  return order;
};

/** Keep the customer's lifetime counters in sync with confirmed sales. */
const syncCustomerCounters = async (order, direction) => {
  if (direction > 0 && !order.salesCounted) {
    await Customer.updateOne(
      { _id: order.customerId },
      {
        $inc: { totalOrders: 1, totalSales: Number(order.total || 0) },
        $set: { lastOrderAt: order.orderDate || new Date() },
      }
    );
    order.salesCounted = true;
  } else if (direction < 0 && order.salesCounted) {
    await Customer.updateOne(
      { _id: order.customerId },
      {
        $inc: { totalOrders: -1, totalSales: -Number(order.total || 0) },
      }
    );
    order.salesCounted = false;
  }
};

/** Submit a draft: re-check stock/credit, then auto-confirm or request approval. */
const submitDraft = async (req, order, settings, note = '') => {
  if (order.status !== ORDER_STATUS.DRAFT) {
    throw new ConflictError('Only draft orders can be submitted', 'ORDER_NOT_DRAFT');
  }

  const rawItems = normalizeItems(order.items);
  const products = await loadProducts(rawItems);
  const stock = assertStockAvailable(
    rawItems.map((i) => ({ product: i.product, qty: i.qty })),
    products,
    settings
  );
  const customer = await Customer.findById(order.customerId);
  const credit = assertCreditLimit(customer, order.total, settings);

  const next = submittedStatus(order.total, settings);
  const approvalRequired = next === ORDER_STATUS.PENDING_APPROVAL;

  await transition(req, order, next, {
    note: note || (approvalRequired ? 'Submitted for approval' : 'Submitted and confirmed'),
    extra: { approvalRequired },
  });

  let warnings = [...stock.warnings, ...(credit.warning ? [credit.warning] : [])];
  if (next === ORDER_STATUS.CONFIRMED) {
    await syncCustomerCounters(order, 1);
    await order.save();
    // Hold the units for this confirmed order (no-op unless the tenant
    // enabled reserveStockOnConfirm).
    await reserveStock(order.items, {
      warehouseId: order.warehouse || null,
      settings,
    });
  } else {
    warnings = [...warnings, `Approval required: order value is at or above the ${settings?.order?.approvalThreshold || 0} threshold`];
  }

  return { order, warnings };
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const list = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req) };
  if (req.query.pendingApproval) filter.status = ORDER_STATUS.PENDING_APPROVAL;

  const result = await listDocuments(Order, {
    filter,
    query: req.query,
    searchFields: SEARCH_FIELDS,
    filtersSpec: FILTERS_SPEC,
    sortAllowed: SORT_ALLOWED,
    defaultSort: '-orderDate',
    dateField: 'orderDate',
    populate: POPULATE,
  });

  return paginated(res, {
    data: result.data.map(serialize),
    ...result.meta,
  });
});

export const stats = asyncHandler(async (req, res) => {
  const base = {
    companyId: new mongoose.Types.ObjectId(req.companyId),
    isDeleted: { $ne: true },
    ...aggregateScope(req),
  };

  const startOfDay = dayjs().startOf('day').toDate();
  const startOfMonth = dayjs().startOf('month').toDate();
  const moneyStatuses = { $nin: [ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED] };

  const [byStatus, today, month, overall] = await Promise.all([
    Order.aggregate([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    Order.aggregate([
      { $match: { ...base, orderDate: { $gte: startOfDay }, status: moneyStatuses } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    Order.aggregate([
      { $match: { ...base, orderDate: { $gte: startOfMonth }, status: moneyStatuses } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    Order.aggregate([
      { $match: { ...base, status: moneyStatuses } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
  ]);

  const counts = Object.fromEntries(ORDER_STATUS_LIST.map((s) => [s, 0]));
  const values = Object.fromEntries(ORDER_STATUS_LIST.map((s) => [s, 0]));
  byStatus.forEach((row) => {
    counts[row._id] = row.count;
    values[row._id] = Math.round((row.value || 0) * 100) / 100;
  });

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const totalValue = Math.round((overall?.[0]?.value || 0) * 100) / 100;
  const salesCount = overall?.[0]?.count || 0;

  return success(res, {
    data: {
      total,
      byStatus: counts,
      valuesByStatus: values,
      pendingApprovals: counts[ORDER_STATUS.PENDING_APPROVAL] || 0,
      today: {
        count: today?.[0]?.count || 0,
        value: Math.round((today?.[0]?.value || 0) * 100) / 100,
      },
      month: {
        count: month?.[0]?.count || 0,
        value: Math.round((month?.[0]?.value || 0) * 100) / 100,
      },
      totalValue,
      averageValue: salesCount ? Math.round((totalValue / salesCount) * 100) / 100 : 0,
    },
  });
});

export const get = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, req.params.id);
  return success(res, { data: serialize(order) });
});

export const create = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const payload = await validateRefs({ ...req.body });

  const customer = await getCustomer(payload.customerId);
  const priceList = await getPriceList(customer, payload.priceList);
  const rawItems = normalizeItems(payload.items);
  const { priced, warnings } = await priceOrder(req, customer, priceList, rawItems, settings);

  const snapshot = snapshotFrom(customer, payload, settings, priceList, req);

  const order = new Order({
    ...snapshot,
    items: priced.lines,
    ...priced.totals,
    taxBreakup: priced.taxBreakup,
    status: ORDER_STATUS.DRAFT,
    approvalRequired: false,
    statusHistory: [
      {
        status: ORDER_STATUS.DRAFT,
        at: new Date(),
        by: req.user.id,
        byName: req.user.name,
        note: 'Order created',
      },
    ],
  });
  order.orderNo = await nextOrderNumber(req.companyId, settings, order.orderDate);
  await order.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'Order',
    entityId: order._id,
    entityLabel: labelOf(order),
    after: toPlain(order),
    description: `Order ${labelOf(order)} created for ${customer.name}`,
  });
  await markSetup('firstOrder');

  let finalWarnings = warnings;
  if (payload.submit) {
    const submitted = await submitDraft(req, order, settings, 'Submitted on create');
    finalWarnings = submitted.warnings;
  }

  const full = await loadDoc(Order, order._id, { populate: POPULATE, label: 'Order' });
  return created(res, {
    message: payload.submit ? 'Order submitted' : 'Order created',
    data: serialize(full),
    meta: { warnings: finalWarnings },
  });
});

export const update = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const order = await loadOrder(req, req.params.id);
  if (order.status !== ORDER_STATUS.DRAFT) {
    throw new ConflictError('Only draft orders can be edited', 'ORDER_LOCKED');
  }

  const before = toPlain(order);
  const payload = await validateRefs({ ...req.body });
  delete payload.submit;

  const customer = await getCustomer(payload.customerId || order.customerId);
  const priceList = await getPriceList(
    customer,
    payload.priceList !== undefined ? payload.priceList : order.priceList
  );

  const rawItems = payload.items ? normalizeItems(payload.items) : normalizeItems(order.items);
  if (!rawItems.length) throw new BadRequestError('Add at least one product', 'VALIDATION_ERROR');

  const { priced, warnings } = await priceOrder(req, customer, priceList, rawItems, settings);
  const snapshot = snapshotFrom(customer, payload, settings, priceList, req, order);

  Object.assign(order, snapshot, priced.totals, {
    items: priced.lines,
    taxBreakup: priced.taxBreakup,
    priceList: priceList?._id || null,
  });
  await order.save();

  const after = toPlain(order);
  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Order',
    entityId: order._id,
    entityLabel: labelOf(order),
    before,
    after,
    description: `Order ${labelOf(order)} updated`,
  });

  const full = await loadDoc(Order, order._id, { populate: POPULATE, label: 'Order' });
  return success(res, {
    message: 'Order updated',
    data: serialize(full),
    meta: { warnings },
  });
});

export const remove = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, req.params.id);
  if (order.status !== ORDER_STATUS.DRAFT) {
    throw new ConflictError(
      'Only draft orders can be deleted. Cancel this order instead.',
      'ORDER_LOCKED'
    );
  }

  const snapshot = toPlain(order);
  await order.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'Order',
    entityId: order._id,
    entityLabel: labelOf(order),
    before: snapshot,
    description: `Draft order ${labelOf(order)} deleted`,
  });

  return success(res, { message: 'Order deleted', data: { id: String(order._id) } });
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const submit = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const order = await loadOrder(req, req.params.id);
  const result = await submitDraft(req, order, settings, req.body?.note || '');

  const full = await loadDoc(Order, order._id, { populate: POPULATE, label: 'Order' });
  return success(res, {
    message:
      order.status === ORDER_STATUS.PENDING_APPROVAL
        ? 'Order submitted for approval'
        : 'Order confirmed',
    data: serialize(full),
    meta: { warnings: result.warnings },
  });
});

export const approve = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, req.params.id);
  if (order.status !== ORDER_STATUS.PENDING_APPROVAL) {
    throw new ConflictError(
      'Only orders pending approval can be approved',
      ErrorCodes.INVALID_STATUS_TRANSITION
    );
  }
  await transition(req, order, ORDER_STATUS.CONFIRMED, {
    note: req.body?.note || 'Approved',
    extra: {
      approvalRequired: false,
      approvedBy: req.user.id,
      approvedAt: new Date(),
    },
    action: AUDIT_ACTIONS.APPROVE,
  });
  await syncCustomerCounters(order, 1);
  await order.save();
  // Approved orders become confirmed - hold their units.
  await reserveStock(order.items, {
    warehouseId: order.warehouse || null,
    settings: await settingsOf(req),
  });

  const full = await loadDoc(Order, order._id, { populate: POPULATE, label: 'Order' });
  return success(res, { message: 'Order approved', data: serialize(full) });
});

export const reject = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, req.params.id);
  if (order.status !== ORDER_STATUS.PENDING_APPROVAL) {
    throw new ConflictError(
      'Only orders pending approval can be rejected',
      ErrorCodes.INVALID_STATUS_TRANSITION
    );
  }
  await transition(req, order, ORDER_STATUS.REJECTED, {
    reason: req.body.reason,
    extra: {
      approvalRequired: false,
      rejectedBy: req.user.id,
      rejectedAt: new Date(),
      rejectionReason: req.body.reason,
    },
    action: AUDIT_ACTIONS.REJECT,
  });

  const full = await loadDoc(Order, order._id, { populate: POPULATE, label: 'Order' });
  return success(res, { message: 'Order rejected', data: serialize(full) });
});

export const cancel = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, req.params.id);
  const reason = req.body?.reason || '';

  // Stock is only ever reserved on CONFIRMED (and stays reserved until it is
  // consumed at DISPATCH). Capture the prior state so a never-confirmed order
  // cannot release somebody else's reservation.
  const prevStatus = order.status;
  const hadReservation = [
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.PARTIALLY_INVOICED,
    ORDER_STATUS.FULLY_INVOICED,
  ].includes(prevStatus);

  await transition(req, order, ORDER_STATUS.CANCELLED, {
    reason,
    extra: {
      cancelledAt: new Date(),
      cancelledBy: req.user.id,
      cancelReason: reason,
    },
  });

  if (hadReservation) {
    await releaseReservation(order.items, {
      warehouseId: order.warehouse || null,
      settings: await settingsOf(req),
    });
  }

  if (order.salesCounted) {
    await syncCustomerCounters(order, -1);
    await order.save();
  }

  const full = await loadDoc(Order, order._id, { populate: POPULATE, label: 'Order' });
  return success(res, { message: 'Order cancelled', data: serialize(full) });
});

export const dispatch = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, req.params.id);

  // Book the stock OUT first: dispatchOrderStock does a pre-flight
  // availability check, so a shortage throws 422 before anything is written
  // and the order stays in its current state.
  await dispatchOrderStock(order, {
    settings: await settingsOf(req),
    movedBy: req.user.id,
  });

  await transition(req, order, ORDER_STATUS.DISPATCHED, {
    note: req.body?.note || 'Dispatched',
    extra: { dispatchedAt: dateOrNull(req.body?.dispatchedAt) || new Date() },
  });

  const full = await loadDoc(Order, order._id, { populate: POPULATE, label: 'Order' });
  return success(res, { message: 'Order marked dispatched', data: serialize(full) });
});

export const deliver = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, req.params.id);
  await transition(req, order, ORDER_STATUS.DELIVERED, {
    note: req.body?.note || 'Delivered',
    extra: { deliveredAt: new Date() },
  });

  const full = await loadDoc(Order, order._id, { populate: POPULATE, label: 'Order' });
  return success(res, { message: 'Order marked delivered', data: serialize(full) });
});

// ---------------------------------------------------------------------------
// Form options (customer-aware pricing/stock)
// ---------------------------------------------------------------------------

export const formOptions = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const customerId = refOrNull(req.query.customerId);

  const [customer, products, salesmen, routes, warehouses] = await Promise.all([
    customerId ? Customer.findById(customerId).lean() : null,
    Product.find({ isActive: true })
      .select('name sku category brand unit hsnCode gstRate mrp sellingPrice dealerPrice stock lowStockLevel isActive')
      .sort({ name: 1 })
      .limit(1000)
      .lean(),
    User.find({ isActive: true, role: { $in: ['SALESMAN', 'MANAGER', 'COMPANY_ADMIN'] } })
      .select('name email role title')
      .sort({ name: 1 })
      .lean(),
    Route.find({ isActive: true }).select('name code territory').sort({ name: 1 }).lean(),
    Warehouse.find({ isActive: true }).select('name code type isDefault').sort({ isDefault: -1, name: 1 }).lean(),
  ]);

  if (customerId && !customer) throw new BadRequestError('Customer not found', 'INVALID_REFERENCE');

  const priceList = customer ? await getPriceList(customer, null) : await PriceList.findOne({ isDefault: true }).lean();

  const defaultWarehouse =
    warehouses.find((w) => String(w._id) === String(settings?.inventory?.defaultWarehouse)) ||
    warehouses.find((w) => w.isDefault) ||
    warehouses[0] ||
    null;

  const idOf = (d) => ({ ...d, id: String(d._id), _id: undefined });

  return success(res, {
    data: {
      customer: customer
        ? {
            id: String(customer._id),
            name: customer.name,
            code: customer.code || '',
            phone: customer.phone || '',
            gstin: customer.gstin || '',
            type: customer.type,
            creditLimit: customer.creditLimit || 0,
            creditDays: customer.creditDays || 0,
            outstanding: customer.outstanding || 0,
            paymentTerms: customer.paymentTerms,
            priceList: customer.priceList ? String(customer.priceList) : null,
            assignedTo: customer.assignedTo ? String(customer.assignedTo) : null,
            route: customer.route ? String(customer.route) : null,
            warehouse: customer.warehouse ? String(customer.warehouse) : null,
            address: customer.address || {},
            shippingAddress: customer.shippingAddress || {},
          }
        : null,
      priceList: priceList
        ? {
            id: String(priceList._id),
            name: priceList.name,
            code: priceList.code || '',
            type: priceList.type,
            items: (priceList.items || []).map((i) => ({
              product: String(i.product),
              price: Number(i.price || 0),
              discountPercent: Number(i.discountPercent || 0),
              minQty: Number(i.minQty || 1),
            })),
          }
        : null,
      products: products.map(idOf),
      salesmen: salesmen.map(idOf),
      routes: routes.map(idOf),
      warehouses: warehouses.map(idOf),
      defaults: {
        warehouse: defaultWarehouse ? String(defaultWarehouse._id) : null,
        paymentMode: settings?.order?.defaultPaymentMode || 'CREDIT',
      },
      settings: {
        currency: settings?.currency || 'INR',
        currencySymbol: settings?.currencySymbol || '₹',
        tax: {
          regime: settings?.tax?.regime || 'GST',
          taxInclusive: Boolean(settings?.tax?.taxInclusive),
          enableCgstSgst: settings?.tax?.enableCgstSgst !== false,
          label: settings?.tax?.taxLabel || 'Tax',
          // Company state: same-state sales split into CGST + SGST, others IGST.
          sellerState: sellerStateOf(settings, req.company),
          defaultTaxRate: Number(settings?.tax?.defaultTaxRate ?? 18),
        },
        order: {
          approvalThreshold: Number(settings?.order?.approvalThreshold || 0),
          creditLimitAction: settings?.order?.creditLimitAction || 'WARN',
          allowNegativeStock: Boolean(settings?.order?.allowNegativeStock),
          showStockOnOrder: settings?.order?.showStockOnOrder !== false,
          defaultPaymentMode: settings?.order?.defaultPaymentMode || 'CREDIT',
        },
        invoice: { rounding: settings?.invoice?.rounding || 'NEAREST' },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Export / print
// ---------------------------------------------------------------------------

const buildExportFilter = (req) => {
  const filter = { ...scopeFilter(req) };

  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = SEARCH_FIELDS.map((f) => ({ [f]: rx }));
  }
  ['status', 'customerId', 'salesman', 'route', 'warehouse', 'paymentMode'].forEach((key) => {
    if (req.query[key]) filter[key] = req.query[key];
  });
  if (req.query.pendingApproval) filter.status = ORDER_STATUS.PENDING_APPROVAL;

  if (req.query.dateFrom || req.query.dateTo) {
    const range = {};
    if (req.query.dateFrom) range.$gte = new Date(req.query.dateFrom);
    if (req.query.dateTo) {
      const to = new Date(req.query.dateTo);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateTo))) to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
    filter.orderDate = { ...(filter.orderDate || {}), ...range };
  }
  return filter;
};

const fetchForExport = (req) =>
  Order.find(buildExportFilter(req))
    .sort({ orderDate: -1 })
    .limit(5000)
    .populate('customerId', 'name code phone')
    .populate('salesman', 'name')
    .populate('warehouse', 'name code')
    .lean();

export const exportXlsx = asyncHandler(async (req, res) => {
  const orders = await fetchForExport(req);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ElevIQ SFA';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Orders', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Order No', key: 'orderNo', width: 20 },
    { header: 'Order Date', key: 'orderDate', width: 14 },
    { header: 'Customer', key: 'customer', width: 32 },
    { header: 'Customer Code', key: 'customerCode', width: 16 },
    { header: 'Salesman', key: 'salesman', width: 22 },
    { header: 'Warehouse', key: 'warehouse', width: 20 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Items', key: 'itemCount', width: 10 },
    { header: 'Subtotal', key: 'subtotal', width: 14 },
    { header: 'Discount', key: 'discountTotal', width: 14 },
    { header: 'Tax', key: 'taxTotal', width: 14 },
    { header: 'Total', key: 'total', width: 16 },
    { header: 'Payment Mode', key: 'paymentMode', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };

  orders.forEach((o) => {
    sheet.addRow({
      orderNo: o.orderNo,
      orderDate: o.orderDate ? dayjs(o.orderDate).format('YYYY-MM-DD') : '',
      customer: o.customerId?.name || o.customerName || '',
      customerCode: o.customerCode || o.customerId?.code || '',
      salesman: o.salesman?.name || '',
      warehouse: o.warehouse?.name || '',
      status: o.status,
      itemCount: o.itemCount || 0,
      subtotal: Number(o.subtotal || 0),
      discountTotal: Number(o.discountTotal || 0),
      taxTotal: Number(o.taxTotal || 0),
      total: Number(o.total || 0),
      paymentMode: o.paymentMode || '',
    });
  });

  if (orders.length) {
    sheet.addRow({});
    const totalRow = sheet.addRow({
      orderNo: `Total (${orders.length} orders)`,
      total: orders.reduce((s, o) => s + Number(o.total || 0), 0),
    });
    totalRow.font = { bold: true };
  }

  const filename = `orders-${dayjs().format('YYYY-MM-DD')}.xlsx`;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'Order',
    entityLabel: 'Order register',
    description: `Exported ${orders.length} orders to Excel`,
  });

  res.end();
});

const money2 = (n) => Number(n || 0).toFixed(2);

export const pdf = asyncHandler(async (req, res) => {
  const order = await loadOrder(req, req.params.id);
  const settings = await settingsOf(req);
  const company = req.company || {};
  const loc = await pdfLocale(settings, company);

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const filename = `order-${(order.orderNo || order._id).toString().replace(/[^a-z0-9-]/gi, '')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);

  const left = 40;
  const right = 555;

  // Header
  doc.font('Helvetica-Bold').fontSize(18).text(company.businessName || 'ElevIQ SFA', left, 40);
  doc.font('Helvetica').fontSize(8).fillColor('#555');
  const companyLine = [
    company.code ? `Code: ${company.code}` : '',
    company.gstin && loc.showTaxId ? `${loc.taxIdLabel}: ${company.gstin}` : '',
    company.phone || '',
    company.email || '',
  ]
    .filter(Boolean)
    .join('  |  ');
  if (companyLine) doc.text(companyLine, left, 62);
  doc.fillColor('#000');

  doc.font('Helvetica-Bold').fontSize(14).text('SALES ORDER', right - 180, 40, {
    width: 180,
    align: 'right',
  });
  doc.font('Helvetica').fontSize(9);
  doc.text(`Order No: ${order.orderNo || '—'}`, right - 200, 62, { width: 200, align: 'right' });
  doc.text(
    `Date: ${order.orderDate ? dayjs(order.orderDate).format('DD MMM YYYY') : '—'}`,
    right - 200,
    75,
    { width: 200, align: 'right' }
  );
  doc.text(`Status: ${order.status}`, right - 200, 88, { width: 200, align: 'right' });

  doc.moveTo(left, 104).lineTo(right, 104).strokeColor('#cbd5e1').stroke();

  // Customer / delivery blocks
  const customer = order.customerId || {};
  doc.font('Helvetica-Bold').fontSize(9).text('BILL TO', left, 116);
  doc.font('Helvetica').fontSize(9);
  doc.text(order.customerName || customer.name || '—', left, 130, { width: 240 });
  const addr = order.billingAddress || {};
  const addrLines = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode]
    .filter(Boolean)
    .join(', ');
  if (addrLines) doc.text(addrLines, left, 144, { width: 240 });
  if (order.customerPhone || customer.phone) {
    doc.text(`Phone: ${order.customerPhone || customer.phone}`, left, 158, { width: 240 });
  }
  if (order.customerGstin || customer.gstin) {
    doc.text(`${loc.taxIdLabel}: ${order.customerGstin || customer.gstin}`, left, 172, { width: 240 });
  }

  doc.font('Helvetica-Bold').fontSize(9).text('SHIP TO', 300, 116);
  doc.font('Helvetica').fontSize(9);
  const ship = order.shippingAddress || addr;
  doc.text(order.customerName || customer.name || '—', 300, 130, { width: 255 });
  const shipLines = [ship.line1, ship.line2, ship.city, ship.state, ship.pincode]
    .filter(Boolean)
    .join(', ');
  if (shipLines) doc.text(shipLines, 300, 144, { width: 255 });
  doc.text(`Payment: ${order.paymentMode || '—'} / ${order.paymentTerms || '—'}`, 300, 172, {
    width: 255,
  });

  // Items table
  let y = 200;
  const cols = [
    { x: left, w: 26, label: '#' },
    { x: left + 26, w: 200, label: 'Item' },
    { x: left + 226, w: 55, label: loc.codeLabel },
    { x: left + 281, w: 45, label: 'Qty', align: 'right' },
    { x: left + 326, w: 62, label: 'Rate', align: 'right' },
    { x: left + 388, w: 45, label: 'Disc', align: 'right' },
    { x: left + 433, w: 42, label: `${loc.taxLabel}%`, align: 'right' },
    { x: right - 80, w: 80, label: 'Amount', align: 'right' },
  ];

  const headerRow = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111');
    cols.forEach((c) => doc.text(c.label, c.x, y, { width: c.w, align: c.align || 'left' }));
    y += 13;
    doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor('#cbd5e1').stroke();
    doc.font('Helvetica').fontSize(8);
  };
  headerRow();

  (order.items || []).forEach((item, index) => {
    if (y > 680) {
      doc.addPage();
      y = 50;
      headerRow();
    }
    doc.text(String(index + 1), cols[0].x, y, { width: cols[0].w });
    doc.text(item.name || '—', cols[1].x, y, { width: cols[1].w });
    doc.text(item.hsnCode || '—', cols[2].x, y, { width: cols[2].w });
    doc.text(String(item.qty), cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.text(money2(item.unitPrice), cols[4].x, y, { width: cols[4].w, align: 'right' });
    doc.text(`${Number(item.discountPercent || 0)}%`, cols[5].x, y, {
      width: cols[5].w,
      align: 'right',
    });
    doc.text(`${Number(item.taxRate || 0)}%`, cols[6].x, y, { width: cols[6].w, align: 'right' });
    doc.text(money2(item.lineTotal), cols[7].x, y, { width: cols[7].w, align: 'right' });
    y += 16;
  });

  y += 8;
  doc.moveTo(left, y).lineTo(right, y).strokeColor('#cbd5e1').stroke();
  y += 10;

  const totals = [
    ['Subtotal', order.subtotal],
    ['Discount', -Number(order.discountTotal || 0)],
    ['Taxable', order.taxableTotal],
    ...taxRows(order.taxTotal, order.taxBreakup, loc),
    ['Round off', order.roundOff],
  ];
  doc.fontSize(9);
  totals.forEach(([label, value]) => {
    doc.text(label, 380, y, { width: 90, align: 'right' });
    doc.text(money2(value), 475, y, { width: 80, align: 'right' });
    y += 14;
  });
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('Total', 380, y + 2, { width: 90, align: 'right' });
  doc.text(`${loc.money} ${money2(order.total)}`, 475, y + 2, {
    width: 80,
    align: 'right',
  });

  // Notes / footer
  const footerY = Math.max(y + 36, 720);
  doc.font('Helvetica').fontSize(8).fillColor('#555');
  if (order.notes) {
    doc.text(`Notes: ${order.notes}`, left, footerY, { width: 340 });
  }
  if (order.deliveryInstructions) {
    doc.text(`Delivery: ${order.deliveryInstructions}`, left, footerY + 22, { width: 340 });
  }
  doc.text(
    `Generated by ElevIQ SFA on ${dayjs().format('DD MMM YYYY HH:mm')}`,
    left,
    780,
    { width: 515, align: 'center' }
  );

  doc.end();

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'Order',
    entityId: order._id,
    entityLabel: labelOf(order),
    description: `Printed order ${labelOf(order)}`,
  });
});

export default {
  list,
  stats,
  get,
  create,
  update,
  remove,
  submit,
  approve,
  reject,
  cancel,
  dispatch,
  deliver,
  formOptions,
  exportXlsx,
  pdf,
};
