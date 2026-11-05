import StockRequest, { STOCK_REQUEST_STATUS as S } from '../../models/StockRequest.js';
import StockTransfer from '../../models/StockTransfer.js';
import Product from '../../models/Product.js';
import Setting from '../../models/Setting.js';
import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { listDocuments } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, COMPANY_ROLES, DEFAULT_PERMISSIONS, salesTypeAllows } from '../../config/constants.js';
import { nextSeries } from '../../utils/numberSeries.js';
import { toPlain } from './_helpers.js';
import { activeVanOf, assertDayClosed, issueToVan, loadVan, receiveOnVan } from '../../services/vanService.js';
import { notifyUsers, notifyPermission } from '../../services/notifyService.js';

/**
 * Van stock requests: the executive asks, a manager adjusts and approves
 * (stock is issued from the godown), the executive confirms receipt.
 */

const can = (req, permission) => {
  if (req.user?.role === COMPANY_ROLES.COMPANY_ADMIN) return true;
  const matrix = req.settings?.rolePermissions?.[permission] || DEFAULT_PERMISSIONS[permission] || [];
  return matrix.includes(req.user?.role);
};
const isApprover = (req) => can(req, 'inventory.manage');

const history = (doc, status, req, note = '') =>
  doc.statusHistory.push({ status, at: new Date(), by: req.user.id, byName: req.user.name, note });

/** Validate lines and attach product names; quantities are base units. */
const buildLines = async (items = []) => {
  const rows = items.filter((i) => i.product && Number(i.qty) > 0);
  if (!rows.length) throw new BadRequestError('Add at least one product with a quantity', 'VALIDATION_ERROR');
  const products = await Product.find({ _id: { $in: rows.map((r) => r.product) } }).select('name sku unit isActive').lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const seen = new Set();
  return rows.map((r, i) => {
    const p = byId.get(String(r.product));
    if (!p) throw new BadRequestError(`Product not found on line ${i + 1}`, 'INVALID_REFERENCE');
    if (seen.has(String(p._id))) throw new BadRequestError(`${p.name} is listed twice`, 'VALIDATION_ERROR');
    seen.add(String(p._id));
    return { product: p._id, name: p.name, sku: p.sku || '', unit: p.unit || 'PCS', qty: Number(r.qty) };
  });
};

const loadRequest = async (req) => {
  const doc = await StockRequest.findOne({ _id: req.params.id });
  if (!doc) throw new NotFoundError('Stock request not found');
  if (!isApprover(req) && String(doc.executive) !== String(req.user.id)) throw new NotFoundError('Stock request not found');
  return doc;
};

const respond = async (res, doc, message, status = 200) => {
  const full = await StockRequest.findOne({ _id: doc._id }).populate('van', 'name code vehicleNumber').lean();
  const fn = status === 201 ? created : success;
  return fn(res, { message, data: toPlain(full) });
};

/** GET /stock-requests - executives see their own; managers see all. */
export const list = asyncHandler(async (req, res) => {
  const filter = isApprover(req) ? {} : { executive: req.user.id };
  const result = await listDocuments(StockRequest, {
    filter,
    query: req.query,
    searchFields: ['requestNo', 'executiveName', 'vanCode'],
    filtersSpec: { status: { type: 'string' }, van: { type: 'objectId' } },
    sortAllowed: ['createdAt', 'requestNo'],
    defaultSort: '-createdAt',
    populate: [{ path: 'van', select: 'name code vehicleNumber' }],
  });
  return paginated(res, { data: result.data.map(toPlain), ...result.meta, extra: { canApprove: isApprover(req) } });
});

export const get = asyncHandler(async (req, res) => respond(res, await loadRequest(req), 'OK'));

