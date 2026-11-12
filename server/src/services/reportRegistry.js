import mongoose from 'mongoose';
import dayjs from 'dayjs';

import Invoice from '../models/Invoice.js';
import CreditNote from '../models/CreditNote.js';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import Product from '../models/Product.js';
import Supplier from '../models/Supplier.js';
import User from '../models/User.js';
import StockMovement from '../models/StockMovement.js';
import StockBalance from '../models/StockBalance.js';
import GoodsReceipt from '../models/GoodsReceipt.js';
import PurchaseBill from '../models/PurchaseBill.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import SupplierPayment from '../models/SupplierPayment.js';
import Target from '../models/Target.js';
import { startOfDay, DEFAULT_TZ } from './fieldForceService.js';

/**
 * Report registry: every printable report in one place.
 *
 * A report declares its group (REGISTER = document-by-document books,
 * MIS = summaries for decisions, LISTING = master lists), the permission(s)
 * it needs on top of its group's, the filters it takes and a `run` that
 * returns { columns, rows, totals, note? }. The hub, the viewer and the Excel
 * export all work from this one definition.
 *
 * Column types: text | date | money | number | percent.
 */

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const MAX_ROWS = 5000;

export const REPORT_GROUPS = {
  REGISTER: { label: 'Register Reports', permission: 'reports.register.view' },
  MIS: { label: 'MIS Reports', permission: 'reports.mis.view' },
  LISTING: { label: 'Listing Reports', permission: 'reports.listing.view' },
};

const LIVE_INVOICE = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];
const LIVE_BILL = ['POSTED', 'PARTIALLY_PAID', 'PAID'];

// ---- shared helpers ---------------------------------------------------------

const col = (key, label, type = 'text') => ({ key, label, type });
const totalsOf = (rows, columns) => {
  const out = {};
  columns.filter((c) => ['money', 'number'].includes(c.type) && !c.noTotal).forEach((c) => {
    out[c.key] = r2(rows.reduce((s, r) => s + Number(r[c.key] || 0), 0));
  });
  return out;
};
const finish = (columns, rows, extra = {}) => ({
  columns,
  rows: rows.slice(0, MAX_ROWS),
  totals: totalsOf(rows, columns),
  truncated: rows.length > MAX_ROWS,
  ...extra,
});

/** Inclusive date window from YYYY-MM-DD params in the company's timezone (default: this month). */
export const windowOf = (params, tz = DEFAULT_TZ) => {
  const fromKey = params.from || dayjs().startOf('month').format('YYYY-MM-DD');
  const toKey = params.to || dayjs().format('YYYY-MM-DD');
  const from = startOfDay(fromKey, tz);
  const to = dayjs(startOfDay(toKey, tz)).add(1, 'day').toDate();
  return { from, to, fromKey, toKey };
};

/** A salesman only ever sees their own documents; managers see their team. */
const ownScope = (ctx, field = 'salesman', alsoCreated = true) => {
  const { role, id, teamIds = [] } = ctx.user;
  if (!['SALESMAN', 'MANAGER'].includes(role)) return {};
  const ids = role === 'SALESMAN' ? [oid(id)] : [id, ...teamIds].map(oid);
  return alsoCreated ? { $and: [{ $or: [{ [field]: { $in: ids } }, { createdBy: { $in: ids } }] }] } : { [field]: { $in: ids } };
};

const by = (params, key, field = key) => (params[key] ? { [field]: oid(params[key]) } : {});
const names = async (Model, ids, field = 'name') => {
  const list = await Model.find({ _id: { $in: [...new Set(ids.filter(Boolean).map(String))] } }).select(field).lean();
  return new Map(list.map((d) => [String(d._id), d[field]]));
};
const ageBucket = (dueDate, today) => {
  if (!dueDate) return 'notDue';
  const days = Math.floor((today - new Date(dueDate)) / 86400000);
  if (days <= 0) return 'notDue';
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  return 'd90plus';
};
const AGEING_COLUMNS = (who) => [
  col('name', who),
  col('docs', 'Open docs', 'number'),
  col('notDue', 'Not due', 'money'),
  col('d30', '1-30 days', 'money'),
  col('d60', '31-60 days', 'money'),
  col('d90', '61-90 days', 'money'),
  col('d90plus', '90+ days', 'money'),
  col('total', 'Total due', 'money'),
];

// ---- filter vocabulary (the client renders these) -------------------------
// dateRange | customer | supplier | product | salesman | warehouse | status | groupBy | days | includeZero

// ===========================================================================
// Registers
// ===========================================================================

const salesRegister = {
  code: 'sales-register',
  group: 'REGISTER',
  title: 'Sales Register',
  description: 'Every invoice with taxable value, GST split, paid and balance.',
  icon: 'FileText',
  requires: ['invoices.view'],
  filters: ['dateRange', 'customer', 'salesman', 'status'],
  statuses: [['', 'All live'], ['CANCELLED', 'Cancelled']],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const docs = await Invoice.find({
      invoiceDate: { $gte: from, $lt: to },
      status: p.status === 'CANCELLED' ? 'CANCELLED' : { $in: LIVE_INVOICE },
      ...by(p, 'customer', 'customerId'),
      ...by(p, 'salesman'),
      ...ownScope(ctx),
    })
      .sort({ invoiceDate: 1, invoiceNo: 1 })
      .lean();
    const columns = [
      col('date', 'Date', 'date'),
      col('docNo', 'Invoice'),
      col('party', 'Customer'),
      col('gstin', 'GSTIN'),
      col('taxable', 'Taxable', 'money'),
      col('cgst', 'CGST', 'money'),
      col('sgst', 'SGST', 'money'),
      col('igst', 'IGST', 'money'),
      col('total', 'Total', 'money'),
      col('returns', 'Returns', 'money'),
      col('paid', 'Received', 'money'),
      col('balance', 'Balance', 'money'),
      col('status', 'Status'),
    ];
    const rows = docs.map((d) => ({
      date: d.invoiceDate,
      docNo: d.invoiceNo,
      party: d.customerName,
      gstin: d.customerGstin || '',
      taxable: d.taxableTotal,
      cgst: d.taxBreakup?.cgst,
      sgst: d.taxBreakup?.sgst,
      igst: d.taxBreakup?.igst,
      total: d.total,
      returns: d.creditNoteTotal,
      paid: d.amountPaid,
      balance: d.balanceDue,
      status: d.status,
    }));
    return finish(columns, rows);
  },
};

