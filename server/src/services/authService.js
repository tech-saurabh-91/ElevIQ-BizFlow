import env from '../config/env.js';
import { AUDIT_ACTIONS, COMPANY_STATUS, LIVE_COMPANY_STATUSES, PLATFORM_ROLES, COMPANY_ROLES } from '../config/constants.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  newJti,
  hashToken,
  refreshExpiryDate,
  setRefreshCookie,
  clearRefreshCookie,
} from '../utils/tokens.js';
import { UnauthorizedError, ForbiddenError, AppError, BadRequestError, ConflictError, ErrorCodes } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { withoutTenant, withTenant } from '../middlewares/tenant.js';
import { audit } from '../middlewares/audit.js';

import User from '../models/User.js';
import PlatformUser from '../models/PlatformUser.js';
import Company from '../models/Company.js';
import Session from '../models/Session.js';
import Setting from '../models/Setting.js';
import logger from '../utils/logger.js';

const ACCESS_TOKEN_TTL_SEC = 15 * 60; // must match env.jwt.accessExpires default

/**
 * How long a just-rotated refresh token may still be replayed before we treat
 * it as theft. Covers the legitimate "the rotated Set-Cookie never reached the
 * browser" race (page unloaded mid-refresh, two refreshes racing on a cold
 * load). Replay only wins when the token really was the one we issued AND it
 * comes from the same client IP inside this window.
 */
const REFRESH_GRACE_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Internal: issue a full token pair + session row
// ---------------------------------------------------------------------------
const issueTokens = async ({ userId, scope, companyId, userAgent, ip }) => {
  const jti = newJti();
  const refreshToken = signRefreshToken({ userId, scope, companyId, jti });
  const accessToken = signAccessToken({
    sub: userId,
    scope,
    companyId: companyId || null,
    sid: jti,
  });

  await Session.create({
    scope,
    companyId: companyId ? String(companyId) : null,
    user: scope === 'company' ? userId : null,
    platformUser: scope === 'platform' ? userId : null,
    jti,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: userAgent || '',
    ip: ip || '',
    issuedAt: new Date(),
    expiresAt: refreshExpiryDate(),
    lastUsedAt: new Date(),
    isCurrent: true,
  });

  return { accessToken, refreshToken, jti };
};

// ---------------------------------------------------------------------------
// PLATFORM LOGIN
// ---------------------------------------------------------------------------
export const loginPlatform = async ({ email, password, ip, userAgent }) => {
  const admin = await PlatformUser.findOne({ email: String(email).toLowerCase(), isDeleted: { $ne: true } })
    .select('+password')
    .lean();

  if (!admin) {
    throw new UnauthorizedError('Invalid email or password', ErrorCodes.INVALID_CREDENTIALS);
  }

  // Cast to a document-like shim for helper methods when using .lean()
  if (admin.lockedUntil && new Date(admin.lockedUntil) > new Date()) {
    throw new AppError('Account locked due to too many failed attempts. Try again in 15 minutes.', {
      status: 423,
      code: ErrorCodes.ACCOUNT_LOCKED,
    });
  }

  const bcrypt = (await import('bcryptjs')).default;
  const ok = await bcrypt.compare(password, admin.password);
  if (!ok) {
    await PlatformUser.updateOne(
      { _id: admin._id },
      {
        $inc: { failedLoginAttempts: 1 },
        ...(admin.failedLoginAttempts + 1 >= 5 ? { $set: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } } : {}),
      }
    );
    throw new UnauthorizedError('Invalid email or password', ErrorCodes.INVALID_CREDENTIALS);
  }

  if (!admin.isActive) throw new ForbiddenError('Account is disabled', 'FORBIDDEN');

  await PlatformUser.updateOne(
    { _id: admin._id },
    { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip } }
  );

  const { accessToken, refreshToken, jti } = await issueTokens({
    userId: String(admin._id),
    scope: 'platform',
    companyId: null,
    userAgent,
    ip,
  });

  return {
    accessToken,
    refreshToken,
    jti,
    user: {
      id: String(admin._id),
      name: admin.name,
      email: admin.email,
      role: admin.role,
      scope: 'platform',
      twoFactorEnabled: admin.twoFactorEnabled,
    },
  };
};

