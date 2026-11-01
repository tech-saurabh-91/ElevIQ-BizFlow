import { Router } from 'express';
import * as ctrl from '../../controllers/auth/authController.js';
import { validate } from '../../middlewares/validate.js';
import {
  platformLoginSchema,
  companyLoginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshSchema,
} from '../../validators/authValidators.js';
import { authenticate } from '../../middlewares/auth.js';
import { authLimiter } from '../../middlewares/security.js';

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Shared authentication entrypoints (company + platform refresh)
 */
const router = Router();

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Company workspace login (email or phone + optional company code)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier, password]
 *             properties:
 *               identifier: { type: string, example: admin@democorp.com }
 *               password: { type: string, example: Passw0rd! }
 *               companyCode: { type: string, example: DEMO01 }
 *     responses:
 *       '200': { description: Signed in (returns accessToken, company, user) }
 *       '401': { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/auth/login', authLimiter, validate({ body: companyLoginSchema }), ctrl.companyLogin);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Rotate the refresh token and get a new access token
 *     security: [{ refreshCookie: [] }]
 *     responses:
 *       '200': { description: Refreshed }
 *       '401': { description: Invalid/expired/reused token }
 */
router.post('/auth/refresh', validate({ body: refreshSchema }), ctrl.refresh);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Sign out (revokes the current session, clears cookie)
 *     security: [{ bearerAuth: [] }, { refreshCookie: [] }]
 *     responses:
 *       '200': { description: Signed out }
 */
router.post('/auth/logout', authenticate, ctrl.logout);

/** Authenticated password change (company or platform session). */
router.post('/auth/change-password', authenticate, validate({ body: changePasswordSchema }), ctrl.changePassword);

/** Request a password reset link. */
router.post('/auth/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), ctrl.forgotPassword);

/** Complete a password reset. */
router.post('/auth/reset-password', authLimiter, validate({ body: resetPasswordSchema }), ctrl.resetPassword);

/** Session management (list / revoke). */
router.get('/auth/sessions', authenticate, ctrl.listSessions);
router.delete('/auth/sessions/:id', authenticate, ctrl.revokeSession);
router.post('/auth/logout-all', authenticate, ctrl.logoutAll);

export default router;
