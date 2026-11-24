import bcrypt from 'bcryptjs';
import Company from '../models/Company.js';
import Customer from '../models/Customer.js';
import CustomerAccount, { MAX_FAILED_PINS, PIN_LOCK_MINUTES, PIN_PATTERN, normalizeMobile } from '../models/CustomerAccount.js';
import Session from '../models/Session.js';
import Setting from '../models/Setting.js';
import { withTenant, withoutTenant } from '../middlewares/tenant.js';
import { COMPANY_STATUS } from '../config/constants.js';
import { AppError, BadRequestError, ErrorCodes, ForbiddenError, NotFoundError, UnauthorizedError } from '../utils/errors.js';
import {
  hashToken,
  newJti,
  refreshExpiryDate,
  signPortalAccessToken,
  signPortalRefreshToken,
  verifyPortalRefreshToken,
} from '../utils/tokens.js';
import logger from '../utils/logger.js';
import crypto from 'node:crypto';
import { messagingAvailable, phoneForMessages, sendText } from './customerMessaging.js';

/**
 * Customer portal sign-in: company link (/portal/<CODE>) + mobile + PIN.
 *
 * Mirrors the staff flow in authService (Session row per refresh token,
 * rotation, reuse detection, lockout) but never shares a token or a cookie
 * with it: portal tokens have their own audience and scope 'customer'.
 */

const REFRESH_GRACE_MS = 60 * 1000;
const PIN_ERROR = 'Mobile number or PIN is incorrect';
// Compared against when the mobile is unknown, so both cases take as long.
const DUMMY_HASH = bcrypt.hashSync('no-such-account', 4);

/** The portal is open for this company: plan module on and switched on in settings. */
export const portalOpen = (company, settings) =>
  company?.featureFlags?.customerPortal === true && settings?.portal?.enabled === true;

/** Throws when the company cannot be used right now (same rules as staff). */
export const assertCompanyLive = (company) => {
  if (!company || company.isDeleted || company.purgedAt) throw new NotFoundError('Company not found', 'NOT_FOUND');
  if (company.status === COMPANY_STATUS.SUSPENDED || company.status === COMPANY_STATUS.CANCELLED) {
    throw new AppError('This company is not taking orders online right now.', { status: 403, code: ErrorCodes.COMPANY_SUSPENDED });
  }
  const end = company.subscriptionEnd || company.trialEndsAt;
  const expired = end && new Date(end).getTime() < Date.now();
  if (company.status === COMPANY_STATUS.EXPIRED || (company.status === COMPANY_STATUS.TRIAL && expired)) {
    throw new AppError('This company is not taking orders online right now.', { status: 403, code: ErrorCodes.COMPANY_EXPIRED });
  }
};

const portalClosed = () =>
  new ForbiddenError('Online ordering is not switched on for this company.', 'PORTAL_DISABLED');

/** Company by its code, with its settings, for the public portal pages. */
export const loadPortalCompany = async (code) => {
  const company = await withoutTenant(() =>
    Company.findOne({ code: String(code || '').trim().toUpperCase(), isDeleted: { $ne: true } }).lean()
  );
  if (!company) throw new NotFoundError('Company not found', 'NOT_FOUND');
  const settings = await withTenant(company._id, () => Setting.forCompany(company._id));
  return { company, settings };
};

/** What the login page may show about a company (no private data). */
export const publicCompanyInfo = (company, settings) => ({
  code: company.code,
  name: settings?.displayName?.trim() || company.businessName,
  logo: settings?.logo || company.logo || '',
  open: portalOpen(company, settings),
  // Sign in with a one-time code by SMS / WhatsApp as well as with the PIN.
  otp: otpAllowed(settings),
});

/** OTP login: switched on by the company and a messaging provider set up. */
export const otpAllowed = (settings) => settings?.portal?.otpLogin === true && messagingAvailable();

