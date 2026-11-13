import mongoose from 'mongoose';
import dayjs from 'dayjs';
import Company from '../models/Company.js';
import FinancialYear from '../models/FinancialYear.js';
import YearBalance from '../models/YearBalance.js';
import Invoice from '../models/Invoice.js';
import CreditNote from '../models/CreditNote.js';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import GoodsReceipt from '../models/GoodsReceipt.js';
import PurchaseBill from '../models/PurchaseBill.js';
import SupplierPayment from '../models/SupplierPayment.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import StockAdjustment from '../models/StockAdjustment.js';
import StockTransfer from '../models/StockTransfer.js';
import StockMovement from '../models/StockMovement.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import { AppError, ConflictError, NotFoundError } from '../utils/errors.js';
import { dayKey, DEFAULT_TZ } from './fieldForceService.js';

/**
 * Financial year closing.
 *
 * A year "closes" by being locked: no document dated inside it can be added,
 * changed, cancelled or posted. On closing we record the year's totals and its
 * closing balances. The new year needs nothing carried over - numbering
 * restarts by itself (document numbers carry the FY tag) and receivables,
 * payables and stock are running balances that simply continue.
 */

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const tzOf = (company) => company?.timezone || DEFAULT_TZ;

/** The financial year that contains a company-local day ('YYYY-MM-DD'). */
export const fyOfDay = (day, startMonth = 4) => {
  const d = dayjs(day);
  const year = d.month() + 1 >= startMonth ? d.year() : d.year() - 1;
  const start = dayjs(`${year}-${String(startMonth).padStart(2, '0')}-01`);
  const next = start.add(1, 'year');
  const tag = `${String(year).slice(-2)}${String(year + 1).slice(-2)}`;
  const label = startMonth === 1 ? `FY ${year}` : `FY ${year}-${String(year + 1).slice(-2)}`;
  return {
    tag,
    label,
    startDay: start.format('YYYY-MM-DD'),
    endDay: next.subtract(1, 'day').format('YYYY-MM-DD'),
    nextStartDay: next.format('YYYY-MM-DD'),
  };
};

/** The year with a given tag ("2526"). */
export const fyOfTag = (tag, startMonth = 4) => {
  if (!/^\d{4}$/.test(String(tag))) throw new AppError('Unknown financial year', { status: 404, code: 'NOT_FOUND' });
  const year = 2000 + Number(String(tag).slice(0, 2));
  return fyOfDay(`${year}-${String(startMonth).padStart(2, '0')}-01`, startMonth);
};

/** UTC instant where a company-local day begins. */
const dayStart = (day, tz) => dayjs.tz(day, tz).toDate();

// ---------------------------------------------------------------- the lock

/** True when this date falls in a closed year of the company. */
export const isLockedDate = (company, date) => {
  const through = company?.booksClosedThrough;
  if (!through || !date) return false;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return false;
  // A bare 'YYYY-MM-DD' from a form is already a company-local day.
  const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dayKey(parsed, tzOf(company));
  return day <= through;
};

export const booksClosedError = (company) => {
  const fy = fyOfDay(company.booksClosedThrough, company.financialYearStartMonth || 4);
  const shown = dayjs(company.booksClosedThrough).format('DD/MM/YYYY');
  return new AppError(
    `${fy.label} is closed: documents dated ${shown} or earlier cannot be added, changed, cancelled or posted. Use a date after ${shown}, or ask the admin to reopen the year.`,
    { status: 423, code: 'BOOKS_CLOSED', errors: [{ field: '_', message: `${fy.label} is closed` }] }
  );
};

/** Throw when a date belongs to a closed year. */
export const assertOpenDate = (company, date) => {
  if (isLockedDate(company, date)) throw booksClosedError(company);
};

// ---------------------------------------------------------------- years

const firstActivityDay = async (company) => {
  const tz = tzOf(company);
  const firsts = await Promise.all([
    Invoice.findOne({ status: { $ne: 'DRAFT' } }).sort({ invoiceDate: 1 }).select('invoiceDate').lean(),
    Order.findOne({}).sort({ orderDate: 1 }).select('orderDate').lean(),
    PurchaseBill.findOne({}).sort({ billDate: 1 }).select('billDate').lean(),
    StockMovement.findOne({}).sort({ movedAt: 1 }).select('movedAt').lean(),
  ]);
  const dates = [firsts[0]?.invoiceDate, firsts[1]?.orderDate, firsts[2]?.billDate, firsts[3]?.movedAt].filter(Boolean);
  if (!dates.length) return null;
  return dayKey(new Date(Math.min(...dates.map((d) => new Date(d).getTime()))), tz);
};

