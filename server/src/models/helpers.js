import mongoose from 'mongoose';
import dayjs from 'dayjs';

/**
 * Shared schema helpers so every model looks and behaves the same.
 */

export const { ObjectId } = mongoose.Schema.Types;

/** Standard ref fields used across models. */
export const userRef = { type: ObjectId, ref: 'User', default: null };
export const companyRef = { type: ObjectId, ref: 'Company', default: null };

/**
 * Money helper.
 * We store money as Decimal128-compatible numbers via a custom getter so JSON
 * serialises to a plain number, and enforce rounding to 2 decimals on write.
 */
export const money = (opts = {}) => ({
  type: Number,
  default: 0,
  required: false,
  get: (v) => (v == null ? 0 : round2(Number(v))),
  set: (v) => round2(Number(v) || 0),
  ...opts,
});

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Common timestamps block (schema already has timestamps option usually). */
export const baseFields = () => ({
  createdBy: userRef,
  updatedBy: userRef,
  isDeleted: { type: Boolean, default: false },
});

/** Soft-delete + tenant aware "find active" helper. */
export const activeOnly = (q) => q.where({ isDeleted: { $ne: true } });

/** Uppercase/trim setter. */
export const upper = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);

/** Today helper for scheduled docs. */
export const today = () => dayjs().startOf('day').toDate();

export default { ObjectId, userRef, companyRef, money, round2, baseFields };
