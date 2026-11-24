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
import { resolveLinePricing, nextOrderNumber, taxBreakupFor, sellerStateOf, buyerStateOf, submittedStatus } from '../../services/orderService.js';
import { reserveStock } from '../../services/inventoryService.js';
import { baseQtyOf } from '../../services/catalogService.js';
import PaymentClaim from '../../models/PaymentClaim.js';
import ReturnRequest from '../../models/ReturnRequest.js';
import PortalNotification from '../../models/PortalNotification.js';
import { nextSeries } from '../../utils/numberSeries.js';
import { unitOptions } from '../../services/catalogService.js';
import { notifyUsers, notifyPermission } from '../../services/notifyService.js';
import { buildLedger } from '../../services/ledgerService.js';
import { getPriceList, snapshotFrom, normalizeItems, syncCustomerCounters } from '../company/orderController.js';
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
  data.unread = await PortalNotification.countDocuments({ customer: req.portal.customerId, readAt: null });
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

  // Trusted customer: confirmed at once when stock, credit and approval allow.
  const auto = await autoConfirmCheck(req, priced, order.total);
  if (auto.ok) {
    order.status = ORDER_STATUS.CONFIRMED;
    order.statusHistory.push({
      status: ORDER_STATUS.CONFIRMED,
      at: new Date(),
      by: null,
      byName: 'System',
      note: 'Confirmed automatically (trusted customer)',
    });
  }
  await order.save();
  if (auto.ok) {
    await syncCustomerCounters(order, 1);
    await order.save();
    await reserveStock(order.items, { warehouseId: order.warehouse || null, settings: req.settings });
  }

  const message = {
    type: 'PORTAL_ORDER',
    title: auto.ok ? `Online order ${order.orderNo} confirmed automatically` : `New online order ${order.orderNo}`,
    body: `${customer.name} · ${Number(order.total || 0).toFixed(2)} · ${priced.lines.filter((l) => !l.isFree).length} products`,
    link: `/app/orders/${order._id}`,
    entityType: 'Order',
    entityId: order._id,
    priority: 'HIGH',
  };
  if (order.salesman) await notifyUsers([order.salesman], message);
  await notifyPermission(req.companyId, 'orders.approve', { ...message, exclude: order.salesman ? String(order.salesman) : null });

  return created(res, {
    message: auto.ok ? 'Order confirmed' : 'Order sent',
    data: orderView(order.toObject()),
  });
});

/**
 * Can this order be confirmed without a person looking at it? Only for a
 * customer staff marked trusted, with the company setting on, and when:
 * every product is available (on hand less reserved), the credit limit is not
 * crossed and the order is below the approval limit.
 */
const autoConfirmCheck = async (req, priced, total) => {
  if (!portalSettings(req).autoConfirm || !req.customer.portalAutoConfirm) return { ok: false };
  if (submittedStatus(total, req.settings) !== ORDER_STATUS.CONFIRMED) return { ok: false, why: 'approval' };
  const limit = Number(req.customer.creditLimit || 0);
  if (limit > 0 && Number(req.customer.outstanding || 0) + Number(total || 0) > limit) return { ok: false, why: 'credit' };

  const wanted = new Map();
  priced.lines.forEach((l) => {
    const key = String(l.product);
    wanted.set(key, (wanted.get(key) || 0) + baseQtyOf(l));
  });
  const ids = [...wanted.keys()].map(oid);
  const [products, reserved] = await Promise.all([
    Product.find({ _id: { $in: ids } }).select('stock').lean(),
    StockBalance.aggregate([
      { $match: { companyId: oid(req.companyId), isDeleted: { $ne: true }, product: { $in: ids } } },
      { $group: { _id: '$product', reserved: { $sum: '$reservedQty' } } },
    ]),
  ]);
  const held = new Map(reserved.map((r) => [String(r._id), r.reserved]));
  const enough = products.length === ids.length &&
    products.every((p) => Number(p.stock || 0) - Number(held.get(String(p._id)) || 0) >= wanted.get(String(p._id)));
  return enough ? { ok: true } : { ok: false, why: 'stock' };
};

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