/** Every year from the first activity to the current one, newest first. */
export const listYears = async (company) => {
  const startMonth = company.financialYearStartMonth || 4;
  const today = dayKey(new Date(), tzOf(company));
  const current = fyOfDay(today, startMonth);
  const first = await firstActivityDay(company);
  const docs = await FinancialYear.find({}).lean();
  const byTag = new Map(docs.map((d) => [d.tag, d]));

  const years = [];
  let fy = first ? fyOfDay(first < current.startDay ? first : current.startDay, startMonth) : current;
  for (let guard = 0; guard < 50; guard++) {
    years.push(fy);
    if (fy.tag === current.tag) break;
    fy = fyOfDay(fy.nextStartDay, startMonth);
  }
  // Years closed earlier stay listed even with no activity left.
  docs.forEach((d) => {
    if (!years.some((y) => y.tag === d.tag)) years.push(fyOfTag(d.tag, startMonth));
  });
  years.sort((a, b) => (a.startDay < b.startDay ? -1 : 1));

  const through = company.booksClosedThrough || '';
  const out = years.map((y) => {
    const doc = byTag.get(y.tag);
    const ended = y.endDay < today;
    const closed = Boolean(through) && y.endDay <= through;
    return {
      ...y,
      status: closed ? 'CLOSED' : y.tag === current.tag ? 'CURRENT' : 'OPEN',
      ended,
      closedAt: closed ? doc?.closedAt || null : null,
      closedByName: closed ? doc?.closedByName || '' : '',
      reopened: !closed && doc?.status === 'REOPENED',
      history: doc?.history || [],
      totals: closed ? doc?.totals || null : null,
    };
  });
  // The next year that may be closed: the oldest ended, open one.
  const nextToClose = out.find((y) => y.status === 'OPEN' && y.ended);
  const lastClosed = [...out].reverse().find((y) => y.status === 'CLOSED');
  out.forEach((y) => {
    y.canClose = Boolean(nextToClose && y.tag === nextToClose.tag);
    y.canReopen = Boolean(lastClosed && y.tag === lastClosed.tag);
  });
  return { years: out.reverse(), booksClosedThrough: through, today };
};

// ---------------------------------------------------------------- checklist

/** Loose ends inside a year that should be finished before it is locked. */
export const checklist = async (company, tag) => {
  const fy = fyOfTag(tag, company.financialYearStartMonth || 4);
  const tz = tzOf(company);
  const end = dayStart(fy.nextStartDay, tz);
  const upTo = (field) => ({ [field]: { $lt: end } });
  const [draftInvoices, draftCredits, draftPayments, draftGrns, draftAdjustments, transfersInTransit, draftTransfers, openOrders, openPos] = await Promise.all([
    Invoice.countDocuments({ status: 'DRAFT', ...upTo('invoiceDate') }),
    CreditNote.countDocuments({ status: 'DRAFT', ...upTo('creditNoteDate') }),
    Payment.countDocuments({ status: 'DRAFT', ...upTo('paymentDate') }),
    GoodsReceipt.countDocuments({ status: 'DRAFT', ...upTo('grnDate') }),
    StockAdjustment.countDocuments({ status: 'DRAFT', ...upTo('adjustmentDate') }),
    StockTransfer.countDocuments({ status: 'DISPATCHED', ...upTo('transferDate') }),
    StockTransfer.countDocuments({ status: 'DRAFT', ...upTo('transferDate') }),
    Order.countDocuments({ status: { $in: ['PENDING_APPROVAL', 'CONFIRMED', 'PARTIALLY_INVOICED'] }, ...upTo('orderDate') }),
    PurchaseOrder.countDocuments({ status: { $in: ['SENT', 'PARTIALLY_RECEIVED', 'APPROVED'] }, ...upTo('poDate') }),
  ]);
  const item = (key, label, count, severity, to, hint) => ({ key, label, count, severity, to, hint });
  const items = [
    item('draftInvoices', 'Draft invoices', draftInvoices, 'warning', '/app/invoices?status=DRAFT', 'Issue or delete them - a draft dated in a closed year cannot be issued later.'),
    item('draftCredits', 'Draft credit notes', draftCredits, 'warning', '/app/credit-notes?status=DRAFT', 'Issue or delete them.'),
    item('draftPayments', 'Draft receipts', draftPayments, 'warning', '/app/payments?status=DRAFT', 'Receive or delete them.'),
    item('draftGrns', 'Goods receipts not posted', draftGrns, 'warning', '/app/goods-receipts', 'Post them so the stock is in the right year.'),
    item('draftAdjustments', 'Stock adjustments not posted', draftAdjustments, 'warning', '/app/inventory', 'Post or delete them.'),
    item('transfersInTransit', 'Transfers dispatched but not received', transfersInTransit, 'warning', '/app/inventory', 'Receive them at the destination.'),
    item('draftTransfers', 'Draft transfers', draftTransfers, 'warning', '/app/inventory', 'Dispatch or delete them.'),
    item('openOrders', 'Orders still open (they carry into the new year)', openOrders, 'info', '/app/orders', 'Fine to keep: they will be invoiced with new-year dates and numbers.'),
    item('openPos', 'Purchase orders still open (they carry into the new year)', openPos, 'info', '/app/purchase-orders', 'Fine to keep: goods received later get new-year dates.'),
    item('stockCount', 'Physical stock count', 0, 'reminder', '/app/inventory', 'Count the godowns and vans and post any difference as a stock adjustment dated inside the year.'),
  ];
  return { year: fy, items, blocking: items.filter((i) => i.severity === 'warning' && i.count > 0).length };
};

