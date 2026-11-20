import { ForbiddenError, AppError } from '../utils/errors.js';
import { PLATFORM_ROLES, COMPANY_ROLES, DEFAULT_PERMISSIONS, LEGACY_PERMISSION_KEYS, blockedBySalesType } from '../config/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** The roles a permission is given to in this company (its matrix, then the defaults). */
export const matrixRoles = (settings, permission) => {
  const saved = settings?.rolePermissions;
  if (saved && Array.isArray(saved[permission])) return saved[permission];
  const legacy = LEGACY_PERMISSION_KEYS[permission];
  if (legacy && saved && Array.isArray(saved[legacy])) return saved[legacy];
  return Array.isArray(DEFAULT_PERMISSIONS[permission]) ? DEFAULT_PERMISSIONS[permission] : null;
};

/**
 * The user's own Allow / Deny for a permission, if one is in force.
 * `accessOverrides` is [{ permission, effect: 'ALLOW'|'DENY', until }];
 * a lapsed temporary one no longer counts.
 */
export const userOverride = (user, permission, now = new Date()) => {
  const list = Array.isArray(user?.accessOverrides) ? user.accessOverrides : [];
  const row = list.find((o) => o?.permission === permission);
  if (!row || !['ALLOW', 'DENY'].includes(row.effect)) return null;
  if (row.until && new Date(row.until) < now) return null;
  return row;
};

/** The profile's Allow / Deny for a permission (profiles have no end date). */
export const profileOverride = (user, permission) => {
  const list = user?.profile?.isActive === false ? [] : user?.profile?.overrides || [];
  const row = list.find((o) => o?.permission === permission);
  return row && ['ALLOW', 'DENY'].includes(row.effect) ? row : null;
};

/**
 * Whether a company user may do `permission`, and why:
 * admin > sales type > the user's own Deny / Allow > their access profile >
 * the company's role matrix > the shipped defaults. Unknown permissions are refused.
 * @returns {{ allowed: boolean, source: 'ADMIN'|'SALES_TYPE'|'USER_DENY'|'USER_ALLOW'|'PROFILE_DENY'|'PROFILE_ALLOW'|'ROLE'|'UNKNOWN', until?: Date|null }}
 */
export const accessFor = (user, settings, permission, now = new Date()) => {
  if (user?.role === COMPANY_ROLES.COMPANY_ADMIN) return { allowed: true, source: 'ADMIN' };
  const roles = matrixRoles(settings, permission);
  if (!roles) return { allowed: false, source: 'UNKNOWN' };
  if (blockedBySalesType(user, permission)) return { allowed: false, source: 'SALES_TYPE' };
  const own = userOverride(user, permission, now);
  if (own) return { allowed: own.effect === 'ALLOW', source: own.effect === 'ALLOW' ? 'USER_ALLOW' : 'USER_DENY', until: own.until || null };
  const prof = profileOverride(user, permission);
  if (prof) return { allowed: prof.effect === 'ALLOW', source: prof.effect === 'ALLOW' ? 'PROFILE_ALLOW' : 'PROFILE_DENY' };
  return { allowed: roles.includes(user?.role), source: 'ROLE' };
};

/** Whose records a role sees when nothing else is set. */
export const ROLE_DATA_SCOPE = Object.freeze({ SALESMAN: 'OWN', MANAGER: 'TEAM' });

/**
 * Whose records this user sees: 'OWN' | 'TEAM' | 'ALL', and where that came
 * from (the user, their profile or their role). Admins see everything.
 */
export const dataScopeFor = (user) => {
  if (!user || user.role === COMPANY_ROLES.COMPANY_ADMIN) return { level: 'ALL', source: 'ADMIN' };
  if (user.dataScope) return { level: user.dataScope, source: 'USER' };
  const fromProfile = user.profile?.isActive === false ? '' : user.profile?.dataScope;
  if (fromProfile) return { level: fromProfile, source: 'PROFILE' };
  return { level: ROLE_DATA_SCOPE[user.role] || 'ALL', source: 'ROLE' };
};

