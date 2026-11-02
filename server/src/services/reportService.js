import mongoose from 'mongoose';
import dayjs from 'dayjs';

import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import StockBalance from '../models/StockBalance.js';
import StockMovement from '../models/StockMovement.js';
import Warehouse from '../models/Warehouse.js';
import User from '../models/User.js';
import Visit from '../models/Visit.js';
import Attendance from '../models/Attendance.js';
import Expense from '../models/Expense.js';
import Target from '../models/Target.js';

import { INVOICE_STATUS, PAYMENT_STATUS } from '../config/constants.js';

/**
 * Phase 8 - Report aggregations.
 *
 * Every function is a pure read: it takes a companyId + a resolved window and
 * returns plain objects ready to serialise. Money is rounded to 2dp at the edge
 * so the client never has to. Trend reports bucket by day/week/month via
 * $dateTrunc; balance reports (receivables, inventory) ignore the window and
 * reflect the live state.
 */

const oid = (id) => new mongoose.Types.ObjectId(id);
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// ---------------------------------------------------------------------------
// Window + bucket helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the client's dateFrom/dateTo into an inclusive [from, to] pair.
 * Trend reports default to the last 30 days when no window is supplied.
 */
export const resolveWindow = (query = {}, { defaultDays = 30 } = {}) => {
  const { dateFrom, dateTo } = query;
  let from = dateFrom && !Number.isNaN(Date.parse(dateFrom)) ? dayjs(dateFrom).startOf('day') : null;
  let to = dateTo && !Number.isNaN(Date.parse(dateTo)) ? dayjs(dateTo).endOf('day') : null;

  if (!from && !to) {
    to = dayjs().endOf('day');
    from = to.subtract(defaultDays - 1, 'day').startOf('day');
  } else if (from && !to) {
    to = from.add(defaultDays - 1, 'day').endOf('day');
  } else if (!from && to) {
    from = to.subtract(defaultDays - 1, 'day').startOf('day');
  }
  // Guard against an inverted range.
  if (from.isAfter(to)) [from, to] = [to, from];

  return { from: from.toDate(), to: to.toDate(), fromIso: from.format('YYYY-MM-DD'), toIso: to.format('YYYY-MM-DD') };
};

/** A Mongo $match fragment restricting `field` to the resolved window. */
const inWindow = (field, { from, to }) => ({ [field]: { $gte: from, $lte: to } });

/** $dateTrunc bucket expression for a date field at the given granularity. */
const bucketOf = (field, granularity = 'day') => ({
  $dateTrunc: { date: `$${field}`, unit: granularity },
});

/** Fill missing buckets so charts show a continuous series. */
const fillSeries = (rows, { from, to }, granularity = 'day') => {
  const step = { day: 1, week: 7, month: 30 }[granularity] || 1;
  const unit = granularity === 'month' ? 'month' : granularity === 'week' ? 'week' : 'day';
  const byKey = new Map(rows.map((r) => [String(r._id), r]));

  const out = [];
  let cursor = dayjs(from).startOf(unit === 'week' ? 'week' : unit);
  const end = dayjs(to);
  // Hard cap so a silly range can never spin forever.
  let guard = 0;
  while (cursor.isBefore(end) && guard < 1000) {
    const key = cursor.format(unit === 'week' ? 'GGGG-[W]WW' : 'YYYY-MM-DD');
    const hit = byKey.get(key) || byKey.get(cursor.startOf('day').format('YYYY-MM-DD'));
    out.push({
      period: key,
      date: cursor.toDate(),
      count: hit?.count ?? 0,
      value: round2(hit?.value ?? 0),
    });
    cursor = cursor.add(step, 'day');
    guard += 1;
  }
  return out;
};

// ===========================================================================
// SALES — invoiced revenue over time + breakdowns
// ===========================================================================

/**
 * Sales report: time series of issued invoices + top customers / salesmen /
 * products / payment modes. Drafts and cancelled invoices are excluded because
 * they represent no revenue.
 * `scope` optionally narrows to a salesman (role scoping is applied by caller).
 */
