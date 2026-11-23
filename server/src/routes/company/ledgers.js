import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../../controllers/company/ledgerController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { requireModule } from '../../middlewares/modules.js';
import { documentEmailSchema } from '../../validators/companyValidators.js';

/**
 * Statements of account. A customer's needs "customers.statement"; a
 * supplier's needs the purchase module and both bills and supplier payments.
 */
const router = Router();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const params = z.object({
  kind: z.enum(['customer', 'supplier']),
  id: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id'),
});
const period = z
  .object({
    from: day.optional(),
    to: day.optional(),
    confirm: z.enum(['true', 'false']).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'From must be on or before To',
    path: ['from'],
  });
const emailBody = documentEmailSchema.extend({
  from: day.optional(),
  periodTo: day.optional(),
  confirm: z.boolean().optional(),
});

const purchase = requireModule('purchase');
/** Access by kind of party. */
const access = (req, res, next) => {
  if (req.params.kind === 'customer') return authorize('customers.statement')(req, res, next);
  return purchase(req, res, (err) => {
    if (err) return next(err);
    return authorize('bills.view')(req, res, (err2) =>
      err2 ? next(err2) : authorize('supplierpayments.view')(req, res, next)
    );
  });
};

router.get('/:kind/:id', validate({ params, query: period }), access, ctrl.show);
router.get('/:kind/:id/pdf', validate({ params, query: period }), access, ctrl.pdf);
router.get('/:kind/:id/export', validate({ params, query: period }), access, ctrl.exportXlsx);
router.post('/:kind/:id/email', validate({ params, body: emailBody }), access, ctrl.email);

export default router;
