import mongoose from 'mongoose';
import dayjs from 'dayjs';

import GoodsReceipt from '../../models/GoodsReceipt.js';
import PurchaseOrder from '../../models/PurchaseOrder.js';
import PurchaseBill from '../../models/PurchaseBill.js';
import SupplierPayment from '../../models/SupplierPayment.js';
import PurchaseReturn from '../../models/PurchaseReturn.js';
import Supplier from '../../models/Supplier.js';
import Product from '../../models/Product.js';
import Setting from '../../models/Setting.js';

import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, BILL_STATUS, GRN_STATUS, MOVEMENT_TYPES, SUPPLIER_DOC_STATUS } from '../../config/constants.js';
import { BadRequestError, ConflictError } from '../../utils/errors.js';
import { toPlain, loadDoc, dateOrNull } from './_helpers.js';
import { taxBreakupFor, sellerStateOf } from '../../services/orderService.js';
import { recordMovement, assertWarehouseStock } from '../../services/inventoryService.js';
import { nextSeries, getFinancialYearTag } from '../../utils/numberSeries.js';
import { companyToday, tzOf } from '../../utils/companyTime.js';

/**
 * Accounts payable: supplier bills, supplier payments and purchase returns.
 *
 * Quantities are tracked per GRN line:
 *   billable   = accepted - billed - returned before billing
 *   returnable = accepted - returned
 * A bill takes the GRN rate (stock was costed at it), so the bill and the
 * stock value always agree. What we owe a supplier (Supplier.outstanding)
 * moves with every posted / cancelled bill, payment and billed return.
 */

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const EPS = 0.0001;
const LIVE_BILL = [BILL_STATUS.POSTED, BILL_STATUS.PARTIALLY_PAID, BILL_STATUS.PAID];

const settingsOf = async (req) => req.settings || (await Setting.forCompany(req.companyId));
const companyState = (settings, company) => sellerStateOf(settings, company); // the buyer, on a purchase

const numberFor = async (req, settings, key, seriesKey, fallback, date) => {
  const cfg = settings?.series?.[key] || {};
  const fy = getFinancialYearTag(date || new Date(), Number(settings?.financialYearStartMonth || 4));
  return nextSeries(req.companyId, seriesKey, { prefix: cfg.prefix || fallback, pad: Number(cfg.pad || 6), fy });
};

const loadSupplier = async (id) => {
  const supplier = await Supplier.findById(id);
  if (!supplier) throw new BadRequestError('Supplier not found', 'INVALID_REFERENCE');
  return supplier;
};

const bumpOutstanding = (supplierId, delta) =>
  Supplier.updateOne({ _id: supplierId }, { $inc: { outstanding: r2(delta) } });

/** Line amounts excl. tax -> taxable, tax and total. */
const lineAmounts = (qty, unitPrice, taxRate, regime) => {
  const taxable = r2(Number(qty) * Number(unitPrice));
  const rate = regime === 'NONE' ? 0 : Number(taxRate || 0);
  const tax = r2((taxable * rate) / 100);
  return { taxableAmount: taxable, taxAmount: tax, lineTotal: r2(taxable + tax), taxRate: rate };
};

// ---------------------------------------------------------------------------
// GRN line quantities
// ---------------------------------------------------------------------------

/**
 * For the given posted GRNs: each line with accepted, billed, returned (split
 * into returned-before-billing and returned-from-a-bill), billable and
 * returnable quantities, plus the bill(s) it is on.
 */
