import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import logger from '../../utils/logger.js';
import { pdfLocale, taxRows } from '../../utils/pdfLocale.js';
import dayjs from 'dayjs';

import Invoice from '../../models/Invoice.js';
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
import { AUDIT_ACTIONS, INVOICE_STATUS, INVOICE_STATUS_LIST } from '../../config/constants.js';
import { AppError, BadRequestError, ConflictError, ErrorCodes } from '../../utils/errors.js';
import { toPlain, loadDoc, assertRef, refOrNull, dateOrNull } from './_helpers.js';
import {
  nextInvoiceNumber,
  dueDateFor,
  recalcInvoiceBalance,
  refreshInvoiceStatus,
  remainingOrderLines,
  buildInvoiceLinesFromOrder,
  buildDirectInvoiceLines,
  syncOrderInvoicing,
} from '../../services/invoiceService.js';
import { taxBreakupFor, sellerStateOf, buyerStateOf } from '../../services/orderService.js';

/** Relations returned on every invoice read so the UI never needs a second call. */
const POPULATE = [
  {
    path: 'customerId',
    select:
      'name code phone gstin type creditLimit creditDays paymentTerms outstanding priceList route warehouse address shippingAddress',
  },
  { path: 'salesman', select: 'name email role title' },
  { path: 'route', select: 'name code' },
  { path: 'warehouse', select: 'name code' },
  { path: 'order', select: 'orderNo orderDate status total' },
  { path: 'createdBy', select: 'name email' },
  { path: 'issuedBy', select: 'name email' },
  { path: 'cancelledBy', select: 'name email' },
];

const SEARCH_FIELDS = ['invoiceNo', 'customerName', 'customerPhone', 'customerCode', 'orderNo', 'poReference'];

const FILTERS_SPEC = {
  status: { type: 'string' },
  customerId: { type: 'objectId' },
  salesman: { type: 'objectId' },
  route: { type: 'objectId' },
  warehouse: { type: 'objectId' },
  paymentMode: { type: 'string' },
};

const SORT_ALLOWED = [
  'invoiceDate',
  'dueDate',
  'createdAt',
  'updatedAt',
  'total',
  'balanceDue',
  'invoiceNo',
  'status',
  'customerName',
];

