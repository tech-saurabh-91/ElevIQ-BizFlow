import { Router } from 'express';
import * as ctrl from '../../controllers/company/priceListController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import {
  idParamsSchema,
  priceListCreateSchema,
  priceListUpdateSchema,
  priceListListQuerySchema,
} from '../../validators/companyValidators.js';

const router = Router();

router.get('/', authorize('products.view'), validate({ query: priceListListQuerySchema }), ctrl.list);

router.post('/', authorize('products.create'), validate({ body: priceListCreateSchema }), ctrl.create);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('products.view'), ctrl.get)
  .patch(authorize('products.update'), validate({ body: priceListUpdateSchema }), ctrl.update)
  .put(authorize('products.update'), validate({ body: priceListUpdateSchema }), ctrl.update)
  .delete(authorize('products.delete'), ctrl.remove);

export default router;