/** POST /stock-requests - the executive asks for stock for their van. */
export const create = asyncHandler(async (req, res) => {
  if (req.user.role === 'SALESMAN' && !salesTypeAllows(req.user.salesType || 'BOTH', 'VAN_SALE')) {
    throw new ForbiddenError('Stock requests are for van sales users', 'FORBIDDEN');
  }
  const driving = await activeVanOf(req.user.id);
  if (!driving) throw new BadRequestError('No van is assigned to you', 'NO_VAN');
  await assertDayClosed(req.user.id, req.company);
  if (await StockRequest.exists({ van: driving.van._id, status: S.SUBMITTED })) {
    throw new ConflictError('This van already has a request waiting for approval', 'REQUEST_PENDING');
  }
  const lines = await buildLines(req.body.items);
  const doc = new StockRequest({
    van: driving.van._id,
    vanCode: driving.van.code,
    fromWarehouse: driving.van.parent || null,
    executive: req.user.id,
    executiveName: req.user.name,
    neededOn: req.body.neededOn ? new Date(req.body.neededOn) : new Date(),
    notes: req.body.notes || '',
    items: lines.map((l) => ({ ...l, requestedQty: l.qty, approvedQty: l.qty })),
  });
  history(doc, S.SUBMITTED, req, 'Requested');
  doc.requestNo = await nextSeries(req.companyId, 'STOCK_REQUEST', { prefix: 'SR', pad: 5 });
  await doc.save();
  audit(req, { action: AUDIT_ACTIONS.CREATE, entityType: 'StockRequest', entityId: doc._id, entityLabel: doc.requestNo, description: `Stock request ${doc.requestNo} for van ${doc.vanCode}` });
  await notifyPermission(req.companyId, 'inventory.manage', {
    type: 'STOCK_REQUEST',
    title: `Stock request ${doc.requestNo} from ${doc.executiveName}`,
    body: `Van ${doc.vanCode} · ${doc.items.length} item(s) waiting for approval`,
    link: '/app/stock-requests',
    entityType: 'StockRequest',
    entityId: doc._id,
    priority: 'HIGH',
    exclude: req.user.id,
  });
  return respond(res, doc, 'Request sent for approval', 201);
});

/**
 * POST /stock-requests/:id/approve - the manager's final list (quantities
 * changed, lines added or removed). Stock leaves the godown now.
 */
export const approve = asyncHandler(async (req, res) => {
  if (!isApprover(req)) throw new ForbiddenError('You cannot approve stock requests', 'FORBIDDEN');
  const doc = await loadRequest(req);
  if (doc.status !== S.SUBMITTED) throw new ConflictError('Only a request waiting for approval can be approved', 'REQUEST_LOCKED');
  const lines = await buildLines(req.body.items);
  const requested = new Map(doc.items.map((i) => [String(i.product), i.requestedQty]));
  const van = await loadVan(doc.van);
  const settings = await Setting.forCompany(req.companyId);
  const transfer = await issueToVan({ van, lines, userId: req.user.id, settings, companyId: req.companyId, refNo: doc.requestNo });

  // Lines the manager removed stay visible with 0 approved.
  const removed = doc.items.filter((i) => !lines.some((l) => String(l.product) === String(i.product)));
  doc.items = [
    ...lines.map((l) => ({ product: l.product, name: l.name, sku: l.sku, unit: l.unit, requestedQty: requested.get(String(l.product)) || 0, approvedQty: l.qty, receivedQty: 0 })),
    ...removed.map((i) => ({ ...i.toObject(), approvedQty: 0 })),
  ];
  doc.status = S.APPROVED;
  doc.managerNotes = req.body.notes || '';
  doc.approvedBy = req.user.id;
  doc.approvedAt = new Date();
  doc.transfer = transfer._id;
  doc.transferNo = transfer.transferNo;
  history(doc, S.APPROVED, req, req.body.notes || `Issued on ${transfer.transferNo}`);
  await doc.save();
  audit(req, { action: AUDIT_ACTIONS.STATUS_CHANGE, entityType: 'StockRequest', entityId: doc._id, entityLabel: doc.requestNo, description: `Stock request ${doc.requestNo} approved and issued (${transfer.transferNo})` });
  await notifyUsers([doc.executive], {
    type: 'STOCK_REQUEST',
    title: `Stock request ${doc.requestNo} approved`,
    body: `Issued on ${transfer.transferNo} - confirm what you received`,
    link: '/app/stock-requests',
    entityType: 'StockRequest',
    entityId: doc._id,
    priority: 'HIGH',
  });
  return respond(res, doc, 'Approved - stock issued to the van');
});

