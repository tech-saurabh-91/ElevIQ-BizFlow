import { Router } from 'express';
import * as ctrl from '../../controllers/company/routeController.js';
import { validate, z, objectIdSchema } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import {
  idParamsSchema,
  routeCreateSchema,
  routeUpdateSchema,
  routeListQuerySchema,
} from '../../validators/companyValidators.js';

const router = Router();

router.get('/', authorize('customers.view'), validate({ query: routeListQuerySchema }), ctrl.list);

router.post('/', authorize('customers.create'), validate({ body: routeCreateSchema }), ctrl.create);

const routeCustomersSchema = z.object({ customerIds: z.array(objectIdSchema).max(2000) });

router.get('/:id/customers', validate({ params: idParamsSchema }), authorize('customers.view'), ctrl.customers);
router.put(
  '/:id/customers',
  validate({ params: idParamsSchema, body: routeCustomersSchema }),
  authorize('customers.update'),
  ctrl.setCustomers
);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('customers.view'), ctrl.get)
  .patch(authorize('customers.update'), validate({ body: routeUpdateSchema }), ctrl.update)
  .put(authorize('customers.update'), validate({ body: routeUpdateSchema }), ctrl.update)
  .delete(authorize('customers.delete'), ctrl.remove);

export default router;
