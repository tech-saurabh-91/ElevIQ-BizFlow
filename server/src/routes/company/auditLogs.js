import { Router } from 'express';
import * as ctrl from '../../controllers/company/auditLogController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { idParamsSchema, auditListQuerySchema } from '../../validators/companyValidators.js';

const router = Router();

router.get('/', authorize('audit.view'), validate({ query: auditListQuerySchema }), ctrl.list);

router.get('/:id', authorize('audit.view'), validate({ params: idParamsSchema }), ctrl.get);

export default router;
