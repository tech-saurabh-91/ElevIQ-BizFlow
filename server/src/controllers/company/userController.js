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
import { AUDIT_ACTIONS } from '../../config/constants.js';
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

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
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
  return success(res, { data: toPlain(doc) });
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

  const payload = await validateRefs(req.body);
  await assertUniqueLogin(payload);
  let temporaryPassword = null;

  if (!payload.password) {
    temporaryPassword = generatePassword();
    payload.password = temporaryPassword;
    payload.mustChangePassword = true;
  }

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

  doc.password = req.body.newPassword;
  doc.mustChangePassword = req.body.mustChangePassword ?? true;
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

export default { list, get, create, update, remove, resetPassword, stats };
