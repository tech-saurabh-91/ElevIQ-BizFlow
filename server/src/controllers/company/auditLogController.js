import AuditLog from '../../models/AuditLog.js';
import mongoose from 'mongoose';
import { success, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments, applyDateRange } from '../../utils/query.js';
import { loadDoc, toPlain } from './_helpers.js';

/** GET /api/v1/audit-logs - tenant audit trail (COMPANY_ADMIN only). */
export const list = asyncHandler(async (req, res) => {
  const filter = {};

  if (req.query.actorId) filter['actor.userId'] = req.query.actorId;
  applyDateRange(filter, req.query, 'occurredAt');

  const result = await listDocuments(AuditLog, {
    filter,
    query: req.query,
    searchFields: ['entityLabel', 'description', 'actor.name', 'actor.email', 'entityType', 'action'],
    filtersSpec: {
      action: { type: 'string' },
      entityType: { type: 'string' },
    },
    sortAllowed: ['occurredAt', 'action', 'entityType'],
    defaultSort: '-occurredAt',
  });

  const [entityTypes, actions] = await Promise.all([
    AuditLog.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(req.companyId), isDeleted: { $ne: true } } },
      { $group: { _id: '$entityType' } },
    ]),
    AuditLog.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(req.companyId), isDeleted: { $ne: true } } },
      { $group: { _id: '$action' } },
    ]),
  ]);

  return paginated(res, {
    data: result.data.map(toPlain),
    ...result.meta,
    extra: {
      entityTypes: entityTypes.map((e) => e._id).filter(Boolean).sort(),
      actions: actions.map((a) => a._id).filter(Boolean).sort(),
    },
  });
});

/** GET /api/v1/audit-logs/:id - single event with before/after snapshots. */
export const get = asyncHandler(async (req, res) => {
  const doc = await loadDoc(AuditLog, req.params.id, { label: 'Audit event' });
  return success(res, { data: toPlain(doc) });
});

export default { list, get };
