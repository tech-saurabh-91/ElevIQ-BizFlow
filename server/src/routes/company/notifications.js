import { Router } from 'express';
import * as ctrl from '../../controllers/company/notificationController.js';
import { validate } from '../../middlewares/validate.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import { notificationListQuerySchema } from '../../validators/reportValidators.js';

/**
 * Phase 8 - In-app notification inbox.
 *
 * No granular permission: any authenticated company user may read their own
 * inbox. Scoping is by `recipients`/`broadcast` + the tenant plugin, so a user
 * can never reach into another company's notifications.
 */
const router = Router();

router.get('/', validate({ query: notificationListQuerySchema }), ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.post('/read-all', ctrl.markAllRead);

router.delete('/:id', validate({ params: idParamsSchema }), ctrl.remove);
router.patch('/:id/read', validate({ params: idParamsSchema }), ctrl.markRead);

export default router;
