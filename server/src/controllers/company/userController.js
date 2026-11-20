import crypto from 'node:crypto';
import User from '../../models/User.js';
import Company from '../../models/Company.js';
import Warehouse from '../../models/Warehouse.js';
import Route from '../../models/Route.js';
import Session from '../../models/Session.js';
import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { BadRequestError, AppError } from '../../utils/errors.js';
import { listDocuments } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import Setting from '../../models/Setting.js';
import {
  AUDIT_ACTIONS,
  COMPANY_ROLES,
  DEFAULT_PERMISSIONS,
  ADMIN_ONLY_PERMISSIONS,
  SALES_CHANNEL_PERMISSIONS,
  MAX_ACCESS_DAYS,
  isSensitivePermission,
} from '../../config/constants.js';
import { accessFor, matrixRoles, userOverride } from '../../middlewares/rbac.js';
import { notifyUsers } from '../../services/notifyService.js';
import { toPlain, loadDoc, assertRef, normalizeRefs, markSetup, assertLimit } from './_helpers.js';

const REFS = ['reportingManager', 'warehouse'];

const generatePassword = () => {
  const body = crypto.randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 6);
  return `Temp#${body}${crypto.randomInt(10, 99)}`;
};

const validateRefs = async (payload) => {
  const out = normalizeRefs({ ...payload }, REFS);

  if (out.reportingManager) {
    out.reportingManager = await assertRef(User, out.reportingManager, 'Reporting manager');
  }
  if (out.warehouse) out.warehouse = await assertRef(Warehouse, out.warehouse, 'Warehouse');

  if (Array.isArray(out.routes) && out.routes.length) {
    const found = await Route.countDocuments({ _id: { $in: out.routes } });
    if (found !== new Set(out.routes).size) {
      throw new BadRequestError('One or more routes do not exist', 'INVALID_REFERENCE');
    }
  }
  if (Array.isArray(out.teamMembers) && out.teamMembers.length) {
    const found = await User.countDocuments({ _id: { $in: out.teamMembers } });
    if (found !== new Set(out.teamMembers).size) {
      throw new BadRequestError('One or more team members do not exist', 'INVALID_REFERENCE');
    }
  }
  return out;
};

/**
 * Email and phone are unique per company (see the User indexes), so the same
 * person may exist in another company. Check up front for a clear message
 * instead of a raw duplicate-key error. Soft-deleted users still hold the value.
 */
const assertUniqueLogin = async (payload, excludeId = null) => {
  const checks = [
    ['email', payload.email ? String(payload.email).trim().toLowerCase() : ''],
    ['phone', payload.phone ? String(payload.phone).trim() : ''],
  ];
  for (const [field, value] of checks) {
    if (!value) continue;
    const filter = { [field]: value, isDeleted: { $in: [true, false] } };
    if (excludeId) filter._id = { $ne: excludeId };
    if (await User.exists(filter)) {
      throw new AppError(`A user with this ${field} already exists in your company`, {
        status: 409,
        code: 'DUPLICATE',
        errors: [{ field: `body.${field}`, message: `This ${field} is already in use` }],
      });
    }
  }
};