const salesReturnRegister = {
  code: 'sales-return-register',
  group: 'REGISTER',
  title: 'Sales Return Register',
  description: 'Credit notes raised against invoices, with tax.',
  icon: 'Undo2',
  requires: ['creditnotes.view'],
  filters: ['dateRange', 'customer'],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const docs = await CreditNote.find({
      creditNoteDate: { $gte: from, $lt: to },
      status: 'ISSUED',
      ...by(p, 'customer', 'customerId'),
      ...ownScope(ctx),
    })
      .sort({ creditNoteDate: 1 })
      .lean();
    const columns = [
      col('date', 'Date', 'date'),
      col('docNo', 'Credit note'),
      col('invoiceNo', 'Invoice'),
      col('party', 'Customer'),
      col('reason', 'Reason'),
      col('taxable', 'Taxable', 'money'),
      col('tax', 'Tax', 'money'),
      col('total', 'Total', 'money'),
    ];
    const rows = docs.map((d) => ({
      date: d.creditNoteDate,
      docNo: d.creditNoteNo,
      invoiceNo: d.invoiceNo,
      party: d.customerName,
      reason: String(d.reason || '').replace(/_/g, ' ').toLowerCase(),
      taxable: d.taxableTotal,
      tax: d.taxTotal,
      total: d.total,
    }));
    return finish(columns, rows);
  },
};

const receiptRegister = {
  code: 'receipt-register',
  group: 'REGISTER',
  title: 'Receipt Register',
  description: 'Money collected from customers, by mode and reference.',
  icon: 'Wallet',
  requires: ['payments.view'],
  filters: ['dateRange', 'customer', 'salesman', 'status'],
  statuses: [['', 'Received'], ['BOUNCED', 'Bounced'], ['CANCELLED', 'Cancelled']],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const docs = await Payment.find({
      paymentDate: { $gte: from, $lt: to },
      status: p.status || 'RECEIVED',
      ...by(p, 'customer', 'customerId'),
      ...by(p, 'salesman', 'collectedBy'),
      ...ownScope(ctx, 'collectedBy'),
    })
      .sort({ paymentDate: 1 })
      .lean();
    const collectors = await names(User, docs.map((d) => d.collectedBy));
    const columns = [
      col('date', 'Date', 'date'),
      col('docNo', 'Receipt'),
      col('party', 'Customer'),
      col('mode', 'Mode'),
      col('reference', 'Reference'),
      col('collector', 'Collected by'),
      col('amount', 'Amount', 'money'),
      col('applied', 'Set off', 'money'),
      col('unapplied', 'On account', 'money'),
    ];
    const rows = docs.map((d) => ({
      date: d.paymentDate,
      docNo: d.paymentNo,
      party: d.customerName,
      mode: String(d.mode || '').replace(/_/g, ' '),
      reference: d.reference || '',
      collector: collectors.get(String(d.collectedBy)) || '',
      amount: d.amount,
      applied: d.amountApplied,
      unapplied: d.unappliedAmount,
    }));
    return finish(columns, rows);
  },
};

const orderRegister = {
  code: 'order-register',
  group: 'REGISTER',
  title: 'Order Register',
  description: 'Sales orders booked, by customer and salesman, with status.',
  icon: 'ShoppingCart',
  requires: ['orders.view'],
  filters: ['dateRange', 'customer', 'salesman', 'status'],
  statuses: [['', 'All booked'], ['PENDING_APPROVAL', 'Pending approval'], ['CONFIRMED', 'Confirmed'], ['DELIVERED', 'Delivered'], ['CANCELLED', 'Cancelled'], ['REJECTED', 'Rejected']],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const docs = await Order.find({
      orderDate: { $gte: from, $lt: to },
      status: p.status || { $ne: 'DRAFT' },
      ...by(p, 'customer', 'customerId'),
      ...by(p, 'salesman'),
      ...ownScope(ctx),
    })
      .sort({ orderDate: 1 })
      .lean();
    const reps = await names(User, docs.map((d) => d.salesman));
    const columns = [
      col('date', 'Date', 'date'),
      col('docNo', 'Order'),
      col('party', 'Customer'),
      col('salesman', 'Salesman'),
      col('items', 'Lines', 'number'),
      col('taxable', 'Taxable', 'money'),
      col('total', 'Total', 'money'),
      col('invoiced', 'Invoiced', 'money'),
      col('status', 'Status'),
    ];
    const rows = docs.map((d) => ({
      date: d.orderDate,
      docNo: d.orderNo,
      party: d.customerName,
      salesman: reps.get(String(d.salesman)) || '',
      items: d.itemCount,
      taxable: d.taxableTotal,
      total: d.total,
      invoiced: d.invoicedAmount,
      status: d.status,
    }));
    return finish(columns, rows);
  },
};

