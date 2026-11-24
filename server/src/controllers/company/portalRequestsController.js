import mongoose from 'mongoose';
import PaymentClaim from '../../models/PaymentClaim.js';
import ReturnRequest from '../../models/ReturnRequest.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { ConflictError, NotFoundError } from '../../utils/errors.js';
import { notifyCustomer } from '../../services/customerMessaging.js';

/**
 * Staff side of what customers send from the portal:
 *   payment claims ("I have paid")   -> record as a payment receipt, or reject
 *   returns / complaints              -> accept, reject or close as resolved
 */

const pageOf = (q) => Math.max(1, Number(q.page) || 1);
const limitOf = (q) => Math.min(100, Math.max(1, Number(q.limit) || 20));

const listOf = async (Model, req, extraFilter = {}) => {
  const page = pageOf(req.query);
  const limit = limitOf(req.query);
  const filter = { ...extraFilter };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.customer && mongoose.isValidObjectId(req.query.customer)) filter.customer = req.query.customer;
  const [rows, total, open] = await Promise.all([
    Model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('customer', 'name code phone').lean(),
    Model.countDocuments(filter),
    Model.countDocuments({ status: Model === PaymentClaim ? 'SUBMITTED' : 'OPEN' }),
  ]);
  return {
    data: rows.map((r) => ({ ...r, id: String(r._id), customer: r.customer ? { id: String(r.customer._id), name: r.customer.name, code: r.customer.code, phone: r.customer.phone } : null })),
    meta: { page, limit, total, pages: Math.ceil(total / limit), open },
  };
};

// ---------------------------------------------------------------------------
// Payment claims
// ---------------------------------------------------------------------------

/** GET /payment-claims?status&customer&page */
export const listClaims = asyncHandler(async (req, res) => {
  const { data, meta } = await listOf(PaymentClaim, req);
  return success(res, { data, meta });
});

/** POST /payment-claims/:id/reject { reason } */
export const rejectClaim = asyncHandler(async (req, res) => {
  const claim = await PaymentClaim.findById(req.params.id);
  if (!claim) throw new NotFoundError('Payment claim not found');
  if (claim.status !== 'SUBMITTED') throw new ConflictError('This claim was already answered', 'CLAIM_CLOSED');
  claim.status = 'REJECTED';
  claim.rejectReason = req.body.reason;
  claim.reviewedBy = req.user.id;
  claim.reviewedAt = new Date();
  await claim.save();
  await notifyCustomer(claim.customer, {
    type: 'PAYMENT',
    title: `We could not find your payment of ${claim.amount.toFixed(2)}`,
    body: req.body.reason,
    link: 'payments',
  });
  audit(req, {
    action: AUDIT_ACTIONS.REJECT,
    entityType: 'PaymentClaim',
    entityId: claim._id,
    entityLabel: claim.customerName,
    description: `Payment claim of ${claim.amount} from ${claim.customerName} rejected: ${req.body.reason}`,
  });
  return success(res, { message: 'Claim rejected', data: { id: String(claim._id), status: claim.status } });
});

/**
 * Called by the payment receipt "create" when it was made from a claim:
 * the claim becomes VERIFIED and points at the receipt; the customer is told.
 */
export const closeClaimWithPayment = async (req, claimId, payment) => {
  const claim = await PaymentClaim.findById(claimId);
  if (!claim) throw new NotFoundError('Payment claim not found');
  if (claim.status !== 'SUBMITTED') throw new ConflictError('This claim was already answered', 'CLAIM_CLOSED');
  if (String(claim.customer) !== String(payment.customerId)) {
    throw new ConflictError('The receipt must be for the same customer as the claim', 'CLAIM_CUSTOMER');
  }
  claim.status = 'VERIFIED';
  claim.payment = payment._id;
  claim.reviewedBy = req.user.id;
  claim.reviewedAt = new Date();
  await claim.save();
  await notifyCustomer(claim.customer, {
    type: 'PAYMENT',
    title: `Payment of ${Number(payment.amount).toFixed(2)} received`,
    body: `Receipt ${payment.paymentNo}. Thank you.`,
    link: 'payments',
  });
  return claim;
};

/** Check a claim can still be recorded before the receipt is saved. */
export const assertClaimOpen = async (claimId, customerId) => {
  const claim = await PaymentClaim.findById(claimId).lean();
  if (!claim) throw new NotFoundError('Payment claim not found');
  if (claim.status !== 'SUBMITTED') throw new ConflictError('This claim was already answered', 'CLAIM_CLOSED');
  if (String(claim.customer) !== String(customerId)) {
    throw new ConflictError('The receipt must be for the same customer as the claim', 'CLAIM_CUSTOMER');
  }
  return claim;
};

// ---------------------------------------------------------------------------
// Returns & complaints
// ---------------------------------------------------------------------------

/** GET /returns?status&customer&page */
export const listReturns = asyncHandler(async (req, res) => {
  const { data, meta } = await listOf(ReturnRequest, req);
  return success(res, { data, meta });
});

const NEXT = {
  OPEN: ['ACCEPTED', 'REJECTED', 'RESOLVED'],
  ACCEPTED: ['RESOLVED', 'REJECTED'],
  REJECTED: [],
  RESOLVED: [],
};
const WORDS = {
  ACCEPTED: 'accepted',
  REJECTED: 'not accepted',
  RESOLVED: 'resolved',
};

/** POST /returns/:id/decide { status, note } */
export const decideReturn = asyncHandler(async (req, res) => {
  const request = await ReturnRequest.findById(req.params.id);
  if (!request) throw new NotFoundError('Request not found');
  const { status, note } = req.body;
  if (!(NEXT[request.status] || []).includes(status)) {
    throw new ConflictError(`A ${request.status.toLowerCase()} request cannot be marked ${status.toLowerCase()}`, 'INVALID_STATUS_TRANSITION');
  }
  request.status = status;
  if (note) request.staffNote = note;
  request.history.push({ status, at: new Date(), byName: req.user.name, note: note || '' });
  await request.save();

  await notifyCustomer(request.customer, {
    type: 'RETURN',
    title: `${request.kind === 'RETURN' ? 'Return' : 'Complaint'} ${request.requestNo} ${WORDS[status]}`,
    body: note || '',
    link: 'returns',
  });
  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'ReturnRequest',
    entityId: request._id,
    entityLabel: request.requestNo,
    description: `${request.requestNo} (${request.customerName}) ${WORDS[status]}${note ? `: ${note}` : ''}`,
  });
  return success(res, { message: `Request ${WORDS[status]}`, data: { ...request.toObject(), id: String(request._id) } });
});

export default { listClaims, rejectClaim, listReturns, decideReturn };
