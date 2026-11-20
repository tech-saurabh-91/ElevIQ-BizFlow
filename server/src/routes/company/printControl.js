import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../../controllers/company/printControlController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { PRINT_DOC_TYPES } from '../../models/PrintLog.js';

/** /api/v1/print-control - original / duplicate printing of key documents. */
const router = Router();
const docParams = z.object({
  docType: z.enum(PRINT_DOC_TYPES),
  id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id'),
});

router.get(
  '/',
  authorize('documents.print.original'),
  validate({
    query: z.object({
      docType: z.enum(PRINT_DOC_TYPES).optional(),
      search: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  }),
  ctrl.list
);
router.get('/status/:docType/:id', authorize('documents.print'), validate({ params: docParams }), ctrl.status);
router.post(
  '/:docType/:id/grant',
  authorize('documents.print.original'),
  validate({ params: docParams, body: z.object({ note: z.string().trim().max(300).optional().or(z.literal('')) }) }),
  ctrl.grant
);

export default router;