// ---------------------------------------------------------------- snapshot

const sumBy = async (Model, match, groupKey, field) => {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: groupKey, total: { $sum: field } } }]);
  return new Map(rows.map((r) => [String(r._id), r.total]));
};

/** Source documents of stock movements and the field holding their date. */
const MOVEMENT_SOURCES = [
  ['INVOICE', Invoice, 'invoiceDate'],
  ['CREDIT_NOTE', CreditNote, 'creditNoteDate'],
  ['GOODS_RECEIPT', GoodsReceipt, 'grnDate'],
  ['PURCHASE_RETURN', PurchaseReturn, 'returnDate'],
  ['ADJUSTMENT', StockAdjustment, 'adjustmentDate'],
  ['TRANSFER', StockTransfer, 'transferDate'],
];

/** Movements posted on/after `end` whose document is dated before it. */
export const lateMovementIds = async (companyId, end) => {
  const ids = [];
  for (const [refType, Model, field] of MOVEMENT_SOURCES) {
    const refs = await StockMovement.distinct('refId', { companyId, isDeleted: { $ne: true }, refType, movedAt: { $gte: end }, refId: { $ne: null } });
    if (!refs.length) continue;
    const inYear = await Model.distinct('_id', { _id: { $in: refs }, [field]: { $lt: end } });
    if (!inYear.length) continue;
    const moves = await StockMovement.distinct('_id', { companyId, refType, refId: { $in: inYear }, movedAt: { $gte: end } });
    ids.push(...moves);
  }
  return ids;
};

