import { Router } from 'express';
import * as ctrl from '../../controllers/platform/reportController.js';
import { validate } from '../../middlewares/validate.js';
import { reportOverviewQuerySchema } from '../../validators/reportValidators.js';

/**
 * Phase 8 - Platform reports.
 *
 * Read-only cross-tenant analytics. Any platform-scope session (SUPER_ADMIN or
 * PLATFORM_SUPPORT) may read them; there is no write surface.
 */
const router = Router();

router.get('/overview', validate({ query: reportOverviewQuerySchema }), ctrl.overview);

export default router;