const purchaseRegister = {
  code: 'purchase-register',
  group: 'REGISTER',
  title: 'Purchase Register',
  description: 'Supplier bills with input GST split, paid and balance.',
  icon: 'ReceiptText',
  requires: ['bills.view'],
  module: 'purchase',
  filters: ['dateRange', 'supplier', 'status'],
  statuses: [['', 'All live'], ['CANCELLED', 'Cancelled']],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const docs = await PurchaseBill.find({
      supplierInvoiceDate: { $gte: from, $lt: to },
      status: p.status === 'CANCELLED' ? 'CANCELLED' : { $in: LIVE_BILL },
      ...by(p, 'supplier', 'supplierId'),
    })
      .sort({ supplierInvoiceDate: 1 })
      .lean();
    const columns = [
      col('date', 'Invoice date', 'date'),
      col('docNo', 'Bill'),
      col('supplierInvoiceNo', 'Supplier invoice'),
      col('party', 'Supplier'),
      col('gstin', 'GSTIN'),
      col('taxable', 'Taxable', 'money'),
      col('cgst', 'CGST', 'money'),
      col('sgst', 'SGST', 'money'),
      col('igst', 'IGST', 'money'),
      col('other', 'Other charges', 'money'),
      col('total', 'Total', 'money'),
      col('returns', 'Returns', 'money'),
      col('paid', 'Paid', 'money'),
      col('balance', 'Balance', 'money'),
    ];
    const rows = docs.map((d) => ({
      date: d.supplierInvoiceDate,
      docNo: d.billNo,
      supplierInvoiceNo: d.supplierInvoiceNo,
      party: d.supplierName,
      gstin: d.supplierGstin || '',
      taxable: d.taxableTotal,
      cgst: d.taxBreakup?.cgst,
      sgst: d.taxBreakup?.sgst,
      igst: d.taxBreakup?.igst,
      other: d.otherCharges,
      total: d.total,
      returns: d.returnTotal,
      paid: d.amountPaid,
      balance: d.balanceDue,
    }));
    return finish(columns, rows);
  },
};

const purchaseReturnRegister = {
  code: 'purchase-return-register',
  group: 'REGISTER',
  title: 'Purchase Return Register',
  description: 'Goods sent back to suppliers (debit notes).',
  icon: 'PackageMinus',
  requires: ['purchasereturns.view'],
  module: 'purchase',
  filters: ['dateRange', 'supplier'],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const docs = await PurchaseReturn.find({ returnDate: { $gte: from, $lt: to }, status: 'POSTED', ...by(p, 'supplier', 'supplierId') })
      .sort({ returnDate: 1 })
      .lean();
    const columns = [
      col('date', 'Date', 'date'),
      col('docNo', 'Debit note'),
      col('grnNo', 'GRN'),
      col('party', 'Supplier'),
      col('reason', 'Reason'),
      col('taxable', 'Taxable', 'money'),
      col('tax', 'Tax', 'money'),
      col('total', 'Total', 'money'),
      col('billed', 'Off bills', 'money'),
    ];
    const rows = docs.map((d) => ({
      date: d.returnDate,
      docNo: d.returnNo,
      grnNo: d.grnNo,
      party: d.supplierName,
      reason: d.reason,
      taxable: d.taxableTotal,
      tax: d.taxTotal,
      total: d.total,
      billed: d.billedTotal,
    }));
    return finish(columns, rows);
  },
};

const supplierPaymentRegister = {
  code: 'supplier-payment-register',
  group: 'REGISTER',
  title: 'Supplier Payment Register',
  description: 'Payments made to suppliers and the bills they settled.',
  icon: 'HandCoins',
  requires: ['supplierpayments.view'],
  module: 'purchase',
  filters: ['dateRange', 'supplier'],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const docs = await SupplierPayment.find({ paymentDate: { $gte: from, $lt: to }, status: 'POSTED', ...by(p, 'supplier', 'supplierId') })
      .sort({ paymentDate: 1 })
      .lean();
    const columns = [
      col('date', 'Date', 'date'),
      col('docNo', 'Payment'),
      col('party', 'Supplier'),
      col('mode', 'Mode'),
      col('reference', 'Reference'),
      col('bills', 'Against'),
      col('amount', 'Amount', 'money'),
      col('advance', 'Advance', 'money'),
    ];
    const rows = docs.map((d) => ({
      date: d.paymentDate,
      docNo: d.paymentNo,
      party: d.supplierName,
      mode: String(d.mode || '').replace(/_/g, ' '),
      reference: d.reference,
      bills: (d.allocations || []).map((a) => a.billNo).join(', '),
      amount: d.amount,
      advance: d.advanceAmount,
    }));
    return finish(columns, rows);
  },
};

const grnRegister = {
  code: 'grn-register',
  group: 'REGISTER',
  title: 'Goods Receipt Register',
  description: 'Goods received into warehouses, with value.',
  icon: 'PackagePlus',
  requires: ['grn.view'],
  module: 'purchase',
  filters: ['dateRange', 'supplier', 'warehouse'],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const docs = await GoodsReceipt.find({
      grnDate: { $gte: from, $lt: to },
      status: 'POSTED',
      ...by(p, 'supplier', 'supplierId'),
      ...by(p, 'warehouse'),
    })
      .sort({ grnDate: 1 })
      .lean();
    const columns = [
      col('date', 'Date', 'date'),
      col('docNo', 'GRN'),
      col('poNo', 'PO'),
      col('party', 'Supplier'),
      col('warehouse', 'Warehouse'),
      col('challan', 'Challan / bill'),
      col('qty', 'Qty accepted', 'number'),
      col('value', 'Value', 'money'),
    ];
    const rows = docs.map((d) => ({
      date: d.grnDate,
      docNo: d.grnNo,
      poNo: d.poNo,
      party: d.supplierName,
      warehouse: d.warehouseName,
      challan: d.invoiceNo,
      qty: d.totalAcceptedQty,
      value: d.totalValue,
    }));
    return finish(columns, rows);
  },
};

