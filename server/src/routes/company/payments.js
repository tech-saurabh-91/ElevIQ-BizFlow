import { Router } from 'express';
import * as ctrl from '../../controllers/company/paymentController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import {
  paymentCreateSchema,
  paymentUpdateSchema,
  paymentReceiveSchema,
  paymentBounceSchema,
  paymentCancelSchema,
  paymentListQuerySchema,
  paymentFormOptionsQuerySchema,
} from '../../validators/paymentValidators.js';

/**
 * Phase 6 - Payments & Collections API.
 * Static routes are declared before `/:id`.
 */
const router = Router();

router.get('/', authorize('payments.view'), validate({ query: paymentListQuerySchema }), ctrl.list);
router.get('/stats', authorize('payments.view'), ctrl.stats);
router.get(
  '/form-options',
  authorize('payments.view'),
  validate({ query: paymentFormOptionsQuerySchema }),
  ctrl.formOptions
);
router.get(
  '/export',
  authorize('payments.export'),
  validate({ query: paymentListQuerySchema }),
  ctrl.exportXlsx
);

router.post('/', authorize('payments.create'), validate({ body: paymentCreateSchema }), ctrl.create);

router.get('/:id/pdf', validate({ params: idParamsSchema }), authorize('payments.view'), ctrl.pdf);

router.post(
  '/:id/receive',
  validate({ params: idParamsSchema, body: paymentReceiveSchema }),
  authorize('payments.update'),
  ctrl.receive
);
router.post(
  '/:id/bounce',
  validate({ params: idParamsSchema, body: paymentBounceSchema }),
  authorize('payments.cancel'),
  ctrl.bounce
);
router.post(
  '/:id/cancel',
  validate({ params: idParamsSchema, body: paymentCancelSchema }),
  authorize('payments.cancel'),
  ctrl.cancel
);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('payments.view'), ctrl.get)
  .patch(authorize('payments.update'), validate({ body: paymentUpdateSchema }), ctrl.update)
  .put(authorize('payments.update'), validate({ body: paymentUpdateSchema }), ctrl.update)
  .delete(authorize('payments.delete'), ctrl.remove);

export default router;
