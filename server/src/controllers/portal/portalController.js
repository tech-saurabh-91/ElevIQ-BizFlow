import mongoose from 'mongoose';
import Order from '../../models/Order.js';
import Invoice from '../../models/Invoice.js';
import Product from '../../models/Product.js';
import StockBalance from '../../models/StockBalance.js';
import BalanceConfirmation from '../../models/BalanceConfirmation.js';
import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { escapeRegex } from '../../utils/query.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { ORDER_STATUS, INVOICE_STATUS } from '../../config/constants.js';
import { buildSaleLines, loadPricingContext, productFit, schemeSummary, bestRule } from '../../services/pricingService.js';
import { resolveLinePricing, nextOrderNumber, taxBreakupFor, sellerStateOf, buyerStateOf } from '../../services/orderService.js';
import { unitOptions } from '../../services/catalogService.js';
import { notifyUsers, notifyPermission } from '../../services/notifyService.js';
import { buildLedger } from '../../services/ledgerService.js';
import { getPriceList, snapshotFrom, normalizeItems } from '../company/orderController.js';
import { POPULATE as INVOICE_POPULATE, renderInvoicePdf } from '../company/invoiceController.js';
import * as ledgerCtrl from '../company/ledgerController.js';
import { portalSessionView } from '../../services/portalAuthService.js';
import { DEFAULT_TZ } from '../../services/fieldForceService.js';

/**
 * Customer portal: everything a signed-in customer can see and do.
 *
 * Every read is limited to req.portal.customerId (the tenant plugin already
 * limits it to the company). Prices are always worked out here from the
 * customer's price list, discount rules and schemes; the customer only sends
 * product, unit and quantity.
 */

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const pageOf = (q) => Math.max(1, Number(q.page) || 1);
const limitOf = (q, max = 50) => Math.min(max, Math.max(1, Number(q.limit) || 20));
const LOW = 'LOW';

const portalSettings = (req) => req.settings?.portal || {};

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

