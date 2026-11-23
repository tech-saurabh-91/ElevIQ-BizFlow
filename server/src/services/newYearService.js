import dayjs from 'dayjs';

import Target from '../models/Target.js';
import User from '../models/User.js';
import Route from '../models/Route.js';
import Scheme from '../models/Scheme.js';
import PriceList from '../models/PriceList.js';
import DiscountRule from '../models/DiscountRule.js';
import Counter from '../models/Counter.js';
import Setting from '../models/Setting.js';
import { BadRequestError } from '../utils/errors.js';
import { TARGET_STATUS } from '../config/constants.js';
import { fyOfDay, currentYearOf } from './yearCloseService.js';
import {
  periodWindow,
  refreshTargetAchievements,
  startOfDay,
  DEFAULT_TZ,
} from './fieldForceService.js';

/**
 * Setting up a new financial year:
 *   1. targets - copy last year's month / quarter / year targets into the same
 *      periods of this year, optionally raised by a percentage;
 *   2. validity - schemes, price lists and discounts whose "valid to" date
 *      ended around the year end, to extend into the new year;
 *   3. numbering - the first numbers the new year's documents get.
 */

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const tzOf = (company) => company?.timezone || DEFAULT_TZ;
const COPY_TYPES = ['MONTH', 'QUARTER', 'YEAR']; // weeks do not line up year to year

/** This year and the one before, with UTC instants of their first days. */
const yearsOf = (company) => {
  const current = currentYearOf(company);
  const previous = fyOfDay(
    dayjs(current.startDay).subtract(1, 'day').format('YYYY-MM-DD'),
    company?.financialYearStartMonth || 4
  );
  const tz = tzOf(company);
  return {
    current,
    previous,
    curStart: startOfDay(current.startDay, tz),
    prevStart: startOfDay(previous.startDay, tz),
    curEnd: startOfDay(current.nextStartDay, tz),
  };
};

// ------------------------------------------------------------------ targets

/** Last year's targets and where each would go this year. */
const targetPlan = async (company) => {
  const { prevStart, curStart } = yearsOf(company);
  const sources = await Target.find({
    periodType: { $in: COPY_TYPES },
    startDate: { $gte: prevStart, $lt: curStart },
  })
    .sort({ startDate: 1 })
    .lean();
  const plan = [];
  for (const t of sources) {
    // Mid-period anchor one year on: lands in the same month / quarter / year.
    const anchor = dayjs(t.startDate).add(1, 'year').add(10, 'day').toDate();
    const window = periodWindow(t.periodType, anchor);
    const who = t.salesman ? { salesman: t.salesman } : { route: t.route };
    const exists = await Target.exists({
      periodType: t.periodType,
      periodKey: window.periodKey,
      ...who,
    });
    plan.push({ source: t, window, exists: Boolean(exists) });
  }
  return plan;
};

/**
 * Copy last year's targets into this year. `percent` raises (or lowers) every
 * figure; targets already set for a period are left alone, and so are targets
 * of salesmen or routes that are no longer active.
 */
export const copyTargets = async (company, { percent = 0 } = {}) => {
  const p = Number(percent);
  if (!Number.isFinite(p) || p < -90 || p > 500)
    throw new BadRequestError('Use a change between -90% and 500%', 'VALIDATION_ERROR');
  const factor = 1 + p / 100;
  const plan = await targetPlan(company);
  const users = new Map(
    (
      await User.find({ _id: { $in: plan.map((x) => x.source.salesman).filter(Boolean) } })
        .select('name isActive')
        .lean()
    ).map((u) => [String(u._id), u])
  );
  const routes = new Map(
    (
      await Route.find({ _id: { $in: plan.map((x) => x.source.route).filter(Boolean) } })
        .select('name isActive')
        .lean()
    ).map((r) => [String(r._id), r])
  );

  let created = 0;
  const skipped = { exists: 0, inactive: 0 };
  for (const { source: t, window, exists } of plan) {
    if (exists) {
      skipped.exists += 1;
      continue;
    }
    const user = t.salesman ? users.get(String(t.salesman)) : null;
    const route = t.route ? routes.get(String(t.route)) : null;
    if (
      (t.salesman && (!user || user.isActive === false)) ||
      (t.route && (!route || route.isActive === false))
    ) {
      skipped.inactive += 1;
      continue;
    }
    const doc = new Target({
      name: window.periodLabel,
      periodType: t.periodType,
      periodKey: window.periodKey,
      periodLabel: window.periodLabel,
      startDate: window.startDate,
      endDate: window.endDate,
      salesman: t.salesman || null,
      salesmanName: user?.name || t.salesmanName || '',
      route: t.route || null,
      routeName: route?.name || t.routeName || '',
      targetValue: r2(Number(t.targetValue || 0) * factor),
      targetOrders: Math.round(Number(t.targetOrders || 0) * factor),
      targetVisits: Math.round(Number(t.targetVisits || 0) * factor),
      notes: `Copied from ${t.periodLabel || t.periodKey}${p ? ` (${p > 0 ? '+' : ''}${p}%)` : ''}`,
      status: TARGET_STATUS.ACTIVE,
      source: 'WEB',
    });
    await refreshTargetAchievements(doc);
    await doc.save();
    created += 1;
  }
  return { created, skipped };
};

// ------------------------------------------------------------------ validity

