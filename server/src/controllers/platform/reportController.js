import dayjs from 'dayjs';
import mongoose from 'mongoose';

import Company from '../../models/Company.js';
import User from '../../models/User.js';
import Plan from '../../models/Plan.js';
import PlatformAuditLog from '../../models/PlatformAuditLog.js';
import { COMPANY_STATUS } from '../../config/constants.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { withoutTenant } from '../../middlewares/tenant.js';
import { resolveWindow } from '../../services/reportService.js';

/**
 * Phase 8 - Platform reports.
 *
 * Cross-tenant read-only analytics for the service provider. Everything runs
 * under `withoutTenant()` and matches on `isDeleted` explicitly, so no company
 * can ever be attributed to another's numbers.
 */

const oid = (id) => new mongoose.Types.ObjectId(id);
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const inWindow = (field, { from, to }) => ({ [field]: { $gte: from, $lte: to } });

/** Fill empty months so the signups chart is continuous. */
const fillMonths = (rows, window) => {
  const byKey = new Map(rows.map((r) => [String(r._id), r]));
  const out = [];
  let cursor = dayjs(window.from).startOf('month');
  const end = dayjs(window.to);
  let guard = 0;
  while (cursor.isBefore(end) && guard < 120) {
    const key = cursor.format('YYYY-MM');
    const hit = byKey.get(key);
    out.push({
      period: key,
      label: cursor.format('MMM YY'),
      count: hit?.count ?? 0,
      value: round2(hit?.value ?? 0),
    });
    cursor = cursor.add(1, 'month');
    guard += 1;
  }
  return out;
};

/** GET /api/platform/reports/overview */
export const overview = asyncHandler(async (req, res) => {
  const window = resolveWindow(req.query, { defaultDays: 365 });

  const [
    statusRows,
    signupSeries,
    planRows,
    roleRows,
    userTotals,
    newInWindow,
    topCompaniesRaw,
    auditRaw,
  ] = await withoutTenant(() =>
    Promise.all([
      // Company counts by lifecycle status.
      Company.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // New companies per month inside the requested window.
      Company.aggregate([
        { $match: { isDeleted: { $ne: true }, ...inWindow('createdAt', window) } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // How many companies sit on each plan.
      Company.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: '$plan', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Platform-wide user headcount by company role.
      User.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: '$role', count: { $sum: 1 }, active: { $sum: { $cond: ['$isActive', 1, 0] } } } },
        { $sort: { count: -1 } },
      ]),

      Promise.all([
        User.countDocuments({ isDeleted: { $ne: true } }).skipTenant(),
        User.countDocuments({ isDeleted: { $ne: true }, isActive: true }).skipTenant(),
      ]),

      Company.countDocuments({ isDeleted: { $ne: true }, ...inWindow('createdAt', window) }).skipTenant(),

      // Top companies by active user headcount (a proxy for adoption).
      User.aggregate([
        { $match: { isDeleted: { $ne: true }, isActive: true } },
        { $group: { _id: '$companyId', users: { $sum: 1 } } },
        { $sort: { users: -1 } },
        { $limit: 10 },
      ]),

      // Audit activity mix over the same window.
      Promise.all([
        PlatformAuditLog.aggregate([
          { $match: { occurredAt: { $gte: window.from, $lte: window.to } } },
          { $group: { _id: '$severity', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]).catch(() => []),
        PlatformAuditLog.estimatedDocumentCount().catch(() => 0),
      ]).then(([bySeverity, total]) => [bySeverity, total]),
    ])
  );

  // Hydrate plan names for the plan breakdown.
  const planIds = planRows.map((r) => r._id).filter(Boolean);
  const plans = planIds.length
    ? await withoutTenant(() =>
        Plan.find({ _id: { $in: planIds.map((p) => oid(String(p))) } })
          .select('name price billingCycle')
          .lean()
    )
    : [];
  const planById = new Map(plans.map((p) => [String(p._id), p]));

  const totalCompanies = statusRows.reduce((s, r) => s + r.count, 0);

  // Hydrate company names for the top-companies list.
  const topIds = topCompaniesRaw.map((t) => t._id).filter(Boolean);
  const topCompanies = topIds.length
    ? await withoutTenant(() =>
        Company.find({ _id: { $in: topIds.map(oid) } })
          .select('code businessName status')
          .lean()
    )
    : [];
  const companyById = new Map(topCompanies.map((c) => [String(c._id), c]));

  const byStatus = Object.fromEntries(statusRows.map((r) => [r._id, r.count]));
  const [totalUsers, activeUsers] = userTotals;

  const data = {
    window: { from: window.fromIso, to: window.toIso },
    summary: {
      totalCompanies,
      activeCompanies: byStatus[COMPANY_STATUS.ACTIVE] || 0,
      trialCompanies: byStatus[COMPANY_STATUS.TRIAL] || 0,
      suspended: byStatus[COMPANY_STATUS.SUSPENDED] || 0,
      expired: byStatus[COMPANY_STATUS.EXPIRED] || 0,
      cancelled: byStatus[COMPANY_STATUS.CANCELLED] || 0,
      newCompanies: newInWindow,
      totalUsers,
      activeUsers,
      inactiveUsers: Math.max(0, totalUsers - activeUsers),
      activationRate: totalUsers > 0 ? round2((activeUsers / totalUsers) * 100) : 0,
    },
    signups: fillMonths(signupSeries, window),
    byStatus: statusRows.map((r) => ({ status: r._id || '—', count: r.count })),
    byPlan: planRows.map((r) => ({
      id: r._id ? String(r._id) : null,
      name: planById.get(String(r._id))?.name || (r._id ? 'Custom plan' : 'No plan'),
      price: round2(planById.get(String(r._id))?.price || 0),
      billingCycle: planById.get(String(r._id))?.billingCycle || '',
      count: r.count,
    })),
    byRole: roleRows.map((r) => ({
      role: r._id || '—',
      count: r.count,
      active: r.active,
      inactive: Math.max(0, r.count - r.active),
    })),
    topCompanies: topCompaniesRaw
      .map((t) => {
        const c = companyById.get(String(t._id));
        return c
          ? {
              id: String(t._id),
              name: c.businessName,
              code: c.code,
              status: c.status,
              users: t.users,
            }
          : null;
      })
      .filter(Boolean),
    activity: {
      total: auditRaw?.[1] ?? 0,
      bySeverity: (auditRaw?.[0] || []).map((r) => ({ severity: r._id || 'INFO', count: r.count })),
    },
  };

  return success(res, { data });
});

export default { overview };