// ---------------------------------------------------------------------------
// COMPANY LOGIN  (email OR phone, optional company code for disambiguation)
// ---------------------------------------------------------------------------
export const loginCompany = async ({ identifier, password, companyCode, ip, userAgent }) => {
  const id = String(identifier || '').trim().toLowerCase();
  if (!id) throw new BadRequestError('Email or phone is required', 'IDENTIFIER_REQUIRED');

  // Find candidate users by loginId (email or phone), across tenants.
  // Login is deliberately cross-tenant until the company is identified.
  let candidates = await User.find({ loginId: id, isDeleted: { $ne: true } })
    .select('+password')
    .skipTenant()
    .lean();

  if (!candidates.length) {
    // Fallback: match email OR phone fields directly (in case loginId not synced).
    candidates = await User.find({
      $or: [{ email: id }, { phone: String(identifier).trim() }],
      isDeleted: { $ne: true },
    })
      .select('+password')
      .skipTenant()
      .lean();
  }

  if (!candidates.length) {
    throw new UnauthorizedError('Invalid credentials', ErrorCodes.INVALID_CREDENTIALS);
  }

  // Disambiguate by company code when the login id exists in multiple tenants.
  if (companyCode) {
    const code = String(companyCode).trim().toUpperCase();
    const company = await withoutTenant(() => Company.findOne({ code, isDeleted: { $ne: true } }).lean());
    if (!company) throw new UnauthorizedError('Invalid company code', ErrorCodes.INVALID_CREDENTIALS);
    candidates = candidates.filter((c) => String(c.companyId) === String(company._id));
    if (!candidates.length) {
      throw new UnauthorizedError('Invalid credentials for this company', ErrorCodes.INVALID_CREDENTIALS);
    }
  } else if (candidates.length > 1) {
    // Ambiguous: return a helpful error listing the companies (codes only).
    const ids = [...new Set(candidates.map((c) => String(c.companyId)))];
    const companies = await withoutTenant(() =>
      Company.find({ _id: { $in: ids }, isDeleted: { $ne: true } })
        .select('code businessName')
        .lean()
    );
    throw new AppError(
      'Multiple accounts found for this login. Please enter your company code.',
      {
        status: 409,
        code: 'MULTIPLE_ACCOUNTS',
        details: companies.map((c) => ({ code: c.code, name: c.businessName })),
      }
    );
  }

  const user = candidates[0];

  // ---- Lock check -------------------------------------------------------
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    throw new AppError('Account locked due to too many failed attempts. Try again in 15 minutes.', {
      status: 423,
      code: ErrorCodes.ACCOUNT_LOCKED,
    });
  }

  // ---- Password check ---------------------------------------------------
  const bcrypt = (await import('bcryptjs')).default;
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    const attempts = (user.failedLoginAttempts || 0) + 1;
    await User.updateOne(
      { _id: user._id, companyId: user.companyId },
      {
        $set: { failedLoginAttempts: attempts },
        ...(attempts >= 5 ? { $set: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } } : {}),
      }
    );
    throw new UnauthorizedError('Invalid credentials', ErrorCodes.INVALID_CREDENTIALS);
  }

  if (!user.isActive) throw new ForbiddenError('Your account has been deactivated', 'FORBIDDEN');
  if (user.isDeleted) throw new UnauthorizedError('Invalid credentials', ErrorCodes.INVALID_CREDENTIALS);

  // ---- Company status gate ---------------------------------------------
  const company = await withoutTenant(() => Company.findById(user.companyId).lean());
  if (!company || company.isDeleted) throw new ForbiddenError('Company not found', 'NOT_FOUND');

  const now = Date.now();
  const end = company.subscriptionEnd || company.trialEndsAt;
  const expired = end && new Date(end).getTime() < now;

  if (company.status === COMPANY_STATUS.SUSPENDED) {
    throw new AppError('Company account is suspended. Please contact support.', {
      status: 403,
      code: ErrorCodes.COMPANY_SUSPENDED,
      details: company.statusReason || undefined,
    });
  }
  if (company.status === COMPANY_STATUS.CANCELLED) {
    throw new AppError('Company account is cancelled.', { status: 403, code: ErrorCodes.COMPANY_EXPIRED });
  }
  if (expired) {
    await withoutTenant(() =>
      Company.updateOne({ _id: company._id }, { $set: { status: COMPANY_STATUS.EXPIRED } })
    );
    throw new AppError(
      company.status === COMPANY_STATUS.TRIAL ? 'Trial period has ended. Please subscribe to continue.' : 'Subscription has expired. Please renew.',
      { status: 403, code: ErrorCodes.COMPANY_EXPIRED }
    );
  }

  // ---- Issue tokens -----------------------------------------------------
  const { accessToken, refreshToken, jti } = await issueTokens({
    userId: String(user._id),
    scope: 'company',
    companyId: String(company._id),
    userAgent,
    ip,
  });

  await User.updateOne(
    { _id: user._id, companyId: company._id },
    { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip, lastSeenAt: new Date() } }
  );

  // Ensure settings exist (first login creates defaults).
  const settings = await withTenant(company._id, () => Setting.forCompany(company._id)).catch((e) => {
    logger.warn(`settings bootstrap failed: ${e.message}`);
    return null;
  });
  // The workspace header shows the editable display name, falling back to the
  // registered business name.
  const displayName = settings?.displayName?.trim() || '';

  // Touch company lastActivity
  await withoutTenant(() =>
    Company.updateOne({ _id: company._id }, { $set: { lastActivityAt: new Date() } })
  ).catch(() => {});

  return {
    accessToken,
    refreshToken,
    jti,
    company: {
      id: String(company._id),
      name: displayName || company.businessName,
      businessName: company.businessName,
      code: company.code,
      slug: company.slug,
      logo: company.logo || '',
      currency: company.currency,
      currencySymbol: company.currencySymbol,
      businessType: company.businessType,
      status: company.status,
      timezone: company.timezone,
      financialYearStartMonth: company.financialYearStartMonth,
    },
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      title: user.title || '',
      scope: 'company',
      avatar: user.avatar || '',
      mustChangePassword: Boolean(user.mustChangePassword),
      territory: user.territory || '',
    },
  };
};