/** Orders that still can produce an invoice. */
const INVOICEABLE_ORDER_STATUSES = ['CONFIRMED', 'PARTIALLY_INVOICED', 'DISPATCHED', 'DELIVERED'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const scopeFilter = (req) => {
  const role = req.user?.role;
  if (role === 'SALESMAN') return { salesman: req.user.id };
  if (role === 'MANAGER') {
    const ids = [req.user.id, ...(req.dataScope?.teamIds || [])];
    return { salesman: { $in: ids } };
  }
  return {};
};

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

const labelOf = (invoice) =>
  invoice?.invoiceNo || (invoice?._id ? String(invoice._id) : 'Invoice');

const loadInvoice = (req, id) =>
  loadDoc(Invoice, id, { populate: POPULATE, filter: scopeFilter(req), label: 'Invoice' });

const getCustomer = async (customerId) => {
  const customer = await Customer.findById(customerId);
  if (!customer) throw new BadRequestError('Customer not found', 'INVALID_REFERENCE');
  if (customer.isActive === false) {
    throw new AppError(`"${customer.name}" is inactive and cannot be invoiced`, {
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
  const ids = [...new Set(items.map((i) => String(i.product?._id || i.product)).filter(Boolean))];
  const docs = await Product.find({ _id: { $in: ids } }).lean();
  return new Map(docs.map((d) => [String(d._id), d]));
};

const normalizeItems = (items = []) =>
  items.map((i) => ({
    product: i.product ? String(i.product?._id || i.product) : undefined,
    orderItemId: i.orderItemId ? String(i.orderItemId?._id || i.orderItemId) : undefined,
    qty: Number(i.qty),
    unitPrice: i.unitPrice,
    discountPercent: i.discountPercent,
    taxRate: i.taxRate,
    note: i.note || '',
  }));

const validateRefs = async (payload) => {
  const out = { ...payload };
  const refs = [
    ['salesman', User, 'Salesman'],
    ['route', Route, 'Route'],
    ['warehouse', Warehouse, 'Warehouse'],
  ];
  for (const [key, Model, label] of refs) {
    if (key in out) out[key] = await assertRef(Model, out[key], label);
  }
  return out;
};

const loadOrderForInvoice = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) throw new BadRequestError('Order not found', 'INVALID_REFERENCE');
  if (!INVOICEABLE_ORDER_STATUSES.includes(order.status)) {
    throw new AppError(
      `Order ${order.orderNo || ''} is ${order.status.toLowerCase().replace(/_/g, ' ')} and cannot be invoiced`,
      { status: 422, code: 'ORDER_NOT_INVOICEABLE' }
    );
  }
  return order;
};

/** Build the header snapshot for a new invoice. */
const snapshotFor = ({ customer, order, payload, settings, req, existing = null }) => {
  const resolve = (key, fallback) => {
    if (payload[key] !== undefined) return payload[key];
    if (existing && existing[key] !== undefined && existing[key] !== null) return existing[key];
    return fallback;
  };

  const invoiceDate = dateOrNull(resolve('invoiceDate', existing?.invoiceDate || new Date())) || new Date();
  const paymentTerms = resolve('paymentTerms', customer?.paymentTerms || settings?.invoice?.defaultPaymentTerms || 'IMMEDIATE');
  const creditDays = Number(resolve('creditDays', customer?.creditDays || 0));
  const dueDate =
    dateOrNull(payload.dueDate) || dueDateFor(invoiceDate, { paymentTerms, creditDays }, settings);

  const billing = customer?.address || order?.billingAddress || {};
  const shipping = customer?.shippingAddress?.line1
    ? customer.shippingAddress
    : customer?.address || order?.shippingAddress || {};

  return {
    order: order?._id || existing?.order || null,
    orderNo: order?.orderNo || existing?.orderNo || '',
    direct: order ? false : existing ? Boolean(existing.direct) : true,

    customerId: customer?._id || order?.customerId || existing?.customerId,
    customerName: customer?.name || order?.customerName || existing?.customerName || '',
    customerCode: customer?.code || order?.customerCode || existing?.customerCode || '',
    customerPhone: customer?.phone || order?.customerPhone || existing?.customerPhone || '',
    customerGstin: customer?.gstin || order?.customerGstin || existing?.customerGstin || '',
    billingAddress: billing,
    shippingAddress: shipping,

    salesman: refOrNull(
      resolve('salesman', order?.salesman || customer?.assignedTo || existing?.salesman || (req.user.role === 'SALESMAN' ? req.user.id : null))
    ),
    route: refOrNull(resolve('route', order?.route || customer?.route || existing?.route)),
    warehouse: refOrNull(resolve('warehouse', order?.warehouse || customer?.warehouse || existing?.warehouse || settings?.inventory?.defaultWarehouse)),

    invoiceDate,
    dueDate,

    paymentMode: resolve('paymentMode', order?.paymentMode || existing?.paymentMode || settings?.order?.defaultPaymentMode || 'CREDIT'),
    paymentTerms,
    creditDays,
    poReference: resolve('poReference', order?.poReference || existing?.poReference || ''),
    // Place of supply is where the buyer receives the goods (decides CGST/SGST vs IGST).
    placeOfSupply: resolve('placeOfSupply', existing?.placeOfSupply || buyerStateOf(customer) || ''),

    notes: resolve('notes', order?.notes || existing?.notes || ''),
    terms: resolve('terms', settings?.invoice?.terms || existing?.terms || ''),
    footerNote: resolve('footerNote', settings?.invoice?.footerNote || existing?.footerNote || ''),

    source: 'WEB',
  };
};

/** Push a status-history entry. */
const pushHistory = (invoice, status, req, note = '') => {
  invoice.statusHistory.push({
    status,
    at: new Date(),
    by: req.user.id,
    byName: req.user.name,
    note,
  });
};

/** Re-validate that a draft's quantities still fit the unbilled order quantity. */
const assertDraftQuantities = async (invoice) => {
  if (!invoice.order) return;
  const order = await Order.findById(invoice.order);
  if (!order) throw new BadRequestError('Linked order not found', 'INVALID_REFERENCE');

  const rows = await remainingOrderLines(order);
  const errors = [];
  (invoice.items || []).forEach((line, index) => {
    const row = rows.find((r) => String(r.orderItemId) === String(line.orderItemId));
    if (!row || Number(line.qty) > row.remainingQty + 0.0001) {
      errors.push({
        field: `items.${index}.qty`,
        message: `${line.name}: only ${row?.remainingQty ?? 0} left to invoice (${line.qty} requested)`,
      });
    }
  });

  if (errors.length) {
    throw new AppError('Invoice quantity exceeds the unbilled order quantity', {
      status: 422,
      code: 'INVOICE_QTY_EXCEEDED',
      errors,
    });
  }
};

/** Issue a draft invoice: balance, customer outstanding and order progress. */
const issueInvoice = async (req, invoice, note = '') => {
  if (invoice.status !== INVOICE_STATUS.DRAFT) {
    throw new ConflictError('Only draft invoices can be issued', 'INVOICE_NOT_DRAFT');
  }

  await assertDraftQuantities(invoice);

  recalcInvoiceBalance(invoice);
  invoice.status = INVOICE_STATUS.ISSUED;
  invoice.issuedAt = new Date();
  invoice.issuedBy = req.user.id;
  refreshInvoiceStatus(invoice);
  pushHistory(invoice, INVOICE_STATUS.ISSUED, req, note || 'Invoice issued');
  await invoice.save();

  await Customer.updateOne(
    { _id: invoice.customerId },
    { $inc: { outstanding: Number(invoice.total || 0) } }
  );

  if (invoice.order) await syncOrderInvoicing(invoice.order);

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Invoice',
    entityId: invoice._id,
    entityLabel: labelOf(invoice),
    before: { status: INVOICE_STATUS.DRAFT },
    after: { status: invoice.status },
    description: `Invoice ${labelOf(invoice)} issued`,
  });

  return invoice;
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const list = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req) };
  if (req.query.orderId) filter.order = req.query.orderId;
  if (req.query.overdue) {
    filter.status = INVOICE_STATUS.OVERDUE;
  }

  const result = await listDocuments(Invoice, {
    filter,
    query: req.query,
    searchFields: SEARCH_FIELDS,
    filtersSpec: FILTERS_SPEC,
    sortAllowed: SORT_ALLOWED,
    defaultSort: '-invoiceDate',
    dateField: 'invoiceDate',
    populate: POPULATE,
  });

  return paginated(res, { data: result.data.map(serialize), ...result.meta });
});

