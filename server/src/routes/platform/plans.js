import { Router } from 'express';
import * as ctrl from '../../controllers/platform/planController.js';
import { validate, paginationSchema } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { z } from 'zod';
import {
  createPlanSchema,
  updatePlanSchema,
  companyParamsSchema,
} from '../../validators/platformValidators.js';

/**
 * /api/platform/plans
 * Plan catalogue (pricing/limits/features) shared by every tenant.
 * `authorize()` keeps PLATFORM_SUPPORT read-only (non-GET blocked).
 */
const router = Router();
router.use(authorize());

const planListQuerySchema = paginationSchema.extend({
  active: z.enum(['true', 'false']).optional(),
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

router.get('/', validate({ query: planListQuerySchema }), ctrl.list);
router.post('/', validate({ body: createPlanSchema }), ctrl.create);
router.get('/:id', ctrl.detail);
router.patch('/:id', validate({ body: updatePlanSchema }), ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
