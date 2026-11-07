import { ForbiddenError, AppError } from '../utils/errors.js';
import { PLATFORM_ROLES, COMPANY_ROLES, DEFAULT_PERMISSIONS, blockedBySalesType } from '../config/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Whether the company user's role has `permission` (sales type, per-user, company, default). */
const effectivePermission = (req, permission) => {
  const user = req.user;
  const role = user.role;
  // 0. a salesman's sales type closes the other channel
  if (blockedBySalesType(user, permission)) return false;
  // 1. per-user explicit override
  if (user.permissionsOverride && Array.isArray(user.permissionsOverride[permission])) {
    return user.permissionsOverride[permission].includes(role);
  }
  // 2. per-company role matrix
  const override = req.settings?.rolePermissions;
  if (override && Array.isArray(override[permission])) {
    return override[permission].includes(role);
  }
  // 3. global default matrix
  if (Array.isArray(DEFAULT_PERMISSIONS[permission])) {
    return DEFAULT_PERMISSIONS[permission].includes(role);
  }
  // Unknown permission -> deny by default (fail closed).
  return false;
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
 * - Per-company overrides live in Setting.rolePermissions.
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