const stockRegister = {
  code: 'stock-register',
  group: 'REGISTER',
  title: 'Stock Movement Register',
  description: 'Every stock in and out - purchases, sales, transfers, returns, adjustments.',
  icon: 'ArrowLeftRight',
  requires: ['inventory.view'],
  filters: ['dateRange', 'product', 'warehouse'],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const docs = await StockMovement.find({ movedAt: { $gte: from, $lt: to }, ...by(p, 'product'), ...by(p, 'warehouse') })
      .sort({ movedAt: 1, _id: 1 })
      .limit(MAX_ROWS + 1)
      .lean();
    const columns = [
      col('date', 'Date', 'date'),
      col('type', 'Type'),
      col('docNo', 'Reference'),
      col('product', 'Product'),
      col('warehouse', 'Warehouse'),
      col('qtyIn', 'In', 'number'),
      col('qtyOut', 'Out', 'number'),
      col('balance', 'Balance after', 'number'),
      col('unitCost', 'Cost', 'money'),
      col('value', 'Value', 'money'),
    ];
    columns.find((c) => c.key === 'balance').noTotal = true;
    columns.find((c) => c.key === 'unitCost').noTotal = true;
    const rows = docs.map((d) => ({
      date: d.movedAt,
      type: String(d.type || '').replace(/_/g, ' ').toLowerCase(),
      docNo: d.refNo,
      product: d.productName,
      warehouse: d.warehouseName || 'Company',
      qtyIn: d.qty > 0 ? d.qty : 0,
      qtyOut: d.qty < 0 ? -d.qty : 0,
      balance: d.balanceAfter,
      unitCost: d.unitCost,
      value: d.value,
    }));
    return finish(columns, rows);
  },
};

// ===========================================================================
// MIS
// ===========================================================================

const GP_GROUPS = [['product', 'Product'], ['customer', 'Customer'], ['salesman', 'Salesman'], ['category', 'Category'], ['month', 'Month']];

const grossProfit = {
  code: 'gross-profit',
  group: 'MIS',
  title: 'Gross Profit',
  description: 'Sales, cost of goods and margin by product, customer, salesman, category or month - net of returns.',
  icon: 'TrendingUp',
  requires: ['invoices.view', 'products.cost.view'],
  filters: ['dateRange', 'groupBy', 'customer', 'salesman'],
  groupBy: GP_GROUPS,
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const groupBy = GP_GROUPS.some(([g]) => g === p.groupBy) ? p.groupBy : 'product';
    const scope = { ...by(p, 'customer', 'customerId'), ...by(p, 'salesman'), ...ownScope(ctx) };
    const [invoices, notes] = await Promise.all([
      Invoice.find({ invoiceDate: { $gte: from, $lt: to }, status: { $in: LIVE_INVOICE }, ...scope })
        .select('invoiceDate customerId customerName salesman items.product items.name items.qty items.taxableAmount items.costPrice items._id')
        .lean(),
      CreditNote.find({ creditNoteDate: { $gte: from, $lt: to }, status: 'ISSUED', ...scope })
        .select('creditNoteDate invoice customerId customerName salesman items.product items.name items.qty items.taxableAmount items.invoiceItemId')
        .lean(),
    ]);
    // Cost of returned goods = what that invoice line cost.
    const lineCost = new Map();
    const noteInvoiceIds = notes.map((n) => n.invoice).filter(Boolean);
    const extraInvoices = noteInvoiceIds.length
      ? await Invoice.find({ _id: { $in: noteInvoiceIds } }).select('items._id items.costPrice').lean()
      : [];
    [...invoices, ...extraInvoices].forEach((inv) => inv.items.forEach((l) => lineCost.set(String(l._id), Number(l.costPrice || 0))));

    const productIds = [...invoices, ...notes].flatMap((d) => d.items.map((l) => l.product));
    const [products, reps] = await Promise.all([
      Product.find({ _id: { $in: productIds } }).select('category').lean(),
      names(User, [...invoices, ...notes].map((d) => d.salesman)),
    ]);
    const categoryOf = new Map(products.map((x) => [String(x._id), x.category || 'Uncategorised']));

    const keyOf = (doc, line, date) => {
      switch (groupBy) {
        case 'customer':
          return [String(doc.customerId), doc.customerName];
        case 'salesman':
          return [String(doc.salesman || ''), reps.get(String(doc.salesman)) || 'No salesman'];
        case 'category': {
          const c = categoryOf.get(String(line.product)) || 'Uncategorised';
          return [c, c];
        }
        case 'month': {
          const m = dayjs(date).format('YYYY-MM');
          return [m, dayjs(date).format('MMM YYYY')];
        }
        default:
          return [String(line.product), line.name];
      }
    };
    const acc = new Map();
    const add = (doc, line, date, sign, cost) => {
      const [k, label] = keyOf(doc, line, date);
      const row = acc.get(k) || { key: k, name: label, qty: 0, sales: 0, cost: 0 };
      row.qty += sign * Number(line.qty || 0);
      row.sales += sign * Number(line.taxableAmount || 0);
      row.cost += sign * cost;
      acc.set(k, row);
    };
    invoices.forEach((inv) => inv.items.forEach((l) => add(inv, l, inv.invoiceDate, 1, Number(l.costPrice || 0) * Number(l.qty || 0))));
    notes.forEach((n) => n.items.forEach((l) => add(n, l, n.creditNoteDate, -1, (lineCost.get(String(l.invoiceItemId)) || 0) * Number(l.qty || 0))));

    const rows = [...acc.values()]
      .map((r) => {
        const gp = r2(r.sales - r.cost);
        return { key: r.key, name: r.name, qty: r2(r.qty), sales: r2(r.sales), cost: r2(r.cost), grossProfit: gp, marginPercent: r.sales ? r2((gp / r.sales) * 100) : 0 };
      })
      .sort((a, b) => (groupBy === 'month' ? a.key.localeCompare(b.key) : b.sales - a.sales))
      .map(({ key, ...row }) => row);
    const label = GP_GROUPS.find(([g]) => g === groupBy)[1];
    const columns = [
      col('name', label),
      col('qty', 'Qty', 'number'),
      col('sales', 'Net sales (taxable)', 'money'),
      col('cost', 'Cost of goods', 'money'),
      col('grossProfit', 'Gross profit', 'money'),
      col('marginPercent', 'Margin %', 'percent'),
    ];
    const out = finish(columns, rows);
    out.totals.marginPercent = out.totals.sales ? r2((out.totals.grossProfit / out.totals.sales) * 100) : 0;
    out.note = 'Cost is the moving average cost when each invoice was issued. Returns (credit notes) are taken off at the cost they were sold at.';
    return out;
  },
};