/** GET /portal/me - who is signed in, company, portal options, balance. */
export const me = asyncHandler(async (req, res) => {
  const data = portalSessionView({
    account: req.portalAccount,
    customer: req.customer,
    company: req.company,
    settings: req.settings,
  });
  if (portalSettings(req).showOutstanding !== false) {
    data.customer.outstanding = Math.round(Number(req.customer.outstanding || 0) * 100) / 100;
    data.customer.creditLimit = Number(req.customer.creditLimit || 0);
  }
  const lastOrder = await Order.findOne({ customerId: req.portal.customerId })
    .sort({ createdAt: -1 })
    .select('orderNo orderDate status total source items.isFree')
    .lean();
  data.lastOrder = lastOrder ? orderSummary(lastOrder) : null;
  return success(res, { data });
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** In stock / low / out, from available (on hand less reserved). Never a number. */
const stockStatusOf = (product, reserved) => {
  const available = Number(product.stock || 0) - Number(reserved || 0);
  if (available <= 0) return 'OUT';
  if (available <= Number(product.lowStockLevel || 0)) return LOW;
  return 'IN_STOCK';
};

/** GET /portal/catalog?search&category&page&limit */
export const catalog = asyncHandler(async (req, res) => {
  const page = pageOf(req.query);
  const limit = limitOf(req.query, 60);
  const filter = { isActive: true };
  if (req.query.category) filter.category = String(req.query.category);
  const search = String(req.query.search || '').trim();
  if (search) {
    // Every word must appear somewhere (name, code, brand, barcode).
    filter.$and = search
      .split(/\s+/)
      .slice(0, 6)
      .map((word) => {
        const rx = new RegExp(escapeRegex(word), 'i');
        return { $or: [{ name: rx }, { sku: rx }, { customCode: rx }, { brand: rx }, { barcode: rx }] };
      });
  }

  const [products, total, categories] = await Promise.all([
    Product.find(filter)
      .select('name sku customCode brand category image unit packUnits gstRate mrp sellingPrice stock lowStockLevel isActive description')
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
    page === 1 ? Product.distinct('category', { isActive: true }) : null,
  ]);

  const customer = req.customer;
  const priceList = await getPriceList(customer);
  const ctx = await loadPricingContext({ customer, date: new Date() });
  const names = new Map(products.map((p) => [String(p._id), p.name]));

  let reservedBy = new Map();
  const showStock = portalSettings(req).showStockStatus !== false;
  if (showStock && products.length) {
    const rows = await StockBalance.aggregate([
      { $match: { companyId: oid(req.companyId), isDeleted: { $ne: true }, product: { $in: products.map((p) => p._id) } } },
      { $group: { _id: '$product', reserved: { $sum: '$reservedQty' } } },
    ]);
    reservedBy = new Map(rows.map((r) => [String(r._id), r.reserved]));
  }

  const data = products.map((product) => {
    const units = unitOptions(product).map((u) => {
      const priced = resolveLinePricing(product, priceList, { qty: 1, unit: u.unit });
      return { unit: u.unit, factor: u.factor, price: priced.unitPrice, base: u.base };
    });
    const rule = bestRule(ctx.rules, customer, product);
    const offers = ctx.schemes
      .filter((s) => productFit(s, product) >= 0)
      .map((s) => ({ id: String(s._id), name: s.name, summary: schemeSummary(s, (id) => names.get(id) || 'item') }));
    if (rule) offers.unshift({ id: String(rule._id), name: rule.name, summary: `${rule.discountPercent}% off` });
    return {
      id: String(product._id),
      name: product.name,
      code: product.sku || product.customCode || '',
      brand: product.brand || '',
      category: product.category || '',
      image: product.image || '',
      description: product.description || '',
      mrp: Number(product.mrp || 0),
      taxRate: Number(product.gstRate || 0),
      unit: product.unit || 'PCS',
      price: units[0]?.price || 0,
      units,
      offers,
      stock: showStock ? stockStatusOf(product, reservedBy.get(String(product._id))) : null,
    };
  });

  return paginated(res, {
    data,
    page,
    limit,
    total,
    extra: {
      categories: categories ? categories.filter(Boolean).sort() : undefined,
      taxInclusive: Boolean(req.settings?.tax?.taxInclusive),
    },
  });
});

// ---------------------------------------------------------------------------
// Cart -> order request
// ---------------------------------------------------------------------------

/** Only product, unit, quantity and a note are taken from the customer. */
const cartItems = (items = []) =>
  normalizeItems(items.map((i) => ({ product: i.product, qty: i.qty, unit: i.unit, note: i.note }))).map((i) => ({
    product: i.product,
    qty: i.qty,
    unit: i.unit,
    note: i.note,
  }));

const priceCart = async (req, items) => {
  const customer = req.customer;
  const priceList = await getPriceList(customer);
  const priced = await buildSaleLines(cartItems(items), {
    priceList,
    settings: req.settings,
    customer,
    date: new Date(),
    canOverride: false,
    maxManualDiscount: 0,
    verb: 'ordered',
  });
  priced.taxBreakup = taxBreakupFor(priced.totals.taxTotal, req.settings, {
    sellerState: sellerStateOf(req.settings, req.company),
    buyerState: buyerStateOf(customer),
  });
  return { priced, priceList };
};

const linesView = (lines = []) =>
  lines.map((l) => ({
    product: String(l.product?._id || l.product),
    name: l.name,
    unit: l.unit,
    qty: l.qty,
    unitPrice: l.unitPrice,
    discountPercent: l.discountPercent,
    taxRate: l.taxRate,
    taxAmount: l.taxAmount,
    lineTotal: l.lineTotal,
    isFree: Boolean(l.isFree),
    schemeName: l.schemeName || '',
    note: l.note || '',
  }));

const totalsView = (t = {}) => ({
  subtotal: t.subtotal,
  discountTotal: t.discountTotal,
  taxableTotal: t.taxableTotal,
  taxTotal: t.taxTotal,
  roundOff: t.roundOff,
  total: t.total,
});

/** POST /portal/orders/preview - what the cart costs; nothing is saved. */
export const preview = asyncHandler(async (req, res) => {
  const { priced } = await priceCart(req, req.body.items);
  const min = Number(portalSettings(req).minOrderValue || 0);
  return success(res, {
    data: {
      items: linesView(priced.lines),
      totals: totalsView(priced.totals),
      offers: priced.applied,
      minOrderValue: min,
      belowMinimum: min > 0 && Number(priced.totals.total) < min,
    },
  });
});

/** POST /portal/orders - place an order request (REQUESTED: nothing reserved). */
export const placeOrder = asyncHandler(async (req, res) => {
  const { priced, priceList } = await priceCart(req, req.body.items);
  const min = Number(portalSettings(req).minOrderValue || 0);
  if (min > 0 && Number(priced.totals.total) < min) {
    throw new AppError(`The minimum order is ${min}. Please add more items.`, { status: 422, code: 'BELOW_MINIMUM_ORDER' });
  }

  const customer = req.customer;
  const snapshot = snapshotFrom(
    customer,
    { notes: String(req.body.note || '').slice(0, 500), poReference: String(req.body.reference || '').slice(0, 60) },
    req.settings,
    priceList,
    req
  );
  const order = new Order({
    ...snapshot,
    items: priced.lines,
    ...priced.totals,
    taxBreakup: priced.taxBreakup,
    status: ORDER_STATUS.REQUESTED,
    source: 'PORTAL',
    portalAccount: req.portal.accountId,
    requestedItems: priced.lines
      .filter((l) => !l.isFree)
      .map((l) => ({ product: l.product, name: l.name, unit: l.unit, qty: l.qty })),
    approvalRequired: false,
    statusHistory: [
      { status: ORDER_STATUS.REQUESTED, at: new Date(), by: null, byName: customer.name, note: 'Ordered online' },
    ],
  });
  order.orderNo = await nextOrderNumber(req.companyId, req.settings, order.orderDate);
  await order.save();

  const message = {
    type: 'PORTAL_ORDER',
    title: `New online order ${order.orderNo}`,
    body: `${customer.name} · ${Number(order.total || 0).toFixed(2)} · ${priced.lines.filter((l) => !l.isFree).length} products`,
    link: `/app/orders/${order._id}`,
    entityType: 'Order',
    entityId: order._id,
    priority: 'HIGH',
  };
  if (order.salesman) await notifyUsers([order.salesman], message);
  await notifyPermission(req.companyId, 'orders.approve', { ...message, exclude: order.salesman ? String(order.salesman) : null });

  return created(res, { message: 'Order sent', data: orderView(order.toObject()) });
});

// ---------------------------------------------------------------------------
// My orders
// ---------------------------------------------------------------------------

const orderSummary = (o) => ({
  id: String(o._id),
  orderNo: o.orderNo,
  orderDate: o.orderDate,
  status: o.status,
  total: o.total,
  lines: (o.items || []).filter((l) => !l.isFree).length,
  source: o.source,
});

/** What the customer may see of an order (no internal notes or staff ids). */
const orderView = (o) => {
  const view = {
    ...orderSummary(o),
    expectedDeliveryDate: o.expectedDeliveryDate,
    items: linesView(o.items),
    totals: totalsView(o),
    note: o.notes || '',
    reference: o.poReference || '',
    rejectionReason: o.rejectionReason || '',
    cancelReason: o.cancelReason || '',
    history: (o.statusHistory || []).map((h) => ({ status: h.status, at: h.at, note: h.note || '' })),
    canCancel: o.status === ORDER_STATUS.REQUESTED,
  };
  // What staff changed from what the customer asked for.
  if (o.requestedItems?.length) {
    const now = new Map(
      (o.items || []).filter((l) => !l.isFree).map((l) => [`${l.product?._id || l.product}|${l.unit}`, Number(l.qty)])
    );
    const asked = new Map(o.requestedItems.map((r) => [`${r.product}|${r.unit}`, r]));
    const changes = [];
    o.requestedItems.forEach((r) => {
      const key = `${r.product}|${r.unit}`;
      const qty = now.get(key);
      if (qty === undefined) changes.push({ name: r.name, unit: r.unit, asked: r.qty, now: 0 });
      else if (qty !== Number(r.qty)) changes.push({ name: r.name, unit: r.unit, asked: r.qty, now: qty });
    });
    (o.items || [])
      .filter((l) => !l.isFree && !asked.has(`${l.product?._id || l.product}|${l.unit}`))
      .forEach((l) => changes.push({ name: l.name, unit: l.unit, asked: 0, now: l.qty }));
    view.changes = changes;
  }
  return view;
};

const ownOrder = async (req, id, { lean = true } = {}) => {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError('Order not found');
  const query = Order.findOne({ _id: id, customerId: req.portal.customerId });
  const order = lean ? await query.lean() : await query;
  if (!order) throw new NotFoundError('Order not found');
  return order;
};

/** GET /portal/orders?status&page */
export const listOrders = asyncHandler(async (req, res) => {
  const page = pageOf(req.query);
  const limit = limitOf(req.query);
  const filter = { customerId: req.portal.customerId };
  if (req.query.status) filter.status = String(req.query.status);
  const [rows, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('orderNo orderDate status total source items.isFree')
      .lean(),
    Order.countDocuments(filter),
  ]);
  return paginated(res, { data: rows.map(orderSummary), page, limit, total });
});

/** GET /portal/orders/:id */
export const getOrder = asyncHandler(async (req, res) => {
  const order = await ownOrder(req, req.params.id);
  return success(res, { data: orderView(order) });
});

/** POST /portal/orders/:id/cancel - only while it is still a request. */
export const cancelOrder = asyncHandler(async (req, res) => {
  const order = await ownOrder(req, req.params.id, { lean: false });
  if (order.status !== ORDER_STATUS.REQUESTED) {
    throw new ConflictError(
      'This order is already being processed. Please contact the company to change it.',
      'ORDER_LOCKED'
    );
  }
  const reason = String(req.body?.reason || '').slice(0, 300);
  order.status = ORDER_STATUS.CANCELLED;
  order.cancelledAt = new Date();
  order.cancelReason = reason || 'Cancelled by the customer';
  order.statusHistory.push({
    status: ORDER_STATUS.CANCELLED,
    at: new Date(),
    by: null,
    byName: req.customer.name,
    note: order.cancelReason,
  });
  await order.save();
  if (order.salesman) {
    await notifyUsers([order.salesman], {
      type: 'PORTAL_ORDER',
      title: `Online order ${order.orderNo} cancelled by the customer`,
      body: `${req.customer.name}${reason ? ` · ${reason}` : ''}`,
      link: `/app/orders/${order._id}`,
      entityType: 'Order',
      entityId: order._id,
    });
  }
  return success(res, { message: 'Order cancelled', data: orderView(order.toObject()) });
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

const VISIBLE_INVOICE = { $nin: [INVOICE_STATUS.DRAFT] };

/** GET /portal/invoices?unpaid&page */
export const listInvoices = asyncHandler(async (req, res) => {
  const page = pageOf(req.query);
  const limit = limitOf(req.query);
  const filter = { customerId: req.portal.customerId, status: VISIBLE_INVOICE };
  if (String(req.query.unpaid) === 'true') filter.balanceDue = { $gt: 0.004 };
  const [rows, total] = await Promise.all([
    Invoice.find(filter)
      .sort({ invoiceDate: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('invoiceNo invoiceDate dueDate status total amountPaid balanceDue orderNos')
      .lean(),
    Invoice.countDocuments(filter),
  ]);
  const data = rows.map((i) => ({
    id: String(i._id),
    invoiceNo: i.invoiceNo,
    invoiceDate: i.invoiceDate,
    dueDate: i.dueDate,
    status: i.status,
    total: i.total,
    amountPaid: i.amountPaid,
    balanceDue: i.balanceDue,
    orderNos: i.orderNos || [],
  }));
  return paginated(res, { data, page, limit, total });
});

/** GET /portal/invoices/:id/pdf */
export const invoicePdf = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new NotFoundError('Invoice not found');
  let query = Invoice.findOne({ _id: req.params.id, customerId: req.portal.customerId, status: VISIBLE_INVOICE });
  INVOICE_POPULATE.forEach((p) => {
    query = query.populate(p);
  });
  const invoice = await query;
  if (!invoice) throw new NotFoundError('Invoice not found');
  await renderInvoicePdf(req, res, invoice, { copyLabel: 'CUSTOMER COPY', watermark: '', printedBy: '' });
});

// ---------------------------------------------------------------------------
// Statement of account
// ---------------------------------------------------------------------------

const assertStatementOn = (req) => {
  if (portalSettings(req).showOutstanding === false) {
    throw new ForbiddenError('Statements are not available online. Please ask the company.', 'STATEMENT_OFF');
  }
};

/** The ledger handlers read the party from params: point them at this customer. */
const asOwnLedger = (req) => {
  req.params.kind = 'customer';
  req.params.id = req.portal.customerId;
};

/** GET /portal/statement?from&to */
export const statement = asyncHandler(async (req, res) => {
  assertStatementOn(req);
  const ledger = await buildLedger({
    kind: 'customer',
    partyId: req.portal.customerId,
    companyId: req.companyId,
    from: req.query.from,
    to: req.query.to,
    tz: req.company?.timezone || req.settings?.timezone || DEFAULT_TZ,
    startMonth: Number(req.company?.financialYearStartMonth || req.settings?.financialYearStartMonth || 4),
  });
  const latest = await BalanceConfirmation.findOne({ customer: req.portal.customerId }).sort({ createdAt: -1 }).lean();
  return success(res, {
    data: {
      ...ledger,
      confirmation: latest ? { status: latest.status, asOf: latest.asOf, balance: latest.balance, note: latest.note, at: latest.createdAt } : null,
    },
  });
});

/** GET /portal/statement/pdf?from&to */
export const statementPdf = (req, res, next) => {
  try {
    assertStatementOn(req);
  } catch (err) {
    return next(err);
  }
  asOwnLedger(req);
  return ledgerCtrl.pdf(req, res, next);
};

/** POST /portal/statement/confirm { status, note, asOf } - the customer's answer on its balance. */
export const confirmBalance = asyncHandler(async (req, res) => {
  assertStatementOn(req);
  const to = req.body.asOf || undefined;
  const ledger = await buildLedger({
    kind: 'customer',
    partyId: req.portal.customerId,
    companyId: req.companyId,
    to,
    tz: req.company?.timezone || req.settings?.timezone || DEFAULT_TZ,
    startMonth: Number(req.company?.financialYearStartMonth || req.settings?.financialYearStartMonth || 4),
  });
  const doc = await BalanceConfirmation.create({
    customer: req.portal.customerId,
    account: req.portal.accountId,
    asOf: new Date(ledger.period.to),
    balance: ledger.closing,
    status: req.body.status,
    note: String(req.body.note || '').slice(0, 500),
  });
  if (req.body.status === 'DISPUTED') {
    await notifyPermission(req.companyId, 'customers.statement', {
      type: 'SYSTEM',
      title: `${req.customer.name} does not agree with their balance`,
      body: String(req.body.note || '').slice(0, 300),
      link: `/app/ledger/customer/${req.portal.customerId}`,
      entityType: 'Customer',
      entityId: req.portal.customerId,
      priority: 'HIGH',
    });
  }
  return created(res, {
    message: req.body.status === 'CONFIRMED' ? 'Thank you for confirming' : 'Sent to the company',
    data: { status: doc.status, asOf: doc.asOf, balance: doc.balance, note: doc.note, at: doc.createdAt },
  });
});

export default {
  me,
  catalog,
  preview,
  placeOrder,
  listOrders,
  getOrder,
  cancelOrder,
  listInvoices,
  invoicePdf,
  statement,
  statementPdf,
  confirmBalance,
};