const grnLines = async (grns, { excludeReturn = null } = {}) => {
  const itemIds = grns.flatMap((g) => g.items.map((i) => i._id));
  const [bills, returns] = await Promise.all([
    PurchaseBill.find({ status: { $in: LIVE_BILL }, 'items.grnItemId': { $in: itemIds } })
      .select('billNo items.grnItemId items.qty items.taxRate')
      .lean(),
    PurchaseReturn.find({
      status: SUPPLIER_DOC_STATUS.POSTED,
      'items.grnItemId': { $in: itemIds },
      ...(excludeReturn ? { _id: { $ne: excludeReturn } } : {}),
    })
      .select('items.grnItemId items.qty items.bill')
      .lean(),
  ]);
  const billed = new Map();
  const onBills = new Map(); // grnItemId -> [{ bill, billNo, qty, taxRate }]
  bills.forEach((b) =>
    b.items.forEach((i) => {
      const k = String(i.grnItemId);
      billed.set(k, (billed.get(k) || 0) + Number(i.qty));
      onBills.set(k, [...(onBills.get(k) || []), { bill: b._id, billNo: b.billNo, qty: Number(i.qty), taxRate: i.taxRate }]);
    })
  );
  const retUnbilled = new Map();
  const retBilled = new Map(); // `${grnItemId}:${bill}` -> qty
  returns.forEach((ret) =>
    ret.items.forEach((i) => {
      const k = String(i.grnItemId);
      if (i.bill) retBilled.set(`${k}:${i.bill}`, (retBilled.get(`${k}:${i.bill}`) || 0) + Number(i.qty));
      else retUnbilled.set(k, (retUnbilled.get(k) || 0) + Number(i.qty));
    })
  );

  const out = [];
  grns.forEach((g) =>
    g.items.forEach((item) => {
      const k = String(item._id);
      const accepted = Number(item.acceptedQty || 0);
      const b = billed.get(k) || 0;
      const ru = retUnbilled.get(k) || 0;
      const billsHere = (onBills.get(k) || []).map((x) => ({ ...x, returned: retBilled.get(`${k}:${x.bill}`) || 0 }));
      const rb = billsHere.reduce((s, x) => s + x.returned, 0);
      out.push({
        grn: g,
        item,
        key: k,
        accepted,
        billed: b,
        billable: r2(accepted - b - ru),
        returnable: r2(accepted - ru - rb),
        unbilledLeft: r2(accepted - b - ru),
        billsHere,
      });
    })
  );
  return out;
};

const loadPostedGrns = async (filter) =>
  GoodsReceipt.find({ ...filter, status: GRN_STATUS.POSTED })
    .select('grnNo grnDate supplierId supplierName purchaseOrder poNo warehouse warehouseName invoiceNo items')
    .sort({ grnDate: 1 })
    .lean();

/** Tax rate of a GRN line: its PO line's rate, else the product's GST rate. */
const taxRatesFor = async (grns) => {
  const poIds = [...new Set(grns.map((g) => g.purchaseOrder).filter(Boolean).map(String))];
  const productIds = [...new Set(grns.flatMap((g) => g.items.map((i) => String(i.product))))];
  const [pos, products] = await Promise.all([
    poIds.length ? PurchaseOrder.find({ _id: { $in: poIds } }).select('items.product items.taxRate').lean() : [],
    Product.find({ _id: { $in: productIds } }).select('gstRate hsnCode').lean(),
  ]);
  const poRate = new Map();
  pos.forEach((po) => po.items.forEach((i) => poRate.set(`${po._id}:${i.product}`, Number(i.taxRate || 0))));
  const product = new Map(products.map((p) => [String(p._id), p]));
  return {
    rateOf: (grn, item) => poRate.get(`${grn.purchaseOrder}:${item.product}`) ?? Number(product.get(String(item.product))?.gstRate || 0),
    hsnOf: (item) => product.get(String(item.product))?.hsnCode || '',
  };
};

const shapeLine = (row, rateOf) => ({
  grn: String(row.grn._id),
  grnNo: row.grn.grnNo,
  grnItemId: row.key,
  product: String(row.item.product),
  name: row.item.name,
  sku: row.item.sku,
  unit: row.item.unit,
  unitFactor: Number(row.item.unitFactor || 1),
  unitPrice: Number(row.item.unitCost || 0),
  taxRate: rateOf(row.grn, row.item),
  accepted: row.accepted,
  billable: row.billable,
  returnable: row.returnable,
});

// ===========================================================================
// Supplier bills
// ===========================================================================

const BILL_SEARCH = ['billNo', 'supplierName', 'supplierInvoiceNo', 'grnNos'];

