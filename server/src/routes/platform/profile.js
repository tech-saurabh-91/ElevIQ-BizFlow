import { Router } from 'express';
import * as ctrl from '../../controllers/platform/profileController.js';
import { validate } from '../../middlewares/validate.js';
import { updatePlatformProfileSchema } from '../../validators/platformValidators.js';

/**
 * /api/platform/profile
 * The signed-in platform admin's own account (name/phone only).
 * Self-service: allowed for both roles (it is their own record, not tenant data).
 */
const router = Router();

router.get('/', ctrl.getProfile);
router.patch('/', validate({ body: updatePlatformProfileSchema }), ctrl.updateProfile);

export default router;