export const salesReport = async ({ companyId, window, granularity = 'day', top = 10, scope = {} }) => {
  const tenant = { companyId: oid(companyId), isDeleted: { $ne: true } };
  const billable = { $nin: [INVOICE_STATUS.DRAFT, INVOICE_STATUS.CANCELLED] };
  const base = { ...tenant, status: billable, ...inWindow('invoiceDate', window), ...scope };

  const [series, byCustomer, bySalesman, byProduct, byMode, totals] = await Promise.all([
    Invoice.aggregate([
      { $match: base },
      {
        $group: {
          _id: bucketOf('invoiceDate', granularity),
          count: { $sum: 1 },
          value: { $sum: '$total' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Invoice.aggregate([
      { $match: base },
      {
        $group: {
          _id: '$customerId',
          name: { $first: '$customerName' },
          code: { $first: '$customerCode' },
          count: { $sum: 1 },
          value: { $sum: '$total' },
          paid: { $sum: '$amountPaid' },
        },
      },
      { $sort: { value: -1 } },
      { $limit: top },
    ]),
    Invoice.aggregate([
      { $match: { ...base, salesman: { $ne: null } } },
      {
        $group: {
          _id: '$salesman',
          count: { $sum: 1 },
          value: { $sum: '$total' },
          paid: { $sum: '$amountPaid' },
        },
      },
      { $sort: { value: -1 } },
      { $limit: top },
    ]),
    Invoice.aggregate([
      { $match: base },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $first: '$items.name' },
          sku: { $first: '$items.sku' },
          qty: { $sum: '$items.qty' },
          value: { $sum: '$items.lineTotal' },
        },
      },
      { $sort: { value: -1 } },
      { $limit: top },
    ]),
    Invoice.aggregate([
      { $match: base },
      {
        $group: {
          _id: '$paymentMode',
          count: { $sum: 1 },
          value: { $sum: '$total' },
        },
      },
      { $sort: { value: -1 } },
    ]),
    Invoice.aggregate([
      { $match: base },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          value: { $sum: '$total' },
          paid: { $sum: '$amountPaid' },
          tax: { $sum: '$taxTotal' },
          discount: { $sum: '$discountTotal' },
          avg: { $avg: '$total' },
        },
      },
    ]),
  ]);

  // Hydrate names for the salesman breakdown.
  const salesmanIds = bySalesman.map((r) => r._id);
  const salesmen = salesmanIds.length
    ? await User.find({ _id: { $in: salesmanIds } })
        .select('name email role')
        .lean()
    : [];
  const userById = new Map(salesmen.map((u) => [String(u._id), u]));

  const t = totals[0] || {};
  return {
    window: { from: window.fromIso, to: window.toIso, granularity },
    summary: {
      count: t.count ?? 0,
      total: round2(t.value),
      collected: round2(t.paid),
      tax: round2(t.tax),
      discount: round2(t.discount),
      average: round2(t.avg),
      outstanding: round2(Number(t.value || 0) - Number(t.paid || 0)),
    },
    series: fillSeries(series, window, granularity),
    byCustomer: byCustomer.map((r) => ({
      id: r._id,
      name: r.name || '—',
      code: r.code || '',
      count: r.count,
      value: round2(r.value),
      outstanding: round2(Number(r.value || 0) - Number(r.paid || 0)),
    })),
    bySalesman: bySalesman.map((r) => ({
      id: r._id,
      name: userById.get(String(r._id))?.name || '—',
      role: userById.get(String(r._id))?.role || '',
      count: r.count,
      value: round2(r.value),
      outstanding: round2(Number(r.value || 0) - Number(r.paid || 0)),
    })),
    byProduct: byProduct.map((r) => ({
      id: r._id,
      name: r.name || '—',
      sku: r.sku || '',
      qty: round2(r.qty),
      value: round2(r.value),
    })),
    byPaymentMode: byMode.map((r) => ({
      mode: r._id || '—',
      count: r.count,
      value: round2(r.value),
    })),
  };
};

// ===========================================================================
// RECEIVABLES — aging of outstanding invoices (live balance, not windowed)
// ===========================================================================