const revokeSessions = async (req, userId, reason = 'ADMIN_ACTION') => {
  await Session.updateMany(
    { companyId: req.companyId, user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );
};

const syncTeams = async (doc, previousManagerId = null) => {
  const managerId = doc.reportingManager ? String(doc.reportingManager) : null;

  if (previousManagerId && previousManagerId !== managerId) {
    await User.updateOne({ _id: previousManagerId }, { $pull: { teamMembers: doc._id } });
  }
  if (managerId && managerId !== String(doc._id)) {
    await User.updateOne({ _id: managerId }, { $addToSet: { teamMembers: doc._id } });
  }
  if (Array.isArray(doc.teamMembers) && doc.teamMembers.length) {
    await User.updateMany({ _id: { $in: doc.teamMembers } }, { $set: { reportingManager: doc._id } });
  }
};

const assertAdminGuard = async (user, payload) => {
  const losingAdmin =
    user.role === 'COMPANY_ADMIN' &&
    ((payload.role && payload.role !== 'COMPANY_ADMIN') || payload.isActive === false);
  if (!losingAdmin) return;

  const otherAdmins = await User.countDocuments({
    role: 'COMPANY_ADMIN',
    isActive: true,
    _id: { $ne: user._id },
  });
  if (otherAdmins === 0) {
    throw new BadRequestError(
      'At least one active company admin is required',
      'LAST_ADMIN'
    );
  }
};

/**
 * Only a company admin may make someone an admin or touch an admin's account,
 * even when the role matrix lets others manage users (else a manager could
 * raise their own access through a second account).
 */
const assertNoEscalation = (req, target, payload = {}) => {
  if (req.user.role === COMPANY_ROLES.COMPANY_ADMIN) return;
  if (payload.role === COMPANY_ROLES.COMPANY_ADMIN) {
    throw new AppError('Only a company admin can give the admin role', { status: 403, code: 'FORBIDDEN' });
  }
  if (target?.role === COMPANY_ROLES.COMPANY_ADMIN) {
    throw new AppError('Only a company admin can change an admin account', { status: 403, code: 'FORBIDDEN' });
  }
};

/** Overrides still in force (a lapsed temporary grant drops out). */
const liveOverrides = (user, now = new Date()) =>
  (user?.accessOverrides || []).filter((o) => !o.until || new Date(o.until) >= now);

/** List rows: admins see how many own permissions each user has; nobody else sees the details. */
const listRow = (req) => (doc) => {
  const row = toPlain(doc);
  row.customAccess = liveOverrides(doc).length;
  if (req.user.role !== COMPANY_ROLES.COMPANY_ADMIN) delete row.accessOverrides;
  delete row.permissionsOverride;
  return row;
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
export const list = asyncHandler(async (req, res) => {
  const result = await listDocuments(User, {
    filter: {},
    query: req.query,
    searchFields: ['name', 'email', 'phone', 'employeeCode', 'title', 'territory', 'designation'],
    filtersSpec: {
      role: { type: 'string' },
      isActive: { type: 'bool' },
      reportingManager: { type: 'objectId' },
      territory: { type: 'string' },
    },
    sortAllowed: ['createdAt', 'name', 'role', 'lastLoginAt'],
    populate: [
      { path: 'reportingManager', select: 'name email role' },
      { path: 'warehouse', select: 'name code' },
      { path: 'routes', select: 'name code' },
    ],
  });

  return paginated(res, { data: result.data.map(listRow(req)), ...result.meta });
});

export const get = asyncHandler(async (req, res) => {
  const doc = await loadDoc(User, req.params.id, {
    populate: [
      { path: 'reportingManager', select: 'name email role' },
      { path: 'teamMembers', select: 'name email role' },
      { path: 'warehouse', select: 'name code' },
      { path: 'routes', select: 'name code beatDays' },
    ],
    label: 'User',
  });
  return success(res, { data: listRow(req)(doc) });
});

export const create = asyncHandler(async (req, res) => {
  const limit = req.company?.limits?.maxUsers || req.company?.userLimit;
  const current = await User.countDocuments({});
  await assertLimit(
    req,
    current,
    limit,
    `User limit reached (${limit}). Upgrade your plan or deactivate a user.`
  );

  assertNoEscalation(req, null, req.body);
  const payload = await validateRefs(req.body);
  await assertUniqueLogin(payload);
  let temporaryPassword = null;

  if (!payload.password) {
    temporaryPassword = generatePassword();
    payload.password = temporaryPassword;
  }
  // Whoever set it, the admin shares this password: the user replaces it on
  // first sign-in, and is not asked again after that.
  payload.mustChangePassword = true;

  const doc = await User.create(payload);

  await syncTeams(doc);
  await markSetup('users');

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'User',
    entityId: doc._id,
    entityLabel: doc.name,
    after: toPlain(doc),
    description: `User "${doc.name}" (${doc.role}) created`,
  });

  const data = toPlain(doc);
  if (temporaryPassword) data.temporaryPassword = temporaryPassword;

  return created(res, { message: 'User created', data });
});

export const update = asyncHandler(async (req, res) => {
  const doc = await loadDoc(User, req.params.id, { label: 'User' });
  assertNoEscalation(req, doc, req.body);
  const payload = await validateRefs(req.body);
  await assertUniqueLogin(payload, doc._id);

  if (String(doc._id) === String(req.user.id)) {
    if (payload.isActive === false) {
      throw new BadRequestError('You cannot deactivate your own account', 'SELF_ACTION');
    }
    if (payload.role && payload.role !== doc.role) {
      throw new BadRequestError('You cannot change your own role', 'SELF_ACTION');
    }
  }

  await assertAdminGuard(doc, payload);

  if (payload.reportingManager && String(payload.reportingManager) === String(doc._id)) {
    throw new BadRequestError('A user cannot report to themselves', 'INVALID_REFERENCE');
  }

  const before = toPlain(doc);
  const previousManagerId = doc.reportingManager ? String(doc.reportingManager) : null;

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined) doc.set(key, value);
  });
  await doc.save();

  await syncTeams(doc, previousManagerId);

  if (payload.isActive === false) {
    await revokeSessions(req, doc._id, 'DEACTIVATED');
  }

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'User',
    entityId: doc._id,
    entityLabel: doc.name,
    before,
    after: toPlain(doc),
    description: `User "${doc.name}" updated`,
  });

  return success(res, { message: 'User updated', data: toPlain(doc) });
});

