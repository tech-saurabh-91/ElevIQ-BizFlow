import { Router } from 'express';
import * as authCtrl from '../../controllers/portal/portalAuthController.js';
import * as ctrl from '../../controllers/portal/portalController.js';
import { validate } from '../../middlewares/validate.js';
import { authLimiter } from '../../middlewares/security.js';
import { authenticatePortal, requirePinChanged } from '../../middlewares/portalAuth.js';
import { upload, folder } from '../../middlewares/upload.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import {
  portalCodeParams,
  portalLoginSchema,
  portalChangePinSchema,
  portalCartSchema,
  portalCancelSchema,
  portalStatementQuery,
  portalConfirmSchema,
  portalOtpRequestSchema,
  portalOtpVerifySchema,
  portalPaymentClaimSchema,
  portalReturnSchema,
} from '../../validators/portalValidators.js';

/**
 * @swagger
 * tags:
 *   - name: Customer Portal
 *     description: |
 *       A company's customers (shops) ordering online. Sign in on the company's
 *       link with mobile + PIN; every call after that sees only the signed-in
 *       customer's own orders, invoices and statement. Orders placed here are
 *       REQUESTED: no stock is reserved until the company accepts them.
 */
const router = Router();

// ---- Public ---------------------------------------------------------------
/**
 * @swagger
 * /api/portal/company/{code}:
 *   get:
 *     tags: [Customer Portal]
 *     summary: Company name, logo and whether online ordering is on
 *     parameters:
 *       - { in: path, name: code, required: true, schema: { type: string } }
 */
router.get('/company/:code', validate({ params: portalCodeParams }), authCtrl.companyInfo);
router.get('/company/:code/manifest.webmanifest', validate({ params: portalCodeParams }), authCtrl.manifest);

/**
 * @swagger
 * /api/portal/auth/login:
 *   post:
 *     tags: [Customer Portal]
 *     summary: Customer sign-in with mobile + PIN
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [companyCode, mobile, pin]
 *             properties:
 *               companyCode: { type: string }
 *               mobile: { type: string }
 *               pin: { type: string }
 *     responses:
 *       '200': { description: Signed in (refresh cookie eleviq_prt set on /api/portal) }
 *       '401': { description: Wrong mobile or PIN }
 *       '403': { description: Online ordering off for the company or this customer }
 *       '423': { description: Locked after 5 wrong PINs }
 */
router.post('/auth/login', authLimiter, validate({ body: portalLoginSchema }), authCtrl.login);
router.post('/auth/refresh', authCtrl.refresh);
// One-time code by SMS / WhatsApp (when the company allows it and a provider is set up).
router.post('/auth/otp', authLimiter, validate({ body: portalOtpRequestSchema }), authCtrl.requestOtp);
router.post('/auth/otp/verify', authLimiter, validate({ body: portalOtpVerifySchema }), authCtrl.loginWithOtp);

// ---- Signed-in customer ----------------------------------------------------
router.use(authenticatePortal);
router.post('/auth/logout', authCtrl.logout);
router.post('/auth/change-pin', authLimiter, validate({ body: portalChangePinSchema }), authCtrl.changePin);
router.get('/me', ctrl.me);

// Everything else waits until the customer has set their own PIN.
router.use(requirePinChanged);

/**
 * @swagger
 * /api/portal/catalog:
 *   get:
 *     tags: [Customer Portal]
 *     summary: Products at this customer's prices, with offers and stock status (no quantities)
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: category, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer } }
 */
router.get('/catalog', ctrl.catalog);

/**
 * @swagger
 * /api/portal/orders:
 *   get:
 *     tags: [Customer Portal]
 *     summary: This customer's orders
 *   post:
 *     tags: [Customer Portal]
 *     summary: Place an order request (status REQUESTED, nothing reserved)
 */
router.post('/orders/preview', validate({ body: portalCartSchema }), ctrl.preview);
router.get('/orders', ctrl.listOrders);
router.post('/orders', validate({ body: portalCartSchema }), ctrl.placeOrder);
router.get('/orders/:id', validate({ params: idParamsSchema }), ctrl.getOrder);
router.post('/orders/:id/cancel', validate({ params: idParamsSchema, body: portalCancelSchema }), ctrl.cancelOrder);

router.get('/invoices', ctrl.listInvoices);
router.get('/invoices/:id/pdf', validate({ params: idParamsSchema }), ctrl.invoicePdf);
router.get('/invoices/:id', validate({ params: idParamsSchema }), ctrl.getInvoice);

/**
 * @swagger
 * /api/portal/payments:
 *   post:
 *     tags: [Customer Portal]
 *     summary: Tell the company about a payment (multipart, optional "proof" image); staff verify it
 */
router.get('/payments', ctrl.listClaims);
router.post('/payments', folder('claims'), upload.single('proof'), validate({ body: portalPaymentClaimSchema }), ctrl.createClaim);

/**
 * @swagger
 * /api/portal/returns:
 *   post:
 *     tags: [Customer Portal]
 *     summary: Raise a return or complaint (multipart, up to 4 "photos")
 */
router.get('/returns', ctrl.listReturns);
router.post('/returns', folder('returns'), upload.array('photos', 4), validate({ body: portalReturnSchema }), ctrl.createReturn);

router.get('/notifications', ctrl.listNotifications);
router.post('/notifications/read', ctrl.readNotifications);

/**
 * @swagger
 * /api/portal/statement:
 *   get:
 *     tags: [Customer Portal]
 *     summary: Statement of account (when the company shows balances online)
 */
router.get('/statement', validate({ query: portalStatementQuery }), ctrl.statement);
router.get('/statement/pdf', validate({ query: portalStatementQuery }), ctrl.statementPdf);
router.post('/statement/confirm', validate({ body: portalConfirmSchema }), ctrl.confirmBalance);

export default router;
