import { Router } from 'express';
import * as ctrl from '../../controllers/company/orderController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import {
  orderCreateSchema,
  orderUpdateSchema,
  orderSubmitSchema,
  orderApproveSchema,
  orderRejectSchema,
  orderCancelSchema,
  orderDispatchSchema,
  orderDeliverSchema,
  orderListQuerySchema,
  orderFormOptionsQuerySchema,
} from '../../validators/orderValidators.js';

/**
 * Phase 4 - Order Booking API.
 *
 * Static routes must be declared before `/:id` so `stats`, `export` and
 * `form-options` are never swallowed by the id route.
 */
const router = Router();

router.get('/', authorize('orders.view'), validate({ query: orderListQuerySchema }), ctrl.list);
router.get('/stats', authorize('orders.view'), ctrl.stats);
router.get(
  '/form-options',
  authorize('orders.view'),
  validate({ query: orderFormOptionsQuerySchema }),
  ctrl.formOptions
);
router.get(
  '/export',
  authorize('orders.export'),
  validate({ query: orderListQuerySchema }),
  ctrl.exportXlsx
);

router.post('/', authorize('orders.create'), validate({ body: orderCreateSchema }), ctrl.create);

router.get(
  '/:id/pdf',
  validate({ params: idParamsSchema }),
  authorize('orders.view'),
  ctrl.pdf
);

router.post(
  '/:id/submit',
  validate({ params: idParamsSchema, body: orderSubmitSchema }),
  authorize('orders.update'),
  ctrl.submit
);
router.post(
  '/:id/approve',
  validate({ params: idParamsSchema, body: orderApproveSchema }),
  authorize('orders.approve'),
  ctrl.approve
);
router.post(
  '/:id/reject',
  validate({ params: idParamsSchema, body: orderRejectSchema }),
  authorize('orders.approve'),
  ctrl.reject
);
router.post(
  '/:id/cancel',
  validate({ params: idParamsSchema, body: orderCancelSchema }),
  authorize('orders.cancel'),
  ctrl.cancel
);
router.post(
  '/:id/dispatch',
  validate({ params: idParamsSchema, body: orderDispatchSchema }),
  authorize('orders.update'),
  ctrl.dispatch
);
router.post(
  '/:id/deliver',
  validate({ params: idParamsSchema, body: orderDeliverSchema }),
  authorize('orders.update'),
  ctrl.deliver
);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('orders.view'), ctrl.get)
  .patch(authorize('orders.update'), validate({ body: orderUpdateSchema }), ctrl.update)
  .put(authorize('orders.update'), validate({ body: orderUpdateSchema }), ctrl.update)
  .delete(authorize('orders.delete'), ctrl.remove);

export default router;