export const listBills = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.overdue === 'true') {
    filter.status = { $in: [BILL_STATUS.POSTED, BILL_STATUS.PARTIALLY_PAID] };
    filter.dueDate = { $lt: companyToday(tzOf(req)).today };
  }
  const result = await listDocuments(PurchaseBill, {
    filter,
    query: req.query,
    searchFields: BILL_SEARCH,
    filtersSpec: { status: { type: 'string' }, supplierId: { type: 'objectId' } },
    sortAllowed: ['billDate', 'dueDate', 'total', 'balanceDue', 'createdAt'],
    defaultSort: '-billDate',
    dateField: 'billDate',
  });
  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const getBill = asyncHandler(async (req, res) => {
  const doc = await loadDoc(PurchaseBill, req.params.id, { label: 'Bill' });
  const [payments, returns] = await Promise.all([
    SupplierPayment.find({ 'allocations.bill': doc._id, status: SUPPLIER_DOC_STATUS.POSTED })
      .select('paymentNo paymentDate mode reference allocations')
      .lean(),
    PurchaseReturn.find({ 'items.bill': doc._id, status: SUPPLIER_DOC_STATUS.POSTED }).select('returnNo returnDate total items.bill items.lineTotal').lean(),
  ]);
  const data = toPlain(doc);
  data.payments = payments.map((p) => ({
    id: String(p._id),
    paymentNo: p.paymentNo,
    paymentDate: p.paymentDate,
    mode: p.mode,
    reference: p.reference,
    amount: r2(p.allocations.filter((a) => String(a.bill) === String(doc._id)).reduce((s, a) => s + a.amount, 0)),
  }));
  data.returns = returns.map((x) => ({
    id: String(x._id),
    returnNo: x.returnNo,
    returnDate: x.returnDate,
    amount: r2(x.items.filter((i) => String(i.bill) === String(doc._id)).reduce((s, i) => s + i.lineTotal, 0)),
  }));
  return success(res, { data });
});

/** GET /purchase-bills/form-options?supplierId= - posted GRNs with quantity left to bill. */
export const billFormOptions = asyncHandler(async (req, res) => {
  if (!req.query.supplierId) return success(res, { data: { grns: [] } });
  const supplier = await loadSupplier(req.query.supplierId);
  const grns = await loadPostedGrns({ supplierId: supplier._id });
  const rows = await grnLines(grns);
  const { rateOf } = await taxRatesFor(grns);
  const byGrn = new Map();
  rows
    .filter((r) => r.billable > EPS)
    .forEach((r) => {
      const k = String(r.grn._id);
      if (!byGrn.has(k)) {
        byGrn.set(k, { id: k, grnNo: r.grn.grnNo, grnDate: r.grn.grnDate, poNo: r.grn.poNo, invoiceNo: r.grn.invoiceNo, warehouseName: r.grn.warehouseName, lines: [] });
      }
      byGrn.get(k).lines.push(shapeLine(r, rateOf));
    });
  return success(res, {
    data: {
      supplier: { id: String(supplier._id), name: supplier.name, gstin: supplier.gstin, creditDays: supplier.creditDays, outstanding: supplier.outstanding },
      grns: [...byGrn.values()],
    },
  });
});

/**
 * POST /purchase-bills - book a supplier's bill for goods on posted GRNs.
 * body: { supplierId, supplierInvoiceNo, supplierInvoiceDate, grnIds[],
 *         items?: [{ grnItemId, qty?, taxRate? }], otherCharges?, notes? }
 * Without `items`, every unbilled quantity on the chosen GRNs is billed.
 */