// ---------------------------------------------------------------------------
// REFRESH (with rotation + reuse detection)
// ---------------------------------------------------------------------------
export const refreshTokens = async ({ token, ip, userAgent, res }) => {
  if (!token) throw new UnauthorizedError('Refresh token missing', 'TOKEN_INVALID');

  const decoded = verifyRefreshToken(token);
  const { jti, scope, sub: userId, companyId } = decoded;
  if (!jti) throw new UnauthorizedError('Invalid refresh token', 'TOKEN_INVALID');

  const session = await Session.findOne({ jti }).select('+refreshTokenHash').lean();

  if (!session) {
    throw new UnauthorizedError('Session not found', 'TOKEN_INVALID');
  }
  if (session.expiresAt < new Date()) {
    await Session.updateOne({ jti }, { $set: { revokedAt: new Date(), revokedReason: 'expired' } });
    throw new UnauthorizedError('Refresh token expired', 'TOKEN_EXPIRED');
  }

  // Verify the presented token matches the stored hash (belt & braces).
  if (hashToken(token) !== session.refreshTokenHash) {
    await revokeAllForUser(scope, userId, companyId, 'hash-mismatch');
    throw new UnauthorizedError('Invalid refresh token', ErrorCodes.REFRESH_REUSE);
  }

  // Reuse detection: a rotated/revoked jti being replayed == possible theft.
  if (session.revokedAt) {
    const rotated = session.revokedReason === 'rotated';
    const withinGrace =
      rotated && Date.now() - new Date(session.revokedAt).getTime() <= REFRESH_GRACE_MS;
    const sameClient = !session.ip || !ip || session.ip === ip;

    if (!withinGrace || !sameClient) {
      await revokeAllForUser(scope, userId, companyId, 'refresh-reuse-detected');
      throw new UnauthorizedError(
        'Session revoked due to a security concern. Please sign in again.',
        ErrorCodes.REFRESH_REUSE
      );
    }

    // Same device replaying the token we issued seconds ago: the browser simply
    // missed the rotated cookie. Re-issue instead of signing the user out.
    logger.warn(
      `Refresh replayed within ${REFRESH_GRACE_MS}ms grace window (jti=${jti}); issuing a fresh rotation.`
    );
  } else {
    // Rotate: revoke old, issue new.
    await Session.updateOne(
      { jti },
      { $set: { revokedAt: new Date(), revokedReason: 'rotated', isCurrent: false } }
    );
  }

  const issued = await issueTokens({
    userId: String(userId),
    scope,
    companyId: companyId ? String(companyId) : null,
    userAgent,
    ip,
  });

  if (scope === 'platform') {
    const admin = await PlatformUser.findById(userId).lean();
    if (!admin || !admin.isActive || admin.isDeleted) {
      throw new UnauthorizedError('Account unavailable', 'TOKEN_INVALID');
    }
    return {
      ...issued,
      scope,
      user: { id: String(admin._id), name: admin.name, email: admin.email, role: admin.role, scope: 'platform' },
    };
  }

  // company scope
  const user = await User.findOne({ _id: userId, companyId, isDeleted: { $ne: true } }).lean();
  if (!user) throw new UnauthorizedError('Account unavailable', 'TOKEN_INVALID');
  if (!user.isActive) throw new ForbiddenError('Your account has been deactivated', 'FORBIDDEN');

  const company = await withoutTenant(() => Company.findById(companyId).lean());
  if (!company || company.isDeleted) throw new ForbiddenError('Company not found', 'NOT_FOUND');

  const end = company.subscriptionEnd || company.trialEndsAt;
  if (company.status === COMPANY_STATUS.SUSPENDED) {
    throw new AppError('Company account is suspended.', { status: 403, code: ErrorCodes.COMPANY_SUSPENDED });
  }
  if (end && new Date(end) < new Date() && !LIVE_COMPANY_STATUSES.includes(company.status)) {
    throw new AppError('Subscription has expired.', { status: 403, code: ErrorCodes.COMPANY_EXPIRED });
  }

  const settings = await withTenant(companyId, () => Setting.forCompany(companyId)).catch(() => null);
  const displayName = settings?.displayName?.trim() || '';

  return {
    ...issued,
    scope,
    company: {
      id: String(company._id),
      name: displayName || company.businessName,
      businessName: company.businessName,
      code: company.code,
      slug: company.slug,
      logo: company.logo || '',
      currency: company.currency,
      currencySymbol: company.currencySymbol,
      businessType: company.businessType,
      status: company.status,
    },
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      scope: 'company',
      avatar: user.avatar || '',
      mustChangePassword: Boolean(user.mustChangePassword),
      title: user.title || '',
    },
  };
};

