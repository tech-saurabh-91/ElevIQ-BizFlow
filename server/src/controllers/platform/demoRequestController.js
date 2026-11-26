import DemoRequest, { DEMO_REQUEST_STATUSES } from '../../models/DemoRequest.js';
import Company from '../../models/Company.js';
import PlatformAuditLog from '../../models/PlatformAuditLog.js';
import { success, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { NotFoundError } from '../../utils/errors.js';
import { applySearch } from '../../utils/query.js';
import { withoutTenant } from '../../middlewares/tenant.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';

/**
 * /api/platform/demo-requests - "Book a demo" leads from the public home page.
 */

const STATUS_LABEL = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  DEMO_SCHEDULED: 'Demo scheduled',
  DEMO_DONE: 'Demo done',
  WON: 'Won',
  LOST: 'Lost',
};

const record = (req, entry) =>
  PlatformAuditLog.create({
    actor: {
      userId: req.user?.id || null,
      name: req.user?.name || 'system',
      email: req.user?.email || '',
      role: req.user?.role || 'SYSTEM',
    },
    channel: 'WEB',
    severity: 'INFO',
    occurredAt: new Date(),
    entityType: 'DemoRequest',
    ...entry,
  }).catch(() => {});

const serialize = (d) => ({
  id: String(d._id),
  name: d.name,
  business: d.business,
  mobile: d.mobile,
  city: d.city,
  email: d.email || '',
  businessType: d.businessType || '',
  teamSize: d.teamSize || '',
  message: d.message || '',
  source: d.source,
  status: d.status,
  followUpAt: d.followUpAt,
  repeatCount: d.repeatCount || 0,
  lastSubmittedAt: d.lastSubmittedAt || d.createdAt,
  notes: (d.notes || [])
    .map((n) => ({ id: String(n._id), text: n.text, byName: n.byName, at: n.at }))
    .sort((a, b) => new Date(b.at) - new Date(a.at)),
  convertedCompany: d.convertedCompany
    ? typeof d.convertedCompany === 'object' && d.convertedCompany.businessName
      ? { id: String(d.convertedCompany._id), name: d.convertedCompany.businessName, code: d.convertedCompany.code }
      : { id: String(d.convertedCompany) }
    : null,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

const load = async (id) => {
  const doc = await DemoRequest.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!doc) throw new NotFoundError('Demo request not found', 'NOT_FOUND');
  return doc;
};

const withCompany = (doc) =>
  withoutTenant(() => doc.populate({ path: 'convertedCompany', select: 'businessName code' }));

/** Count of NEW requests - shown on the dashboard and in the sidebar. */
export const countNew = () => DemoRequest.countDocuments({ status: 'NEW', isDeleted: { $ne: true } });

// GET /api/platform/demo-requests/new-count  (sidebar badge)
export const newCount = asyncHandler(async (_req, res) => success(res, { data: { count: await countNew() } }));

// GET /api/platform/demo-requests
export const list = asyncHandler(async (req, res) => {
  const filter = { isDeleted: { $ne: true } };
  applySearch(filter, req.query.search, ['name', 'business', 'mobile', 'city', 'email']);
  if (req.query.status === 'OPEN') filter.status = { $nin: ['WON', 'LOST'] };
  else if (req.query.status) filter.status = req.query.status;
  if (req.query.followUp === 'due') {
    filter.followUpAt = { $ne: null, $lte: new Date() };
    filter.status = { $nin: ['WON', 'LOST'] };
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 20);

  const [rows, total, counts] = await Promise.all([
    DemoRequest.find(filter)
      .sort({ lastSubmittedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    DemoRequest.countDocuments(filter),
    DemoRequest.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const byStatus = Object.fromEntries(DEMO_REQUEST_STATUSES.map((s) => [s, 0]));
  counts.forEach((c) => {
    byStatus[c._id] = c.count;
  });
  const followUpDue = await DemoRequest.countDocuments({
    isDeleted: { $ne: true },
    status: { $nin: ['WON', 'LOST'] },
    followUpAt: { $ne: null, $lte: new Date() },
  });

  return paginated(res, {
    data: rows.map(serialize),
    page,
    limit,
    total,
    extra: { counts: { ...byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0), followUpDue } },
  });
});

// GET /api/platform/demo-requests/:id
export const get = asyncHandler(async (req, res) => {
  const doc = await withCompany(await load(req.params.id));
  return success(res, { data: serialize(doc) });
});

// PATCH /api/platform/demo-requests/:id  { status?, followUpAt?, convertedCompany? }
export const update = asyncHandler(async (req, res) => {
  const doc = await load(req.params.id);
  const before = { status: doc.status, followUpAt: doc.followUpAt };
  const { status, followUpAt, convertedCompany } = req.body;

  if (status !== undefined) doc.status = status;
  if (followUpAt !== undefined) doc.followUpAt = followUpAt ? new Date(followUpAt) : null;
  if (convertedCompany !== undefined) {
    if (convertedCompany) {
      const exists = await withoutTenant(() => Company.exists({ _id: convertedCompany, isDeleted: { $ne: true } }));
      if (!exists) throw new NotFoundError('Company not found', 'NOT_FOUND');
      doc.convertedCompany = convertedCompany;
      doc.status = 'WON';
    } else {
      doc.convertedCompany = null;
    }
  }
  await doc.save();

  if (doc.status !== before.status) {
    record(req, {
      action: AUDIT_ACTIONS.STATUS_CHANGE,
      entityId: doc._id,
      entityLabel: doc.business,
      description: `Demo request "${doc.business}" moved from ${STATUS_LABEL[before.status]} to ${STATUS_LABEL[doc.status]}`,
      before,
      after: { status: doc.status },
    });
  }

  return success(res, { message: 'Demo request updated', data: serialize(await withCompany(doc)) });
});

// POST /api/platform/demo-requests/:id/notes  { text }
export const addNote = asyncHandler(async (req, res) => {
  const doc = await load(req.params.id);
  doc.notes.push({ text: req.body.text, by: req.user.id, byName: req.user.name || '', at: new Date() });
  // Writing a note about a brand-new lead means someone has picked it up.
  if (doc.status === 'NEW' && req.body.markContacted) doc.status = 'CONTACTED';
  await doc.save();
  return success(res, { message: 'Note added', data: serialize(await withCompany(doc)) });
});

// DELETE /api/platform/demo-requests/:id  (soft delete, e.g. spam)
export const remove = asyncHandler(async (req, res) => {
  const doc = await load(req.params.id);
  doc.isDeleted = true;
  await doc.save();
  record(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityId: doc._id,
    entityLabel: doc.business,
    description: `Deleted demo request from "${doc.business}"`,
  });
  return success(res, { message: 'Demo request deleted', data: { id: String(doc._id) } });
});

export default { list, get, update, addNote, remove, countNew, newCount };