export const createBill = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const body = req.body;
  const supplier = await loadSupplier(body.supplierId);

  const dup = await PurchaseBill.exists({
    supplierId: supplier._id,
    supplierInvoiceNo: body.supplierInvoiceNo.trim(),
    status: { $in: LIVE_BILL },
  });
  if (dup) throw new ConflictError(`Supplier invoice ${body.supplierInvoiceNo} is already booked for ${supplier.name}`, 'DUPLICATE_BILL');

  const grns = await loadPostedGrns({ _id: { $in: body.grnIds }, supplierId: supplier._id });
  if (grns.length !== new Set(body.grnIds.map(String)).size) {
    throw new BadRequestError('Pick posted goods receipts of this supplier', 'INVALID_REFERENCE');
  }
  const rows = await grnLines(grns);
  const { rateOf, hsnOf } = await taxRatesFor(grns);
  const wanted = body.items?.length ? new Map(body.items.map((i) => [String(i.grnItemId), i])) : null;

  const regime = settings?.tax?.regime;
  const items = [];
  for (const row of rows) {
    const pick = wanted ? wanted.get(row.key) : { qty: row.billable };
    if (!pick || row.billable <= EPS) continue;
    const qty = r2(pick.qty ?? row.billable);
    if (qty <= EPS) continue;
    if (qty > row.billable + EPS) {
      throw new BadRequestError(`${row.item.name} (${row.grn.grnNo}): only ${row.billable} ${row.item.unit} left to bill`, 'VALIDATION_ERROR');
    }
    const unitPrice = Number(row.item.unitCost || 0);
    items.push({
      grn: row.grn._id,
      grnNo: row.grn.grnNo,
      grnItemId: row.item._id,
      product: row.item.product,
      name: row.item.name,
      sku: row.item.sku,
      hsnCode: hsnOf(row.item),
      unit: row.item.unit,
      unitFactor: Number(row.item.unitFactor || 1),
      qty,
      unitPrice,
      ...lineAmounts(qty, unitPrice, pick.taxRate ?? rateOf(row.grn, row.item), regime),
    });
  }
  if (!items.length) throw new BadRequestError('Nothing left to bill on the chosen goods receipts', 'VALIDATION_ERROR');

  const taxableTotal = r2(items.reduce((s, i) => s + i.taxableAmount, 0));
  const taxTotal = r2(items.reduce((s, i) => s + i.taxAmount, 0));
  const otherCharges = r2(body.otherCharges || 0);
  const raw = r2(taxableTotal + taxTotal + otherCharges);
  const mode = settings?.invoice?.rounding || 'NEAREST';
  const rounded = mode === 'NONE' ? raw : mode === 'DOWN' ? Math.floor(raw) : Math.round(raw);
  const invoiceDate = dateOrNull(body.supplierInvoiceDate) || new Date();

  const doc = new PurchaseBill({
    billNo: await numberFor(req, settings, 'bill', 'BILL', 'PB', invoiceDate),
    billDate: new Date(),
    supplierId: supplier._id,
    supplierName: supplier.name,
    supplierGstin: supplier.gstin || '',
    supplierState: supplier.address?.state || '',
    supplierInvoiceNo: body.supplierInvoiceNo.trim(),
    supplierInvoiceDate: invoiceDate,
    dueDate: dayjs(invoiceDate).add(Number(supplier.creditDays || 0), 'day').toDate(),
    grns: grns.map((g) => g._id),
    grnNos: grns.map((g) => g.grnNo),
    items,
    subtotal: taxableTotal,
    taxableTotal,
    taxTotal,
    // Input tax: the supplier is the seller, we are the buyer.
    taxBreakup: taxBreakupFor(taxTotal, settings, { sellerState: supplier.address?.state, buyerState: companyState(settings, req.company) }),
    otherCharges,
    roundOff: r2(rounded - raw),
    total: r2(rounded),
    notes: body.notes || '',
  });
  doc.refreshBalance();
  await doc.save();
  await bumpOutstanding(supplier._id, doc.total);
  await Supplier.updateOne({ _id: supplier._id }, { $set: { lastPurchaseAt: new Date() } });

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'PurchaseBill',
    entityId: doc._id,
    entityLabel: doc.billNo,
    description: `Bill ${doc.billNo} (${supplier.name} invoice ${doc.supplierInvoiceNo}) booked for ${doc.total}`,
  });
  return created(res, { message: 'Bill booked', data: toPlain(doc) });
});

export const cancelBill = asyncHandler(async (req, res) => {
  const doc = await loadDoc(PurchaseBill, req.params.id, { label: 'Bill' });
  if (doc.status === BILL_STATUS.CANCELLED) throw new ConflictError('Bill is already cancelled', 'BILL_CANCELLED');
  if (Number(doc.amountPaid) > 0) {
    throw new ConflictError('Payments are set against this bill - cancel those payments first', 'BILL_HAS_PAYMENTS');
  }
  if (Number(doc.returnTotal) > 0) {
    throw new ConflictError('Purchase returns are set against this bill - cancel those first', 'BILL_HAS_RETURNS');
  }
  doc.status = BILL_STATUS.CANCELLED;
  doc.cancelledAt = new Date();
  doc.cancelledBy = req.user.id;
  doc.cancelReason = req.body?.reason || '';
  doc.balanceDue = 0;
  await doc.save();
  await bumpOutstanding(doc.supplierId, -doc.total);
  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'PurchaseBill',
    entityId: doc._id,
    entityLabel: doc.billNo,
    description: `Bill ${doc.billNo} cancelled${doc.cancelReason ? `: ${doc.cancelReason}` : ''}`,
  });
  return success(res, { message: 'Bill cancelled', data: toPlain(doc) });
});

// ===========================================================================
// Supplier payments
// ===========================================================================