export const receivablesReport = async ({ companyId, buckets = 30, top = 10, customerId = null }) => {
  const tenant = { companyId: oid(companyId), isDeleted: { $ne: true } };
  const open = { status: { $nin: [INVOICE_STATUS.DRAFT, INVOICE_STATUS.CANCELLED] } };
  const base = { ...tenant, ...open };
  if (customerId) base.customerId = oid(customerId);

  // Pull open invoices once; aging is computed in JS against today so the
  // brackets are exact and easy to reason about.
  const rows = await Invoice.aggregate([
    { $match: base },
    {
      $project: {
        invoiceNo: 1,
        invoiceDate: 1,
        dueDate: 1,
        customerId: 1,
        customerName: 1,
        customerCode: 1,
        salesman: 1,
        total: 1,
        amountPaid: 1,
        creditNoteTotal: 1,
        outstanding: {
          $max: [
            0,
            { $subtract: [{ $subtract: ['$total', '$amountPaid'] }, '$creditNoteTotal'] },
          ],
        },
      },
    },
    { $match: { outstanding: { $gt: 0 } } },
    { $sort: { dueDate: 1, invoiceDate: 1 } },
  ]);

  const today = dayjs().startOf('day');
  const edges = [buckets, buckets * 2, buckets * 3];
  const labels = [
    `Current (0-${edges[0]}d)`,
    `${edges[0] + 1}-${edges[1]}d`,
    `${edges[1] + 1}-${edges[2]}d`,
    `Over ${edges[2]}d`,
  ];
  const bucketsOut = labels.map((label, i) => ({ label, index: i, count: 0, value: 0 }));

  const byCustomer = new Map();
  let total = 0;
  let overdueCount = 0;
  let overdueValue = 0;

  for (const r of rows) {
    // Overdue is measured from the due date (or invoice date when none set).
    const anchor = r.dueDate || r.invoiceDate;
    const overdueBy = today.diff(dayjs(anchor).startOf('day'), 'day');
    const isOverdue = overdueBy > 0;
    const idx = overdueBy <= 0 ? 0 : overdueBy <= edges[0] ? 0 : overdueBy <= edges[1] ? 1 : overdueBy <= edges[2] ? 2 : 3;

    bucketsOut[idx].count += 1;
    bucketsOut[idx].value = round2(bucketsOut[idx].value + r.outstanding);
    total = round2(total + r.outstanding);
    if (isOverdue) {
      overdueCount += 1;
      overdueValue = round2(overdueValue + r.outstanding);
    }

    const key = String(r.customerId);
    const prev = byCustomer.get(key) || { id: key, name: r.customerName || '—', code: r.customerCode || '', count: 0, value: 0, oldestDays: 0 };
    prev.count += 1;
    prev.value = round2(prev.value + r.outstanding);
    prev.oldestDays = Math.max(prev.oldestDays, Math.max(0, overdueBy));
    byCustomer.set(key, prev);
  }

  return {
    summary: {
      total: round2(total),
      invoiceCount: rows.length,
      overdueCount,
      overdueValue: round2(overdueValue),
      overduePercent: total > 0 ? round2((overdueValue / total) * 100) : 0,
    },
    buckets: bucketsOut.map((b) => ({ ...b, value: round2(b.value) })),
    byCustomer: [...byCustomer.values()].sort((a, b) => b.value - a.value).slice(0, top),
    invoices: rows.slice(0, 200).map((r) => ({
      id: r._id,
      invoiceNo: r.invoiceNo,
      invoiceDate: r.invoiceDate,
      dueDate: r.dueDate,
      customerId: r.customerId,
      customerName: r.customerName || '—',
      total: round2(r.total),
      outstanding: round2(r.outstanding),
    })),
  };
};

// ===========================================================================
// COLLECTIONS — money received over time + by mode / collector
// ===========================================================================

