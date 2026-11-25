import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import env from '../config/env.js';
import { UnauthorizedError, AppError } from './errors.js';

/**
 * JWT + refresh-token helpers.
 * Access token: 15 min, sent in Authorization header.
 * Refresh token: 7 days, httpOnly cookie, rotated on every refresh, tracked by jti.
 */

export const signAccessToken = (payload) =>
  jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpires,
    issuer: 'eleviq-sfa',
    audience: payload.scope === 'platform' ? 'platform' : 'company',
  });

export const signRefreshToken = ({ userId, scope, companyId, jti }) =>
  jwt.sign(
    { sub: userId, scope, companyId: companyId || null, jti },
    env.jwt.refreshSecret,
    { expiresIn: env.jwt.refreshExpires, issuer: 'eleviq-sfa' }
  );

/** Time-limited impersonation token issued to a platform admin. */
export const signImpersonationToken = ({ platformUserId, companyId, actingAs }) =>
  jwt.sign(
    { sub: actingAs, scope: 'impersonate', companyId, platformUserId, imp: true },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.impersonateExpires, issuer: 'eleviq-sfa', audience: 'company' }
  );

export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, env.jwt.accessSecret, { issuer: 'eleviq-sfa' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Access token expired', { status: 401, code: 'TOKEN_EXPIRED' });
    }
    throw new AppError('Invalid access token', { status: 401, code: 'TOKEN_INVALID' });
  }
};

export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, env.jwt.refreshSecret, { issuer: 'eleviq-sfa' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Refresh token expired', { status: 401, code: 'TOKEN_EXPIRED' });
    }
    throw new AppError('Invalid refresh token', { status: 401, code: 'TOKEN_INVALID' });
  }
};

export const newJti = () => crypto.randomUUID();

export const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

/** Refresh token expiry as a JS Date (matches JWT exp). */
export const refreshExpiryDate = () => {
  // Parse forms like '7d', '15m', '12h'
  const m = /^(\d+)([smhd])$/.exec(env.jwt.refreshExpires);
  if (!m) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const n = Number(m[1]);
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]];
  return new Date(Date.now() + n * mult);
};

/** Cookie options for the refresh cookie. */
export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.cookie.secure,
  sameSite: env.cookie.sameSite,
  path: '/api',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  signed: false,
});

export const setRefreshCookie = (res, token) => {
  res.cookie(env.cookie.refreshName, token, refreshCookieOptions());
};

export const clearRefreshCookie = (res) => {
  res.clearCookie(env.cookie.refreshName, { ...refreshCookieOptions(), maxAge: undefined });
};

export const extractBearer = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
};

export default { signAccessToken, verifyAccessToken, extractBearer };
