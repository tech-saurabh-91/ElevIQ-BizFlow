import { Router } from 'express';
import * as ctrl from '../../controllers/company/beatController.js';
import { validate, z, objectIdSchema } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';

/** /api/v1/beat-plans - route planning and the salesman's day. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const router = Router();
router.get('/', authorize('fieldforce.visits.view'), validate({ query: z.object({ from: day.optional(), to: day.optional() }) }), ctrl.grid);
router.put(
  '/',
  authorize('fieldforce.targets.manage'),
  validate({
    body: z.object({
      route: objectIdSchema,
      salesman: objectIdSchema.nullable().optional(),
      days: z.array(day).min(1, 'Choose at least one day').max(62),
      notes: z.string().trim().max(300).optional().or(z.literal('')),
    }),
  }),
  ctrl.setPlan
);
router.get('/mine', validate({ query: z.object({ date: day.optional() }) }), ctrl.mine);
router.get(
  '/customers',
  validate({ query: z.object({ route: z.union([objectIdSchema, z.literal('none')]).optional(), q: z.string().trim().max(80).optional() }) }),
  ctrl.customers
);
router.post(
  '/check-in',
  authorize('fieldforce.visits.manage'),
  validate({
    body: z.object({
      customerId: objectIdSchema,
      route: objectIdSchema.optional(),
      location: z.object({ lat: z.coerce.number().min(-90).max(90).nullable().optional(), lng: z.coerce.number().min(-180).max(180).nullable().optional() }).optional(),
      accuracy: z.coerce.number().min(0).max(1e6).optional(),
      address: z.string().trim().max(300).optional(),
    }),
  }),
  ctrl.checkIn
);

export default router;
