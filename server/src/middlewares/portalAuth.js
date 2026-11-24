import { extractBearer, verifyPortalAccessToken } from '../utils/tokens.js';
import { UnauthorizedError } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { runWithContext } from './tenantContext.js';
import Company from '../models/Company.js';
import Customer from '../models/Customer.js';
import CustomerAccount from '../models/CustomerAccount.js';
import Session from '../models/Session.js';
import Setting from '../models/Setting.js';
import { assertCompanyLive, portalOpen } from '../services/portalAuthService.js';
import { ForbiddenError } from '../utils/errors.js';

/**
 * Authenticates a customer portal request.
 *
 * Accepts only portal tokens (audience 'portal', scope 'customer'); a staff
 * token is refused here just as a portal token is refused by `authenticate`.
 *
 * Sets req.portal = { accountId, customerId, companyId, sid } and runs the rest
 * of the request in the company's tenant context, so every query is limited to
 * that company. Controllers further limit every read to req.portal.customerId.
 */
export const authenticatePortal = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req);
  if (!token) throw new UnauthorizedError('Please sign in', 'TOKEN_INVALID');
  const decoded = verifyPortalAccessToken(token);
  const { companyId, sub: accountId, sid } = decoded;
  if (!companyId || !accountId) throw new UnauthorizedError('Invalid token payload', 'TOKEN_INVALID');

  const [company, settings, session, account] = await Promise.all([
    Company.findById(companyId).lean(),
    Setting.findOne({ companyId }).lean(),
    sid ? Session.findOne({ jti: sid, scope: 'customer' }).lean() : null,
    CustomerAccount.findOne({ _id: accountId, companyId }).lean(),
  ]);

  assertCompanyLive(company);
  if (!portalOpen(company, settings)) {
    throw new ForbiddenError('Online ordering is not switched on for this company.', 'PORTAL_DISABLED');
  }
  if (!session || session.revokedAt) {
    throw new UnauthorizedError('Please sign in again', 'TOKEN_INVALID');
  }
  if (!account || account.isDeleted) throw new UnauthorizedError('Please sign in again', 'TOKEN_INVALID');
  if (!account.isActive) {
    throw new ForbiddenError('Online ordering is switched off for your account. Please contact the company.', 'PORTAL_ACCESS_OFF');
  }
  const customer = await Customer.findOne({ _id: account.customer, companyId }).lean();
  if (!customer || customer.isDeleted || customer.isActive === false) {
    throw new ForbiddenError('Your account is not active. Please contact the company.', 'PORTAL_ACCESS_OFF');
  }

  req.portal = {
    accountId: String(account._id),
    customerId: String(customer._id),
    companyId: String(companyId),
    sid,
    mustChangePin: Boolean(account.mustChangePin),
  };
  req.companyId = String(companyId);
  req.company = company;
  req.settings = settings;
  req.customer = customer;
  req.portalAccount = account;

  return runWithContext({ scope: 'company', companyId: String(companyId), userId: null, portal: true }, () => next());
});

/** Until the customer replaces the PIN staff gave them, only that is allowed. */
export const requirePinChanged = (req, _res, next) => {
  if (req.portal?.mustChangePin) {
    return next(new ForbiddenError('Please set your own PIN first', 'PIN_CHANGE_REQUIRED'));
  }
  return next();
};

export default authenticatePortal;
