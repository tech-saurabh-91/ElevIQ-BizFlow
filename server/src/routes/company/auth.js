import { Router } from 'express';
import * as ctrl from '../../controllers/auth/authController.js';
import { authenticate } from '../../middlewares/auth.js';
import { requireCompanyScope } from '../../middlewares/rbac.js';
import { tenant } from '../../middlewares/tenant.js';

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Company workspace session & profile
 */
const router = Router();

// Authenticated company session
router.use(authenticate, requireCompanyScope, tenant);

/** Current user + company + effective settings. */
router.get('/me', ctrl.companyMe);

export default router;