export const remove = asyncHandler(async (req, res) => {
  const doc = await loadDoc(User, req.params.id, { label: 'User' });

  if (String(doc._id) === String(req.user.id)) {
    throw new BadRequestError('You cannot delete your own account', 'SELF_ACTION');
  }
  assertNoEscalation(req, doc);

  await assertAdminGuard(doc, { isActive: doc.isActive });

  const snapshot = toPlain(doc);
  await doc.softDelete();
  await revokeSessions(req, doc._id, 'DELETED');

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'User',
    entityId: doc._id,
    entityLabel: doc.name,
    before: snapshot,
    description: `User "${doc.name}" removed`,
  });

  return success(res, { message: 'User removed', data: { id: String(doc._id) } });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const doc = await loadDoc(User, req.params.id, { label: 'User' });
  assertNoEscalation(req, doc);

  doc.password = req.body.newPassword;
  doc.mustChangePassword = true; // an admin-set password is replaced on next sign-in
  await doc.save();

  await revokeSessions(req, doc._id, 'PASSWORD_RESET');

  audit(req, {
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    entityType: 'User',
    entityId: doc._id,
    entityLabel: doc.name,
    description: `Password reset for "${doc.name}" by ${req.user.name}`,
    severity: 'WARN',
  });

  return success(res, {
    message: 'Password reset. The user must sign in again.',
    data: { id: String(doc._id), mustChangePassword: doc.mustChangePassword },
  });
});

export const stats = asyncHandler(async (req, res) => {
  const [total, active, admins, managers, salesmen, accountants, warehouse, company] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ isActive: true }),
    User.countDocuments({ role: 'COMPANY_ADMIN' }),
    User.countDocuments({ role: 'MANAGER' }),
    User.countDocuments({ role: 'SALESMAN' }),
    User.countDocuments({ role: 'ACCOUNTANT' }),
    User.countDocuments({ role: 'WAREHOUSE' }),
    Company.findById(req.companyId).select('limits userLimit').lean(),
  ]);

  return success(res, {
    data: {
      total,
      active,
      inactive: total - active,
      byRole: {
        COMPANY_ADMIN: admins,
        MANAGER: managers,
        SALESMAN: salesmen,
        ACCOUNTANT: accountants,
        WAREHOUSE: warehouse,
      },
      limit: company?.limits?.maxUsers ?? company?.userLimit ?? null,
    },
  });
});

// ---------------------------------------------------------------------------
// Per-user access (company admin only)
// ---------------------------------------------------------------------------
const ROLE_LABEL = (role) => role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, ' ');

/** Every permission for this user: what the role gives, their own setting, and the result. */
const accessView = (user, settings) => {
  const now = new Date();
  const permissions = Object.keys(DEFAULT_PERMISSIONS).map((key) => {
    const own = (user.accessOverrides || []).find((o) => o.permission === key) || null;
    const lapsed = own?.until && new Date(own.until) < now;
    const result = accessFor(user, settings, key, now);
    return {
      key,
      roleAllowed: user.role === COMPANY_ROLES.COMPANY_ADMIN || (matrixRoles(settings, key) || []).includes(user.role),
      override: own ? { effect: own.effect, until: own.until || null, note: own.note || '', byName: own.byName || '', at: own.at || null, lapsed: Boolean(lapsed) } : null,
      allowed: result.allowed,
      source: result.source,
      channel: SALES_CHANNEL_PERMISSIONS[key] || null,
      sensitive: isSensitivePermission(key),
      adminOnly: ADMIN_ONLY_PERMISSIONS.includes(key),
    };
  });
  return {
    user: { id: String(user._id), name: user.name, role: user.role, salesType: user.salesType || 'BOTH', isActive: user.isActive },
    customCount: liveOverrides(user, now).length,
    maxDays: MAX_ACCESS_DAYS,
    permissions,
  };
};

/** GET /users/:id/access */
export const getAccess = asyncHandler(async (req, res) => {
  const doc = await loadDoc(User, req.params.id, { label: 'User' });
  const settings = await Setting.forCompany(req.companyId);
  return success(res, { data: accessView(doc, settings) });
});

