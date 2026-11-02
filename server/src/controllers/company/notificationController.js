import Notification from '../../models/Notification.js';
import { success, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments } from '../../utils/query.js';

/**
 * Phase 8 - In-app notifications.
 *
 * A notification is visible to a user when it is a company-wide broadcast OR
 * when the user is explicitly in `recipients`. Everything is tenant-scoped by
 * the tenant plugin, so a company can never see another's inbox.
 */
const visibleTo = (userId) => ({
  $or: [{ broadcast: true }, { recipients: { $in: [userId] } }],
});

export const list = asyncHandler(async (req, res) => {
  const filter = visibleTo(req.user.id);
  if (req.query.unreadOnly) filter.isRead = false;
  if (req.query.type) filter.type = req.query.type;

  const result = await listDocuments(Notification, {
    filter,
    query: req.query,
    searchFields: ['title', 'body'],
    filtersSpec: { type: { type: 'string' } },
    sortAllowed: ['createdAt', 'priority', 'isRead'],
    defaultSort: '-createdAt',
  });

  const unread = await Notification.countDocuments({ ...visibleTo(req.user.id), isRead: false });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta, extra: { unread } });
});

export const unreadCount = asyncHandler(async (req, res) => {
  const unread = await Notification.countDocuments({ ...visibleTo(req.user.id), isRead: false });
  return success(res, { data: { unread } });
});

export const markRead = asyncHandler(async (req, res) => {
  const doc = await Notification.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!doc) return success(res, { message: 'Notification not found', data: null, status: 404 });

  // Only the addressed user (or any user, for broadcasts) may flip their own
  // read flag; the tenant plugin already proves the company matches.
  if (!doc.broadcast && !doc.recipients.some((r) => String(r) === String(req.user.id))) {
    return success(res, { message: 'Notification not found', data: null, status: 404 });
  }

  if (!doc.isRead) {
    doc.isRead = true;
    doc.readAt = new Date();
    await doc.save();
  }
  return success(res, { data: toPlain(doc) });
});

export const markAllRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { ...visibleTo(req.user.id), isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  return success(res, { data: { modified: result.modifiedCount || 0 } });
});

export const remove = asyncHandler(async (req, res) => {
  const doc = await Notification.findOne({ _id: req.params.id, companyId: req.companyId });
  if (!doc) return success(res, { message: 'Notification not found', data: null, status: 404 });
  // Notifications have no isDeleted field — clearing an inbox entry is a real
  // purge, so we opt in explicitly rather than fight the soft-delete guard.
  await Notification.deleteOne({ _id: doc._id }).hardDelete();
  return success(res, { message: 'Notification deleted' });
});

const toPlain = (doc) => ({
  id: String(doc._id),
  type: doc.type,
  title: doc.title,
  body: doc.body || '',
  link: doc.link || '',
  priority: doc.priority || 'NORMAL',
  entityType: doc.entityType || '',
  entityId: doc.entityId ? String(doc.entityId) : null,
  isRead: Boolean(doc.isRead),
  readAt: doc.readAt || null,
  broadcast: Boolean(doc.broadcast),
  createdAt: doc.createdAt,
});

export default { list, unreadCount, markRead, markAllRead, remove };
