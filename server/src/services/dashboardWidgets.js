import mongoose from 'mongoose';
import dayjs from 'dayjs';

import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import Visit from '../models/Visit.js';
import StockRequest from '../models/StockRequest.js';
import PurchaseBill from '../models/PurchaseBill.js';
import Target from '../models/Target.js';
import { startOfDay, dayKey } from './fieldForceService.js';

/**
 * Dashboard widgets. Each widget is a small, fast summary - a KPI tile, a
 * chart or a short list - with:
 *   roles     who gets it by default (the admin can change this per company)
 *   requires  permissions for the data it shows (always enforced)
 *   module    a plan module it belongs to (e.g. purchase)
 *   load(ctx) the data, scoped to the user (salesman: own, manager: team)
 *
 * Shapes:  kpi  { value, format, hint, trend, tone }
 *          chart { points: [{ label, value }], format }
 *          list { rows: [{ title, subtitle, value, format, to, tone }], empty }
 */

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const LIVE_INVOICE = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];
const A = 'COMPANY_ADMIN';
const M = 'MANAGER';
const C = 'ACCOUNTANT';
const W = 'WAREHOUSE';
const S = 'SALESMAN';

/** Change vs the same days of last month, as a percent (null when nothing to compare). */
const trendOf = (now, before) => (before > 0 ? r2(((now - before) / before) * 100) : null);

const windows = (tz) => {
  // Day and month boundaries in the company's timezone (servers run on UTC).
  const key = dayKey(new Date(), tz); // YYYY-MM-DD, company local
  const today = startOfDay(key, tz);
  const tomorrow = dayjs(today).add(1, 'day').toDate();
  const monthKey = `${key.slice(0, 8)}01`;
  const monthStart = startOfDay(monthKey, tz);
  const daysIn = Number(key.slice(8, 10));
  const lastMonthKey = dayjs(monthKey).subtract(1, 'month').format('YYYY-MM-DD');
  const lastMonthStart = startOfDay(lastMonthKey, tz);
  const lastMonthSameDay = dayjs(lastMonthStart).add(daysIn, 'day').toDate();
  return { today, tomorrow, monthStart, lastMonthStart, lastMonthSameDay };
};

/** { field: me } for a salesman, { field: { $in: team } } for a manager, {} otherwise. */
const scopeOf = (ctx, field) => {
  const { role, id, teamIds = [] } = ctx.user;
  if (role === S) return { [field]: oid(id) };
  if (role === M) return { [field]: { $in: [id, ...teamIds].map(oid) } };
  return {};
};

const sumOf = async (Model, match, field, dateField, from, to) => {
  const [row] = await Model.aggregate([
    { $match: { ...match, [dateField]: { $gte: from, $lt: to } } },
    { $group: { _id: null, total: { $sum: `$${field}` }, count: { $sum: 1 } } },
  ]);
  return { total: r2(row?.total), count: row?.count || 0 };
};

const base = (ctx) => ({ companyId: oid(ctx.companyId), isDeleted: { $ne: true } });

// ===========================================================================