export const collectionsReport = async ({ companyId, window, granularity = 'day', top = 10, scope = {} }) => {
  const tenant = { companyId: oid(companyId), isDeleted: { $ne: true } };
  const received = { status: { $nin: [PAYMENT_STATUS.DRAFT, PAYMENT_STATUS.CANCELLED, PAYMENT_STATUS.BOUNCED] } };
  const base = { ...tenant, ...received, ...inWindow('paymentDate', window), ...scope };

  const [series, byMode, byCollector, totals] = await Promise.all([
    Payment.aggregate([
      { $match: base },
      { $group: { _id: bucketOf('paymentDate', granularity), count: { $sum: 1 }, value: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]),
    Payment.aggregate([
      { $match: base },
      { $group: { _id: '$mode', count: { $sum: 1 }, value: { $sum: '$amount' }, applied: { $sum: '$amountApplied' } } },
      { $sort: { value: -1 } },
    ]),
    Payment.aggregate([
      { $match: { ...base, collectedBy: { $ne: null } } },
      { $group: { _id: '$collectedBy', count: { $sum: 1 }, value: { $sum: '$amount' } } },
      { $sort: { value: -1 } },
      { $limit: top },
    ]),
    Payment.aggregate([
      { $match: base },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          value: { $sum: '$amount' },
          applied: { $sum: '$amountApplied' },
          advance: { $sum: '$unappliedAmount' },
        },
      },
    ]),
  ]);

  const collectorIds = byCollector.map((r) => r._id);
  const collectors = collectorIds.length
    ? await User.find({ _id: { $in: collectorIds } }).select('name role').lean()
    : [];
  const userById = new Map(collectors.map((u) => [String(u._id), u]));

  const t = totals[0] || {};
  return {
    window: { from: window.fromIso, to: window.toIso, granularity },
    summary: {
      count: t.count ?? 0,
      total: round2(t.value),
      applied: round2(t.applied),
      advance: round2(t.advance),
      average: t.count ? round2(Number(t.value || 0) / t.count) : 0,
    },
    series: fillSeries(series, window, granularity),
    byMode: byMode.map((r) => ({
      mode: r._id || '—',
      count: r.count,
      value: round2(r.value),
      applied: round2(r.applied),
    })),
    byCollector: byCollector.map((r) => ({
      id: r._id,
      name: userById.get(String(r._id))?.name || '—',
      role: userById.get(String(r._id))?.role || '',
      count: r.count,
      value: round2(r.value),
    })),
  };
};

// ===========================================================================
// INVENTORY — stock valuation + movement over time + low stock
// ===========================================================================

