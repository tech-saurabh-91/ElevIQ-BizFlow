import mongoose from 'mongoose';
import Counter from '../models/Counter.js';
import dayjs from 'dayjs';
import env from '../config/env.js';

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
