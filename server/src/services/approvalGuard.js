import { AppError } from '../utils/errors.js';
import { COMPANY_ROLES } from '../config/constants.js';
import { limitsFor } from '../middlewares/rbac.js';

/**
 * Checks before someone approves an order, expense, stock request or day
 * cashout (company admins are exempt: the owner is often the only approver).
 *
 * - Maker-checker (Company settings -> Approvals): nobody approves what they
 *   raised themselves.
 * - Approval limit (Users -> Access): a user may approve only up to their
 *   amount.
 */
export const assertCanApprove = (req, { raisedBy = [], amount = null, label = 'this document' } = {}) => {
  if (req.user?.role === COMPANY_ROLES.COMPANY_ADMIN) return;
  const me = String(req.user?.id || '');
  const makerChecker = Boolean(req.settings?.approvals?.makerChecker);
  if (makerChecker && raisedBy.filter(Boolean).some((id) => String(id?._id || id) === me)) {
    throw new AppError(`You raised ${label}, so someone else must approve it (maker-checker).`, { status: 403, code: 'MAKER_CHECKER' });
  }
  const limit = limitsFor(req.user).maxApproveAmount;
  if (limit !== null && amount !== null && Number(amount) > limit + 0.001) {
    throw new AppError(`You can approve up to ${limit}; ${label} is ${Number(amount)}. Ask someone with a higher limit.`, {
      status: 403,
      code: 'APPROVAL_LIMIT',
    });
  }
};

export default { assertCanApprove };
