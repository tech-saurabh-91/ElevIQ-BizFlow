import { Router } from 'express';
import * as ctrl from '../../controllers/company/userController.js';
import { validate } from '../../middlewares/validate.js';
import { requireRole } from '../../middlewares/rbac.js';
import { idParamsSchema, accessProfileCreateSchema, accessProfileUpdateSchema } from '../../validators/companyValidators.js';

/** /api/v1/access-profiles - shared sets of access; company admins only. */
const router = Router();
router.use(requireRole('COMPANY_ADMIN'));

router.get('/', ctrl.listProfiles);
router.post('/', validate({ body: accessProfileCreateSchema }), ctrl.createProfile);
router.patch('/:id', validate({ params: idParamsSchema, body: accessProfileUpdateSchema }), ctrl.updateProfile);
router.delete('/:id', validate({ params: idParamsSchema }), ctrl.removeProfile);

export default router;
