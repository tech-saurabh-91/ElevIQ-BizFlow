import { Router } from 'express';
import * as ctrl from '../../controllers/company/userController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize, requireRole } from '../../middlewares/rbac.js';
import {
  idParamsSchema,
  userCreateSchema,
  userUpdateSchema,
  userListQuerySchema,
  userResetPasswordSchema,
  userAccessSchema,
  userAccessWhoSchema,
} from '../../validators/companyValidators.js';

const router = Router();

router.get('/stats', authorize('users.view'), ctrl.stats);

// Per-user access: only a company admin sees or changes it.
const adminOnly = requireRole('COMPANY_ADMIN');
router.get('/access/who', adminOnly, validate({ query: userAccessWhoSchema }), ctrl.whoCan);
router.get('/:id/access', adminOnly, validate({ params: idParamsSchema }), ctrl.getAccess);
router.put('/:id/access', adminOnly, validate({ params: idParamsSchema, body: userAccessSchema }), ctrl.saveAccess);

router.get('/', authorize('users.view'), validate({ query: userListQuerySchema }), ctrl.list);

router.post('/', authorize('users.create'), validate({ body: userCreateSchema }), ctrl.create);

router.post(
  '/:id/reset-password',
  authorize('users.update'),
  validate({ params: idParamsSchema, body: userResetPasswordSchema }),
  ctrl.resetPassword
);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('users.view'), ctrl.get)
  .patch(authorize('users.update'), validate({ body: userUpdateSchema }), ctrl.update)
  .put(authorize('users.update'), validate({ body: userUpdateSchema }), ctrl.update)
  .delete(authorize('users.delete'), ctrl.remove);

export default router;