const describe = (list) =>
  list.length
    ? list.map((o) => `${o.effect === 'ALLOW' ? 'Allow' : 'Deny'} ${o.permission}${o.until ? ` until ${new Date(o.until).toISOString().slice(0, 10)}` : ''}`).join('; ')
    : 'none';

/** PUT /users/:id/access { overrides: [{ permission, effect, until?, note? }] } - replaces the user's own access. */
export const saveAccess = asyncHandler(async (req, res) => {
  const doc = await loadDoc(User, req.params.id, { label: 'User' });
  if (String(doc._id) === String(req.user.id)) {
    throw new BadRequestError('You cannot change your own access', 'SELF_ACTION');
  }
  if (doc.role === COMPANY_ROLES.COMPANY_ADMIN) {
    throw new BadRequestError('A company admin always has full access; there is nothing to change', 'ADMIN_FULL_ACCESS');
  }

  const now = new Date();
  const latest = new Date(now.getTime() + MAX_ACCESS_DAYS * 86400000);
  const errors = [];
  const seen = new Set();
  const previous = new Map((doc.accessOverrides || []).map((o) => [o.permission, o]));
  const next = [];

  req.body.overrides.forEach((o, i) => {
    const field = `body.overrides.${i}`;
    if (!DEFAULT_PERMISSIONS[o.permission]) return errors.push({ field, message: `Unknown permission "${o.permission}"` });
    if (seen.has(o.permission)) return errors.push({ field, message: `"${o.permission}" is listed twice` });
    seen.add(o.permission);
    if (o.effect === 'ALLOW' && ADMIN_ONLY_PERMISSIONS.includes(o.permission)) {
      return errors.push({ field, message: `"${o.permission}" stays with company admins; it cannot be given to one user` });
    }
    if (o.until) {
      if (o.until <= now) return errors.push({ field: `${field}.until`, message: 'The end date must be in the future' });
      if (o.until > latest) return errors.push({ field: `${field}.until`, message: `A temporary setting can run at most ${MAX_ACCESS_DAYS} days` });
    }
    const old = previous.get(o.permission);
    const same = old && old.effect === o.effect && String(old.until || '') === String(o.until || '') && (old.note || '') === (o.note || '');
    next.push(
      same
        ? old
        : { permission: o.permission, effect: o.effect, until: o.until || null, note: o.note || '', by: req.user.id, byName: req.user.name || '', at: now }
    );
    return null;
  });
  if (errors.length) {
    throw new AppError('Some access settings are not valid', { status: 422, code: 'VALIDATION_ERROR', errors });
  }

  const before = liveOverrides(doc, now).map((o) => ({ permission: o.permission, effect: o.effect, until: o.until }));
  doc.accessOverrides = next;
  await doc.save();
  const after = next.map((o) => ({ permission: o.permission, effect: o.effect, until: o.until }));

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'User',
    entityId: doc._id,
    entityLabel: doc.name,
    before: { accessOverrides: before },
    after: { accessOverrides: after },
    description: `Access of "${doc.name}" (${ROLE_LABEL(doc.role)}) changed: ${describe(after)}`,
    severity: 'WARN',
  });
  if (describe(before) !== describe(after)) {
    notifyUsers([doc._id], {
      type: 'SYSTEM',
      title: 'Your access was updated',
      body: `${req.user.name || 'Your admin'} changed what you can do in the app. Some screens or buttons may have changed.`,
      entityType: 'User',
      entityId: doc._id,
    });
  }

  const settings = await Setting.forCompany(req.companyId);
  return success(res, { message: 'Access saved', data: accessView(doc, settings) });
});

/** GET /users/access/who?permission=invoices.print - who can do it, and why. */
export const whoCan = asyncHandler(async (req, res) => {
  const { permission } = req.query;
  if (!DEFAULT_PERMISSIONS[permission]) throw new BadRequestError(`Unknown permission "${permission}"`, 'VALIDATION_ERROR');
  const settings = await Setting.forCompany(req.companyId);
  const users = await User.find({ isActive: true }).select('name email phone role salesType accessOverrides').sort({ name: 1 }).lean();
  const now = new Date();
  const rows = users.map((u) => {
    const r = accessFor(u, settings, permission, now);
    const own = userOverride(u, permission, now);
    return { id: String(u._id), name: u.name, email: u.email || '', role: u.role, salesType: u.salesType || 'BOTH', allowed: r.allowed, source: r.source, until: own?.until || null };
  });
  return success(res, {
    data: {
      permission,
      roles: matrixRoles(settings, permission) || [],
      sensitive: isSensitivePermission(permission),
      users: rows,
    },
  });
});

export default { list, get, create, update, remove, resetPassword, stats, getAccess, saveAccess, whoCan };
