import env from '../config/env.js';
import { verifyAccessToken, extractBearer } from '../utils/tokens.js';
import { UnauthorizedError, ForbiddenError, AppError, ErrorCodes } from '../utils/errors.js';
import { COMPANY_STATUS, LIVE_COMPANY_STATUSES, COMPANY_ROLES } from '../config/constants.js';
import { runWithContext } from './tenantContext.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import User from '../models/User.js';
import PlatformUser from '../models/PlatformUser.js';
import Company from '../models/Company.js';
import Session from '../models/Session.js';
import Setting from '../models/Setting.js';
import logger from '../utils/logger.js';

/** 503 raised for non-admin users while the company is in maintenance mode. */
export const maintenanceError = (settings) =>
  new AppError(settings?.maintenanceMessage?.trim() || 'The workspace is under maintenance. Please try again later.', {
    status: 503,
    code: 'MAINTENANCE',
  });

/**
 * Core authentication middleware.
 * - Verifies the JWT access token (or impersonation token).
 * - Loads the platform or company user.
 * - Verifies the company is live (not suspended/expired/cancelled).
 * - Runs the rest of the request inside AsyncLocalStorage so the tenant plugin
 *   can auto-scope every query by companyId.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req);
  if (!token) throw new UnauthorizedError('Authentication required', 'TOKEN_INVALID');

  const decoded = verifyAccessToken(token);
  const scope = decoded.scope || 'company';

  // ---- Platform admin ----------------------------------------------------
  if (scope === 'platform') {
    const admin = await PlatformUser.findById(decoded.sub).lean();
    if (!admin || admin.isDeleted) throw new UnauthorizedError('Platform session invalid', 'TOKEN_INVALID');
    if (!admin.isActive) throw new ForbiddenError('Platform account disabled', 'FORBIDDEN');

    req.user = {
      id: String(admin._id),
      type: 'platform',
      name: admin.name,
      email: admin.email,
      role: admin.role,
      scope: 'platform',
    };
    req.companyId = null;

    return runWithContext({ scope: 'platform', userId: req.user.id }, () => next());
  }

  // ---- Impersonation (platform admin acting as a company admin) ---------
  if (decoded.imp && scope === 'impersonate') {
    const admin = await PlatformUser.findById(decoded.platformUserId).lean();
    if (!admin || !admin.isActive) throw new UnauthorizedError('Impersonation session invalid', 'TOKEN_INVALID');

    const company = await Company.findById(decoded.companyId).lean();
    if (!company || company.isDeleted) throw new ForbiddenError('Company not found', 'NOT_FOUND');

    const actingAs = await User.findOne({ _id: decoded.sub, companyId: company._id }).lean();
    if (!actingAs) throw new UnauthorizedError('Impersonation target invalid', 'TOKEN_INVALID');

    req.user = {
      id: String(actingAs._id),
      type: 'user',
      name: actingAs.name,
      email: actingAs.email,
      role: actingAs.role,
      scope: 'impersonate',
      companyId: String(company._id),
      companyName: company.businessName,
      companyCode: company.code,
      impersonatedBy: { id: String(admin._id), name: admin.name, email: admin.email },
      mustChangePassword: false,
    };
    req.companyId = String(company._id);
    req.company = company;
    req.isImpersonating = true;

    return runWithContext(
      // impersonatedBy is the platform admin, so audit trails show who really acted.
      { scope: 'company', companyId: req.companyId, userId: req.user.id, impersonatedBy: String(admin._id) },
      () => next()
    );
  }

  // ---- Company user ------------------------------------------------------
  const companyId = decoded.companyId;
  if (!companyId) throw new UnauthorizedError('Invalid token payload', 'TOKEN_INVALID');

  // One round trip instead of four: user, session, company and settings are
  // independent lookups, so fetch them together and check them in order below.
  const [user, session, company, savedSettings] = await Promise.all([
    User.findOne({ _id: decoded.sub, companyId }).select('+refreshTokens').lean(),
    decoded.sid ? Session.findOne({ jti: decoded.sid }).lean() : null,
    Company.findById(companyId).lean(),
    Setting.findOne({ companyId }).catch((e) => {
      logger.warn(`Failed to load settings for company ${companyId}: ${e.message}`);
      return null;
    }),
  ]);
  if (!user || user.isDeleted) throw new UnauthorizedError('Session invalid', 'TOKEN_INVALID');
  if (!user.isActive) throw new ForbiddenError('Your account has been deactivated', 'FORBIDDEN');
  if (user.isLocked?.()) {
    throw new AppError('Account temporarily locked due to failed logins', {
      status: 423,
      code: ErrorCodes.ACCOUNT_LOCKED,
    });
  }

  // Session revocation check (logout-all / revoked refresh).
  if (session && session.revokedAt) {
    throw new UnauthorizedError('Session has been revoked', 'REFRESH_REUSE');
  }

  // Password changed after token issued -> force re-auth.
  if (user.passwordChangedAt && decoded.iat) {
    const changed = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
    if (changed > decoded.iat) {
      throw new UnauthorizedError('Password changed, please sign in again', 'TOKEN_EXPIRED');
    }
  }

  // ---- Company status gate (SUSPENDED / EXPIRED / CANCELLED) ------------
  if (!company || company.isDeleted) {
    throw new ForbiddenError('Company not found', 'NOT_FOUND');
  }

  const now = Date.now();
  const end = company.subscriptionEnd || company.trialEndsAt;
  const expired = end && new Date(end).getTime() < now;

  if (company.status === COMPANY_STATUS.SUSPENDED) {
    throw new AppError('Company account is suspended. Contact support.', {
      status: 403,
      code: ErrorCodes.COMPANY_SUSPENDED,
      details: company.statusReason || undefined,
    });
  }
  if (company.status === COMPANY_STATUS.CANCELLED) {
    throw new AppError('Company account is cancelled.', { status: 403, code: ErrorCodes.COMPANY_EXPIRED });
  }
  if (expired && company.status === COMPANY_STATUS.EXPIRED) {
    throw new AppError('Subscription has expired. Please renew.', {
      status: 403,
      code: ErrorCodes.COMPANY_EXPIRED,
    });
  }

  // Lazily promote TRIAL -> EXPIRED when trial lapsed (keeps data, blocks login).
  if (company.status === COMPANY_STATUS.TRIAL && expired) {
    await Company.updateOne({ _id: companyId }, { $set: { status: COMPANY_STATUS.EXPIRED } }).skipTenant();
    throw new AppError('Trial period has ended. Please subscribe to continue.', {
      status: 403,
      code: ErrorCodes.COMPANY_EXPIRED,
    });
  }

  // Tenant settings (loaded above) so RBAC/feature checks are cheap downstream;
  // a company without a settings doc yet gets one created (rare, first use).
  let settings = savedSettings;
  if (!settings) {
    try {
      settings = await Setting.forCompany(companyId);
    } catch (e) {
      logger.warn(`Failed to load settings for company ${companyId}: ${e.message}`);
    }
  }

  // Maintenance window: only company admins keep working.
  if (settings?.maintenanceMode && user.role !== COMPANY_ROLES.COMPANY_ADMIN) {
    throw maintenanceError(settings);
  }

  req.user = {
    id: String(user._id),
    type: 'user',
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    salesType: user.salesType || 'BOTH',
    scope: 'company',
    companyId,
    companyName: company.businessName,
    companyCode: company.code,
    mustChangePassword: Boolean(user.mustChangePassword),
    reportingManager: user.reportingManager ? String(user.reportingManager) : null,
    warehouse: user.warehouse ? String(user.warehouse) : null,
    title: user.title || '',
  };
  req.companyId = companyId;
  req.company = company;
  req.settings = settings;

  // Scope for data-level rules: SALESMAN -> own records, MANAGER -> team.
  req.dataScope = {
    selfId: String(user._id),
    managerId: user.reportingManager ? String(user.reportingManager) : null,
    teamIds: (user.teamMembers || []).map(String),
  };

  return runWithContext(
    {
      scope: 'company',
      companyId,
      userId: req.user.id,
      role: user.role,
      impersonatedBy: req.isImpersonating ? req.user.id : null,
    },
    () => next()
  );
});

/** Require a valid session (alias kept for readability at route level). */
export const protect = authenticate;

export default authenticate;
