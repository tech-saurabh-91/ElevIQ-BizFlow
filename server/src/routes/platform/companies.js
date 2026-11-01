import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../../controllers/platform/companyController.js';
import { validate, paginationSchema } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import {
  companyListQuerySchema,
  createCompanySchema,
  updateCompanySchema,
  companyStatusSchema,
  assignSubscriptionSchema,
  companyParamsSchema,
  auditLogQuerySchema,
  impersonateSchema,
} from '../../validators/platformValidators.js';

/**
 * /api/platform/companies
 * Mounted under the platform-scope guard (see routes/platform/index.js).
 * `authorize()` keeps PLATFORM_SUPPORT read-only: every mutating route below
 * is a POST/PATCH/DELETE, which the RBAC layer rejects for that role.
 */
const router = Router();
router.use(authorize());

/** Re-validate :id on every nested route so bad ids 422 instead of 500. */
router.param('id', (req, _res, next, value) => {
  const parsed = companyParamsSchema.safeParse({ id: value });
  if (!parsed.success) {
    const err = new Error('Validation failed');
    err.status = 422;
    err.code = 'VALIDATION_ERROR';
    err.errors = parsed.error.issues.map((i) => ({ field: `params.${i.path.join('.')}`, message: i.message }));
    return next(err);
  }
  req.params.id = parsed.data.id;
  return next();
});

const userQuerySchema = paginationSchema.extend({
  role: z.string().trim().max(40).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

// ---- collection ------------------------------------------------------------
router.get('/', validate({ query: companyListQuerySchema }), ctrl.list);
router.post('/', validate({ body: createCompanySchema }), ctrl.create);

// ---- item ------------------------------------------------------------------
router.get('/:id', ctrl.detail);
router.patch('/:id', validate({ body: updateCompanySchema }), ctrl.update);
router.patch('/:id/status', validate({ body: companyStatusSchema }), ctrl.changeStatus);
router.delete('/:id', ctrl.remove);

// ---- nested ----------------------------------------------------------------
router.get('/:id/health', ctrl.health);
router.get('/:id/users', validate({ query: userQuerySchema }), ctrl.listUsers);
router.get('/:id/audit-logs', validate({ query: auditLogQuerySchema }), ctrl.companyAuditLogs);
router.post(
  '/:id/subscription',
  validate({ body: assignSubscriptionSchema }),
  ctrl.assignSubscription
);
router.post('/:id/impersonate', validate({ body: impersonateSchema }), ctrl.impersonate);

export default router;
