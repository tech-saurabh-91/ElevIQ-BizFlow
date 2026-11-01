import { Router } from 'express';
import * as ctrl from '../../controllers/company/settingsController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { settingsUpdateSchema, rolePermissionsSchema } from '../../validators/companyValidators.js';

const router = Router();

router.get('/', authorize('settings.view'), ctrl.get);

router.patch('/', authorize('settings.update'), validate({ body: settingsUpdateSchema }), ctrl.update);
router.put('/', authorize('settings.update'), validate({ body: settingsUpdateSchema }), ctrl.update);

router.put(
  '/permissions',
  authorize('settings.update'),
  validate({ body: rolePermissionsSchema }),
  ctrl.updatePermissions
);

router.post('/permissions/reset', authorize('settings.update'), ctrl.resetPermissions);

export default router;