export const stats = asyncHandler(async (req, res) => {
  const base = {
    companyId: new mongoose.Types.ObjectId(req.companyId),
    isDeleted: { $ne: true },
    ...aggregateScope(req),
  };

  const startOfDay = dayjs().startOf('day').toDate();
  const startOfMonth = dayjs().startOf('month').toDate();
  const liveStatuses = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];
  const moneyStatuses = { $in: liveStatuses };

  const [byStatus, today, month, outstanding, overdue, credit] = await Promise.all([
    Invoice.aggregate([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...base, invoiceDate: { $gte: startOfDay }, status: moneyStatuses } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...base, invoiceDate: { $gte: startOfMonth }, status: moneyStatuses } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...base, status: moneyStatuses } },
      { $group: { _id: null, value: { $sum: '$balanceDue' } } },
    ]),
    Invoice.aggregate([
      {
        $match: {
          ...base,
          status: { $in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
          dueDate: { $lt: startOfDay },
          balanceDue: { $gt: 0 },
        },
      },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$balanceDue' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...base, status: moneyStatuses } },
      { $group: { _id: null, value: { $sum: '$creditNoteTotal' } } },
    ]),
  ]);

  const counts = Object.fromEntries(INVOICE_STATUS_LIST.map((s) => [s, 0]));
  const values = Object.fromEntries(INVOICE_STATUS_LIST.map((s) => [s, 0]));
  byStatus.forEach((row) => {
    counts[row._id] = row.count;
    values[row._id] = Math.round((row.value || 0) * 100) / 100;
  });

  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

  return success(res, {
    data: {
      total: Object.values(counts).reduce((s, n) => s + n, 0),
      byStatus: counts,
      valuesByStatus: values,
      draftCount: counts[INVOICE_STATUS.DRAFT] || 0,
      overdueCount: overdue?.[0]?.count || 0,
      outstanding: round(outstanding?.[0]?.value),
      overdueAmount: round(overdue?.[0]?.value),
      creditNoteTotal: round(credit?.[0]?.value),
      today: { count: today?.[0]?.count || 0, value: round(today?.[0]?.value) },
      month: { count: month?.[0]?.count || 0, value: round(month?.[0]?.value) },
    },
  });
});

export const get = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req, req.params.id);
  return success(res, { data: serialize(invoice) });
});

