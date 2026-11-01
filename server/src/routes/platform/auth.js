import { Router } from 'express';
import * as ctrl from '../../controllers/auth/authController.js';
import { validate } from '../../middlewares/validate.js';
import { platformLoginSchema } from '../../validators/authValidators.js';
import { authenticate } from '../../middlewares/auth.js';
import { requirePlatformScope } from '../../middlewares/rbac.js';
import { authLimiter } from '../../middlewares/security.js';

/**
 * @swagger
 * tags:
 *   - name: Platform Auth
 *     description: Service provider (SaaS owner) authentication
 */
const router = Router();

/**
 * @swagger
 * /api/platform/auth/login:
 *   post:
 *     tags: [Platform Auth]
 *     summary: Super admin / platform support login
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       '200': { description: Signed in }
 *       '401': { description: Invalid credentials }
 *       '423': { description: Account locked }
 */
router.post('/login', authLimiter, validate({ body: platformLoginSchema }), ctrl.platformLogin);

/** Current platform admin profile. */
router.get('/me', authenticate, requirePlatformScope, ctrl.platformMe);

export default router;