const receivableAgeing = {
  code: 'receivable-ageing',
  group: 'MIS',
  title: 'Receivable Ageing',
  description: 'What customers owe, split by how long it is overdue.',
  icon: 'Hourglass',
  requires: ['invoices.view'],
  filters: ['customer', 'salesman'],
  run: async (p, ctx) => {
    const today = startOfDay(new Date(), ctx.tz);
    const docs = await Invoice.find({
      status: { $in: LIVE_INVOICE },
      balanceDue: { $gt: 0 },
      ...by(p, 'customer', 'customerId'),
      ...by(p, 'salesman'),
      ...ownScope(ctx),
    })
      .select('customerId customerName dueDate balanceDue')
      .lean();
    const acc = new Map();
    docs.forEach((d) => {
      const k = String(d.customerId);
      const row = acc.get(k) || { name: d.customerName, docs: 0, notDue: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
      row[ageBucket(d.dueDate, today)] += Number(d.balanceDue);
      row.total += Number(d.balanceDue);
      row.docs += 1;
      acc.set(k, row);
    });
    const rows = [...acc.values()].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v]))).sort((a, b) => b.total - a.total);
    return finish(AGEING_COLUMNS('Customer'), rows, { note: 'Days are counted from each invoice’s due date.' });
  },
};

const payableAgeing = {
  code: 'payable-ageing',
  group: 'MIS',
  title: 'Payable Ageing',
  description: 'What you owe suppliers, split by how long it is overdue.',
  icon: 'Timer',
  requires: ['bills.view'],
  module: 'purchase',
  filters: ['supplier'],
  run: async (p, ctx) => {
    const today = startOfDay(new Date(), ctx.tz);
    const docs = await PurchaseBill.find({ status: { $in: ['POSTED', 'PARTIALLY_PAID'] }, balanceDue: { $gt: 0 }, ...by(p, 'supplier', 'supplierId') })
      .select('supplierId supplierName dueDate balanceDue')
      .lean();
    const acc = new Map();
    docs.forEach((d) => {
      const k = String(d.supplierId);
      const row = acc.get(k) || { name: d.supplierName, docs: 0, notDue: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 };
      row[ageBucket(d.dueDate, today)] += Number(d.balanceDue);
      row.total += Number(d.balanceDue);
      row.docs += 1;
      acc.set(k, row);
    });
    const rows = [...acc.values()].map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v]))).sort((a, b) => b.total - a.total);
    return finish(AGEING_COLUMNS('Supplier'), rows, { note: 'Days are counted from each bill’s due date.' });
  },
};

const stockValuation = {
  code: 'stock-valuation',
  group: 'MIS',
  title: 'Stock Valuation',
  description: 'Stock on hand at moving average cost, by product (or in one warehouse).',
  icon: 'Boxes',
  requires: ['inventory.view', 'products.cost.view'],
  filters: ['warehouse', 'includeZero'],
  run: async (p, ctx) => {
    let qtyOf = null;
    if (p.warehouse) {
      const balances = await StockBalance.find({ warehouse: oid(p.warehouse) }).select('product qty').lean();
      qtyOf = new Map(balances.map((b) => [String(b.product), Number(b.qty || 0)]));
    }
    const products = await Product.find({ isActive: { $ne: false } }).select('sku name category unit stock avgCost purchasePrice').sort({ name: 1 }).lean();
    const rows = products
      .map((x) => {
        const qty = qtyOf ? qtyOf.get(String(x._id)) || 0 : Number(x.stock || 0);
        const cost = Number(x.avgCost || 0) || Number(x.purchasePrice || 0);
        return { sku: x.sku, name: x.name, category: x.category || '', unit: x.unit, qty: r2(qty), avgCost: r2(cost), value: r2(qty * cost) };
      })
      .filter((r) => p.includeZero === 'true' || Math.abs(r.qty) > 0.0001);
    const columns = [col('sku', 'Code'), col('name', 'Product'), col('category', 'Category'), col('unit', 'Unit'), col('qty', 'On hand', 'number'), col('avgCost', 'Avg cost', 'money'), col('value', 'Value', 'money')];
    columns.find((c) => c.key === 'avgCost').noTotal = true;
    return finish(columns, rows, { note: 'Valued at each product’s moving average cost (all warehouses share one average).' });
  },
};