/** Totals and closing balances of a year, from the documents dated inside it. */
export const buildSnapshot = async (company, fy) => {
  const tz = tzOf(company);
  const companyId = oid(company._id);
  const start = dayStart(fy.startDay, tz);
  const end = dayStart(fy.nextStartDay, tz);
  const live = { companyId, isDeleted: { $ne: true } };
  const inYear = (f) => ({ [f]: { $gte: start, $lt: end } });
  const upTo = (f) => ({ [f]: { $lt: end } });
  const LIVE_INVOICE = { $nin: ['DRAFT', 'CANCELLED'] };

  // ---- year totals
  const [sales] = await Invoice.aggregate([
    { $match: { ...live, status: LIVE_INVOICE, ...inYear('invoiceDate') } },
    { $unwind: '$items' },
    {
      $group: {
        _id: null,
        taxable: { $sum: '$items.taxableAmount' },
        tax: { $sum: '$items.taxAmount' },
        cost: { $sum: { $multiply: [{ $ifNull: ['$items.costPrice', 0] }, { $ifNull: ['$items.baseQty', '$items.qty'] }] } },
      },
    },
  ]);
  const [invoiceTotals] = await Invoice.aggregate([
    { $match: { ...live, status: LIVE_INVOICE, ...inYear('invoiceDate') } },
    { $group: { _id: null, total: { $sum: '$total' }, n: { $sum: 1 } } },
  ]);
  const one = async (Model, match, field) => (await Model.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: field } } }]))[0]?.t || 0;
  const creditNotes = await one(CreditNote, { ...live, status: 'ISSUED', ...inYear('creditNoteDate') }, '$total');
  const collections = await one(Payment, { ...live, status: 'RECEIVED', ...inYear('paymentDate') }, '$amount');
  const [bills] = await PurchaseBill.aggregate([
    { $match: { ...live, status: { $ne: 'CANCELLED' }, ...inYear('billDate') } },
    { $group: { _id: null, total: { $sum: '$total' }, tax: { $sum: '$taxTotal' }, n: { $sum: 1 } } },
  ]);
  const supplierPayments = await one(SupplierPayment, { ...live, status: { $ne: 'CANCELLED' }, ...inYear('paymentDate') }, '$amount');
  const purchaseReturns = await one(PurchaseReturn, { ...live, status: { $ne: 'CANCELLED' }, ...inYear('returnDate') }, '$total');

  // ---- receivables on the last day: opening + invoices - receipts applied - credit notes
  const custInvoiced = await sumBy(Invoice, { ...live, status: LIVE_INVOICE, ...upTo('invoiceDate') }, '$customerId', '$total');
  const custPaid = await sumBy(Payment, { ...live, status: 'RECEIVED', ...upTo('paymentDate') }, '$customerId', { $ifNull: ['$amountApplied', '$amount'] });
  const custCredited = await sumBy(CreditNote, { ...live, status: 'ISSUED', ...upTo('creditNoteDate') }, '$customerId', '$total');
  // Every customer: one added after the year-end may still have back-dated documents.
  const customers = await Customer.find({}).select('name code openingBalance createdAt').lean();
  const custRows = customers
    .map((c) => {
      const id = String(c._id);
      const opening = new Date(c.createdAt) < end ? Number(c.openingBalance || 0) : 0;
      const amount = r2(opening + (custInvoiced.get(id) || 0) - (custPaid.get(id) || 0) - (custCredited.get(id) || 0));
      return { kind: 'CUSTOMER', ref: c._id, name: c.name, code: c.code || '', amount };
    })
    .filter((r) => Math.abs(r.amount) >= 0.01);

  // ---- payables on the last day: opening + bills - payments - returns
  const supBilled = await sumBy(PurchaseBill, { ...live, status: { $ne: 'CANCELLED' }, ...upTo('billDate') }, '$supplierId', '$total');
  const supPaid = await sumBy(SupplierPayment, { ...live, status: { $ne: 'CANCELLED' }, ...upTo('paymentDate') }, '$supplierId', '$amount');
  const supReturned = await sumBy(PurchaseReturn, { ...live, status: { $ne: 'CANCELLED' }, ...upTo('returnDate') }, '$supplierId', '$total');
  const suppliers = await Supplier.find({}).select('name code openingBalance createdAt').lean();
  const supRows = suppliers
    .map((s) => {
      const id = String(s._id);
      const opening = new Date(s.createdAt) < end ? Number(s.openingBalance || 0) : 0;
      const amount = r2(opening + (supBilled.get(id) || 0) - (supPaid.get(id) || 0) - (supReturned.get(id) || 0));
      return { kind: 'SUPPLIER', ref: s._id, name: s.name, code: s.code || '', amount };
    })
    .filter((r) => Math.abs(r.amount) >= 0.01);

  // ---- stock on the last day, replayed from the stock ledger (value at moving average).
  // A movement counts by its document's date: March bills entered in April
  // belong to March, so late-posted movements of in-year documents are added.
  const late = await lateMovementIds(companyId, end);
  const stock = await StockMovement.aggregate([
    { $match: { ...live, $or: [{ movedAt: { $lt: end } }, { _id: { $in: late } }] } },
    {
      $group: {
        _id: { product: '$product', warehouse: '$warehouse' },
        name: { $last: '$productName' },
        code: { $last: '$productSku' },
        warehouseName: { $last: '$warehouseName' },
        qty: { $sum: '$qty' },
        value: { $sum: '$value' },
      },
    },
  ]);
  const stockRows = stock
    .filter((s) => Math.abs(s.qty) > 1e-9)
    .map((s) => ({
      kind: 'STOCK',
      ref: s._id.product,
      warehouse: s._id.warehouse,
      name: s.name,
      code: s.code,
      warehouseName: s.warehouseName,
      qty: Math.round(s.qty * 10000) / 10000,
      rate: s.qty ? r2(s.value / s.qty) : 0,
      amount: r2(s.value),
    }));

  const totals = {
    sales: r2(invoiceTotals?.total),
    salesTaxable: r2(sales?.taxable),
    outputTax: r2(sales?.tax),
    costOfSales: r2(sales?.cost),
    grossProfit: r2((sales?.taxable || 0) - (sales?.cost || 0)),
    creditNotes: r2(creditNotes),
    collections: r2(collections),
    purchases: r2(bills?.total),
    inputTax: r2(bills?.tax),
    supplierPayments: r2(supplierPayments),
    purchaseReturns: r2(purchaseReturns),
    receivables: r2(custRows.reduce((s, r) => s + r.amount, 0)),
    payables: r2(supRows.reduce((s, r) => s + r.amount, 0)),
    stockValue: r2(stockRows.reduce((s, r) => s + r.amount, 0)),
    invoices: invoiceTotals?.n || 0,
    bills: bills?.n || 0,
  };
  return { totals, rows: [...custRows, ...supRows, ...stockRows] };
};