export const listPayments = asyncHandler(async (req, res) => {
  const result = await listDocuments(SupplierPayment, {
    query: req.query,
    searchFields: ['paymentNo', 'supplierName', 'reference', 'allocations.billNo', 'allocations.supplierInvoiceNo'],
    filtersSpec: { status: { type: 'string' }, supplierId: { type: 'objectId' }, mode: { type: 'string' } },
    sortAllowed: ['paymentDate', 'amount', 'createdAt'],
    defaultSort: '-paymentDate',
    dateField: 'paymentDate',
  });
  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const getPayment = asyncHandler(async (req, res) => {
  const doc = await loadDoc(SupplierPayment, req.params.id, { label: 'Supplier payment' });
  return success(res, { data: toPlain(doc) });
});

/** GET /supplier-payments/form-options?supplierId= - the supplier's open bills, oldest due first. */
export const paymentFormOptions = asyncHandler(async (req, res) => {
  if (!req.query.supplierId) return success(res, { data: { bills: [] } });
  const supplier = await loadSupplier(req.query.supplierId);
  const bills = await PurchaseBill.find({
    supplierId: supplier._id,
    status: { $in: [BILL_STATUS.POSTED, BILL_STATUS.PARTIALLY_PAID] },
    balanceDue: { $gt: 0 },
  })
    .select('billNo supplierInvoiceNo supplierInvoiceDate dueDate total balanceDue')
    .sort({ dueDate: 1, billDate: 1 })
    .lean();
  return success(res, {
    data: {
      supplier: { id: String(supplier._id), name: supplier.name, outstanding: supplier.outstanding },
      bills: bills.map((b) => ({ ...b, id: String(b._id), _id: undefined, overdue: b.dueDate && b.dueDate < companyToday(tzOf(req)).today })),
    },
  });
});

/**
 * POST /supplier-payments
 * body: { supplierId, amount, paymentDate?, mode, reference?, allocations?: [{ bill, amount }], notes? }
 * Without `allocations` the amount is set against the oldest-due bills; any
 * rest is an advance.
 */
export const createPayment = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const body = req.body;
  const supplier = await loadSupplier(body.supplierId);
  const amount = r2(body.amount);
  if (amount <= 0) throw new BadRequestError('Amount must be more than zero', 'VALIDATION_ERROR');

  const open = await PurchaseBill.find({
    supplierId: supplier._id,
    status: { $in: [BILL_STATUS.POSTED, BILL_STATUS.PARTIALLY_PAID] },
    balanceDue: { $gt: 0 },
  }).sort({ dueDate: 1, billDate: 1 });
  const byId = new Map(open.map((b) => [String(b._id), b]));

  let plan = [];
  if (body.allocations?.length) {
    for (const a of body.allocations) {
      const bill = byId.get(String(a.bill));
      if (!bill) throw new BadRequestError('A chosen bill is not open for this supplier', 'INVALID_REFERENCE');
      const amt = r2(a.amount);
      if (amt <= 0) continue;
      if (amt > Number(bill.balanceDue) + 0.009) {
        throw new BadRequestError(`${bill.billNo}: only ${bill.balanceDue} is due`, 'VALIDATION_ERROR');
      }
      plan.push({ bill, amount: amt });
    }
  } else {
    let left = amount;
    for (const bill of open) {
      if (left <= 0.009) break;
      const amt = r2(Math.min(left, Number(bill.balanceDue)));
      plan.push({ bill, amount: amt });
      left = r2(left - amt);
    }
  }
  const allocated = r2(plan.reduce((s, p) => s + p.amount, 0));
  if (allocated > amount + 0.009) throw new BadRequestError('Set-off against bills is more than the amount paid', 'VALIDATION_ERROR');

  const date = dateOrNull(body.paymentDate) || new Date();
  const doc = new SupplierPayment({
    paymentNo: await numberFor(req, settings, 'supplierPayment', 'SUPPLIER_PAYMENT', 'PAY', date),
    paymentDate: date,
    supplierId: supplier._id,
    supplierName: supplier.name,
    amount,
    mode: body.mode || 'BANK_TRANSFER',
    reference: body.reference || '',
    allocations: plan.map((p) => ({ bill: p.bill._id, billNo: p.bill.billNo, supplierInvoiceNo: p.bill.supplierInvoiceNo, amount: p.amount })),
    allocatedAmount: allocated,
    advanceAmount: r2(amount - allocated),
    notes: body.notes || '',
  });
  await doc.save();
  for (const p of plan) {
    p.bill.amountPaid = r2(Number(p.bill.amountPaid || 0) + p.amount);
    p.bill.refreshBalance();
    await p.bill.save();
  }
  await bumpOutstanding(supplier._id, -amount);

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'SupplierPayment',
    entityId: doc._id,
    entityLabel: doc.paymentNo,
    description: `Paid ${amount} to ${supplier.name} (${doc.paymentNo})`,
  });
  return created(res, { message: 'Payment recorded', data: toPlain(doc) });
});