// ---------------------------------------------------------------------------
// "I have paid" claims
// ---------------------------------------------------------------------------
const claimView = (c) => ({
  id: String(c._id),
  amount: c.amount,
  paidOn: c.paidOn,
  mode: c.mode,
  reference: c.reference,
  note: c.note,
  proof: c.proof,
  status: c.status,
  rejectReason: c.rejectReason || '',
  createdAt: c.createdAt,
  reviewedAt: c.reviewedAt,
});

const assertFeature = (req, key, label) => {
  if (portalSettings(req)[key] === false) throw new ForbiddenError(`${label} is not available online. Please contact the company.`, 'FEATURE_OFF');
};

/** GET /portal/payments - the customer's payment claims. */
export const listClaims = asyncHandler(async (req, res) => {
  const rows = await PaymentClaim.find({ customer: req.portal.customerId }).sort({ createdAt: -1 }).limit(50).lean();
  return success(res, { data: rows.map(claimView) });
});

/** POST /portal/payments (multipart: proof) - "I have paid". */
export const createClaim = asyncHandler(async (req, res) => {
  assertFeature(req, 'paymentClaims', 'Telling us about payments');
  const invoiceIds = req.body.invoices || [];
  if (invoiceIds.length) {
    const own = await Invoice.countDocuments({ _id: { $in: invoiceIds }, customerId: req.portal.customerId });
    if (own !== invoiceIds.length) throw new NotFoundError('Invoice not found');
  }
  const claim = await PaymentClaim.create({
    customer: req.portal.customerId,
    customerName: req.customer.name,
    account: req.portal.accountId,
    amount: Math.round(Number(req.body.amount) * 100) / 100,
    paidOn: new Date(req.body.paidOn),
    mode: req.body.mode,
    reference: req.body.reference,
    note: req.body.note,
    proof: req.file ? `/uploads/claims/${req.file.filename}` : '',
    invoices: invoiceIds,
  });
  await notifyPermission(req.companyId, 'payments.claims', {
    type: 'PAYMENT_CLAIM',
    title: `${req.customer.name} says they paid ${claim.amount.toFixed(2)}`,
    body: `${claim.mode.replace('_', ' ')}${claim.reference ? ` · ref ${claim.reference}` : ''} · check the bank and record it`,
    link: '/app/payment-claims',
    entityType: 'PaymentClaim',
    entityId: claim._id,
    priority: 'HIGH',
  });
  return created(res, { message: 'Sent. The company will check and record it.', data: claimView(claim) });
});

// ---------------------------------------------------------------------------
// Returns & complaints
// ---------------------------------------------------------------------------
const returnView = (r) => ({
  id: String(r._id),
  requestNo: r.requestNo,
  kind: r.kind,
  reason: r.reason,
  invoiceNo: r.invoiceNo,
  items: r.items,
  note: r.note,
  photos: r.photos,
  status: r.status,
  staffNote: r.staffNote,
  history: r.history,
  createdAt: r.createdAt,
});

/** GET /portal/returns */
export const listReturns = asyncHandler(async (req, res) => {
  const rows = await ReturnRequest.find({ customer: req.portal.customerId }).sort({ createdAt: -1 }).limit(50).lean();
  return success(res, { data: rows.map(returnView) });
});

/** GET /portal/invoices/:id - lines of one own invoice (to pick what to return). */
export const getInvoice = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new NotFoundError('Invoice not found');
  const inv = await Invoice.findOne({ _id: req.params.id, customerId: req.portal.customerId, status: VISIBLE_INVOICE }).lean();
  if (!inv) throw new NotFoundError('Invoice not found');
  return success(res, {
    data: {
      id: String(inv._id),
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate,
      total: inv.total,
      balanceDue: inv.balanceDue,
      status: inv.status,
      items: (inv.items || []).map((l) => ({
        product: String(l.product),
        name: l.name,
        unit: l.unit,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        isFree: Boolean(l.isFree),
      })),
    },
  });
});