const issuePortalTokens = async ({ account, companyId, userAgent, ip }) => {
  const jti = newJti();
  const refreshToken = signPortalRefreshToken({ accountId: account._id, companyId, jti });
  const accessToken = signPortalAccessToken({
    accountId: account._id,
    companyId,
    customerId: account.customer,
    sid: jti,
  });
  await Session.create({
    scope: 'customer',
    companyId: String(companyId),
    customerAccount: account._id,
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

/** Session payload the portal app keeps: who is signed in, for which company. */
export const portalSessionView = ({ account, customer, company, settings }) => ({
  account: {
    id: String(account._id),
    mobile: account.mobile,
    mustChangePin: Boolean(account.mustChangePin),
  },
  customer: {
    id: String(customer._id),
    name: customer.name,
    code: customer.code,
    phone: customer.phone || '',
  },
  company: {
    id: String(company._id),
    code: company.code,
    name: settings?.displayName?.trim() || company.businessName,
    logo: settings?.logo || company.logo || '',
    currency: company.currency || 'INR',
    timezone: company.timezone || 'Asia/Kolkata',
    country: company.address?.country || '',
  },
  portal: {
    showStockStatus: settings?.portal?.showStockStatus !== false,
    showOutstanding: settings?.portal?.showOutstanding !== false,
    minOrderValue: Number(settings?.portal?.minOrderValue || 0),
    paymentClaims: settings?.portal?.paymentClaims !== false,
    returns: settings?.portal?.returns !== false,
  },
});

const loadAccountContext = async (companyId, accountId) =>
  withTenant(companyId, async () => {
    const account = await CustomerAccount.findById(accountId).lean();
    const customer = account ? await Customer.findById(account.customer).lean() : null;
    return { account, customer };
  });

const assertAccountUsable = (account, customer) => {
  if (!account || !customer) throw new UnauthorizedError('Account unavailable', 'TOKEN_INVALID');
  if (!account.isActive || customer.isActive === false) {
    throw new ForbiddenError('Online ordering is switched off for your account. Please contact the company.', 'PORTAL_ACCESS_OFF');
  }
};

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
export const loginPortal = async ({ companyCode, mobile, pin, ip, userAgent }) => {
  const { company, settings } = await loadPortalCompany(companyCode);
  assertCompanyLive(company);
  if (!portalOpen(company, settings)) throw portalClosed();

  const number = normalizeMobile(mobile);
  return withTenant(company._id, async () => {
    const account = await CustomerAccount.findOne({ mobile: number }).select('+pin');
    if (!account) {
      // Same answer and similar time as a wrong PIN.
      await bcrypt.compare(String(pin || ''), DUMMY_HASH);
      throw new UnauthorizedError(PIN_ERROR, ErrorCodes.INVALID_CREDENTIALS);
    }
    if (account.lockedUntil && account.lockedUntil > new Date()) {
      throw new AppError(`Too many wrong PINs. Try again after ${PIN_LOCK_MINUTES} minutes.`, {
        status: 423,
        code: ErrorCodes.ACCOUNT_LOCKED,
      });
    }

    const ok = await bcrypt.compare(String(pin || ''), account.pin);
    if (!ok) {
      account.failedAttempts = (account.failedAttempts || 0) + 1;
      if (account.failedAttempts >= MAX_FAILED_PINS) {
        account.lockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000);
        account.failedAttempts = 0;
      }
      await account.save();
      throw new UnauthorizedError(PIN_ERROR, ErrorCodes.INVALID_CREDENTIALS);
    }

    const customer = await Customer.findById(account.customer).lean();
    assertAccountUsable(account, customer);

    account.failedAttempts = 0;
    account.lockedUntil = null;
    account.lastLoginAt = new Date();
    await account.save();

    const tokens = await issuePortalTokens({ account, companyId: company._id, userAgent, ip });
    return { ...tokens, ...portalSessionView({ account, customer, company, settings }) };
  });
};

// ---------------------------------------------------------------------------
// REFRESH (rotation + reuse detection, like staff sessions)
// ---------------------------------------------------------------------------
const revokeAllForAccount = (accountId, reason) =>
  Session.updateMany(
    { scope: 'customer', customerAccount: accountId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason, isCurrent: false } }
  );

export const revokePortalSessions = (accountId, reason = 'access-changed') => revokeAllForAccount(accountId, reason);

export const refreshPortal = async ({ token, ip, userAgent }) => {
  if (!token) throw new UnauthorizedError('Refresh token missing', 'TOKEN_INVALID');
  const decoded = verifyPortalRefreshToken(token);
  const { jti, sub: accountId, companyId } = decoded;

  const session = await Session.findOne({ jti, scope: 'customer' }).select('+refreshTokenHash').lean();
  if (!session) throw new UnauthorizedError('Session not found', 'TOKEN_INVALID');
  if (session.expiresAt < new Date()) throw new UnauthorizedError('Refresh token expired', 'TOKEN_EXPIRED');
  if (hashToken(token) !== session.refreshTokenHash) {
    await revokeAllForAccount(accountId, 'hash-mismatch');
    throw new UnauthorizedError('Invalid refresh token', ErrorCodes.REFRESH_REUSE);
  }
  if (session.revokedAt) {
    const withinGrace =
      session.revokedReason === 'rotated' && Date.now() - new Date(session.revokedAt).getTime() <= REFRESH_GRACE_MS;
    const sameClient = !session.ip || !ip || session.ip === ip;
    if (!withinGrace || !sameClient) {
      await revokeAllForAccount(accountId, 'refresh-reuse-detected');
      throw new UnauthorizedError('Please sign in again.', ErrorCodes.REFRESH_REUSE);
    }
    logger.warn(`Portal refresh replayed within grace window (jti=${jti})`);
  } else {
    await Session.updateOne({ jti }, { $set: { revokedAt: new Date(), revokedReason: 'rotated', isCurrent: false } });
  }

  const company = await withoutTenant(() => Company.findById(companyId).lean());
  assertCompanyLive(company);
  const settings = await withTenant(companyId, () => Setting.forCompany(companyId));
  if (!portalOpen(company, settings)) throw portalClosed();
  const { account, customer } = await loadAccountContext(companyId, accountId);
  assertAccountUsable(account, customer);

  const tokens = await issuePortalTokens({ account, companyId, userAgent, ip });
  return { ...tokens, ...portalSessionView({ account, customer, company, settings }) };
};

export const logoutPortal = async (jti) => {
  if (jti) {
    await Session.updateOne({ jti, scope: 'customer' }, { $set: { revokedAt: new Date(), revokedReason: 'logout', isCurrent: false } });
  }
};

/** The customer changes their PIN (also clears "must change PIN"). */
export const changePin = async ({ accountId, currentPin, newPin, keepJti }) => {
  if (!PIN_PATTERN.test(String(newPin || ''))) throw new BadRequestError('PIN must be 4 to 6 digits', 'WEAK_PIN');
  const account = await CustomerAccount.findById(accountId).select('+pin');
  if (!account) throw new UnauthorizedError('Account unavailable', 'TOKEN_INVALID');
  if (!(await bcrypt.compare(String(currentPin || ''), account.pin))) {
    throw new BadRequestError('Current PIN is incorrect', 'INVALID_CREDENTIALS');
  }
  if (String(currentPin) === String(newPin)) throw new BadRequestError('Choose a PIN different from the current one', 'SAME_PIN');
  account.pin = String(newPin);
  account.mustChangePin = false;
  await account.save();
  // Sign out other devices, keep this one.
  await Session.updateMany(
    { scope: 'customer', customerAccount: account._id, revokedAt: null, jti: { $ne: keepJti } },
    { $set: { revokedAt: new Date(), revokedReason: 'pin-changed', isCurrent: false } }
  );
  return { ok: true };
};

export default { loginPortal, refreshPortal, logoutPortal, changePin, loadPortalCompany, publicCompanyInfo, portalOpen };

// ---------------------------------------------------------------------------
// OTP sign-in (one-time code by SMS / WhatsApp)
// ---------------------------------------------------------------------------
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_TRIES = 5;
const otpHash = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

/**
 * Send a 6-digit code to a customer's mobile. The answer never says whether
 * the mobile has a login (same reply either way).
 */
export const requestOtp = async ({ companyCode, mobile }) => {
  const { company, settings } = await loadPortalCompany(companyCode);
  assertCompanyLive(company);
  if (!portalOpen(company, settings)) throw portalClosed();
  if (!otpAllowed(settings)) throw new BadRequestError('Sign in with your PIN', 'OTP_NOT_AVAILABLE');

  const number = normalizeMobile(mobile);
  await withTenant(company._id, async () => {
    const account = await CustomerAccount.findOne({ mobile: number, isActive: true });
    if (!account) return;
    if (account.otpSentAt && Date.now() - account.otpSentAt.getTime() < OTP_RESEND_MS) {
      throw new AppError('Please wait a few seconds before asking for another code.', { status: 429, code: 'OTP_TOO_SOON' });
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    account.otpHash = otpHash(code);
    account.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    account.otpSentAt = new Date();
    account.otpAttempts = 0;
    await account.save();
    const name = settings?.displayName?.trim() || company.businessName;
    await sendText({
      to: phoneForMessages(account.mobile),
      text: `${code} is your code to sign in to ${name}. It works for 5 minutes. Do not share it.`,
      kind: 'OTP',
    });
  });
  return { sent: true };
};

/** Sign in with the code; wrong codes count towards the PIN lockout too. */
export const loginWithOtp = async ({ companyCode, mobile, otp, ip, userAgent }) => {
  const { company, settings } = await loadPortalCompany(companyCode);
  assertCompanyLive(company);
  if (!portalOpen(company, settings)) throw portalClosed();
  if (!otpAllowed(settings)) throw new BadRequestError('Sign in with your PIN', 'OTP_NOT_AVAILABLE');

  const number = normalizeMobile(mobile);
  return withTenant(company._id, async () => {
    const account = await CustomerAccount.findOne({ mobile: number }).select('+otpHash');
    const wrong = () => new UnauthorizedError('The code is wrong or has expired. Ask for a new one.', 'OTP_INVALID');
    if (!account || !account.otpHash || !account.otpExpiresAt) throw wrong();
    if (account.lockedUntil && account.lockedUntil > new Date()) {
      throw new AppError(`Too many wrong tries. Try again after ${PIN_LOCK_MINUTES} minutes.`, { status: 423, code: ErrorCodes.ACCOUNT_LOCKED });
    }
    if (account.otpExpiresAt < new Date() || account.otpAttempts >= OTP_MAX_TRIES) throw wrong();
    if (otpHash(String(otp || '').trim()) !== account.otpHash) {
      account.otpAttempts += 1;
      if (account.otpAttempts >= OTP_MAX_TRIES) account.otpHash = null;
      await account.save();
      throw wrong();
    }

    const customer = await Customer.findById(account.customer).lean();
    assertAccountUsable(account, customer);
    account.otpHash = null;
    account.otpExpiresAt = null;
    account.otpAttempts = 0;
    // The code proved they hold the mobile: no need to replace the staff PIN first.
    account.mustChangePin = false;
    account.failedAttempts = 0;
    account.lockedUntil = null;
    account.lastLoginAt = new Date();
    await account.save();

    const tokens = await issuePortalTokens({ account, companyId: company._id, userAgent, ip });
    return { ...tokens, ...portalSessionView({ account, customer, company, settings }) };
  });
};