export const cancelPayment = asyncHandler(async (req, res) => {
  const doc = await loadDoc(SupplierPayment, req.params.id, { label: 'Supplier payment' });
  if (doc.status === SUPPLIER_DOC_STATUS.CANCELLED) throw new ConflictError('Payment is already cancelled', 'PAYMENT_CANCELLED');
  for (const a of doc.allocations) {
    const bill = await PurchaseBill.findById(a.bill);
    if (!bill) continue;
    bill.amountPaid = r2(Math.max(0, Number(bill.amountPaid || 0) - a.amount));
    bill.refreshBalance();
    await bill.save();
  }
  doc.status = SUPPLIER_DOC_STATUS.CANCELLED;
  doc.cancelledAt = new Date();
  doc.cancelledBy = req.user.id;
  doc.cancelReason = req.body?.reason || '';
  await doc.save();
  await bumpOutstanding(doc.supplierId, doc.amount);
  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'SupplierPayment',
    entityId: doc._id,
    entityLabel: doc.paymentNo,
    description: `Supplier payment ${doc.paymentNo} cancelled${doc.cancelReason ? `: ${doc.cancelReason}` : ''}`,
  });
  return success(res, { message: 'Payment cancelled', data: toPlain(doc) });
});

// ===========================================================================
// Purchase returns (debit notes)
// ===========================================================================

