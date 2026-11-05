import { Router } from 'express';
import * as ctrl from '../../controllers/company/stockRequestController.js';
import { validate, z, objectIdSchema, paginationSchema } from '../../middlewares/validate.js';
import { idParamsSchema } from '../../validators/companyValidators.js';

/**
 * /api/v1/stock-requests - van stock requests. Who may do what (executive
 * raises / receives, inventory managers approve / reject) is checked in the
 * controller.
 */
const lines = z
  .array(z.object({ product: objectIdSchema, qty: z.coerce.number().min(0, 'Cannot be negative').max(1e9) }))
  .max(500);
const text = z.string().trim().max(500).optional().or(z.literal(''));

const router = Router();
router.get(
  '/',
  validate({ query: paginationSchema.extend({ status: z.string().optional(), van: objectIdSchema.optional() }) }),
  ctrl.list
);
router.post('/', validate({ body: z.object({ items: lines.min(1, 'Add at least one product'), notes: text, neededOn: z.string().optional() }) }), ctrl.create);
router.get('/:id', validate({ params: idParamsSchema }), ctrl.get);
router.post('/:id/approve', validate({ params: idParamsSchema, body: z.object({ items: lines.min(1, 'Approve at least one product'), notes: text }) }), ctrl.approve);
router.post('/:id/reject', validate({ params: idParamsSchema, body: z.object({ reason: text }) }), ctrl.reject);
router.post('/:id/cancel', validate({ params: idParamsSchema, body: z.object({ reason: text }) }), ctrl.cancel);
router.post('/:id/receive', validate({ params: idParamsSchema, body: z.object({ items: lines.optional(), notes: text }) }), ctrl.receive);

export default router;
