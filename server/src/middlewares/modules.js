import { ForbiddenError } from '../utils/errors.js';

/**
 * Modules a company is subscribed to (Company.featureFlags), switched on or
 * off by the platform - from the plan, or per company when it is registered
 * or edited. A company admin cannot change them. A flag that was never set
 * counts as on, so older companies keep everything they had.
 */
export const moduleOn = (company, key) => company?.featureFlags?.[key] !== false;

export const MODULE_LABEL = { purchase: 'Purchase' };

/** Route guard: 403 when the company's plan does not include the module. */
export const requireModule = (key) => (req, _res, next) => {
  if (moduleOn(req.company, key)) return next();
  return next(
    new ForbiddenError(`${MODULE_LABEL[key] || key} is not part of your plan. Contact your provider to add it.`, 'MODULE_DISABLED')
  );
};

export default requireModule;