export const listReturns = asyncHandler(async (req, res) => {
  const result = await listDocuments(PurchaseReturn, {
    query: req.query,
    searchFields: ['returnNo', 'supplierName', 'grnNo', 'items.billNo', 'reason'],
    filtersSpec: { status: { type: 'string' }, supplierId: { type: 'objectId' } },
    sortAllowed: ['returnDate', 'total', 'createdAt'],
    defaultSort: '-returnDate',
    dateField: 'returnDate',
  });
  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const getReturn = asyncHandler(async (req, res) => {
  const doc = await loadDoc(PurchaseReturn, req.params.id, { label: 'Purchase return' });
  return success(res, { data: toPlain(doc) });
});

/** GET /purchase-returns/form-options?supplierId= - posted GRNs with quantity that can go back. */
export const returnFormOptions = asyncHandler(async (req, res) => {
  if (!req.query.supplierId) return success(res, { data: { grns: [] } });
  const supplier = await loadSupplier(req.query.supplierId);
  const grns = await loadPostedGrns({ supplierId: supplier._id });
  const rows = await grnLines(grns);
  const { rateOf } = await taxRatesFor(grns);
  const byGrn = new Map();
  rows
    .filter((r) => r.returnable > EPS)
    .forEach((r) => {
      const k = String(r.grn._id);
      if (!byGrn.has(k)) byGrn.set(k, { id: k, grnNo: r.grn.grnNo, grnDate: r.grn.grnDate, warehouseName: r.grn.warehouseName, lines: [] });
      byGrn.get(k).lines.push(shapeLine(r, rateOf));
    });
  return success(res, {
    data: { supplier: { id: String(supplier._id), name: supplier.name }, grns: [...byGrn.values()] },
  });
});

/**
 * POST /purchase-returns
 * body: { grnId, items: [{ grnItemId, qty }], reason?, notes?, returnDate? }
 * Unbilled quantity goes back first (it simply will not be billed); the rest
 * comes off the bill(s) it was on, at that bill's tax rate.
 */
export const createReturn = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const body = req.body;
  const [grn] = await loadPostedGrns({ _id: body.grnId });
  if (!grn) throw new BadRequestError('Pick a posted goods receipt', 'INVALID_REFERENCE');
  const supplier = await loadSupplier(grn.supplierId);
  const rows = await grnLines([grn]);
  const { rateOf } = await taxRatesFor([grn]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const regime = settings?.tax?.regime;

  const items = [];
  for (const want of body.items) {
    const row = byKey.get(String(want.grnItemId));
    if (!row) throw new BadRequestError('A line is not on this goods receipt', 'INVALID_REFERENCE');
    let qty = r2(want.qty);
    if (qty <= EPS) continue;
    if (qty > row.returnable + EPS) {
      throw new BadRequestError(`${row.item.name}: only ${row.returnable} ${row.item.unit} can be returned`, 'VALIDATION_ERROR');
    }
    const base = {
      grnItemId: row.item._id,
      product: row.item.product,
      name: row.item.name,
      sku: row.item.sku,
      unit: row.item.unit,
      unitFactor: Number(row.item.unitFactor || 1),
      unitPrice: Number(row.item.unitCost || 0),
    };
    // 1) Not billed yet: it just will not be billed.
    const unbilled = Math.max(0, Math.min(qty, row.unbilledLeft));
    if (unbilled > EPS) {
      items.push({ ...base, qty: r2(unbilled), ...lineAmounts(unbilled, base.unitPrice, rateOf(grn, row.item), regime) });
      qty = r2(qty - unbilled);
    }
    // 2) The rest comes off the bill(s) it was on.
    for (const onBill of row.billsHere) {
      if (qty <= EPS) break;
      const room = r2(onBill.qty - onBill.returned);
      const take = Math.min(qty, room);
      if (take <= EPS) continue;
      items.push({ ...base, qty: r2(take), bill: onBill.bill, billNo: onBill.billNo, ...lineAmounts(take, base.unitPrice, onBill.taxRate, regime) });
      qty = r2(qty - take);
    }
  }
  if (!items.length) throw new BadRequestError('Enter the quantity going back', 'VALIDATION_ERROR');

  const taxableTotal = r2(items.reduce((s, i) => s + i.taxableAmount, 0));
  const taxTotal = r2(items.reduce((s, i) => s + i.taxAmount, 0));
  const billedTotal = r2(items.filter((i) => i.bill).reduce((s, i) => s + i.lineTotal, 0));
  const date = dateOrNull(body.returnDate) || new Date();

  // Stock first: if it cannot leave, nothing else is written.
  const doc = new PurchaseReturn({
    returnNo: await numberFor(req, settings, 'purchaseReturn', 'PURCHASE_RETURN', 'DN', date),
    returnDate: date,
    supplierId: supplier._id,
    supplierName: supplier.name,
    grn: grn._id,
    grnNo: grn.grnNo,
    warehouse: grn.warehouse,
    reason: body.reason || '',
    items,
    taxableTotal,
    taxTotal,
    taxBreakup: taxBreakupFor(taxTotal, settings, { sellerState: supplier.address?.state, buyerState: companyState(settings, req.company) }),
    total: r2(taxableTotal + taxTotal),
    billedTotal,
    notes: body.notes || '',
  });
  const perLine = new Map();
  items.forEach((i) => {
    const k = String(i.grnItemId);
    perLine.set(k, { ...i, qty: (perLine.get(k)?.qty || 0) + i.qty });
  });
  // Check the whole return can leave before any stock moves.
  await assertWarehouseStock(grn.warehouse, [...perLine.values()].map((l) => ({ product: l.product, name: l.name, qty: l.qty, unitFactor: l.unitFactor })), settings, {
    excludeReserved: false,
  });
  for (const line of perLine.values()) {
    await recordMovement({
      product: line.product,
      warehouse: grn.warehouse,
      qty: -r2(line.qty * line.unitFactor),
      type: MOVEMENT_TYPES.PURCHASE_RETURN,
      refType: 'PURCHASE_RETURN',
      refId: doc._id,
      refNo: doc.returnNo,
      reason: body.reason || 'Returned to supplier',
      // Out at what it came in at, so the average cost is undone.
      unitCost: line.unitPrice / line.unitFactor,
      reversal: true,
      movedBy: req.user.id,
      settings,
    });
  }
  await doc.save();

  await applyReturnToBills(doc, 1);
  if (billedTotal > 0) await bumpOutstanding(supplier._id, -billedTotal);

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'PurchaseReturn',
    entityId: doc._id,
    entityLabel: doc.returnNo,
    description: `Purchase return ${doc.returnNo} to ${supplier.name} (${doc.grnNo}) for ${doc.total}`,
  });
  return created(res, { message: 'Purchase return posted', data: toPlain(doc) });
});