export const reject = asyncHandler(async (req, res) => {
  if (!isApprover(req)) throw new ForbiddenError('You cannot reject stock requests', 'FORBIDDEN');
  const doc = await loadRequest(req);
  if (doc.status !== S.SUBMITTED) throw new ConflictError('Only a request waiting for approval can be rejected', 'REQUEST_LOCKED');
  if (!String(req.body.reason || '').trim()) throw new BadRequestError('Give a reason for rejecting', 'VALIDATION_ERROR');
  doc.status = S.REJECTED;
  doc.rejectReason = req.body.reason;
  history(doc, S.REJECTED, req, req.body.reason);
  await doc.save();
  await notifyUsers([doc.executive], {
    type: 'STOCK_REQUEST',
    title: `Stock request ${doc.requestNo} rejected`,
    body: req.body.reason,
    link: '/app/stock-requests',
    entityType: 'StockRequest',
    entityId: doc._id,
  });
  return respond(res, doc, 'Request rejected');
});

export const cancel = asyncHandler(async (req, res) => {
  const doc = await loadRequest(req);
  if (String(doc.executive) !== String(req.user.id) && !isApprover(req)) throw new ForbiddenError('Not your request', 'FORBIDDEN');
  if (doc.status !== S.SUBMITTED) throw new ConflictError('Only a request waiting for approval can be cancelled', 'REQUEST_LOCKED');
  doc.status = S.CANCELLED;
  history(doc, S.CANCELLED, req, req.body.reason || 'Cancelled');
  await doc.save();
  return respond(res, doc, 'Request cancelled');
});

/** POST /stock-requests/:id/receive - the executive confirms what reached the van. */
export const receive = asyncHandler(async (req, res) => {
  const doc = await loadRequest(req);
  if (String(doc.executive) !== String(req.user.id)) throw new ForbiddenError('Only the requesting executive can receive it', 'FORBIDDEN');
  if (doc.status !== S.APPROVED) throw new ConflictError('Only an approved request can be received', 'REQUEST_LOCKED');
  const received = new Map((req.body.items || []).map((i) => [String(i.product), Number(i.qty)]));
  const short = doc.items.filter((i) => i.approvedQty > 0 && received.has(String(i.product)) && received.get(String(i.product)) < i.approvedQty);
  if (short.length && !String(req.body.notes || '').trim()) {
    throw new BadRequestError('Explain why less was received', 'VALIDATION_ERROR');
  }
  const transfer = await StockTransfer.findOne({ _id: doc.transfer });
  if (!transfer) throw new NotFoundError('Issue transfer not found');
  const settings = await Setting.forCompany(req.companyId);
  await receiveOnVan({ transfer, received, userId: req.user.id, settings });
  const got = new Map(transfer.items.map((i) => [String(i.product), i.receivedQty]));
  doc.items.forEach((i) => {
    i.receivedQty = got.get(String(i.product)) || 0;
  });
  doc.status = S.RECEIVED;
  doc.receivedBy = req.user.id;
  doc.receivedAt = new Date();
  doc.receiveNotes = req.body.notes || '';
  history(doc, S.RECEIVED, req, req.body.notes || 'Received on van');
  await doc.save();
  audit(req, { action: AUDIT_ACTIONS.STATUS_CHANGE, entityType: 'StockRequest', entityId: doc._id, entityLabel: doc.requestNo, description: `Stock request ${doc.requestNo} received on van ${doc.vanCode}` });
  return respond(res, doc, 'Received - van stock updated');
});

export default { list, get, create, approve, reject, cancel, receive };
