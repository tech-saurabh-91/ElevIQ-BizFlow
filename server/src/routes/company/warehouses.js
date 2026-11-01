import { Router } from 'express';
import * as ctrl from '../../controllers/company/warehouseController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  idParamsSchema,
  warehouseCreateSchema,
  warehouseUpdateSchema,
  warehouseListQuerySchema,
} from '../../validators/companyValidators.js';

const router = Router();

router.get('/', authorize('inventory.view'), validate({ query: warehouseListQuerySchema }), ctrl.list);

router.post('/', authorize('inventory.manage'), validate({ body: warehouseCreateSchema }), ctrl.create);

router.post(
  '/:id/set-default',
  authorize('inventory.manage'),
  validate({ params: idParamsSchema }),
  asyncHandler(ctrl.setDefault)
);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('inventory.view'), ctrl.get)
  .patch(authorize('inventory.manage'), validate({ body: warehouseUpdateSchema }), ctrl.update)
  .put(authorize('inventory.manage'), validate({ body: warehouseUpdateSchema }), ctrl.update)
  .delete(authorize('inventory.manage'), ctrl.remove);

export default router;