// ---------------------------------------------------------------- close / reopen

const loadCompany = (companyId) => Company.findById(companyId).lean();

export const closeYear = async ({ companyId, tag, user, notes = '' }) => {
  const company = await loadCompany(companyId);
  const { years } = await listYears(company);
  const year = years.find((y) => y.tag === tag);
  if (!year) throw new NotFoundError('Unknown financial year', 'NOT_FOUND');
  if (year.status === 'CLOSED') throw new ConflictError(`${year.label} is already closed`, 'YEAR_CLOSED');
  if (!year.ended) throw new ConflictError(`${year.label} has not ended yet - it can be closed after ${dayjs(year.endDay).format('DD/MM/YYYY')}`, 'YEAR_NOT_ENDED');
  if (!year.canClose) {
    throw new ConflictError('Close the earlier financial years first (years close in order)', 'EARLIER_YEAR_OPEN');
  }

  const check = await checklist(company, tag);
  const { totals, rows } = await buildSnapshot(company, year);

  await YearBalance.deleteMany({ tag }).hardDelete(); // derived rows, rebuilt on every close
  if (rows.length) {
    await YearBalance.insertMany(rows.map((r) => ({ ...r, tag, companyId: company._id })), { ordered: false });
  }
  const entry = { action: 'CLOSED', at: new Date(), by: user.id, byName: user.name, note: notes };
  const existing = await FinancialYear.findOne({ tag });
  const fields = {
    tag,
    label: year.label,
    startDay: year.startDay,
    endDay: year.endDay,
    status: 'CLOSED',
    closedAt: entry.at,
    closedBy: user.id,
    closedByName: user.name,
    notes,
    openItems: check.items.filter((i) => i.count > 0).map(({ key, label, count }) => ({ key, label, count })),
    totals,
  };
  let doc;
  if (existing) {
    existing.set(fields);
    existing.history.push(entry);
    doc = await existing.save();
  } else {
    doc = await FinancialYear.create({ ...fields, companyId: company._id, history: [entry] });
  }
  await Company.updateOne({ _id: company._id }, { $set: { booksClosedThrough: year.endDay } }).skipTenant();
  return { year: { ...year, status: 'CLOSED' }, doc: doc.toObject(), openItems: fields.openItems };
};

export const reopenYear = async ({ companyId, tag, user, reason }) => {
  const company = await loadCompany(companyId);
  const { years } = await listYears(company);
  const year = years.find((y) => y.tag === tag);
  if (!year) throw new NotFoundError('Unknown financial year', 'NOT_FOUND');
  if (year.status !== 'CLOSED') throw new ConflictError(`${year.label} is not closed`, 'YEAR_NOT_CLOSED');
  if (!year.canReopen) throw new ConflictError('Reopen the later closed years first (the latest closed year reopens first)', 'LATER_YEAR_CLOSED');

  const previous = years.filter((y) => y.status === 'CLOSED' && y.endDay < year.endDay).sort((a, b) => (a.endDay < b.endDay ? 1 : -1))[0];
  const doc = await FinancialYear.findOne({ tag });
  if (doc) {
    doc.status = 'REOPENED';
    doc.history.push({ action: 'REOPENED', at: new Date(), by: user.id, byName: user.name, note: reason });
    await doc.save();
  }
  await Company.updateOne({ _id: company._id }, { $set: { booksClosedThrough: previous?.endDay || '' } }).skipTenant();
  return { year: { ...year, status: 'OPEN' } };
};

export default { fyOfDay, fyOfTag, isLockedDate, assertOpenDate, listYears, checklist, buildSnapshot, closeYear, reopenYear };