const WIDGETS = [
  {
    key: 'sales-today',
    title: 'Sales today',
    type: 'kpi',
    icon: 'IndianRupee',
    roles: [A, M, C, S],
    requires: ['invoices.view'],
    load: async (ctx) => {
      const w = windows(ctx.tz);
      const match = { ...base(ctx), status: { $in: LIVE_INVOICE }, ...scopeOf(ctx, 'salesman') };
      const [inv, ord] = await Promise.all([
        sumOf(Invoice, match, 'total', 'invoiceDate', w.today, w.tomorrow),
        sumOf(Order, { ...base(ctx), status: { $nin: ['DRAFT', 'CANCELLED', 'REJECTED'] }, ...scopeOf(ctx, 'salesman') }, 'total', 'orderDate', w.today, w.tomorrow),
      ]);
      return { value: inv.total, format: 'money', hint: `${inv.count} invoices · ${ord.count} orders booked (${ord.total.toLocaleString('en-IN')})`, tone: 'brand' };
    },
  },
  {
    key: 'sales-month',
    title: 'Sales this month',
    type: 'kpi',
    icon: 'TrendingUp',
    roles: [A, M, C, S],
    requires: ['invoices.view'],
    load: async (ctx) => {
      const w = windows(ctx.tz);
      const match = { ...base(ctx), status: { $in: LIVE_INVOICE }, ...scopeOf(ctx, 'salesman') };
      const [now, before] = await Promise.all([
        sumOf(Invoice, match, 'total', 'invoiceDate', w.monthStart, w.tomorrow),
        sumOf(Invoice, match, 'total', 'invoiceDate', w.lastMonthStart, w.lastMonthSameDay),
      ]);
      return { value: now.total, format: 'money', hint: `${now.count} invoices`, trend: trendOf(now.total, before.total), tone: 'success' };
    },
  },
  {
    key: 'gross-profit-month',
    title: 'Gross profit this month',
    type: 'kpi',
    icon: 'PiggyBank',
    roles: [A],
    requires: ['invoices.view', 'products.cost.view'],
    load: async (ctx) => {
      const w = windows(ctx.tz);
      const [row] = await Invoice.aggregate([
        { $match: { ...base(ctx), status: { $in: LIVE_INVOICE }, invoiceDate: { $gte: w.monthStart, $lt: w.tomorrow }, ...scopeOf(ctx, 'salesman') } },
        { $unwind: '$items' },
        { $group: { _id: null, sales: { $sum: '$items.taxableAmount' }, cost: { $sum: { $multiply: ['$items.costPrice', '$items.qty'] } } } },
      ]);
      const sales = r2(row?.sales);
      const gp = r2(sales - Number(row?.cost || 0));
      return { value: gp, format: 'money', hint: sales ? `Margin ${r2((gp / sales) * 100)}% on ${sales.toLocaleString('en-IN')} sales` : 'No sales yet', tone: gp < 0 ? 'destructive' : 'success' };
    },
  },
  {
    key: 'collections-month',
    title: 'Collected this month',
    type: 'kpi',
    icon: 'Wallet',
    roles: [A, M, C, S],
    requires: ['payments.view'],
    load: async (ctx) => {
      const w = windows(ctx.tz);
      const match = { ...base(ctx), status: 'RECEIVED', ...scopeOf(ctx, 'collectedBy') };
      const [now, before, today] = await Promise.all([
        sumOf(Payment, match, 'amount', 'paymentDate', w.monthStart, w.tomorrow),
        sumOf(Payment, match, 'amount', 'paymentDate', w.lastMonthStart, w.lastMonthSameDay),
        sumOf(Payment, match, 'amount', 'paymentDate', w.today, w.tomorrow),
      ]);
      return { value: now.total, format: 'money', hint: `Today ${today.total.toLocaleString('en-IN')}`, trend: trendOf(now.total, before.total), tone: 'info' };
    },
  },
  {
    key: 'receivables',
    title: 'Customers owe',
    type: 'kpi',
    icon: 'HandCoins',
    roles: [A, M, C],
    requires: ['invoices.view'],
    load: async (ctx) => {
      const today = startOfDay(new Date(), ctx.tz);
      const match = { ...base(ctx), status: { $in: LIVE_INVOICE }, balanceDue: { $gt: 0 }, ...scopeOf(ctx, 'salesman') };
      const [all] = await Invoice.aggregate([{ $match: match }, { $group: { _id: null, due: { $sum: '$balanceDue' } } }]);
      const [overdue] = await Invoice.aggregate([{ $match: { ...match, dueDate: { $lt: today } } }, { $group: { _id: null, due: { $sum: '$balanceDue' }, n: { $sum: 1 } } }]);
      return { value: r2(all?.due), format: 'money', hint: `${overdue?.n || 0} overdue · ${r2(overdue?.due).toLocaleString('en-IN')}`, tone: overdue?.n ? 'warning' : 'muted' };
    },
  },
  {
    key: 'payables',
    title: 'We owe suppliers',
    type: 'kpi',
    icon: 'Landmark',
    roles: [A, C],
    module: 'purchase',
    requires: ['bills.view'],
    load: async (ctx) => {
      const weekEnd = dayjs(startOfDay(new Date(), ctx.tz)).add(7, 'day').toDate();
      const open = { ...base(ctx), status: { $in: ['POSTED', 'PARTIALLY_PAID'] }, balanceDue: { $gt: 0 } };
      const [all] = await PurchaseBill.aggregate([{ $match: open }, { $group: { _id: null, due: { $sum: '$balanceDue' } } }]);
      const [week] = await PurchaseBill.aggregate([{ $match: { ...open, dueDate: { $lt: weekEnd } } }, { $group: { _id: null, due: { $sum: '$balanceDue' }, n: { $sum: 1 } } }]);
      return { value: r2(all?.due), format: 'money', hint: `${week?.n || 0} bill(s) due in 7 days · ${r2(week?.due).toLocaleString('en-IN')}`, tone: 'warning' };
    },
  },
  {
    key: 'stock-value',
    title: 'Stock value',
    type: 'kpi',
    icon: 'Boxes',
    roles: [A],
    requires: ['inventory.view', 'products.cost.view'],
    load: async (ctx) => {
      const [row] = await Product.aggregate([
        { $match: { ...base(ctx), isActive: { $ne: false } } },
        { $group: { _id: null, value: { $sum: { $multiply: ['$stock', { $cond: [{ $gt: ['$avgCost', 0] }, '$avgCost', '$purchasePrice'] }] } }, items: { $sum: { $cond: [{ $gt: ['$stock', 0] }, 1, 0] } } } },
      ]);
      return { value: r2(row?.value), format: 'money', hint: `${row?.items || 0} products in stock (at average cost)`, tone: 'violet' };
    },
  },
  {
    key: 'low-stock',
    title: 'Low stock',
    type: 'kpi',
    icon: 'PackageX',
    roles: [A, W, M],
    requires: ['inventory.view'],
    load: async (ctx) => {
      const [row] = await Product.aggregate([
        { $match: { ...base(ctx), isActive: { $ne: false }, $expr: { $lte: ['$stock', '$lowStockLevel'] } } },
        { $group: { _id: null, n: { $sum: 1 }, out: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } } } },
      ]);
      return { value: row?.n || 0, format: 'number', hint: `${row?.out || 0} out of stock`, tone: row?.n ? 'destructive' : 'success', to: '/app/reports/low-stock-list' };
    },
  },
  {
    key: 'pending-approvals',
    title: 'Orders to approve',
    type: 'kpi',
    icon: 'ShieldCheck',
    roles: [A, M],
    requires: ['orders.approve'],
    load: async (ctx) => {
      const [row] = await Order.aggregate([
        { $match: { ...base(ctx), status: 'PENDING_APPROVAL', ...scopeOf(ctx, 'salesman') } },
        { $group: { _id: null, n: { $sum: 1 }, value: { $sum: '$total' } } },
      ]);
      return { value: row?.n || 0, format: 'number', hint: `Worth ${r2(row?.value).toLocaleString('en-IN')}`, tone: row?.n ? 'warning' : 'muted', to: '/app/orders?status=PENDING_APPROVAL' };
    },
  },
  {
    key: 'team-today',
    title: 'Team on the field today',
    type: 'kpi',
    icon: 'Users',
    roles: [A, M],
    requires: ['fieldforce.attendance.view'],
    load: async (ctx) => {
      const w = windows(ctx.tz);
      const reps = await User.find({ role: S, isActive: true, ...(ctx.user.role === M ? { _id: { $in: (ctx.user.teamIds || []).map(oid) } } : {}) }).select('_id').lean();
      const ids = reps.map((u) => u._id);
      const [present, visits] = await Promise.all([
        Attendance.countDocuments({ user: { $in: ids }, day: { $gte: w.today, $lt: w.tomorrow }, status: { $in: ['PRESENT', 'HALF_DAY'] } }),
        Visit.countDocuments({ salesman: { $in: ids }, createdAt: { $gte: w.today, $lt: w.tomorrow } }),
      ]);
      return { value: `${present}/${ids.length}`, format: 'text', hint: `${visits} shop visits so far`, tone: 'brand', to: '/app/attendance' };
    },
  },
  {
    key: 'dispatch-pending',
    title: 'Orders to dispatch',
    type: 'kpi',
    icon: 'Truck',
    roles: [A, W, M],
    requires: ['orders.view'],
    load: async (ctx) => {
      const [row] = await Order.aggregate([
        { $match: { ...base(ctx), status: { $in: ['CONFIRMED', 'PARTIALLY_INVOICED', 'FULLY_INVOICED'] } } },
        { $group: { _id: null, n: { $sum: 1 }, value: { $sum: '$total' } } },
      ]);
      return { value: row?.n || 0, format: 'number', hint: `Confirmed, not yet dispatched`, tone: row?.n ? 'warning' : 'success', to: '/app/orders?status=CONFIRMED' };
    },
  },
  {
    key: 'van-requests',
    title: 'Van stock requests',
    type: 'kpi',
    icon: 'ClipboardList',
    roles: [A, W, M],
    requires: ['inventory.view'],
    load: async () => {
      const n = await StockRequest.countDocuments({ status: 'SUBMITTED' });
      return { value: n, format: 'number', hint: 'Waiting for approval', tone: n ? 'warning' : 'muted', to: '/app/stock-requests' };
    },
  },
  {
    key: 'sales-trend',
    title: 'Sales - last 30 days',
    type: 'chart',
    icon: 'LineChart',
    roles: [A, M, C, S],
    requires: ['invoices.view'],
    wide: true,
    load: async (ctx) => {
      const w = windows(ctx.tz);
      const from = dayjs(w.today).subtract(29, 'day').toDate();
      const rows = await Invoice.aggregate([
        { $match: { ...base(ctx), status: { $in: LIVE_INVOICE }, invoiceDate: { $gte: from, $lt: w.tomorrow }, ...scopeOf(ctx, 'salesman') } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$invoiceDate', timezone: ctx.tz } }, total: { $sum: '$total' } } },
      ]);
      const by = new Map(rows.map((x) => [x._id, x.total]));
      const points = Array.from({ length: 30 }, (_, i) => {
        const d = dayjs(from).add(i, 'day');
        return { label: d.format('D MMM'), value: r2(by.get(d.format('YYYY-MM-DD'))) };
      });
      return { points, format: 'money' };
    },
  },
  {
    key: 'top-products',
    title: 'Top products this month',
    type: 'list',
    icon: 'Package',
    roles: [A, M],
    requires: ['invoices.view'],
    load: async (ctx) => {
      const w = windows(ctx.tz);
      const rows = await Invoice.aggregate([
        { $match: { ...base(ctx), status: { $in: LIVE_INVOICE }, invoiceDate: { $gte: w.monthStart, $lt: w.tomorrow }, ...scopeOf(ctx, 'salesman') } },
        { $unwind: '$items' },
        { $group: { _id: '$items.product', name: { $first: '$items.name' }, qty: { $sum: '$items.qty' }, value: { $sum: '$items.taxableAmount' } } },
        { $sort: { value: -1 } },
        { $limit: 5 },
      ]);
      return { rows: rows.map((x) => ({ title: x.name, subtitle: `${r2(x.qty)} sold`, value: r2(x.value), format: 'money' })), empty: 'No sales this month yet' };
    },
  },
  {
    key: 'top-customers',
    title: 'Top customers this month',
    type: 'list',
    icon: 'Store',
    roles: [A, M, C],
    requires: ['invoices.view'],
    load: async (ctx) => {
      const w = windows(ctx.tz);
      const rows = await Invoice.aggregate([
        { $match: { ...base(ctx), status: { $in: LIVE_INVOICE }, invoiceDate: { $gte: w.monthStart, $lt: w.tomorrow }, ...scopeOf(ctx, 'salesman') } },
        { $group: { _id: '$customerId', name: { $first: '$customerName' }, n: { $sum: 1 }, value: { $sum: '$total' } } },
        { $sort: { value: -1 } },
        { $limit: 5 },
      ]);
      return { rows: rows.map((x) => ({ title: x.name, subtitle: `${x.n} invoice(s)`, value: r2(x.value), format: 'money' })), empty: 'No sales this month yet' };
    },
  },
  {
    key: 'salesman-leaderboard',
    title: 'Salesman leaderboard',
    type: 'list',
    icon: 'Award',
    roles: [A, M],
    requires: ['orders.view'],
    load: async (ctx) => {
      const w = windows(ctx.tz);
      const rows = await Order.aggregate([
        { $match: { ...base(ctx), status: { $nin: ['DRAFT', 'CANCELLED', 'REJECTED'] }, orderDate: { $gte: w.monthStart, $lt: w.tomorrow }, salesman: { $ne: null }, ...scopeOf(ctx, 'salesman') } },
        { $group: { _id: '$salesman', n: { $sum: 1 }, value: { $sum: '$total' } } },
        { $sort: { value: -1 } },
        { $limit: 5 },
      ]);
      const names = new Map((await User.find({ _id: { $in: rows.map((x) => x._id) } }).select('name').lean()).map((u) => [String(u._id), u.name]));
      return { rows: rows.map((x, i) => ({ title: `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${names.get(String(x._id)) || '—'}`, subtitle: `${x.n} orders this month`, value: r2(x.value), format: 'money' })), empty: 'No orders booked this month' };
    },
  },
  {
    key: 'overdue-invoices',
    title: 'Overdue invoices',
    type: 'list',
    icon: 'AlarmClock',
    roles: [A, M, C, S],
    requires: ['invoices.view'],
    load: async (ctx) => {
      const today = startOfDay(new Date(), ctx.tz);
      const docs = await Invoice.find({ status: { $in: LIVE_INVOICE }, balanceDue: { $gt: 0 }, dueDate: { $lt: today }, ...scopeOf(ctx, 'salesman') })
        .select('invoiceNo customerName dueDate balanceDue')
        .sort({ dueDate: 1 })
        .limit(5)
        .lean();
      return {
        rows: docs.map((d) => ({ title: d.customerName, subtitle: `${d.invoiceNo} · ${dayjs(today).diff(dayjs(d.dueDate), 'day')} days late`, value: r2(d.balanceDue), format: 'money', tone: 'destructive', to: `/app/invoices/${d._id}` })),
        empty: 'Nothing overdue - nice!',
      };
    },
  },
  {
    key: 'bills-due',
    title: 'Supplier bills due',
    type: 'list',
    icon: 'ReceiptText',
    roles: [A, C],
    module: 'purchase',
    requires: ['bills.view'],
    load: async (ctx) => {
      const weekEnd = dayjs(startOfDay(new Date(), ctx.tz)).add(7, 'day').toDate();
      const docs = await PurchaseBill.find({ status: { $in: ['POSTED', 'PARTIALLY_PAID'] }, balanceDue: { $gt: 0 }, dueDate: { $lt: weekEnd } })
        .select('billNo supplierName supplierInvoiceNo dueDate balanceDue')
        .sort({ dueDate: 1 })
        .limit(5)
        .lean();
      return {
        rows: docs.map((d) => ({ title: d.supplierName, subtitle: `Inv ${d.supplierInvoiceNo} · due ${dayjs(d.dueDate).format('D MMM')}`, value: r2(d.balanceDue), format: 'money', tone: 'warning', to: '/app/purchase-bills' })),
        empty: 'No supplier bills due this week',
      };
    },
  },
  {
    key: 'target-progress',
    title: 'Targets this period',
    type: 'list',
    icon: 'Target',
    roles: [A, M, S],
    requires: ['fieldforce.targets.view'],
    load: async (ctx) => {
      const now = new Date();
      const docs = await Target.find({ startDate: { $lte: now }, endDate: { $gte: now }, ...scopeOf(ctx, 'salesman') })
        .select('salesmanName periodLabel targetValue achievedValue')
        .sort({ achievedValue: -1 })
        .limit(5)
        .lean();
      return {
        rows: docs.map((t) => {
          const pct = t.targetValue ? r2((t.achievedValue / t.targetValue) * 100) : 0;
          return { title: t.salesmanName || 'Team', subtitle: `${t.periodLabel} · ${r2(t.achievedValue).toLocaleString('en-IN')} of ${r2(t.targetValue).toLocaleString('en-IN')}`, value: pct, format: 'percent', progress: Math.min(100, pct), tone: pct >= 100 ? 'success' : pct >= 60 ? 'brand' : 'warning' };
        }),
        empty: 'No targets running right now',
      };
    },
  },
];

export const DASHBOARD_WIDGETS = WIDGETS;
export const findWidget = (key) => WIDGETS.find((w) => w.key === key) || null;

/**
 * Does this role get this widget? Module on, the admin's per-widget role list
 * (or the widget's default roles) names the role, and the role can see the
 * widget's data.
 */
export const widgetOn = (widget, { can, company, settings, role }) => {
  if (widget.module && company?.featureFlags?.[widget.module] === false) return false;
  const listed = settings?.dashboardAccess?.[widget.key];
  const roles = Array.isArray(listed) ? listed : widget.roles;
  return roles.includes(role) && (widget.requires || []).every((perm) => can(perm));
};

export const widgetMissing = (widget, can) => (widget.requires || []).filter((perm) => !can(perm));

