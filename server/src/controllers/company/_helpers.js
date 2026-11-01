import mongoose from 'mongoose';
import { NotFoundError, BadRequestError, AppError } from '../../utils/errors.js';
import { nextSeries } from '../../utils/numberSeries.js';
import Setting from '../../models/Setting.js';
import { getCompanyId } from '../../middlewares/tenantContext.js';

/** Convert a mongoose document/lean object into an API-safe plain object. */
export const toPlain = (doc) => {
  if (doc == null) return null;
  const base = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : { ...doc };

  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
    if (value._bsontype) return value;

    if (value._id) value.id = String(value._id);
    for (const key of Object.keys(value)) {
      if (typeof value[key] === 'object') value[key] = walk(value[key]);
    }
    return value;
  };

  const out = walk(base);
  delete out.__v;
  delete out.isDeleted;
  // Never leak credential material even on fresh documents where select:false
  // fields are still populated in memory.
  delete out.password;
  delete out.refreshTokens;
  delete out.passwordResetToken;
  delete out.passwordResetExpires;
  return out;
};

export const serializeList = (docs) => (Array.isArray(docs) ? docs.map(toPlain) : []);

/** '' and undefined both mean "clear this reference". */
export const refOrNull = (value) => (value === '' || value === undefined ? null : value);

/** null when empty, Date when parseable, null otherwise. */
export const dateOrNull = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Find one document in the current tenant, or throw 404.
 * `filter` lets callers add data-scope constraints.
 */
export const loadDoc = async (Model, id, { populate = [], filter = {}, label = 'Record' } = {}) => {
  let query = Model.findOne({ _id: id, ...filter });
  (Array.isArray(populate) ? populate : [populate]).filter(Boolean).forEach((p) => {
    query = query.populate(p);
  });
  const doc = await query;
  if (!doc) throw new NotFoundError(`${label} not found`);
  return doc;
};

/**
 * Data scope for field-force entities: a SALESMAN only sees records assigned to
 * them, a MANAGER sees their own plus their team's records, everyone else sees
 * the whole company (tenant scoping is still applied by the tenant plugin).
 */
export const salesScope = (req) => {
  const role = req.user?.role;
  if (role === 'SALESMAN') return { assignedTo: req.user.id };
  if (role === 'MANAGER') {
    const ids = [req.user.id, ...(req.dataScope?.teamIds || [])];
    return { assignedTo: { $in: ids } };
  }
  return {};
};

/** Validate that a referenced document exists inside this tenant. */
export const assertRef = async (Model, value, label) => {
  const id = refOrNull(value);
  if (!id) return null;
  const exists = await Model.exists({ _id: id });
  if (!exists) throw new BadRequestError(`${label} not found`, 'INVALID_REFERENCE');
  return id;
};

/** Merge a set of optional reference fields, converting '' -> null. */
export const normalizeRefs = (payload, keys = []) => {
  const out = { ...payload };
  keys.forEach((key) => {
    if (key in out) out[key] = refOrNull(out[key]);
  });
  return out;
};

/** Atomic, tenant-safe auto code (CUS-00001, PRD-00001, ...). */
export const autoCode = (req, key, prefix, pad = 5) =>
  nextSeries(req.companyId, key, { prefix, pad });

/** Flip an onboarding checklist item once real data exists. */
export const markSetup = async (flag) => {
  const companyId = getCompanyId();
  if (!companyId) return;
  try {
    await Setting.updateOne({ companyId }, { $set: { [`setupProgress.${flag}`]: true } });
  } catch {
    /* onboarding state is best-effort */
  }
};

/** Enforce a numeric plan limit (customers/users) before creating a record. */
export const assertLimit = async (req, current, limit, message) => {
  if (!Number.isFinite(Number(limit)) || Number(limit) <= 0) return;
  if (current >= Number(limit)) {
    throw new AppError(message, { status: 403, code: 'PLAN_LIMIT_REACHED' });
  }
};

export default {
  toPlain,
  serializeList,
  refOrNull,
  dateOrNull,
  loadDoc,
  salesScope,
  assertRef,
  normalizeRefs,
  autoCode,
  markSetup,
  assertLimit,
};
