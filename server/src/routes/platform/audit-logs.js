import { Router } from 'express';
import * as ctrl from '../../controllers/platform/auditLogController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { auditLogQuerySchema } from '../../validators/platformValidators.js';

/**
 * /api/platform/audit-logs
 * Platform-wide audit trail (company changes, impersonation, plan edits...).
 * Read-only for both platform roles — no mutating routes here.
 */
const router = Router();
router.use(authorize());

router.get('/summary', ctrl.summary);
router.get('/', validate({ query: auditLogQuerySchema }), ctrl.list);

export default router;