const slowMoving = {
  code: 'slow-moving',
  group: 'MIS',
  title: 'Slow-moving Stock',
  description: 'Products in stock that have not sold for a while - money stuck on the shelf.',
  icon: 'Snail',
  requires: ['inventory.view'],
  filters: ['days'],
  run: async (p, ctx) => {
    const days = Math.max(1, Number(p.days || 60));
    const since = dayjs().subtract(days, 'day').toDate();
    const products = await Product.find({ isActive: { $ne: false }, stock: { $gt: 0 } }).select('sku name category unit stock avgCost purchasePrice').lean();
    const last = await StockMovement.aggregate([
      { $match: { companyId: oid(ctx.companyId), type: 'SALES_OUT', product: { $in: products.map((x) => x._id) } } },
      { $group: { _id: '$product', at: { $max: '$movedAt' } } },
    ]);
    const lastSold = new Map(last.map((x) => [String(x._id), x.at]));
    const rows = products
      .map((x) => {
        const at = lastSold.get(String(x._id)) || null;
        const cost = Number(x.avgCost || 0) || Number(x.purchasePrice || 0);
        return {
          sku: x.sku,
          name: x.name,
          category: x.category || '',
          qty: r2(x.stock),
          lastSold: at,
          idleDays: at ? Math.floor((Date.now() - new Date(at)) / 86400000) : null,
          value: r2(Number(x.stock) * cost),
        };
      })
      .filter((r) => !r.lastSold || new Date(r.lastSold) < since)
      .sort((a, b) => (b.idleDays ?? 99999) - (a.idleDays ?? 99999));
    const columns = [col('sku', 'Code'), col('name', 'Product'), col('category', 'Category'), col('qty', 'On hand', 'number'), col('lastSold', 'Last sold', 'date'), col('idleDays', 'Days idle', 'number'), col('value', 'Stock value', 'money')];
    columns.find((c) => c.key === 'idleDays').noTotal = true;
    return finish(columns, rows, { note: `In stock and not sold in the last ${days} days (or never).` });
  },
};

const gstSummary = {
  code: 'gst-summary',
  group: 'MIS',
  title: 'GST Summary',
  description: 'Output tax on sales against input tax on purchases, month by month.',
  icon: 'Landmark',
  requires: ['invoices.view'],
  filters: ['dateRange'],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const companyId = oid(ctx.companyId);
    const month = (field) => ({ $dateToString: { format: '%Y-%m', date: `$${field}`, timezone: ctx.tz } });
    const sumTax = (dateField) => [
      { $group: { _id: month(dateField), taxable: { $sum: '$taxableTotal' }, cgst: { $sum: '$taxBreakup.cgst' }, sgst: { $sum: '$taxBreakup.sgst' }, igst: { $sum: '$taxBreakup.igst' } } },
    ];
    const base = { companyId, isDeleted: { $ne: true } };
    const [sales, salesRet, purch, purchRet] = await Promise.all([
      Invoice.aggregate([{ $match: { ...base, status: { $in: LIVE_INVOICE }, invoiceDate: { $gte: from, $lt: to } } }, ...sumTax('invoiceDate')]),
      CreditNote.aggregate([{ $match: { ...base, status: 'ISSUED', creditNoteDate: { $gte: from, $lt: to } } }, ...sumTax('creditNoteDate')]),
      PurchaseBill.aggregate([{ $match: { ...base, status: { $in: LIVE_BILL }, supplierInvoiceDate: { $gte: from, $lt: to } } }, ...sumTax('supplierInvoiceDate')]),
      PurchaseReturn.aggregate([{ $match: { ...base, status: 'POSTED', returnDate: { $gte: from, $lt: to } } }, ...sumTax('returnDate')]),
    ]);
    const months = new Map();
    const put = (list, sign, side) =>
      list.forEach((m) => {
        const row = months.get(m._id) || { key: m._id, outTaxable: 0, outTax: 0, inTaxable: 0, inTax: 0 };
        const tax = Number(m.cgst || 0) + Number(m.sgst || 0) + Number(m.igst || 0);
        row[`${side}Taxable`] += sign * Number(m.taxable || 0);
        row[`${side}Tax`] += sign * tax;
        months.set(m._id, row);
      });
    put(sales, 1, 'out');
    put(salesRet, -1, 'out');
    put(purch, 1, 'in');
    put(purchRet, -1, 'in');
    const rows = [...months.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => ({
        month: dayjs(`${r.key}-01`).format('MMM YYYY'),
        outTaxable: r2(r.outTaxable),
        outTax: r2(r.outTax),
        inTaxable: r2(r.inTaxable),
        inTax: r2(r.inTax),
        net: r2(r.outTax - r.inTax),
      }));
    const columns = [
      col('month', 'Month'),
      col('outTaxable', 'Sales taxable', 'money'),
      col('outTax', 'Output tax', 'money'),
      col('inTaxable', 'Purchase taxable', 'money'),
      col('inTax', 'Input tax', 'money'),
      col('net', 'Net tax payable', 'money'),
    ];
    return finish(columns, rows, {
      note: 'Net of sales returns and purchase returns. A guide for filing - reconcile with your GST portal (GSTR-1 / 2B / 3B) before paying.',
    });
  },
};

