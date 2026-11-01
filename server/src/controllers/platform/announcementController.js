import Announcement from '../../models/Announcement.js';
import Company from '../../models/Company.js';
import PlatformAuditLog from '../../models/PlatformAuditLog.js';
import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { NotFoundError } from '../../utils/errors.js';
import { applySearch, applyFilters, applyDateRange, parseSort } from '../../utils/query.js';
import { withoutTenant } from '../../middlewares/tenant.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import dayjs from 'dayjs';

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
    ...entry,
  }).catch(() => {});

const serialize = (a) => ({
  id: String(a._id),
  title: a.title,
  body: a.body || '',
  type: a.type,
  broadcast: Boolean(a.broadcast),
  targetCompanies: (a.targetCompanies || []).map((c) => String(c)),
  targetCount: (a.targetCompanies || []).length,
  active: Boolean(a.active),
  startsAt: a.startsAt,
  endsAt: a.endsAt,
  ctaLabel: a.ctaLabel || '',
  ctaLink: a.ctaLink || '',
  acknowledgedCount: (a.acknowledgedBy || []).length,
  /** Currently visible to companies (active + within its window)? */
  isLive: liveNow(a),
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

/** Is this announcement currently visible? (mirrors Announcement.visibleTo) */
const liveNow = (a) => {
  const now = Date.now();
  const started = !a.startsAt || new Date(a.startsAt).getTime() <= now;
  const ended = a.endsAt && new Date(a.endsAt).getTime() < now;
  return Boolean(a.active) && started && !ended;
};

// ---------------------------------------------------------------------------
// GET /api/platform/announcements
// ---------------------------------------------------------------------------
export const list = asyncHandler(async (req, res) => {
  const filter = { isDeleted: { $ne: true } };
  applySearch(filter, req.query.search, ['title', 'body']);
  applyFilters(filter, req.query, { active: { type: 'bool' }, type: { type: 'exact' } });
  if (req.query.dateFrom || req.query.dateTo) applyDateRange(filter, req.query, 'createdAt');

  const sort = parseSort(req.query, ['createdAt', 'startsAt', 'title'], '-createdAt');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 20);

  const [rows, total, totalCompanies] = await Promise.all([
    Announcement.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Announcement.countDocuments(filter),
    withoutTenant(() => Company.countDocuments({ isDeleted: { $ne: true } })),
  ]);

  return paginated(res, {
    data: rows.map((a) => serialize({ ...a, targetCompanies: a.broadcast ? [] : a.targetCompanies })),
    page,
    limit,
    total,
    extra: { totalCompanies },
  });
});

// ---------------------------------------------------------------------------
// POST /api/platform/announcements
// ---------------------------------------------------------------------------
export const create = asyncHandler(async (req, res) => {
  const body = { ...req.body };

  // Validate that explicitly targeted companies actually exist.
  if (!body.broadcast && Array.isArray(body.targetCompanies) && body.targetCompanies.length) {
    const found = await withoutTenant(() =>
      Company.countDocuments({ _id: { $in: body.targetCompanies }, isDeleted: { $ne: true } })
    );
    if (found !== body.targetCompanies.length) {
      throw new NotFoundError('One or more target companies no longer exist', 'NOT_FOUND');
    }
  } else if (!body.broadcast) {
    body.targetCompanies = [];
  }

  if (body.startsAt) body.startsAt = new Date(body.startsAt);
  if (body.endsAt) {
    body.endsAt = new Date(body.endsAt);
    if (body.startsAt && body.endsAt <= body.startsAt) {
      body.endsAt = null;
    }
  } else {
    body.endsAt = null;
  }

  const announcement = await Announcement.create({ ...body, createdBy: req.user.id });

  record(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'Announcement',
    entityId: announcement._id,
    entityLabel: announcement.title,
    description: `Published announcement "${announcement.title}" ${
      announcement.broadcast ? 'to all companies' : `to ${announcement.targetCompanies.length} compan${announcement.targetCompanies.length === 1 ? 'y' : 'ies'}`
    }`,
    after: { type: announcement.type, active: announcement.active, broadcast: announcement.broadcast },
  });

  return created(res, { message: 'Announcement published', data: { announcement: serialize(announcement) } });
});

// ---------------------------------------------------------------------------
// PATCH /api/platform/announcements/:id
// ---------------------------------------------------------------------------
export const update = asyncHandler(async (req, res) => {
  const before = await Announcement.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
  if (!before) throw new NotFoundError('Announcement not found', 'NOT_FOUND');

  const payload = { ...req.body };
  if (payload.startsAt) payload.startsAt = new Date(payload.startsAt);
  if (payload.endsAt) payload.endsAt = new Date(payload.endsAt);
  if (payload.broadcast) payload.targetCompanies = [];

  const announcement = await Announcement.findOneAndUpdate(
    { _id: before._id },
    { $set: payload },
    { new: true, runValidators: true }
  ).lean();

  record(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Announcement',
    entityId: announcement._id,
    entityLabel: announcement.title,
    description: `Updated announcement "${announcement.title}"`,
    before: { active: before.active, endsAt: before.endsAt },
    after: { active: announcement.active, endsAt: announcement.endsAt },
  });

  return success(res, { message: 'Announcement updated', data: { announcement: serialize(announcement) } });
});

// ---------------------------------------------------------------------------
// DELETE /api/platform/announcements/:id  (soft)
// ---------------------------------------------------------------------------
export const remove = asyncHandler(async (req, res) => {
  const before = await Announcement.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
  if (!before) throw new NotFoundError('Announcement not found', 'NOT_FOUND');

  await Announcement.updateOne(
    { _id: before._id },
    { $set: { isDeleted: true, active: false, endsAt: dayjs().toDate() } }
  );

  record(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'Announcement',
    entityId: before._id,
    entityLabel: before.title,
    severity: 'WARN',
    description: `Retired announcement "${before.title}"`,
    before: { active: before.active },
    after: { isDeleted: true },
  });

  return success(res, { message: 'Announcement retired', data: { id: String(before._id) } });
});

export default { list, create, update, remove };