/** POST /portal/returns (multipart: photos[]) */
export const createReturn = asyncHandler(async (req, res) => {
  assertFeature(req, 'returns', 'Returns and complaints');
  let invoice = null;
  if (req.body.invoice) {
    invoice = await Invoice.findOne({ _id: req.body.invoice, customerId: req.portal.customerId, status: VISIBLE_INVOICE }).lean();
    if (!invoice) throw new NotFoundError('Invoice not found');
  }
  const items = req.body.items || [];
  if (req.body.kind === 'RETURN' && !items.length) {
    throw new AppError('Choose the products and quantities to return', { status: 422, code: 'VALIDATION_ERROR' });
  }
  // Lines are named from the invoice (or the catalogue); never more than billed.
  const billed = new Map((invoice?.items || []).filter((l) => !l.isFree).map((l) => [`${l.product}|${l.unit}`, l]));
  const products = new Map(
    (await Product.find({ _id: { $in: items.map((i) => i.product) } }).select('name unit').lean()).map((p) => [String(p._id), p])
  );
  const lines = items.map((i) => {
    const product = products.get(String(i.product));
    if (!product) throw new NotFoundError('Product not found');
    const unit = i.unit || product.unit;
    const line = billed.get(`${i.product}|${unit}`);
    if (invoice && !line) throw new AppError(`${product.name} is not on invoice ${invoice.invoiceNo}`, { status: 422, code: 'VALIDATION_ERROR' });
    if (line && Number(i.qty) > Number(line.qty)) {
      throw new AppError(`${product.name}: at most ${line.qty} ${unit} was billed`, { status: 422, code: 'VALIDATION_ERROR' });
    }
    return { product: product._id, name: product.name, unit, qty: Number(i.qty) };
  });

  const request = new ReturnRequest({
    customer: req.portal.customerId,
    customerName: req.customer.name,
    account: req.portal.accountId,
    kind: req.body.kind,
    reason: req.body.reason,
    invoice: invoice?._id || null,
    invoiceNo: invoice?.invoiceNo || '',
    items: lines,
    note: req.body.note,
    photos: (req.files || []).map((f) => `/uploads/returns/${f.filename}`),
    history: [{ status: 'OPEN', at: new Date(), byName: req.customer.name, note: 'Raised online' }],
  });
  request.requestNo = await nextSeries(req.companyId, 'RETURN_REQUEST', { prefix: 'RR', pad: 5 });
  await request.save();
  await notifyPermission(req.companyId, 'returns.manage', {
    type: 'RETURN_REQUEST',
    title: `${req.body.kind === 'RETURN' ? 'Return' : 'Complaint'} ${request.requestNo} from ${req.customer.name}`,
    body: `${req.body.reason.replace('_', ' ').toLowerCase()}${invoice ? ` · invoice ${invoice.invoiceNo}` : ''}`,
    link: '/app/returns',
    entityType: 'ReturnRequest',
    entityId: request._id,
    priority: 'HIGH',
  });
  if (req.customer.assignedTo) {
    await notifyUsers([req.customer.assignedTo], {
      type: 'RETURN_REQUEST',
      title: `${req.customer.name} raised ${request.requestNo}`,
      body: req.body.note ? String(req.body.note).slice(0, 200) : '',
      link: '/app/returns',
      entityType: 'ReturnRequest',
      entityId: request._id,
    });
  }
  return created(res, { message: 'Sent to the company', data: returnView(request.toObject()) });
});

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
/** GET /portal/notifications */
export const listNotifications = asyncHandler(async (req, res) => {
  const rows = await PortalNotification.find({ customer: req.portal.customerId }).sort({ createdAt: -1 }).limit(50).lean();
  return success(res, {
    data: rows.map((n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, link: n.link, read: Boolean(n.readAt), at: n.createdAt })),
  });
});

/** POST /portal/notifications/read */
export const readNotifications = asyncHandler(async (req, res) => {
  await PortalNotification.updateMany({ customer: req.portal.customerId, readAt: null }, { $set: { readAt: new Date() } });
  return success(res, { message: 'OK' });
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