const salesmanPerformance = {
  code: 'salesman-performance',
  group: 'MIS',
  title: 'Salesman Performance',
  description: 'Orders, billing and collections per salesman for the period.',
  icon: 'Award',
  requires: ['orders.view'],
  filters: ['dateRange', 'salesman'],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const companyId = oid(ctx.companyId);
    const base = { companyId, isDeleted: { $ne: true } };
    const scopeIds = ctx.user.role === 'SALESMAN' ? [oid(ctx.user.id)] : ctx.user.role === 'MANAGER' ? [ctx.user.id, ...(ctx.user.teamIds || [])].map(oid) : null;
    const repMatch = (field) => (p.salesman ? { [field]: oid(p.salesman) } : scopeIds ? { [field]: { $in: scopeIds } } : {});
    const [orders, invoices, payments] = await Promise.all([
      Order.aggregate([
        { $match: { ...base, ...repMatch('salesman'), orderDate: { $gte: from, $lt: to }, status: { $nin: ['DRAFT', 'CANCELLED', 'REJECTED'] } } },
        { $group: { _id: '$salesman', orders: { $sum: 1 }, orderValue: { $sum: '$total' }, customers: { $addToSet: '$customerId' } } },
      ]),
      Invoice.aggregate([
        { $match: { ...base, ...repMatch('salesman'), invoiceDate: { $gte: from, $lt: to }, status: { $in: LIVE_INVOICE } } },
        { $group: { _id: '$salesman', invoiced: { $sum: '$total' } } },
      ]),
      Payment.aggregate([
        { $match: { ...base, ...repMatch('collectedBy'), paymentDate: { $gte: from, $lt: to }, status: 'RECEIVED' } },
        { $group: { _id: '$collectedBy', collected: { $sum: '$amount' } } },
      ]),
    ]);
    const acc = new Map();
    const row = (id) => {
      const k = String(id || '');
      if (!acc.has(k)) acc.set(k, { id: k, orders: 0, orderValue: 0, customers: 0, invoiced: 0, collected: 0 });
      return acc.get(k);
    };
    orders.forEach((o) => Object.assign(row(o._id), { orders: o.orders, orderValue: o.orderValue, customers: o.customers.length }));
    invoices.forEach((i) => (row(i._id).invoiced = i.invoiced));
    payments.forEach((x) => (row(x._id).collected = x.collected));
    const reps = await names(User, [...acc.keys()]);
    const rows = [...acc.values()]
      .map((r) => ({
        name: reps.get(r.id) || 'Not assigned',
        orders: r.orders,
        customers: r.customers,
        orderValue: r2(r.orderValue),
        avgOrder: r.orders ? r2(r.orderValue / r.orders) : 0,
        invoiced: r2(r.invoiced),
        collected: r2(r.collected),
      }))
      .sort((a, b) => b.orderValue - a.orderValue);
    const columns = [
      col('name', 'Salesman'),
      col('orders', 'Orders', 'number'),
      col('customers', 'Shops ordered', 'number'),
      col('orderValue', 'Order value', 'money'),
      col('avgOrder', 'Avg order', 'money'),
      col('invoiced', 'Invoiced', 'money'),
      col('collected', 'Collected', 'money'),
    ];
    columns.find((c) => c.key === 'avgOrder').noTotal = true;
    return finish(columns, rows);
  },
};

const targetAchievement = {
  code: 'target-achievement',
  group: 'MIS',
  title: 'Target vs Achievement',
  description: 'Each salesman’s targets for periods in the range and how far they got.',
  icon: 'Target',
  requires: ['fieldforce.targets.view'],
  filters: ['dateRange', 'salesman'],
  run: async (p, ctx) => {
    const { from, to } = windowOf(p, ctx.tz);
    const docs = await Target.find({
      startDate: { $lt: to },
      endDate: { $gte: from },
      ...by(p, 'salesman'),
      ...ownScope(ctx, 'salesman', false),
    })
      .sort({ startDate: 1, salesmanName: 1 })
      .lean();
    const rows = docs.map((t) => ({
      name: t.salesmanName || t.name,
      period: t.periodLabel || t.periodKey,
      target: r2(t.targetValue),
      achieved: r2(t.achievedValue),
      percent: t.targetValue ? r2((t.achievedValue / t.targetValue) * 100) : 0,
      orders: t.achievedOrders,
      targetOrders: t.targetOrders,
      visits: t.achievedVisits,
    }));
    const columns = [
      col('name', 'Salesman'),
      col('period', 'Period'),
      col('target', 'Target', 'money'),
      col('achieved', 'Achieved', 'money'),
      col('percent', 'Achieved %', 'percent'),
      col('orders', 'Orders', 'number'),
      col('targetOrders', 'Order target', 'number'),
      col('visits', 'Visits', 'number'),
    ];
    const out = finish(columns, rows);
    out.totals.percent = out.totals.target ? r2((out.totals.achieved / out.totals.target) * 100) : 0;
    return out;
  },
};

// ===========================================================================
// Listings
// ===========================================================================

const customerList = {
  code: 'customer-list',
  group: 'LISTING',
  title: 'Customer List',
  description: 'All customers with contact, GSTIN, route, salesman, credit and outstanding.',
  icon: 'Users',
  requires: ['customers.view'],
  filters: ['salesman'],
  run: async (p, ctx) => {
    const docs = await Customer.find({ ...by(p, 'salesman', 'assignedTo'), ...ownScope(ctx, 'assignedTo', false) })
      .select('code name type phone email gstin address assignedTo route creditLimit creditDays outstanding isActive')
      .populate('route', 'name')
      .sort({ name: 1 })
      .lean();
    const reps = await names(User, docs.map((d) => d.assignedTo));
    const rows = docs.map((d) => ({
      code: d.code,
      name: d.name,
      type: d.type,
      phone: d.phone,
      gstin: d.gstin,
      city: d.address?.city || '',
      route: d.route?.name || '',
      salesman: reps.get(String(d.assignedTo)) || '',
      creditLimit: d.creditLimit,
      creditDays: d.creditDays,
      outstanding: d.outstanding,
      status: d.isActive === false ? 'Inactive' : 'Active',
    }));
    const columns = [
      col('code', 'Code'),
      col('name', 'Customer'),
      col('type', 'Type'),
      col('phone', 'Phone'),
      col('gstin', 'GSTIN'),
      col('city', 'City'),
      col('route', 'Route'),
      col('salesman', 'Salesman'),
      col('creditLimit', 'Credit limit', 'money'),
      col('creditDays', 'Credit days', 'number'),
      col('outstanding', 'Outstanding', 'money'),
      col('status', 'Status'),
    ];
    columns.find((c) => c.key === 'creditDays').noTotal = true;
    return finish(columns, rows);
  },
};