// ---------------------------------------------------------------------------
// LOGOUT
// ---------------------------------------------------------------------------
export const logout = async ({ jti, scope, userId, companyId }) => {
  if (jti) {
    await Session.updateOne({ jti }, { $set: { revokedAt: new Date(), revokedReason: 'logout', isCurrent: false } });
  }
  return { ok: true };
};

export const logoutAll = async ({ scope, userId, companyId, exceptJti }) => {
  const filter = {
    scope,
    revokedAt: null,
    ...(scope === 'company' ? { user: userId } : { platformUser: userId }),
  };
  if (exceptJti) filter.jti = { $ne: exceptJti };
  const res = await Session.updateMany(filter, {
    $set: { revokedAt: new Date(), revokedReason: 'logout-all', isCurrent: false },
  });

  // Also clear denormalised tokens on the user doc.
  const Model = scope === 'platform' ? PlatformUser : User;
  const userFilter = { _id: userId };
  if (scope === 'company' && companyId) userFilter.companyId = companyId;
  await Model.updateOne(userFilter, { $set: { refreshTokens: [] } }).catch(() => {});

  return { revoked: res.modifiedCount || 0 };
};

const revokeAllForUser = async (scope, userId, companyId, reason) => {
  const filter = {
    scope,
    revokedAt: null,
    ...(scope === 'company' ? { user: userId } : { platformUser: userId }),
  };
  await Session.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason, isCurrent: false } });
};

// ---------------------------------------------------------------------------
// Sessions listing
// ---------------------------------------------------------------------------
export const listSessions = async ({ scope, userId }) => {
  const filter = {
    scope,
    revokedAt: null,
    expiresAt: { $gte: new Date() },
    ...(scope === 'company' ? { user: userId } : { platformUser: userId }),
  };
  const sessions = await Session.find(filter)
    .select('jti userAgent ip issuedAt lastUsedAt isCurrent expiresAt')
    .sort({ issuedAt: -1 })
    .lean();
  return sessions.map((s) => ({
    id: s.jti,
    userAgent: s.userAgent,
    ip: s.ip,
    issuedAt: s.issuedAt,
    lastUsedAt: s.lastUsedAt,
    expiresAt: s.expiresAt,
    current: s.isCurrent,
  }));
};

export const revokeSession = async ({ scope, userId, jti }) => {
  const filter = { jti, scope, ...(scope === 'company' ? { user: userId } : { platformUser: userId }) };
  const res = await Session.updateOne({ ...filter, revokedAt: null }, {
    $set: { revokedAt: new Date(), revokedReason: 'user-revoked', isCurrent: false },
  });
  if (!res.matchedCount) throw new NotFoundOrForbidden();
  return { ok: true };
};

class NotFoundOrForbidden extends AppError {
  constructor() {
    super('Session not found', { status: 404, code: 'NOT_FOUND' });
  }
}

