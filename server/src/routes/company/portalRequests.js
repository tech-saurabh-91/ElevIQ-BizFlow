import { Router } from 'express';
import * as ctrl from '../../controllers/company/portalRequestsController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { ForbiddenError } from '../../utils/errors.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import { claimRejectSchema, returnDecisionSchema } from '../../validators/portalValidators.js';

/**
 * What customers send from the portal, for staff to answer:
 *   /payment-claims   "I have paid" (record it from Payments → New, or reject)
 *   /returns          returns and complaints
 * Only when the plan includes the customer portal.
 */
const portalModule = (req, _res, next) =>
  req.company?.featureFlags?.customerPortal === true
    ? next()
    : next(new ForbiddenError('The customer portal is not part of your plan.', 'MODULE_DISABLED'));

export const paymentClaimRoutes = Router();
paymentClaimRoutes.use(portalModule);
paymentClaimRoutes.get('/', authorize('payments.claims'), ctrl.listClaims);
paymentClaimRoutes.post(
  '/:id/reject',
  authorize('payments.claims'),
  validate({ params: idParamsSchema, body: claimRejectSchema }),
  ctrl.rejectClaim
);

export const returnRequestRoutes = Router();
returnRequestRoutes.use(portalModule);
returnRequestRoutes.get('/', authorize('returns.manage'), ctrl.listReturns);
returnRequestRoutes.post(
  '/:id/decide',
  authorize('returns.manage'),
  validate({ params: idParamsSchema, body: returnDecisionSchema }),
  ctrl.decideReturn
);