const productList = {
  code: 'product-list',
  group: 'LISTING',
  title: 'Product & Price List',
  description: 'Products with HSN, GST, MRP, selling and dealer price and stock.',
  icon: 'Package',
  requires: ['products.view'],
  filters: ['includeZero'],
  run: async (p, ctx) => {
    const docs = await Product.find({ ...(p.includeZero === 'true' ? {} : { isActive: { $ne: false } }) })
      .select('sku name category brand unit hsnCode gstRate mrp sellingPrice dealerPrice purchasePrice stock isActive')
      .sort({ name: 1 })
      .lean();
    const rows = docs.map((d) => ({
      sku: d.sku,
      name: d.name,
      category: d.category,
      brand: d.brand,
      unit: d.unit,
      hsn: d.hsnCode,
      gst: d.gstRate,
      mrp: d.mrp,
      sellingPrice: d.sellingPrice,
      dealerPrice: d.dealerPrice,
      purchasePrice: d.purchasePrice,
      stock: d.stock,
    }));
    const columns = [
      col('sku', 'Code'),
      col('name', 'Product'),
      col('category', 'Category'),
      col('brand', 'Brand'),
      col('unit', 'Unit'),
      col('hsn', 'HSN'),
      col('gst', 'GST %', 'percent'),
      col('mrp', 'MRP', 'money'),
      col('sellingPrice', 'Selling', 'money'),
      col('dealerPrice', 'Dealer', 'money'),
      ...(ctx.can('products.cost.view') ? [col('purchasePrice', 'Last purchase', 'money')] : []),
      col('stock', 'Stock', 'number'),
    ].map((c) => (['mrp', 'sellingPrice', 'dealerPrice', 'purchasePrice', 'gst'].includes(c.key) ? { ...c, noTotal: true } : c));
    return finish(columns, rows, { totals: {} });
  },
};

const supplierList = {
  code: 'supplier-list',
  group: 'LISTING',
  title: 'Supplier List',
  description: 'Suppliers with contact, GSTIN, credit days and what you owe them.',
  icon: 'Truck',
  requires: ['products.view'],
  filters: [],
  run: async () => {
    const docs = await Supplier.find({}).select('code name contactPerson phone email gstin address creditDays outstanding isActive').sort({ name: 1 }).lean();
    const rows = docs.map((d) => ({
      code: d.code,
      name: d.name,
      contact: d.contactPerson,
      phone: d.phone,
      gstin: d.gstin,
      city: d.address?.city || '',
      state: d.address?.state || '',
      creditDays: d.creditDays,
      outstanding: d.outstanding,
      status: d.isActive === false ? 'Inactive' : 'Active',
    }));
    const columns = [
      col('code', 'Code'),
      col('name', 'Supplier'),
      col('contact', 'Contact'),
      col('phone', 'Phone'),
      col('gstin', 'GSTIN'),
      col('city', 'City'),
      col('state', 'State'),
      col('creditDays', 'Credit days', 'number'),
      col('outstanding', 'We owe', 'money'),
      col('status', 'Status'),
    ];
    columns.find((c) => c.key === 'creditDays').noTotal = true;
    return finish(columns, rows);
  },
};

const lowStockList = {
  code: 'low-stock-list',
  group: 'LISTING',
  title: 'Low Stock List',
  description: 'Products at or below their reorder level - what to buy next.',
  icon: 'AlertTriangle',
  requires: ['inventory.view'],
  filters: [],
  run: async () => {
    const docs = await Product.find({ isActive: { $ne: false }, $expr: { $lte: ['$stock', '$lowStockLevel'] } })
      .select('sku name category unit stock lowStockLevel')
      .sort({ stock: 1 })
      .lean();
    const rows = docs.map((d) => ({
      sku: d.sku,
      name: d.name,
      category: d.category,
      unit: d.unit,
      stock: d.stock,
      reorderAt: d.lowStockLevel,
      shortBy: r2(Math.max(0, Number(d.lowStockLevel || 0) - Number(d.stock || 0))),
    }));
    const columns = [col('sku', 'Code'), col('name', 'Product'), col('category', 'Category'), col('unit', 'Unit'), col('stock', 'On hand', 'number'), col('reorderAt', 'Reorder level', 'number'), col('shortBy', 'Short by', 'number')];
    return finish(columns, rows);
  },
};

export const REPORTS = [
  salesRegister,
  salesReturnRegister,
  receiptRegister,
  orderRegister,
  purchaseRegister,
  purchaseReturnRegister,
  supplierPaymentRegister,
  grnRegister,
  stockRegister,
  grossProfit,
  receivableAgeing,
  payableAgeing,
  stockValuation,
  slowMoving,
  gstSummary,
  salesmanPerformance,
  targetAchievement,
  customerList,
  productList,
  supplierList,
  lowStockList,
];

export const findReport = (code) => REPORTS.find((r) => r.code === code) || null;

/**
 * Can this user (or role) open this report?
 *  1. the company's plan includes the report's module;
 *  2. the admin's report-wise access list, if the report has one, names the
 *     role - otherwise the role has the report group's permission;
 *  3. always: the permissions for the data the report shows (so ticking a
 *     report for a role never leaks costs or purchase data to it).
 * `can` answers a permission for the user or role being checked.
 */
export const canRun = (report, { can, company, settings, role }) => {
  if (!report) return false;
  if (report.module && company?.featureFlags?.[report.module] === false) return false;
  const listed = settings?.reportAccess?.[report.code];
  const open = Array.isArray(listed) ? role === 'COMPANY_ADMIN' || listed.includes(role) : can(REPORT_GROUPS[report.group].permission);
  return open && (report.requires || []).every((perm) => can(perm));
};

/** The report-data permissions a role is missing for a report (why it cannot be ticked). */
export const missingFor = (report, can) => (report.requires || []).filter((perm) => !can(perm));
