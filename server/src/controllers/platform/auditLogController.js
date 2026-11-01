import PlatformAuditLog from '../../models/PlatformAuditLog.js';
import { success, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { applySearch, applyFilters, applyDateRange, parseSort } from '../../utils/query.js';

/**
 * GET /api/platform/audit-logs
 * Platform-wide trail of everything the service provider did
 * (company created, status changed, impersonation, plan edits, logins...).
 */
export const list = asyncHandler(async (req, res) => {
  const filter = {};
  applySearch(filter, req.query.search, [
    'description',
    'entityLabel',
    'actor.name',
    'actor.email',
  ]);

  applyFilters(filter, req.query, {
    action: { type: 'in' },
    entityType: { type: 'in' },
    severity: { type: 'in' },
    channel: { type: 'exact' },
    targetCompanyId: { type: 'objectId' },
  });

  if (req.query.actorId) filter['actor.userId'] = req.query.actorId;
  if (req.query.dateFrom || req.query.dateTo) applyDateRange(filter, req.query, 'occurredAt');

  const sort = parseSort(req.query, ['occurredAt'], '-occurredAt');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 25);

  const [rows, total, facetActions, facetEntities] = await Promise.all([
    PlatformAuditLog.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PlatformAuditLog.countDocuments(filter),
    PlatformAuditLog.aggregate([
      { $match: { occurredAt: { $gte: new Date(Date.now() - 90 * 86400000) } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    PlatformAuditLog.aggregate([
      { $match: { occurredAt: { $gte: new Date(Date.now() - 90 * 86400000) } } },
      { $group: { _id: '$entityType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
  ]);

  return paginated(res, {
    data: rows.map((a) => ({
      id: String(a._id),
      actor: a.actor?.name || 'system',
      actorEmail: a.actor?.email || '',
      actorRole: a.actor?.role || '',
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId ? String(a.entityId) : null,
      entityLabel: a.entityLabel || '',
      targetCompanyId: a.targetCompanyId ? String(a.targetCompanyId) : null,
      description: a.description || '',
      severity: a.severity || 'INFO',
      channel: a.channel || 'WEB',
      occurredAt: a.occurredAt,
      before: a.before ?? null,
      after: a.after ?? null,
      meta: a.meta || null,
    })),
    page,
    limit,
    total,
    extra: {
      facets: {
        actions: facetActions.map((f) => ({ value: f._id, count: f.count })),
        entityTypes: facetEntities.map((f) => ({ value: f._id, count: f.count })),
      },
    },
  });
});

/** GET /api/platform/audit-logs/summary — small header stats for the page. */
export const summary = asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86400000);
  const [total, recent, bySeverity, distinctActors] = await Promise.all([
    PlatformAuditLog.estimatedDocumentCount(),
    PlatformAuditLog.countDocuments({ occurredAt: { $gte: since } }),
    PlatformAuditLog.aggregate([
      { $match: { occurredAt: { $gte: since } } },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]),
    PlatformAuditLog.distinct('actor.userId', { occurredAt: { $gte: since } }),
  ]);

  return success(res, {
    message: 'OK',
    data: {
      total,
      last30d: recent,
      bySeverity: Object.fromEntries(bySeverity.map((s) => [s._id || 'INFO', s.count])),
      activeActors: distinctActors.filter(Boolean).length,
    },
  });
});

export default { list, summary };