export const create = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const payload = await validateRefs({ ...req.body });

  let order = null;
  let customer = null;
  let priced;

  if (payload.orderId) {
    order = await loadOrderForInvoice(payload.orderId);
    customer = await getCustomer(order.customerId);
    priced = await buildInvoiceLinesFromOrder(order, normalizeItems(payload.items || []), settings);
  } else {
    if (!payload.customerId) throw new BadRequestError('Customer is required', 'VALIDATION_ERROR');
    customer = await getCustomer(payload.customerId);
    const priceList = await getPriceList(customer, payload.priceList);
    const rawItems = normalizeItems(payload.items || []);
    const products = await loadProducts(rawItems);
    priced = buildDirectInvoiceLines(rawItems, { products, priceList, settings });
  }

  const snapshot = snapshotFor({ customer, order, payload, settings, req });
  priced.taxBreakup = taxBreakupFor(priced.totals.taxTotal, settings, {
    sellerState: sellerStateOf(settings, req.company),
    buyerState: snapshot.placeOfSupply,
  });

  const invoice = new Invoice({
    ...snapshot,
    items: priced.lines,
    ...priced.totals,
    taxBreakup: priced.taxBreakup,
    status: INVOICE_STATUS.DRAFT,
    amountPaid: 0,
    balanceDue: priced.totals.total,
    creditNoteTotal: 0,
    creditNoteCount: 0,
    statusHistory: [],
  });
  pushHistory(invoice, INVOICE_STATUS.DRAFT, req, order ? `Created from order ${order.orderNo}` : 'Direct invoice created');

  invoice.invoiceNo = await nextInvoiceNumber(req.companyId, settings, invoice.invoiceDate);
  await invoice.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'Invoice',
    entityId: invoice._id,
    entityLabel: labelOf(invoice),
    after: toPlain(invoice),
    description: `Invoice ${labelOf(invoice)} created for ${customer.name}`,
  });

  let message = 'Invoice created';
  if (payload.issue) {
    await issueInvoice(req, invoice, 'Issued on create');
    message = 'Invoice issued';
  }

  const full = await loadDoc(Invoice, invoice._id, { populate: POPULATE, label: 'Invoice' });
  return created(res, { message, data: serialize(full) });
});

export const update = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const invoice = await loadInvoice(req, req.params.id);
  if (invoice.status !== INVOICE_STATUS.DRAFT) {
    throw new ConflictError('Only draft invoices can be edited', 'INVOICE_LOCKED');
  }

  const before = toPlain(invoice);
  const payload = await validateRefs({ ...req.body });
  delete payload.issue;

  const customer = payload.customerId ? await getCustomer(payload.customerId) : await Customer.findById(invoice.customerId);
  if (!customer) throw new BadRequestError('Customer not found', 'INVALID_REFERENCE');

  let priced;
  if (invoice.order) {
    const order = await Order.findById(invoice.order);
    if (!order) throw new BadRequestError('Linked order not found', 'INVALID_REFERENCE');
    const rawItems = payload.items
      ? normalizeItems(payload.items)
      : normalizeItems(invoice.items.map((i) => ({ orderItemId: i.orderItemId, product: i.product, qty: i.qty })));
    priced = await buildInvoiceLinesFromOrder(order, rawItems, settings);
  } else {
    const priceList = await getPriceList(customer, payload.priceList);
    const rawItems = payload.items ? normalizeItems(payload.items) : normalizeItems(invoice.items);
    const products = await loadProducts(rawItems);
    priced = buildDirectInvoiceLines(rawItems, { products, priceList, settings });
  }

  const snapshot = snapshotFor({ customer, order: null, payload, settings, req, existing: invoice });
  priced.taxBreakup = taxBreakupFor(priced.totals.taxTotal, settings, {
    sellerState: sellerStateOf(settings, req.company),
    buyerState: snapshot.placeOfSupply || invoice.placeOfSupply,
  });
  Object.assign(invoice, snapshot, priced.totals, {
    items: priced.lines,
    taxBreakup: priced.taxBreakup,
  });
  recalcInvoiceBalance(invoice);
  await invoice.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Invoice',
    entityId: invoice._id,
    entityLabel: labelOf(invoice),
    before,
    after: toPlain(invoice),
    description: `Invoice ${labelOf(invoice)} updated`,
  });

  const full = await loadDoc(Invoice, invoice._id, { populate: POPULATE, label: 'Invoice' });
  return success(res, { message: 'Invoice updated', data: serialize(full) });
});

export const remove = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req, req.params.id);
  if (invoice.status !== INVOICE_STATUS.DRAFT) {
    throw new ConflictError(
      'Only draft invoices can be deleted. Cancel this invoice instead.',
      'INVOICE_LOCKED'
    );
  }

  const snapshot = toPlain(invoice);
  await invoice.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'Invoice',
    entityId: invoice._id,
    entityLabel: labelOf(invoice),
    before: snapshot,
    description: `Draft invoice ${labelOf(invoice)} deleted`,
  });

  return success(res, { message: 'Invoice deleted', data: { id: String(invoice._id) } });
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const issue = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req, req.params.id);
  await issueInvoice(req, invoice, req.body?.note || '');

  const full = await loadDoc(Invoice, invoice._id, { populate: POPULATE, label: 'Invoice' });
  return success(res, { message: 'Invoice issued', data: serialize(full) });
});

