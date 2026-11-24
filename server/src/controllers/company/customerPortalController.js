import crypto from 'node:crypto';
import Customer from '../../models/Customer.js';
import CustomerAccount, { normalizeMobile } from '../../models/CustomerAccount.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { revokePortalSessions } from '../../services/portalAuthService.js';

/**
 * Staff side of the customer portal: give a customer a login (mobile + PIN),
 * reset its PIN, switch it off. A new or reset PIN is returned ONCE so it can
 * be handed to the customer (who must then set their own).
 */

const newPin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

const assertModule = (req) => {
  if (req.company?.featureFlags?.customerPortal !== true) {
    throw new ForbiddenError('The customer portal is not part of your plan.', 'MODULE_DISABLED');
  }
};

const loadCustomer = async (id) => {
  const customer = await Customer.findById(id).lean();
  if (!customer) throw new NotFoundError('Customer not found');
  return customer;
};

const view = (req, account, extra = {}) => ({
  hasAccount: Boolean(account),
  enabled: Boolean(account?.isActive),
  mobile: account?.mobile || '',
  mustChangePin: Boolean(account?.mustChangePin),
  locked: Boolean(account?.lockedUntil && new Date(account.lockedUntil) > new Date()),
  lastLoginAt: account?.lastLoginAt || null,
  link: `/portal/${req.company?.code || ''}`,
  portalOn: req.settings?.portal?.enabled === true,
  autoConfirmOn: req.settings?.portal?.autoConfirm === true,
  ...extra,
});

/** GET /customers/:id/portal-access */
export const show = asyncHandler(async (req, res) => {
  assertModule(req);
  const customer = await loadCustomer(req.params.id);
  const account = await CustomerAccount.findOne({ customer: customer._id }).lean();
  return success(res, {
    data: view(req, account, { suggestedMobile: normalizeMobile(customer.phone), autoConfirm: Boolean(customer.portalAutoConfirm) }),
  });
});

const assertMobileFree = async (mobile, accountId) => {
  const other = await CustomerAccount.findOne({ mobile, ...(accountId ? { _id: { $ne: accountId } } : {}) })
    .populate('customer', 'name code')
    .lean();
  if (other) {
    throw new ConflictError(
      `This mobile already signs in for ${other.customer?.name || 'another customer'}${other.customer?.code ? ` (${other.customer.code})` : ''}.`,
      'MOBILE_IN_USE'
    );
  }
};

/** PUT /customers/:id/portal-access { enabled, mobile } */
export const save = asyncHandler(async (req, res) => {
  assertModule(req);
  const customer = await loadCustomer(req.params.id);
  let account = await CustomerAccount.findOne({ customer: customer._id });
  const mobile = normalizeMobile(req.body.mobile || account?.mobile || customer.phone);
  let pin = null;
  if (typeof req.body.autoConfirm === 'boolean' && Boolean(customer.portalAutoConfirm) !== req.body.autoConfirm) {
    await Customer.updateOne({ _id: customer._id }, { $set: { portalAutoConfirm: req.body.autoConfirm } });
    customer.portalAutoConfirm = req.body.autoConfirm;
  }

  if (req.body.enabled) {
    if (customer.isActive === false) throw new BadRequestError('This customer is inactive', 'INACTIVE_CUSTOMER');
    if (mobile.length < 7) throw new BadRequestError('Enter the mobile number the customer will sign in with', 'VALIDATION_ERROR');
    await assertMobileFree(mobile, account?._id);
    if (!account) {
      pin = newPin();
      account = new CustomerAccount({ customer: customer._id, mobile, pin, isActive: true, mustChangePin: true });
    } else {
      if (account.mobile !== mobile) await revokePortalSessions(account._id, 'mobile-changed');
      account.mobile = mobile;
      account.isActive = true;
    }
    await account.save();
  } else if (account) {
    account.isActive = false;
    await account.save();
    await revokePortalSessions(account._id, 'access-off');
  }

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Customer',
    entityId: customer._id,
    entityLabel: customer.name,
    description: req.body.enabled
      ? `Online ordering on for ${customer.name} (${mobile})${pin ? ' - new login' : ''}`
      : `Online ordering off for ${customer.name}`,
  });

  return success(res, {
    message: req.body.enabled ? 'Online ordering is on for this customer' : 'Online ordering is off for this customer',
    data: view(req, account?.toObject?.() || account, { ...(pin ? { pin } : {}), autoConfirm: Boolean(customer.portalAutoConfirm) }),
  });
});

/** POST /customers/:id/portal-access/reset-pin - a new PIN, shown once; also unlocks. */
export const resetPin = asyncHandler(async (req, res) => {
  assertModule(req);
  const customer = await loadCustomer(req.params.id);
  const account = await CustomerAccount.findOne({ customer: customer._id });
  if (!account) throw new NotFoundError('This customer has no online login yet');
  const pin = newPin();
  account.pin = pin;
  account.mustChangePin = true;
  account.failedAttempts = 0;
  account.lockedUntil = null;
  await account.save();
  await revokePortalSessions(account._id, 'pin-reset');

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Customer',
    entityId: customer._id,
    entityLabel: customer.name,
    description: `Online ordering PIN reset for ${customer.name}`,
  });
  return success(res, { message: 'New PIN created', data: view(req, account.toObject(), { pin }) });
});

export default { show, save, resetPin };
