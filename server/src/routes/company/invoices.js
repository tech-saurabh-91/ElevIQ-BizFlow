import { Router } from 'express';
import * as ctrl from '../../controllers/company/invoiceController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import {
  invoiceCreateSchema,
  invoiceUpdateSchema,
  invoiceIssueSchema,
  invoiceCancelSchema,
  invoiceListQuerySchema,
  invoiceFormOptionsQuerySchema,
} from '../../validators/invoiceValidators.js';

/**
 * Phase 5 - Invoices API.
 * Static routes are declared before `/:id`.
 */
const router = Router();

router.get('/', authorize('invoices.view'), validate({ query: invoiceListQuerySchema }), ctrl.list);
router.get('/stats', authorize('invoices.view'), ctrl.stats);
router.get(
  '/form-options',
  authorize('invoices.view'),
  validate({ query: invoiceFormOptionsQuerySchema }),
  ctrl.formOptions
);
router.get(
  '/export',
  authorize('invoices.export'),
  validate({ query: invoiceListQuerySchema }),
  ctrl.exportXlsx
);

router.post('/', authorize('invoices.create'), validate({ body: invoiceCreateSchema }), ctrl.create);

router.get('/:id/pdf', validate({ params: idParamsSchema }), authorize('invoices.view'), ctrl.pdf);

router.post(
  '/:id/issue',
  validate({ params: idParamsSchema, body: invoiceIssueSchema }),
  authorize('invoices.update'),
  ctrl.issue
);
router.post(
  '/:id/cancel',
  validate({ params: idParamsSchema, body: invoiceCancelSchema }),
  authorize('invoices.cancel'),
  ctrl.cancel
);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('invoices.view'), ctrl.get)
  .patch(authorize('invoices.update'), validate({ body: invoiceUpdateSchema }), ctrl.update)
  .put(authorize('invoices.update'), validate({ body: invoiceUpdateSchema }), ctrl.update)
  .delete(authorize('invoices.delete'), ctrl.remove);

export default router;