const VALIDITY = [
  {
    kind: 'SCHEME',
    label: 'Scheme',
    Model: Scheme,
    permission: 'schemes.update',
    to: '/app/schemes',
  },
  {
    kind: 'PRICE_LIST',
    label: 'Price list',
    Model: PriceList,
    permission: 'products.update',
    to: '/app/price-lists',
  },
  {
    kind: 'DISCOUNT',
    label: 'Discount',
    Model: DiscountRule,
    permission: 'discounts.update',
    to: '/app/discounts',
  },
];

/** Active schemes, price lists and discounts that ended in the last 3 months of last year or end within 45 days. */
const expiring = async (company) => {
  const { curStart } = yearsOf(company);
  const from = dayjs(curStart).subtract(3, 'month').toDate();
  const until = dayjs().add(45, 'day').toDate();
  const out = [];
  for (const v of VALIDITY) {
    const docs = await v.Model.find({
      isActive: true,
      validTo: { $ne: null, $gte: from, $lte: until },
    })
      .select('name validFrom validTo')
      .sort({ validTo: 1 })
      .lean();
    docs.forEach((d) =>
      out.push({
        kind: v.kind,
        label: v.label,
        id: String(d._id),
        name: d.name,
        validFrom: d.validFrom,
        validTo: d.validTo,
        to: v.to,
        permission: v.permission,
      })
    );
  }
  return out;
};

/**
 * Extend the "valid to" of the given schemes / price lists / discounts to the
 * end of the current year (or `validTo`). `can(permission)` decides per kind.
 */
export const extendValidity = async (company, { items = [], validTo }, can) => {
  const { current } = yearsOf(company);
  // Valid through the whole last day (company time).
  const lastDay = validTo || current.endDay;
  const until = dayjs(startOfDay(lastDay, tzOf(company)))
    .add(1, 'day')
    .subtract(1, 'second')
    .toDate();
  if (Number.isNaN(until.getTime()) || until < new Date())
    throw new BadRequestError('Choose a date in the future', 'VALIDATION_ERROR');
  const done = [];
  const refused = [];
  for (const item of items) {
    const v = VALIDITY.find((x) => x.kind === item.kind);
    if (!v || !can(v.permission)) {
      refused.push(item.id);
      continue;
    }
    const doc = await v.Model.findById(item.id);
    if (!doc) continue;
    doc.validTo = until;
    await doc.save();
    done.push({ kind: v.kind, id: String(doc._id), name: doc.name });
  }
  return { extended: done, refused, validTo: until };
};

// ------------------------------------------------------------------ numbering

const SERIES = [
  ['invoice', 'INVOICE', 'Invoices', 'INV'],
  ['order', 'ORDER', 'Sales orders', 'SO'],
  ['payment', 'PAYMENT', 'Receipts', 'RCPT'],
  ['creditNote', 'CREDIT_NOTE', 'Credit notes', 'CN'],
  ['purchase', 'PURCHASE', 'Purchase orders', 'PO'],
  ['grn', 'GRN', 'Goods receipts', 'GRN'],
  ['bill', 'BILL', 'Supplier bills', 'PB'],
  ['supplierPayment', 'SUPPLIER_PAYMENT', 'Supplier payments', 'PAY'],
  ['purchaseReturn', 'PURCHASE_RETURN', 'Purchase returns', 'DN'],
  ['expense', 'EXPENSE', 'Expenses', 'EXP'],
];

/** The next number of each document series in the current year. */
const numbering = async (company) => {
  const { current } = yearsOf(company);
  const settings = await Setting.forCompany(company._id);
  const counters = new Map(
    (
      await Counter.find({
        _id: { $in: SERIES.map(([, key]) => `${company._id}:${key}:${current.tag}`) },
      }).lean()
    ).map((c) => [c._id, c.seq])
  );
  return SERIES.map(([cfgKey, key, label, fallback]) => {
    const cfg = settings?.series?.[cfgKey] || {};
    const used = counters.get(`${company._id}:${key}:${current.tag}`) || 0;
    const next = [
      cfg.prefix || fallback,
      current.tag,
      String(used + 1).padStart(Number(cfg.pad || 6), '0'),
    ].join('-');
    return { key: cfgKey, label, next, used };
  });
};

// ------------------------------------------------------------------ overview

export const newYearOverview = async (company, can) => {
  const { current, previous } = yearsOf(company);
  const out = {
    year: {
      tag: current.tag,
      label: current.label,
      startDay: current.startDay,
      endDay: current.endDay,
    },
    previous: { tag: previous.tag, label: previous.label },
  };
  if (can('fieldforce.targets.manage')) {
    const plan = await targetPlan(company);
    const byType = {};
    plan.forEach(({ source, exists }) => {
      byType[source.periodType] = byType[source.periodType] || { total: 0, copied: 0, value: 0 };
      byType[source.periodType].total += 1;
      byType[source.periodType].value = r2(
        byType[source.periodType].value + Number(source.targetValue || 0)
      );
      if (exists) byType[source.periodType].copied += 1;
    });
    out.targets = { total: plan.length, toCopy: plan.filter((x) => !x.exists).length, byType };
  }
  const list = await expiring(company);
  out.validity = list
    .filter((x) => can(x.permission))
    .map(({ permission: _permission, ...rest }) => rest);
  out.numbering = await numbering(company);
  return out;
};

export default { newYearOverview, copyTargets, extendValidity };
