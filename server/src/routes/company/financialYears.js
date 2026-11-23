import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../../controllers/company/yearCloseController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';

/** /api/v1/financial-years - year closing (lock, closing balances, reopen). */
const router = Router();
const tagParams = z.object({ tag: z.string().regex(/^\d{4}$/, 'Unknown financial year') });

router.get('/', authorize('books.view'), ctrl.list);
router.get('/status', authorize('books.view'), ctrl.status);
// Setting up the new year: copy targets, extend validity, check numbering.
router.get('/new-year', authorize('books.view', 'fieldforce.targets.manage'), ctrl.newYear);
router.post('/new-year/targets', authorize('fieldforce.targets.manage'), validate({ body: z.object({ percent: z.number().min(-90).max(500).optional() }) }), ctrl.newYearTargets);
router.post(
  '/new-year/extend',
  authorize('schemes.update', 'products.update', 'discounts.update'),
  validate({
    body: z.object({
      items: z.array(z.object({ kind: z.enum(['SCHEME', 'PRICE_LIST', 'DISCOUNT']), id: z.string().regex(/^[a-f0-9]{24}$/i) })).min(1).max(200),
      validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  }),
  ctrl.newYearExtend
);
router.get('/:tag/export', authorize('books.view'), validate({ params: tagParams }), ctrl.exportPack);
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
  validate({ params: tagParams, body: z.object({ notes: z.string().trim().max(1000).optional().or(z.literal('')), force: z.boolean().optional() }) }),
  ctrl.close
);
router.post(
  '/:tag/reopen',
  authorize('books.close'),
  validate({ params: tagParams, body: z.object({ reason: z.string().trim().min(5, 'Give the reason (at least 5 characters)').max(1000) }) }),
  ctrl.reopen
);

export default router;