/** Ceilings for this user: their own, else their profile's; null = none. Admins have none. */
export const limitsFor = (user) => {
  const keys = ['maxDiscountPercent', 'maxApproveAmount'];
  if (!user || user.role === COMPANY_ROLES.COMPANY_ADMIN) return Object.fromEntries(keys.map((k) => [k, null]));
  const own = user.limits || {};
  const prof = user.profile?.isActive === false ? {} : user.profile?.limits || {};
  const pick = (k) => (own[k] !== null && own[k] !== undefined ? Number(own[k]) : prof[k] !== null && prof[k] !== undefined ? Number(prof[k]) : null);
  return Object.fromEntries(keys.map((k) => [k, pick(k)]));
};

const effectivePermission = (req, permission) => accessFor(req.user, req.settings, permission).allowed;

/** Does a ROLE (not a particular user) have a permission under this company's matrix? */
export const roleHasPermission = (settings, role, permission) => {
  if (role === COMPANY_ROLES.COMPANY_ADMIN) return true;
  return (matrixRoles(settings, permission) || []).includes(role);
};

/** In-handler check, e.g. may this user change prices: hasPermission(req, 'pricing.override'). */
export const hasPermission = (req, permission) => {
  const user = req.user;
  if (!user) return false;
  if (user.scope === 'platform') return user.role === PLATFORM_ROLES.SUPER_ADMIN;
  if (user.role === COMPANY_ROLES.COMPANY_ADMIN) return true;
  return effectivePermission(req, permission);
};

/**
 * authorize('orders.create')  - company-level permission check
 * authorize('orders.create', 'orders.update') - any-of
 * authorize({ role: [...] })  - direct role check
 *
 * - COMPANY_ADMIN always passes (full access to own company).
 * - PLATFORM_SUPPORT has read-only platform access (handled in platform routes).
 * - Per-company overrides live in Setting.rolePermissions; per-user Allow /
 *   Deny in User.accessOverrides (see accessFor).
 */
export const authorize =
  (...required) =>
  asyncHandler(async (req, _res, next) => {
    const user = req.user;
    if (!user) throw new ForbiddenError('Not authenticated', 'UNAUTHORIZED');

    // ---- Platform scope --------------------------------------------------
    if (user.scope === 'platform') {
      if (user.role === PLATFORM_ROLES.SUPER_ADMIN) return next();
      // PLATFORM_SUPPORT: read-only (block non-GET) + explicit permissions
      const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (!isRead) {
        throw new ForbiddenError('Platform support has read-only access', 'FORBIDDEN');
      }
      return next();
    }

    // ---- Company scope ---------------------------------------------------
    const role = user.role;

    // COMPANY_ADMIN: unrestricted within own company.
    if (role === COMPANY_ROLES.COMPANY_ADMIN) return next();

    // Normalize required into a list of permission keys.
    const perms = required
      .flatMap((r) => (typeof r === 'string' ? r.split(/\s*\|\|\s*/) : []))
      .filter(Boolean);

    if (!perms.length) return next();

    const allowed = perms.some((p) => effectivePermission(req, p));
    if (!allowed) {
      throw new ForbiddenError(
        `You do not have permission to perform this action (${perms.join(' | ')})`,
        'FORBIDDEN'
      );
    }

    return next();
  });

/**
 * Restrict by role(s) regardless of permission matrix.
 * Usage: requireRole('COMPANY_ADMIN', 'MANAGER')
 */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(new ForbiddenError('Not authenticated', 'UNAUTHORIZED'));
    if (req.user.scope === 'platform') return next();
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError(`Requires role: ${roles.join(' or ')}`, 'FORBIDDEN'));
    }
    return next();
  };

/**
 * Guard a company route so only company-scope sessions may use it
 * (blocks platform tokens from touching tenant endpoints).
 */
export const requireCompanyScope = (req, _res, next) => {
  if (!req.user || (req.user.scope !== 'company' && req.user.scope !== 'impersonate')) {
    return next(new ForbiddenError('Company workspace access required', 'FORBIDDEN'));
  }
  return next();
};

/** Guard platform routes. */
export const requirePlatformScope = (req, _res, next) => {
  if (!req.user || req.user.scope !== 'platform') {
    return next(new ForbiddenError('Platform admin access required', 'FORBIDDEN'));
  }
  return next();
};

export default authorize;
