import env from '../../config/env.js';
import * as authService from '../../services/authService.js';
import { success, created } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { setRefreshCookie, clearRefreshCookie, verifyRefreshToken } from '../../utils/tokens.js';
import { UnauthorizedError } from '../../utils/errors.js';
import { buildDefaultPermissions } from '../../config/constants.js';
import { audit, AUDIT_ACTIONS_LOCAL } from './_audit.js';

const pickUA = (req) => (req.headers['user-agent'] || '').slice(0, 300);

// ---------------------------------------------------------------------------
// PLATFORM AUTH
// ---------------------------------------------------------------------------
export const platformLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip;
  const result = await authService.loginPlatform({ email, password, ip, userAgent: pickUA(req) });

  setRefreshCookie(res, result.refreshToken);
  audit(req, { scope: 'platform', action: 'LOGIN', entityType: 'PlatformUser', entityId: result.user.id, entityLabel: result.user.email, description: 'Platform login' });

  return success(res, {
    message: 'Signed in',
    data: { accessToken: result.accessToken, user: result.user },
  });
});

export const platformMe = asyncHandler(async (req, res) => {
  return success(res, { message: 'OK', data: { user: req.user } });
});

// ---------------------------------------------------------------------------
// COMPANY AUTH
// ---------------------------------------------------------------------------
export const companyLogin = asyncHandler(async (req, res) => {
  const { identifier, password, companyCode, remember } = req.body;
  const result = await authService.loginCompany({
    identifier,
    password,
    companyCode,
    ip: req.ip,
    userAgent: pickUA(req),
  });

  setRefreshCookie(res, result.refreshToken);
  audit(req, {
    scope: 'company',
    companyId: result.company.id,
    action: 'LOGIN',
    entityType: 'User',
    entityId: result.user.id,
    entityLabel: result.user.email || result.user.phone,
    description: `Company login (${result.company.code})`,
    actor: { userId: result.user.id, name: result.user.name, role: result.user.role, email: result.user.email },
  });

  return success(res, {
    message: 'Signed in',
    data: {
      accessToken: result.accessToken,
      company: result.company,
      user: result.user,
      branding: { app: 'ElevIQ SFA', company: result.company.name },
    },
  });
});

export const companyMe = asyncHandler(async (req, res) => {
  return success(res, {
    message: 'OK',
    data: {
      user: req.user,
      company: req.company
        ? {
            id: String(req.company._id),
            name: req.company.businessName,
            code: req.company.code,
            slug: req.company.slug,
            logo: req.company.logo || '',
            currency: req.company.currency,
            currencySymbol: req.company.currencySymbol,
            businessType: req.company.businessType,
            status: req.company.status,
            timezone: req.company.timezone,
            country: req.company.address?.country || '',
            financialYearStartMonth: req.company.financialYearStartMonth,
            featureFlags: req.company.featureFlags,
            plan: req.company.plan,
          }
        : null,
      // Defaults merged under the company's saved matrix, so permissions added
      // after a company customised its matrix still resolve.
      permissions: req.settings ? { ...buildDefaultPermissions(), ...(req.settings.rolePermissions || {}) } : null,
      settings: req.settings
        ? {
            currency: req.settings.currency,
            currencySymbol: req.settings.currencySymbol,
            dateFormat: req.settings.dateFormat,
            timezone: req.company?.timezone || req.settings.timezone,
            tax: req.settings.tax,
            invoice: req.settings.invoice,
            order: req.settings.order,
            fieldForce: req.settings.fieldForce,
            inventory: {
              mode: req.settings.inventory?.mode || 'STOCK',
              defaultMarkupPercent: Number(req.settings.inventory?.defaultMarkupPercent || 0),
            },
          }
        : null,
      branding: { app: 'ElevIQ SFA', company: req.company?.businessName },
    },
  });
});

// ---------------------------------------------------------------------------
// REFRESH  (shared; figures out scope from the cookie)
// ---------------------------------------------------------------------------
export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[env.cookie.refreshName] || req.body?.token;
  if (!token) throw new UnauthorizedError('Refresh token missing', 'TOKEN_INVALID');

  const result = await authService.refreshTokens({
    token,
    ip: req.ip,
    userAgent: pickUA(req),
    res,
  });

  setRefreshCookie(res, result.refreshToken);

  const payload = { accessToken: result.accessToken, scope: result.scope };
  if (result.scope === 'platform') payload.user = result.user;
  else {
    payload.user = result.user;
    payload.company = result.company;
  }

  return success(res, { message: 'Refreshed', data: payload });
});

// ---------------------------------------------------------------------------
// LOGOUT
// ---------------------------------------------------------------------------
export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[env.cookie.refreshName];
  let jti = req.user?.sid || null;
  if (token) {
    try {
      const decoded = verifyRefreshToken(token);
      jti = decoded.jti || jti;
    } catch {
      /* cookie may already be invalid */
    }
  }

  await authService.logout({
    jti,
    scope: req.user?.scope || 'company',
    userId: req.user?.id,
    companyId: req.companyId,
  });

  clearRefreshCookie(res);
  return success(res, { message: 'Signed out' });
});

export const logoutAll = asyncHandler(async (req, res) => {
  const revoked = await authService.logoutAll({
    scope: req.user.scope,
    userId: req.user.id,
    companyId: req.companyId,
  });
  clearRefreshCookie(res);
  return success(res, { message: 'Signed out everywhere', data: revoked });
});

// ---------------------------------------------------------------------------
// PASSWORDS
// ---------------------------------------------------------------------------
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword({
    scope: req.user.scope === 'impersonate' ? 'company' : req.user.scope,
    userId: req.user.id,
    companyId: req.companyId,
    currentPassword,
    newPassword,
  });
  clearRefreshCookie(res);
  return success(res, { message: 'Password updated. Please sign in again.' });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email, scope } = req.body;
  const result = await authService.forgotPassword({ email, scope });
  return success(res, {
    message: 'If that account exists, a reset link has been sent.',
    data: result.devToken ? { devToken: result.devToken } : undefined,
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password, scope } = req.body;
  await authService.resetPassword({ token, password, scope });
  clearRefreshCookie(res);
  return success(res, { message: 'Password has been reset. You can now sign in.' });
});

// ---------------------------------------------------------------------------
// SESSIONS
// ---------------------------------------------------------------------------
export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await authService.listSessions({ scope: req.user.scope, userId: req.user.id });
  return success(res, { message: 'OK', data: sessions });
});

export const revokeSession = asyncHandler(async (req, res) => {
  await authService.revokeSession({ scope: req.user.scope, userId: req.user.id, jti: req.params.id });
  return success(res, { message: 'Session revoked' });
});

export default {
  platformLogin,
  platformMe,
  companyLogin,
  companyMe,
  refresh,
  logout,
  logoutAll,
  changePassword,
  forgotPassword,
  resetPassword,
  listSessions,
  revokeSession,
};
