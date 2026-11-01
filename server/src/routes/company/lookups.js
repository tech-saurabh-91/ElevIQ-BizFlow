import { Router } from 'express';
import * as ctrl from '../../controllers/company/lookupController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { lookupQuerySchema } from '../../validators/companyValidators.js';

const router = Router();

// Any authenticated workspace member may read select options for forms.
router.get('/', authorize(), validate({ query: lookupQuerySchema }), ctrl.options);

export default router;
