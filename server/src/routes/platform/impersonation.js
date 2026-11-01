import { Router } from 'express';
import * as ctrl from '../../controllers/platform/impersonationController.js';
import { authenticate } from '../../middlewares/auth.js';

/**
 * /api/platform/impersonation
 *
 * IMPORTANT: this router is mounted BEFORE `authenticate, requirePlatformScope`
 * in routes/platform/index.js because it is called with the short-lived
 * IMPERSONATION token (scope='impersonate') issued by POST /companies/:id/impersonate.
 * The exit endpoint is idempotent and also accepts a normal platform token so
 * the client can always get back to /platform.
 */
const router = Router();

router.post('/exit', authenticate, ctrl.exit);

export default router;
