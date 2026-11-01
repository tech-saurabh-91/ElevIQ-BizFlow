import { Router } from 'express';
import * as ctrl from '../../controllers/platform/announcementController.js';
import { validate, paginationSchema } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { z } from 'zod';
import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  companyParamsSchema,
} from '../../validators/platformValidators.js';

/**
 * /api/platform/announcements
 * Platform-pushed messages shown inside company workspaces.
 * `authorize()` keeps PLATFORM_SUPPORT read-only.
 */
const router = Router();
router.use(authorize());

const announcementListQuerySchema = paginationSchema.extend({
  active: z.enum(['true', 'false']).optional(),
  type: z.enum(['INFO', 'UPDATE', 'MAINTENANCE', 'PROMO', 'FEATURE']).optional(),
});

router.param('id', (req, _res, next, value) => {
  const parsed = companyParamsSchema.safeParse({ id: value });
  if (!parsed.success) {
    const err = new Error('Validation failed');
    err.status = 422;
    err.code = 'VALIDATION_ERROR';
    err.errors = parsed.error.issues.map((i) => ({ field: `params.${i.path.join('.')}`, message: i.message }));
    return next(err);
  }
  req.params.id = parsed.data.id;
  return next();
});

router.get('/', validate({ query: announcementListQuerySchema }), ctrl.list);
router.post('/', validate({ body: createAnnouncementSchema }), ctrl.create);
router.patch('/:id', validate({ body: updateAnnouncementSchema }), ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