export const inventoryReport = async ({ companyId, window, granularity = 'day', top = 10, warehouseId = null }) => {
  const tenant = { companyId: oid(companyId), isDeleted: { $ne: true } };
  const balMatch = { ...tenant };
  if (warehouseId) balMatch.warehouse = oid(warehouseId);
  const movMatch = { ...tenant, ...inWindow('movedAt', window) };
  if (warehouseId) movMatch.warehouse = oid(warehouseId);

  const [byWarehouse, movementSeries, byType, lowStock, valuation] = await Promise.all([
    StockBalance.aggregate([
      { $match: balMatch },
      {
        $group: {
          _id: '$warehouse',
          lines: { $sum: 1 },
          qty: { $sum: '$qty' },
          value: { $sum: { $multiply: ['$qty', '$lastCost'] } },
        },
      },
      { $sort: { value: -1 } },
    ]),
    StockMovement.aggregate([
      { $match: movMatch },
      { $group: { _id: bucketOf('movedAt', granularity), count: { $sum: 1 }, value: { $sum: '$value' } } },
      { $sort: { _id: 1 } },
    ]),
    StockMovement.aggregate([
      { $match: movMatch },
      { $group: { _id: '$type', count: { $sum: 1 }, qty: { $sum: '$qty' }, value: { $sum: '$value' } } },
      { $sort: { value: -1 } },
    ]),
    Product.find({ companyId: oid(companyId), isDeleted: { $ne: true }, isActive: { $ne: false }, $expr: { $gt: ['$lowStockLevel', 0] } })
      .select('name sku unit stock lowStockLevel category brand')
      .lean(),
    StockBalance.aggregate([
      { $match: balMatch },
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
  ]);

  // Hydrate warehouse + product names.
  const warehouseIds = byWarehouse.map((r) => r._id).filter(Boolean);
  const warehouses = warehouseIds.length
    ? await Warehouse.find({ _id: { $in: warehouseIds } }).select('name code').lean()
    : [];
  const warehouseById = new Map(warehouses.map((w) => [String(w._id), w]));

  const low = lowStock
    .filter((p) => Number(p.stock || 0) <= Number(p.lowStockLevel || 0))
    .sort((a, b) => Number(a.stock || 0) - Number(b.lowStockLevel || 0))
    .slice(0, top);

  const v = valuation[0] || {};
  return {
    window: { from: window.fromIso, to: window.toIso, granularity },
    summary: {
      lines: v.lines ?? 0,
      qty: round2(v.qty),
      reserved: round2(v.reserved),
      available: round2(Number(v.qty || 0) - Number(v.reserved || 0)),
      stockValue: round2(v.value),
      lowStockCount: low.length,
      warehouseCount: warehouseIds.length,
    },
    byWarehouse: byWarehouse.map((r) => ({
      id: r._id,
      name: warehouseById.get(String(r._id))?.name || 'Unassigned',
      code: warehouseById.get(String(r._id))?.code || '',
      lines: r.lines,
      qty: round2(r.qty),
      value: round2(r.value),
    })),
    series: fillSeries(movementSeries, window, granularity),
    byType: byType.map((r) => ({
      type: r._id || '—',
      count: r.count,
      qty: round2(r.qty),
      value: round2(r.value),
    })),
    lowStock: low.map((p) => ({
      id: p._id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      stock: round2(p.stock),
      lowStockLevel: round2(p.lowStockLevel),
      category: p.category || '',
      brand: p.brand || '',
    })),
  };
};

// ===========================================================================
// FIELD FORCE — visits, attendance, expenses, targets
// ===========================================================================

export const fieldForceReport = async ({ companyId, window, granularity = 'day', top = 10, salesman = null }) => {
  const tenant = { companyId: oid(companyId), isDeleted: { $ne: true } };

  const visitMatch = { ...tenant, ...inWindow('visitDay', window) };
  const attMatch = { ...tenant, ...inWindow('day', window) };
  const expMatch = { ...tenant, ...inWindow('expenseDate', window) };
  if (salesman) {
    visitMatch.salesman = oid(salesman);
    attMatch.user = oid(salesman);
    expMatch.claimant = oid(salesman);
  }

  const [visitSeries, visitByOutcome, visitBySalesman, attByUser, expByCategory, expSeries, targets] =
    await Promise.all([
      Visit.aggregate([
        { $match: visitMatch },
        { $group: { _id: bucketOf('visitDay', granularity), count: { $sum: 1 }, value: { $sum: '$orderValue' } } },
        { $sort: { _id: 1 } },
      ]),
      Visit.aggregate([
        { $match: visitMatch },
        { $group: { _id: '$outcome', count: { $sum: 1 }, value: { $sum: '$orderValue' } } },
        { $sort: { count: -1 } },
      ]),
      Visit.aggregate([
        { $match: { ...visitMatch, salesman: { $ne: null } } },
        {
          $group: {
            _id: '$salesman',
            visits: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
            skipped: { $sum: { $cond: [{ $eq: ['$status', 'SKIPPED'] }, 1, 0] } },
            value: { $sum: '$orderValue' },
            avgStay: { $avg: '$durationMinutes' },
          },
        },
        { $sort: { visits: -1 } },
        { $limit: top },
      ]),
      Attendance.aggregate([
        { $match: attMatch },
        {
          $group: {
            _id: '$user',
            days: { $sum: 1 },
            present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
            worked: { $sum: '$workedMinutes' },
            overtime: { $sum: '$overtimeMinutes' },
          },
        },
        { $sort: { worked: -1 } },
        { $limit: top },
      ]),
      Expense.aggregate([
        { $match: expMatch },
        { $group: { _id: '$category', count: { $sum: 1 }, value: { $sum: '$amount' }, approved: { $sum: '$approvedAmount' } } },
        { $sort: { value: -1 } },
      ]),
      Expense.aggregate([
        { $match: expMatch },
        { $group: { _id: bucketOf('expenseDate', granularity), count: { $sum: 1 }, value: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
      ]),
      Target.find({ companyId: oid(companyId), isDeleted: { $ne: true } })
        .select('name periodType periodLabel targetValue achievedValue status salesman route')
        .sort({ achievedValue: -1 })
        .limit(top)
        .lean(),
    ]);

  // Hydrate names.
  const repIds = [
    ...new Set([...visitBySalesman.map((r) => r._id), ...attByUser.map((r) => r._id)].filter(Boolean).map(String)),
  ];
  const reps = repIds.length ? await User.find({ _id: { $in: repIds.map(oid) } }).select('name role').lean() : [];
  const userById = new Map(reps.map((u) => [String(u._id), u]));

  const totalVisitValue = visitByOutcome.reduce((s, r) => s + Number(r.value || 0), 0);
  const totalExp = expByCategory.reduce((s, r) => s + Number(r.value || 0), 0);

  return {
    window: { from: window.fromIso, to: window.toIso, granularity },
    visits: {
      series: fillSeries(visitSeries, window, granularity),
      byOutcome: visitByOutcome.map((r) => ({
        outcome: r._id || '—',
        count: r.count,
        value: round2(r.value),
        share: totalVisitValue > 0 ? round2((Number(r.value || 0) / totalVisitValue) * 100) : 0,
      })),
      bySalesman: visitBySalesman.map((r) => ({
        id: r._id,
        name: userById.get(String(r._id))?.name || '—',
        role: userById.get(String(r._id))?.role || '',
        visits: r.visits,
        completed: r.completed,
        skipped: r.skipped,
        value: round2(r.value),
        avgStay: round2(r.avgStay),
      })),
    },
    attendance: attByUser.map((r) => ({
      id: r._id,
      name: userById.get(String(r._id))?.name || '—',
      days: r.days,
      present: r.present,
      workedHours: round2(Number(r.worked || 0) / 60),
      overtimeHours: round2(Number(r.overtime || 0) / 60),
    })),
    expenses: {
      series: fillSeries(expSeries, window, granularity),
      byCategory: expByCategory.map((r) => ({
        category: r._id || '—',
        count: r.count,
        value: round2(r.value),
        approved: round2(r.approved),
        share: totalExp > 0 ? round2((Number(r.value || 0) / totalExp) * 100) : 0,
      })),
    },
    targets: targets.map((t) => ({
      id: t._id,
      name: t.name,
      periodLabel: t.periodLabel,
      periodType: t.periodType,
      target: round2(t.targetValue),
      achieved: round2(t.achievedValue),
      percent: Number(t.targetValue || 0) > 0 ? round2((Number(t.achievedValue || 0) / Number(t.targetValue || 0)) * 100) : 0,
      status: t.status,
    })),
  };
};

// ===========================================================================
// OVERVIEW — one call powering the report landing KPIs
// ===========================================================================

export const overviewReport = async ({ companyId, window }) => {
  const [sales, collections, receivables] = await Promise.all([
    salesReport({ companyId, window, granularity: 'day', top: 5 }),
    collectionsReport({ companyId, window, granularity: 'day', top: 5 }),
    receivablesReport({ companyId, top: 5 }),
  ]);

  // Low stock / masters are cheap counts.
  const [lowStockCount, productCount, customerCount] = await Promise.all([
    Product.countDocuments({
      companyId: oid(companyId),
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      $expr: { $and: [{ $gt: ['$lowStockLevel', 0] }, { $lte: ['$stock', '$lowStockLevel'] }] },
    }),
    Product.countDocuments({ companyId: oid(companyId), isDeleted: { $ne: true } }),
    Customer.countDocuments({ companyId: oid(companyId), isDeleted: { $ne: true } }),
  ]);

  return {
    window: { from: window.fromIso, to: window.toIso, granularity: 'day' },
    sales: sales.summary,
    collections: collections.summary,
    receivables: receivables.summary,
    inventory: { lowStockCount, productCount, stockValue: 0 },
    masters: { products: productCount, customers: customerCount },
    salesSeries: sales.series,
    collectionsSeries: collections.series,
    topCustomers: sales.byCustomer.slice(0, 5),
  };
};

export default {
  resolveWindow,
  salesReport,
  receivablesReport,
  collectionsReport,
  inventoryReport,
  fieldForceReport,
  overviewReport,
};
