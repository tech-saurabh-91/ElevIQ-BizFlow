import mongoose from 'mongoose';
import Counter from '../models/Counter.js';
import dayjs from 'dayjs';
import env from '../config/env.js';
import { escapeRegex } from './query.js';

/**
 * Atomic per-tenant number series.
 * Documents: { _id: `${companyId}:${key}`, seq }
 * Guarantees no duplicate invoice/order numbers even under concurrency.
 *
 * @param {string} companyId - tenant id
 * @param {string} key       - series key e.g. "INVOICE" or "INVOICE:2024"
 * @param {object} opts
 * @param {string} [opts.prefix] - e.g. "INV"
 * @param {string} [opts.fy]     - financial year tag e.g. "2425"
 * @param {number} [opts.pad]    - zero padding width
 * @returns {Promise<string>}    - e.g. "INV-2425-000001"
 */
export const nextSeries = async (companyId, key, opts = {}) => {
  const { prefix = '', fy = '', pad = 6 } = opts;
  const _id = `${companyId}:${key}:${fy || 'default'}`;

  const counter = await Counter.findOneAndUpdate(
    { _id },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  const seq = counter?.seq ?? 1;
  const seqStr = String(seq).padStart(pad, '0');

  const parts = [prefix, fy, seqStr].filter(Boolean);
  return parts.join('-');
};

/** Move a series counter up to the highest numeric code already stored in it. */
const catchUpCounter = async (companyId, key, { prefix = '', fy = '' }, model, field) => {
  const lead = [prefix, fy].filter(Boolean).join('-');
  const pattern = new RegExp(`^${lead ? `${escapeRegex(lead)}-` : ''}\\d+$`);
  const rows = await model.find({ companyId, [field]: pattern }).select(field).skipTenant().lean();
  const highest = rows.reduce((max, r) => Math.max(max, parseInt(String(r[field]).split('-').pop(), 10) || 0), 0);
  await Counter.updateOne({ _id: `${companyId}:${key}:${fy || 'default'}` }, { $max: { seq: highest } }, { upsert: true });
};

/**
 * Reserve `count` consecutive codes in one counter update (bulk imports).
 * Like nextFreeSeries, a block that clashes with existing codes is skipped
 * once the counter has caught up.
 */
export const reserveFreeSeries = async (companyId, key, count, opts = {}, { model, field = 'code' } = {}) => {
  if (count <= 0) return [];
  const { prefix = '', fy = '', pad = 6 } = opts;
  const format = (seq) => [prefix, fy, String(seq).padStart(pad, '0')].filter(Boolean).join('-');
  const draw = async () => {
    const counter = await Counter.findOneAndUpdate(
      { _id: `${companyId}:${key}:${fy || 'default'}` },
      { $inc: { seq: count } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return Array.from({ length: count }, (_, i) => format(counter.seq - count + 1 + i));
  };

  // Catch up BEFORE drawing: a block drawn while the counter lags behind
  // seeded/imported codes would clash and be thrown away, leaving a big gap.
  const counter = await Counter.findById(`${companyId}:${key}:${fy || 'default'}`).lean();
  if (await model.exists({ companyId, [field]: format((counter?.seq ?? 0) + 1) }).skipTenant()) {
    await catchUpCounter(companyId, key, opts, model, field);
  }
  const codes = await draw();
  if (!(await model.exists({ companyId, [field]: { $in: codes } }).skipTenant())) return codes;
  // Rare: someone else wrote codes in between. Catch up again and redraw.
  await catchUpCounter(companyId, key, opts, model, field);
  return draw();
};

/**
 * Like nextSeries, but for codes that can also arrive from outside the counter
 * (imports, seeded or migrated data). If the next code is already taken, the
 * counter is moved past the highest existing code in the series and we retry,
 * so a new record never fails with a duplicate-key error.
 *
 * @param {import('mongoose').Model} model - model that owns the code field
 * @param {string} field                   - code field, e.g. "code" or "sku"
 */
export const nextFreeSeries = async (companyId, key, opts = {}, { model, field = 'code' } = {}) => {
  const code = await nextSeries(companyId, key, opts);
  if (!(await model.exists({ companyId, [field]: code }).skipTenant())) return code;
  await catchUpCounter(companyId, key, opts, model, field);
  return nextSeries(companyId, key, opts);
};

/**
 * Peek the next number without consuming it (useful for previews).
 * NOT atomic - use only for display previews.
 */
export const peekSeries = async (companyId, key, opts = {}) => {
  const { prefix = '', fy = '', pad = 6 } = opts;
  const _id = `${companyId}:${key}:${fy || 'default'}`;
  const counter = await Counter.findById(_id).lean();
  const seq = (counter?.seq ?? 0) + 1;
  const parts = [prefix, fy, String(seq).padStart(pad, '0')].filter(Boolean);
  return parts.join('-');
};

/**
 * Reset a series (used by seeder / imports). Returns true when a reset happened.
 */
export const resetSeries = async (companyId, key, fy = '') => {
  const _id = `${companyId}:${key}:${fy || 'default'}`;
  const res = await Counter.deleteOne({ _id });
  return res.deletedCount > 0;
};

// ---------------------------------------------------------------------------
// Financial year helpers (default: Indian FY Apr 1 -> Mar 31)
// ---------------------------------------------------------------------------
export const getFinancialYearTag = (date = new Date(), startMonth = 4) => {
  const d = dayjs(date);
  const year = d.month() + 1 >= startMonth ? d.year() : d.year() - 1;
  const startYY = String(year).slice(-2);
  const endYY = String(year + 1).slice(-2);
  return `${startYY}${endYY}`;
};

export const getFinancialYearRange = (date = new Date(), startMonth = 4) => {
  const d = dayjs(date);
  const startYear = d.month() + 1 >= startMonth ? d.year() : d.year() - 1;
  const start = dayjs(new Date(startYear, startMonth - 1, 1));
  const end = dayjs(new Date(startYear + 1, startMonth - 1, 1)).subtract(1, 'millisecond');
  return { start: start.toDate(), end: end.toDate(), tag: `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}` };
};

/**
 * True when a document number carries another financial year than its date -
 * a draft numbered in one year and re-dated into the next. Such a document is
 * renumbered in its own year when it is issued / posted.
 */
export const numberOutOfYear = (number, date, startMonth = 4) => {
  if (!number || !date || !/-\d{4}-/.test(number)) return false;
  return !number.includes(`-${getFinancialYearTag(date, startMonth)}-`);
};

export const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

export default nextSeries;
