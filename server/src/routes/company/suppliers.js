import { Router } from 'express';
import * as ctrl from '../../controllers/company/supplierController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import {
  idParamsSchema,
  supplierCreateSchema,
  supplierUpdateSchema,
  supplierListQuerySchema,
} from '../../validators/companyValidators.js';

const router = Router();

router.get('/', authorize('products.view'), validate({ query: supplierListQuerySchema }), ctrl.list);

router.post('/', authorize('products.create'), validate({ body: supplierCreateSchema }), ctrl.create);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('products.view'), ctrl.get)
  .patch(authorize('products.update'), validate({ body: supplierUpdateSchema }), ctrl.update)
  .put(authorize('products.update'), validate({ body: supplierUpdateSchema }), ctrl.update)
  .delete(authorize('products.delete'), ctrl.remove);

export default router;
