import { Router } from 'express';
import * as ctrl from '../../controllers/company/settingsController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize, requireRole } from '../../middlewares/rbac.js';
import { settingsUpdateSchema, rolePermissionsSchema } from '../../validators/companyValidators.js';

const router = Router();

router.get('/', authorize('settings.view'), ctrl.get);

router.patch('/', authorize('settings.update'), validate({ body: settingsUpdateSchema }), ctrl.update);
router.put('/', authorize('settings.update'), validate({ body: settingsUpdateSchema }), ctrl.update);

// The role matrix decides everyone's access, so only a company admin may change it.
router.put(
  '/permissions',
  requireRole('COMPANY_ADMIN'),
  authorize('settings.update'),
  validate({ body: rolePermissionsSchema }),
  ctrl.updatePermissions
);

router.post('/permissions/reset', requireRole('COMPANY_ADMIN'), authorize('settings.update'), ctrl.resetPermissions);

export default router;