// ---------------------------------------------------------------------------
// CHANGE PASSWORD
// ---------------------------------------------------------------------------
export const changePassword = async ({ scope, userId, companyId, currentPassword, newPassword, keepSessionJti }) => {
  const Model = scope === 'platform' ? PlatformUser : User;
  const doc = await Model.findById(userId).select('+password');
  if (!doc) throw new UnauthorizedError('Account not found', 'TOKEN_INVALID');

  const bcrypt = (await import('bcryptjs')).default;
  const ok = await bcrypt.compare(currentPassword, doc.password);
  if (!ok) throw new BadRequestError('Current password is incorrect', 'WRONG_CURRENT_PASSWORD');

  const { validatePasswordPolicy } = await import('../utils/password.js');
  validatePasswordPolicy(newPassword);

  doc.password = newPassword;
  doc.mustChangePassword = false;
  await doc.save();

  // Revoke all other sessions (force re-auth everywhere else).
  await revokeAllForUser(scope, userId, companyId, 'password-changed');

  return { ok: true };
};

// ---------------------------------------------------------------------------
// FORGOT / RESET PASSWORD
// ---------------------------------------------------------------------------
export const forgotPassword = async ({ email, scope }) => {
  const Model = scope === 'platform' ? PlatformUser : User;
  const query = Model.findOne({
    ...(scope === 'platform' ? { email: String(email).toLowerCase() } : { loginId: String(email).toLowerCase() }),
    isDeleted: { $ne: true },
  });
  // Company lookups run outside a request context (no JWT yet) -> opt out.
  if (scope === 'company') query.skipTenant();
  const user = await query.lean();

  if (!user) return { ok: true }; // do not reveal existence

  const crypto = (await import('node:crypto')).default;
  const raw = crypto.randomBytes(32).toString('hex');
  const hashed = crypto.createHash('sha256').update(raw).digest('hex');

  const updateFilter = { _id: user._id };
  if (scope === 'company' && user.companyId) updateFilter.companyId = user.companyId;
  await Model.updateOne(updateFilter, {
    $set: { passwordResetToken: hashed, passwordResetExpires: new Date(Date.now() + 30 * 60 * 1000) },
  });

  const resetUrl = `${env.mail.appUrl}/reset-password?token=${raw}&scope=${scope}`;
  const to = user.email || (String(user.loginId || '').includes('@') ? user.loginId : null);

  if (to) {
    const { sendMail } = await import('./mailer.js');
    await sendMail({
      to,
      subject: 'Reset your ElevIQ SFA password',
      text: [
        `Hi ${user.name || ''},`.trim(),
        '',
        'We received a request to reset your ElevIQ SFA password.',
        'Open the link below within 30 minutes to choose a new one:',
        '',
        resetUrl,
        '',
        'If you did not request this, you can safely ignore this email - your password stays unchanged.',
        '',
        '— ElevIQ SFA',
      ].join('\n'),
    });
  } else {
    logger.info(`Password reset requested for ${email} (scope=${scope}) but the account has no email on file.`);
  }

  // The raw token is only echoed back outside production so QA can complete
  // the flow without an SMTP server (and tests can drive the reset endpoint).
  logger.info(`Password reset requested for ${email} (scope=${scope}). Token: ${env.isProd ? '[hidden]' : raw}`);
  return { ok: true, devToken: env.isProd ? undefined : raw };
};

export const resetPassword = async ({ token, password, scope }) => {
  const crypto = (await import('node:crypto')).default;
  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  const Model = scope === 'platform' ? PlatformUser : User;

  const query = Model.findOne({
    passwordResetToken: hashed,
    passwordResetExpires: { $gt: new Date() },
    isDeleted: { $ne: true },
  }).select('+password');
  if (scope === 'company') query.skipTenant();
  const user = await query;
  if (!user) throw new BadRequestError('Reset link is invalid or has expired', 'INVALID_RESET_TOKEN');

  const { validatePasswordPolicy } = await import('../utils/password.js');
  validatePasswordPolicy(password);

  user.password = password;
  user.passwordResetToken = null;
  user.passwordResetExpires = null;
  user.mustChangePassword = false;
  await user.save();

  await revokeAllForUser(scope, String(user._id), user.companyId ? String(user.companyId) : null, 'password-reset');

  return { ok: true };
};

export default {
  loginPlatform,
  loginCompany,
  refreshTokens,
  logout,
  logoutAll,
  changePassword,
  forgotPassword,
  resetPassword,
};
