import * as portalAuth from '../../services/portalAuthService.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  PORTAL_REFRESH_COOKIE,
  clearPortalRefreshCookie,
  setPortalRefreshCookie,
  verifyPortalRefreshToken,
} from '../../utils/tokens.js';

const pickUA = (req) => (req.headers['user-agent'] || '').slice(0, 300);

const sessionPayload = (result) => ({
  accessToken: result.accessToken,
  account: result.account,
  customer: result.customer,
  company: result.company,
  portal: result.portal,
});

/** GET /portal/company/:code - name and logo for the login page. */
export const companyInfo = asyncHandler(async (req, res) => {
  const { company, settings } = await portalAuth.loadPortalCompany(req.params.code);
  return success(res, { data: portalAuth.publicCompanyInfo(company, settings) });
});

/**
 * GET /portal/company/:code/manifest.webmanifest - installs the portal as the
 * company's own app (opens on /portal/<CODE>, not the staff login).
 */
export const manifest = asyncHandler(async (req, res) => {
  const { company, settings } = await portalAuth.loadPortalCompany(req.params.code);
  const info = portalAuth.publicCompanyInfo(company, settings);
  const base = `/portal/${encodeURIComponent(info.code)}/`;
  res.type('application/manifest+json');
  res.set('Cache-Control', 'public, max-age=3600');
  return res.send(
    JSON.stringify({
      name: `${info.name} - Order online`,
      short_name: info.name.slice(0, 12),
      start_url: base,
      scope: base,
      id: base,
      display: 'standalone',
      theme_color: '#0b1220',
      background_color: '#0b1220',
      icons: [
        { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    })
  );
});

/** POST /portal/auth/login { companyCode, mobile, pin } */
export const login = asyncHandler(async (req, res) => {
  const result = await portalAuth.loginPortal({
    companyCode: req.body.companyCode,
    mobile: req.body.mobile,
    pin: req.body.pin,
    ip: req.ip,
    userAgent: pickUA(req),
  });
  setPortalRefreshCookie(res, result.refreshToken);
  return success(res, { message: 'Signed in', data: sessionPayload(result) });
});

/** POST /portal/auth/refresh (portal cookie) */
export const refresh = asyncHandler(async (req, res) => {
  const result = await portalAuth.refreshPortal({
    token: req.cookies?.[PORTAL_REFRESH_COOKIE],
    ip: req.ip,
    userAgent: pickUA(req),
  });
  setPortalRefreshCookie(res, result.refreshToken);
  return success(res, { message: 'Refreshed', data: sessionPayload(result) });
});

/** POST /portal/auth/logout */
export const logout = asyncHandler(async (req, res) => {
  let jti = req.portal?.sid || null;
  const token = req.cookies?.[PORTAL_REFRESH_COOKIE];
  if (token) {
    try {
      jti = verifyPortalRefreshToken(token).jti || jti;
    } catch {
      /* expired cookie: nothing to revoke */
    }
  }
  await portalAuth.logoutPortal(jti);
  clearPortalRefreshCookie(res);
  return success(res, { message: 'Signed out' });
});

/** POST /portal/auth/change-pin { currentPin, newPin, confirmPin } */
export const changePin = asyncHandler(async (req, res) => {
  await portalAuth.changePin({
    accountId: req.portal.accountId,
    currentPin: req.body.currentPin,
    newPin: req.body.newPin,
    keepJti: req.portal.sid,
  });
  return success(res, { message: 'PIN changed' });
});
