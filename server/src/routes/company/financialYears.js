import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../../controllers/company/yearCloseController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';

/** /api/v1/financial-years - year closing (lock, closing balances, reopen). */
const router = Router();
const tagParams = z.object({ tag: z.string().regex(/^\d{4}$/, 'Unknown financial year') });

router.get('/', authorize('books.view'), ctrl.list);
router.get('/:tag/checklist', authorize('books.view'), validate({ params: tagParams }), ctrl.checklist);
router.get(
  '/:tag/balances',
  authorize('books.view'),
  validate({
    params: tagParams,
    query: z.object({
      kind: z.enum(['CUSTOMER', 'SUPPLIER', 'STOCK']).optional(),
      search: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  }),
  ctrl.balances
);
router.post(
  '/:tag/close',
  authorize('books.close'),
  validate({ params: tagParams, body: z.object({ notes: z.string().trim().max(1000).optional().or(z.literal('')) }) }),
  ctrl.close
);
router.post(
  '/:tag/reopen',
  authorize('books.close'),
  validate({ params: tagParams, body: z.object({ reason: z.string().trim().min(5, 'Give the reason (at least 5 characters)').max(1000) }) }),
  ctrl.reopen
);

export default router;
