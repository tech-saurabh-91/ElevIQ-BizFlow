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
  vanAssignmentCreateSchema,
  vanAssignmentCloseSchema,
  vanAssignmentListQuerySchema,
  warehouseAssignmentParamsSchema,
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

// --- Van assignments (Phase A) ---------------------------------------------
// History is readable by anyone who can see inventory; changing who drives
// a van is a manage action.
router.get(
  '/:id/assignments',
  authorize('inventory.view'),
  validate({ params: idParamsSchema, query: vanAssignmentListQuerySchema }),
  ctrl.listAssignments
);

router.post(
  '/:id/assignments',
  authorize('inventory.manage'),
  validate({ params: idParamsSchema, body: vanAssignmentCreateSchema }),
  ctrl.assign
);

router.post(
  '/:id/assignments/:assignmentId/close',
  authorize('inventory.manage'),
  validate({ params: warehouseAssignmentParamsSchema, body: vanAssignmentCloseSchema }),
  ctrl.closeAssignment
);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('inventory.view'), ctrl.get)
  .patch(authorize('inventory.manage'), validate({ body: warehouseUpdateSchema }), ctrl.update)
  .put(authorize('inventory.manage'), validate({ body: warehouseUpdateSchema }), ctrl.update)
  .delete(authorize('inventory.manage'), ctrl.remove);

export default router;
