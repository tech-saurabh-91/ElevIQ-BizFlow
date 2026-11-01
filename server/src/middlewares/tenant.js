import { ForbiddenError, AppError } from '../utils/errors.js';
import { runWithContext, getCompanyId, getContext } from './tenantContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Tenant middleware.
 *
 * 1. Guarantees a request runs inside AsyncLocalStorage with companyId taken
 *    ONLY from the verified JWT (never from body/query/header).
 * 2. Rejects any attempt to smuggle a different companyId through the payload.
 *
 * Must run AFTER `authenticate`.
 */
export const tenant = asyncHandler(async (req, _res, next) => {
  const tokenCompanyId = req.companyId;

  // Platform routes have no tenant; they opt into explicit scoping instead.
  if (req.user?.scope === 'platform') {
    // If a platform route explicitly targets a company, honour it for context.
    const target = req.params?.companyId || req.query?.companyId || req.body?.companyId || null;
    if (target) req.targetCompanyId = String(target);
    return runWithContext({ scope: 'platform', userId: req.user.id }, () => next());
  }

  if (!tokenCompanyId) {
    throw new ForbiddenError('Company context missing', 'FORBIDDEN');
  }

  // Reject spoofing attempts: body/query must not declare another tenant.
  const injected = [req.body?.companyId, req.query?.companyId].filter(Boolean);
  for (const value of injected) {
    if (String(value) !== String(tokenCompanyId)) {
      throw new AppError('companyId mismatch: tenant cannot be supplied by client', {
        status: 403,
        code: 'TENANT_SPOOF',
      });
    }
  }

  // Ensure downstream is inside the tenant context.
  if (getCompanyId() === String(tokenCompanyId)) return next();

  return runWithContext(
    { scope: 'company', companyId: String(tokenCompanyId), userId: req.user?.id },
    () => next()
  );
});

/**
 * Run a function inside an explicit tenant context (services, jobs, seeds).
 * Usage: await withTenant(companyId, () => Order.find({}))
 */
export const withTenant = (companyId, fn, extra = {}) => {
  if (!companyId) throw new AppError('withTenant requires companyId', { status: 500 });
  return runWithContext({ scope: 'company', companyId: String(companyId), ...extra }, fn);
};

/**
 * Run a function with tenant scoping explicitly disabled (platform jobs).
 */
export const withoutTenant = (fn) => runWithContext({ scope: 'platform' }, fn);

export const currentCompanyId = getCompanyId;
export const currentContext = getContext;

export default tenant;
