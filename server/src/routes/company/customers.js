import { Router } from 'express';
import * as ctrl from '../../controllers/company/customerController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import {
  idParamsSchema,
  customerCreateSchema,
  customerUpdateSchema,
  customerListQuerySchema,
} from '../../validators/companyValidators.js';

const router = Router();

router.get('/', authorize('customers.view'), validate({ query: customerListQuerySchema }), ctrl.list);

router.post('/', authorize('customers.create'), validate({ body: customerCreateSchema }), ctrl.create);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('customers.view'), ctrl.get)
  .patch(authorize('customers.update'), validate({ body: customerUpdateSchema }), ctrl.update)
  .put(authorize('customers.update'), validate({ body: customerUpdateSchema }), ctrl.update)
  .delete(authorize('customers.delete'), ctrl.remove);

export default router;
