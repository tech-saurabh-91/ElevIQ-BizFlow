import { Router } from 'express';
import * as ctrl from '../../controllers/company/vanController.js';
import { validate, z, objectIdSchema } from '../../middlewares/validate.js';
import { idParamsSchema } from '../../validators/companyValidators.js';

/**
 * /api/v1/vans - van stock, load / unload and day close. Access is checked
 * in the controller: inventory staff, or the executive driving the van.
 */
const moveSchema = z.object({
  items: z
    .array(z.object({ product: objectIdSchema, qty: z.coerce.number().positive('Quantity must be more than 0').max(1e9) }))
    .min(1, 'Add at least one product')
    .max(500),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

const closeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the day to close'),
  counts: z
    .array(z.object({ product: objectIdSchema, counted: z.coerce.number().min(0, 'Cannot be negative').max(1e9) }))
    .max(2000)
    .optional(),
  cashDeposited: z.coerce.number().min(0, 'Cannot be negative').max(1e12).optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
});

const router = Router();
router.get('/mine', ctrl.mine);
router.get('/:id/stock', validate({ params: idParamsSchema }), ctrl.stock);
router.post('/:id/load', validate({ params: idParamsSchema, body: moveSchema }), ctrl.load);
router.post('/:id/unload', validate({ params: idParamsSchema, body: moveSchema }), ctrl.unload);
router.get('/:id/day-close', validate({ params: idParamsSchema }), ctrl.dayClosePreview);
router.post('/:id/day-close', validate({ params: idParamsSchema, body: closeSchema }), ctrl.closeDay);
router.get('/:id/day-closes', validate({ params: idParamsSchema }), ctrl.dayCloses);

export default router;