export const cancel = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req, req.params.id);
  const reason = req.body?.reason || '';

  if (invoice.status === INVOICE_STATUS.CANCELLED) {
    throw new ConflictError('Invoice is already cancelled', ErrorCodes.INVALID_STATUS_TRANSITION);
  }
  if (Number(invoice.amountPaid || 0) > 0) {
    throw new ConflictError(
      'Payments are recorded against this invoice; reverse them before cancelling.',
      'INVOICE_HAS_PAYMENTS'
    );
  }
  if (Number(invoice.creditNoteTotal || 0) > 0) {
    throw new ConflictError(
      'Credit notes are applied to this invoice; cancel them before cancelling the invoice.',
      'INVOICE_HAS_CREDIT_NOTES'
    );
  }

  const before = invoice.status;
  const wasIssued = before !== INVOICE_STATUS.DRAFT;

  if (wasIssued) {
    recalcInvoiceBalance(invoice);
    const remaining = Number(invoice.balanceDue || 0);
    if (remaining > 0) {
      await Customer.updateOne(
        { _id: invoice.customerId },
        { $inc: { outstanding: -remaining } }
      );
    }
    invoice.balanceDue = 0;
  }

  invoice.status = INVOICE_STATUS.CANCELLED;
  invoice.cancelledAt = new Date();
  invoice.cancelledBy = req.user.id;
  invoice.cancelReason = reason;
  pushHistory(invoice, INVOICE_STATUS.CANCELLED, req, reason || 'Invoice cancelled');
  await invoice.save();

  if (invoice.order) await syncOrderInvoicing(invoice.order);

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Invoice',
    entityId: invoice._id,
    entityLabel: labelOf(invoice),
    before: { status: before },
    after: { status: INVOICE_STATUS.CANCELLED },
    description: `Invoice ${labelOf(invoice)} cancelled${reason ? `: ${reason}` : ''}`,
  });

  const full = await loadDoc(Invoice, invoice._id, { populate: POPULATE, label: 'Invoice' });
  return success(res, { message: 'Invoice cancelled', data: serialize(full) });
});

// ---------------------------------------------------------------------------
// Form options
// ---------------------------------------------------------------------------