/** Add (sign 1) or take back (sign -1) a return's billed lines on their bills. */
const applyReturnToBills = async (doc, sign) => {
  const perBill = new Map();
  doc.items.filter((i) => i.bill).forEach((i) => perBill.set(String(i.bill), (perBill.get(String(i.bill)) || 0) + i.lineTotal));
  for (const [billId, amount] of perBill) {
    const bill = await PurchaseBill.findById(billId);
    if (!bill) continue;
    bill.returnTotal = r2(Math.max(0, Number(bill.returnTotal || 0) + sign * amount));
    bill.refreshBalance();
    await bill.save();
  }
};

export const cancelReturn = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const doc = await loadDoc(PurchaseReturn, req.params.id, { label: 'Purchase return' });
  if (doc.status === SUPPLIER_DOC_STATUS.CANCELLED) throw new ConflictError('Return is already cancelled', 'RETURN_CANCELLED');
  const perLine = new Map();
  doc.items.forEach((i) => {
    const k = String(i.grnItemId);
    perLine.set(k, { product: i.product, unitFactor: i.unitFactor, unitPrice: i.unitPrice, qty: (perLine.get(k)?.qty || 0) + i.qty });
  });
  for (const line of perLine.values()) {
    await recordMovement({
      product: line.product,
      warehouse: doc.warehouse,
      qty: r2(line.qty * line.unitFactor),
      type: MOVEMENT_TYPES.PURCHASE_RETURN,
      refType: 'PURCHASE_RETURN',
      refId: doc._id,
      refNo: doc.returnNo,
      reason: 'Purchase return cancelled',
      unitCost: line.unitPrice / line.unitFactor,
      reversal: true,
      movedBy: req.user.id,
      settings,
    });
  }
  await applyReturnToBills(doc, -1);
  if (doc.billedTotal > 0) await bumpOutstanding(doc.supplierId, doc.billedTotal);
  doc.status = SUPPLIER_DOC_STATUS.CANCELLED;
  doc.cancelledAt = new Date();
  doc.cancelledBy = req.user.id;
  doc.cancelReason = req.body?.reason || '';
  await doc.save();
  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'PurchaseReturn',
    entityId: doc._id,
    entityLabel: doc.returnNo,
    description: `Purchase return ${doc.returnNo} cancelled`,
  });
  return success(res, { message: 'Purchase return cancelled', data: toPlain(doc) });
});

// ===========================================================================
// Payables summary (for the list pages' header cards)
// ===========================================================================

export const payablesSummary = asyncHandler(async (req, res) => {
  const companyId = new mongoose.Types.ObjectId(req.companyId);
  const { today, monthStart } = companyToday(tzOf(req)); // company timezone
  const [open, overdue, billedMonth, paidMonth] = await Promise.all([
    PurchaseBill.aggregate([
      { $match: { companyId, isDeleted: { $ne: true }, status: { $in: [BILL_STATUS.POSTED, BILL_STATUS.PARTIALLY_PAID] } } },
      { $group: { _id: null, count: { $sum: 1 }, due: { $sum: '$balanceDue' } } },
    ]),
    PurchaseBill.aggregate([
      { $match: { companyId, isDeleted: { $ne: true }, status: { $in: [BILL_STATUS.POSTED, BILL_STATUS.PARTIALLY_PAID] }, dueDate: { $lt: today } } },
      { $group: { _id: null, count: { $sum: 1 }, due: { $sum: '$balanceDue' } } },
    ]),
    PurchaseBill.aggregate([
      { $match: { companyId, isDeleted: { $ne: true }, status: { $in: LIVE_BILL }, billDate: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$total' }, tax: { $sum: '$taxTotal' } } },
    ]),
    SupplierPayment.aggregate([
      { $match: { companyId, isDeleted: { $ne: true }, status: SUPPLIER_DOC_STATUS.POSTED, paymentDate: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);
  return success(res, {
    data: {
      openBills: open[0]?.count || 0,
      payable: r2(open[0]?.due),
      overdueBills: overdue[0]?.count || 0,
      overdueAmount: r2(overdue[0]?.due),
      billedThisMonth: r2(billedMonth[0]?.total),
      inputTaxThisMonth: r2(billedMonth[0]?.tax),
      paidThisMonth: r2(paidMonth[0]?.total),
    },
  });
});