export const formOptions = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const orderId = refOrNull(req.query.orderId);
  const customerId = refOrNull(req.query.customerId);

  const [products, warehouses] = await Promise.all([
    Product.find({ isActive: true })
      .select('name sku category brand unit hsnCode gstRate mrp sellingPrice dealerPrice stock lowStockLevel isActive')
      .sort({ name: 1 })
      .limit(1000)
      .lean(),
    Warehouse.find({ isActive: true }).select('name code type isDefault').sort({ isDefault: -1, name: 1 }).lean(),
  ]);

  const idOf = (d) => ({ ...d, id: String(d._id), _id: undefined });

  const defaultWarehouse =
    warehouses.find((w) => String(w._id) === String(settings?.inventory?.defaultWarehouse)) ||
    warehouses.find((w) => w.isDefault) ||
    warehouses[0] ||
    null;

  // Invoiceable orders (remaining quantity > 0).
  const orders = await Order.find({ status: { $in: INVOICEABLE_ORDER_STATUSES } })
    .select('orderNo customerName customerId orderDate total status items invoicedQty')
    .sort({ orderDate: -1 })
    .limit(100)
    .lean();

  const orderIds = orders.map((o) => o._id);
  const billed = await Invoice.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(req.companyId),
        isDeleted: { $ne: true },
        order: { $in: orderIds },
        status: { $nin: ['DRAFT', 'CANCELLED'] },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: { order: '$order', line: '$items.orderItemId' },
        qty: { $sum: '$items.qty' },
      },
    },
  ]);

  const billedMap = new Map();
  billed.forEach((row) => {
    const key = `${row._id.order}:${row._id.line}`;
    billedMap.set(key, (billedMap.get(key) || 0) + Number(row.qty || 0));
  });

  const orderOptions = orders
    .map((order) => {
      const orderedQty = (order.items || []).reduce((s, i) => s + Number(i.qty || 0), 0);
      const invoicedQty = (order.items || []).reduce(
        (s, i) => s + (billedMap.get(`${order._id}:${i._id}`) || 0),
        0
      );
      return {
        id: String(order._id),
        orderNo: order.orderNo,
        customerId: String(order.customerId),
        customerName: order.customerName,
        orderDate: order.orderDate,
        total: Number(order.total || 0),
        status: order.status,
        orderedQty: Math.round(orderedQty * 100) / 100,
        invoicedQty: Math.round(invoicedQty * 100) / 100,
        remainingQty: Math.round((orderedQty - invoicedQty) * 100) / 100,
      };
    })
    .filter((o) => o.remainingQty > 0.0001);

  let order = null;
  let remaining = [];
  if (orderId) {
    const doc = await Order.findById(orderId);
    if (!doc) throw new BadRequestError('Order not found', 'INVALID_REFERENCE');
    const rows = await remainingOrderLines(doc);
    remaining = rows
      .filter((row) => row.remainingQty > 0.0001)
      .map((row) => ({
        orderItemId: String(row.orderItemId),
        product: String(row.product),
        name: row.line.name,
        sku: row.line.sku || '',
        unit: row.line.unit || 'PCS',
        hsnCode: row.line.hsnCode || '',
        qty: row.qty,
        remainingQty: row.remainingQty,
        unitPrice: Number(row.line.unitPrice || 0),
        discountPercent: Number(row.line.discountPercent || 0),
        taxRate: Number(row.line.taxRate || 0),
      }));

    order = {
      id: String(doc._id),
      orderNo: doc.orderNo,
      customerId: String(doc.customerId),
      customerName: doc.customerName,
      orderDate: doc.orderDate,
      status: doc.status,
      total: Number(doc.total || 0),
      paymentMode: doc.paymentMode,
      paymentTerms: doc.paymentTerms,
      creditDays: Number(doc.creditDays || 0),
      poReference: doc.poReference || '',
      salesman: doc.salesman ? String(doc.salesman) : null,
      route: doc.route ? String(doc.route) : null,
      warehouse: doc.warehouse ? String(doc.warehouse) : null,
      billingAddress: doc.billingAddress || {},
      shippingAddress: doc.shippingAddress || {},
      items: remaining,
    };
  }

  let customer = null;
  const resolvedCustomerId = customerId || order?.customerId;
  if (resolvedCustomerId) {
    const doc = await Customer.findById(resolvedCustomerId).lean();
    if (doc) {
      customer = {
        id: String(doc._id),
        name: doc.name,
        code: doc.code || '',
        phone: doc.phone || '',
        gstin: doc.gstin || '',
        type: doc.type,
        creditLimit: doc.creditLimit || 0,
        creditDays: doc.creditDays || 0,
        outstanding: doc.outstanding || 0,
        paymentTerms: doc.paymentTerms,
        address: doc.address || {},
        shippingAddress: doc.shippingAddress || {},
      };
    }
  }

  const priceList = customer ? await getPriceList(customer, null) : await PriceList.findOne({ isDefault: true }).lean();

  return success(res, {
    data: {
      order,
      orders: orderOptions,
      customer,
      products: products.map(idOf),
      warehouses: warehouses.map(idOf),
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
      defaults: {
        warehouse: defaultWarehouse ? String(defaultWarehouse._id) : null,
        paymentMode: settings?.order?.defaultPaymentMode || 'CREDIT',
        dueDays: Number(settings?.invoice?.defaultDueDays || 0),
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
        invoice: {
          rounding: settings?.invoice?.rounding || 'NEAREST',
          terms: settings?.invoice?.terms || '',
          footerNote: settings?.invoice?.footerNote || '',
          defaultDueDays: Number(settings?.invoice?.defaultDueDays || 0),
          allowDirectInvoice: settings?.invoice?.allowDirectInvoice !== false,
          showGstin: settings?.invoice?.showGstin !== false,
        },
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
  if (req.query.orderId) filter.order = req.query.orderId;
  if (req.query.overdue) filter.status = INVOICE_STATUS.OVERDUE;

  if (req.query.dateFrom || req.query.dateTo) {
    const range = {};
    if (req.query.dateFrom) range.$gte = new Date(req.query.dateFrom);
    if (req.query.dateTo) {
      const to = new Date(req.query.dateTo);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateTo))) to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
    filter.invoiceDate = { ...(filter.invoiceDate || {}), ...range };
  }
  return filter;
};

export const exportXlsx = asyncHandler(async (req, res) => {
  const invoices = await Invoice.find(buildExportFilter(req))
    .sort({ invoiceDate: -1 })
    .limit(5000)
    .populate('customerId', 'name code phone')
    .populate('order', 'orderNo')
    .lean();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ElevIQ SFA';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Invoices', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Invoice No', key: 'invoiceNo', width: 20 },
    { header: 'Invoice Date', key: 'invoiceDate', width: 14 },
    { header: 'Due Date', key: 'dueDate', width: 14 },
    { header: 'Customer', key: 'customer', width: 32 },
    { header: 'Customer Code', key: 'customerCode', width: 16 },
    { header: 'Order No', key: 'orderNo', width: 20 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Items', key: 'itemCount', width: 10 },
    { header: 'Subtotal', key: 'subtotal', width: 14 },
    { header: 'Discount', key: 'discountTotal', width: 14 },
    { header: 'Tax', key: 'taxTotal', width: 14 },
    { header: 'Total', key: 'total', width: 16 },
    { header: 'Paid', key: 'amountPaid', width: 14 },
    { header: 'Credit Notes', key: 'creditNoteTotal', width: 14 },
    { header: 'Balance', key: 'balanceDue', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };

  invoices.forEach((i) => {
    sheet.addRow({
      invoiceNo: i.invoiceNo,
      invoiceDate: i.invoiceDate ? dayjs(i.invoiceDate).format('YYYY-MM-DD') : '',
      dueDate: i.dueDate ? dayjs(i.dueDate).format('YYYY-MM-DD') : '',
      customer: i.customerId?.name || i.customerName || '',
      customerCode: i.customerCode || i.customerId?.code || '',
      orderNo: i.order?.orderNo || i.orderNo || '',
      status: i.status,
      itemCount: i.itemCount || 0,
      subtotal: Number(i.subtotal || 0),
      discountTotal: Number(i.discountTotal || 0),
      taxTotal: Number(i.taxTotal || 0),
      total: Number(i.total || 0),
      amountPaid: Number(i.amountPaid || 0),
      creditNoteTotal: Number(i.creditNoteTotal || 0),
      balanceDue: Number(i.balanceDue || 0),
    });
  });

  if (invoices.length) {
    sheet.addRow({});
    const totalRow = sheet.addRow({
      invoiceNo: `Total (${invoices.length} invoices)`,
      total: invoices.reduce((s, i) => s + Number(i.total || 0), 0),
      balanceDue: invoices.reduce((s, i) => s + Number(i.balanceDue || 0), 0),
    });
    totalRow.font = { bold: true };
  }

  const filename = `invoices-${dayjs().format('YYYY-MM-DD')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'Invoice',
    entityLabel: 'Invoice register',
    description: `Exported ${invoices.length} invoices to Excel`,
  });

  res.end();
});

const money2 = (n) => Number(n || 0).toFixed(2);

export const pdf = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req, req.params.id);
  const settings = await settingsOf(req);
  const company = req.company || {};
  const loc = await pdfLocale(settings, company);
  const customer = invoice.customerId || {};

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const filename = `invoice-${(invoice.invoiceNo || invoice._id)
    .toString()
    .replace(/[^a-z0-9-]/gi, '')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);

  const left = 40;
  const right = 555;

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

  doc.font('Helvetica-Bold').fontSize(14).text(loc.regime === 'NONE' ? 'INVOICE' : 'TAX INVOICE', right - 180, 40, { width: 180, align: 'right' });
  doc.font('Helvetica').fontSize(9);
  doc.text(`Invoice No: ${invoice.invoiceNo || '—'}`, right - 220, 62, { width: 220, align: 'right' });
  doc.text(
    `Date: ${invoice.invoiceDate ? dayjs(invoice.invoiceDate).format('DD MMM YYYY') : '—'}`,
    right - 220,
    75,
    { width: 220, align: 'right' }
  );
  doc.text(
    `Due: ${invoice.dueDate ? dayjs(invoice.dueDate).format('DD MMM YYYY') : '—'}`,
    right - 220,
    88,
    { width: 220, align: 'right' }
  );
  if (invoice.orderNo) {
    doc.text(`Order: ${invoice.orderNo}`, right - 220, 101, { width: 220, align: 'right' });
  }

  doc.moveTo(left, 118).lineTo(right, 118).strokeColor('#cbd5e1').stroke();

  doc.font('Helvetica-Bold').fontSize(9).text('BILL TO', left, 130);
  doc.font('Helvetica').fontSize(9);
  doc.text(invoice.customerName || customer.name || '—', left, 144, { width: 240 });
  const addr = invoice.billingAddress || {};
  const addrLines = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
  if (addrLines) doc.text(addrLines, left, 158, { width: 240 });
  if (invoice.customerPhone || customer.phone) {
    doc.text(`Phone: ${invoice.customerPhone || customer.phone}`, left, 172, { width: 240 });
  }
  if (invoice.customerGstin || customer.gstin) {
    doc.text(`${loc.taxIdLabel}: ${invoice.customerGstin || customer.gstin}`, left, 186, { width: 240 });
  }

  doc.font('Helvetica-Bold').fontSize(9).text('PAYMENT', 300, 130);
  doc.font('Helvetica').fontSize(9);
  doc.text(`Mode: ${invoice.paymentMode || '—'}`, 300, 144, { width: 255 });
  doc.text(`Terms: ${invoice.paymentTerms || '—'}`, 300, 157, { width: 255 });
  doc.text(`Status: ${invoice.status}`, 300, 170, { width: 255 });
  if (invoice.poReference) doc.text(`PO: ${invoice.poReference}`, 300, 183, { width: 255 });

  let y = 214;
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

  (invoice.items || []).forEach((item, index) => {
    if (y > 640) {
      doc.addPage();
      y = 50;
      headerRow();
    }
    doc.text(String(index + 1), cols[0].x, y, { width: cols[0].w });
    doc.text(item.name || '—', cols[1].x, y, { width: cols[1].w });
    doc.text(item.hsnCode || '—', cols[2].x, y, { width: cols[2].w });
    doc.text(String(item.qty), cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.text(money2(item.unitPrice), cols[4].x, y, { width: cols[4].w, align: 'right' });
    doc.text(`${Number(item.discountPercent || 0)}%`, cols[5].x, y, { width: cols[5].w, align: 'right' });
    doc.text(`${Number(item.taxRate || 0)}%`, cols[6].x, y, { width: cols[6].w, align: 'right' });
    doc.text(money2(item.lineTotal), cols[7].x, y, { width: cols[7].w, align: 'right' });
    y += 16;
  });

  y += 8;
  doc.moveTo(left, y).lineTo(right, y).strokeColor('#cbd5e1').stroke();
  y += 10;

  const totals = [
    ['Subtotal', invoice.subtotal],
    ['Discount', -Number(invoice.discountTotal || 0)],
    ['Taxable', invoice.taxableTotal],
    ...taxRows(invoice.taxTotal, invoice.taxBreakup, loc),
    ['Round off', invoice.roundOff],
    ['Total', invoice.total],
    ['Paid', -Number(invoice.amountPaid || 0)],
    ['Credit notes', -Number(invoice.creditNoteTotal || 0)],
  ];
  doc.fontSize(9);
  totals.forEach(([label, value]) => {
    doc.text(label, 380, y, { width: 90, align: 'right' });
    doc.text(money2(value), 475, y, { width: 80, align: 'right' });
    y += 14;
  });
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('Balance due', 360, y + 2, { width: 110, align: 'right' });
  doc.text(`${loc.money} ${money2(invoice.balanceDue)}`, 475, y + 2, {
    width: 80,
    align: 'right',
  });

  const footerY = Math.max(y + 36, 700);

  // UPI "scan to pay" QR for the open balance (India, when enabled in settings).
  const vpa = settings?.invoice?.upiVpa;
  if (settings?.invoice?.showQr !== false && vpa && loc.currency === 'INR' && Number(invoice.balanceDue) > 0) {
    try {
      const { default: QRCode } = await import('qrcode');
      const upi =
        `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(company.businessName || '')}` +
        `&am=${money2(invoice.balanceDue)}&cu=INR&tn=${encodeURIComponent(invoice.invoiceNo || '')}`;
      const png = await QRCode.toBuffer(upi, { margin: 1, width: 240 });
      doc.image(png, right - 80, footerY - 6, { width: 80 });
      doc.font('Helvetica').fontSize(7).fillColor('#555');
      doc.text(`Scan to pay (UPI) ${vpa}`, right - 110, footerY + 76, { width: 110, align: 'center' });
    } catch (err) {
      logger.warn(`UPI QR skipped for ${invoice.invoiceNo}: ${err.message}`);
    }
  }
  doc.font('Helvetica').fontSize(8).fillColor('#555');
  if (invoice.terms) doc.text(`Terms: ${invoice.terms}`, left, footerY, { width: 340 });
  if (invoice.notes) doc.text(`Notes: ${invoice.notes}`, left, footerY + 22, { width: 340 });
  if (invoice.footerNote) doc.text(invoice.footerNote, left, footerY + 44, { width: 340 });
  doc.text(`Generated by ElevIQ SFA on ${dayjs().format('DD MMM YYYY HH:mm')}`, left, 790, {
    width: 515,
    align: 'center',
  });

  doc.end();

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'Invoice',
    entityId: invoice._id,
    entityLabel: labelOf(invoice),
    description: `Printed invoice ${labelOf(invoice)}`,
  });
});

export default {
  list,
  stats,
  get,
  create,
  update,
  remove,
  issue,
  cancel,
  formOptions,
  exportXlsx,
  pdf,
};
