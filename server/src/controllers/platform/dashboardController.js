import dayjs from 'dayjs';
import Company from '../../models/Company.js';
import User from '../../models/User.js';
import PlatformAuditLog from '../../models/PlatformAuditLog.js';
import { COMPANY_STATUS } from '../../config/constants.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { withoutTenant } from '../../middlewares/tenant.js';
import logger from '../../utils/logger.js';

/**
 * GET /api/platform/dashboard
 *
 * Platform-wide KPIs: company counts by status, users, revenue proxy,
 * top companies by order volume, subscriptions expiring soon and a
 * recent-activity feed.
 */
export const overview = asyncHandler(async (_req, res) => {
  const now = new Date();
  const in30 = dayjs().add(30, 'day').toDate();
  const since30 = dayjs().subtract(30, 'day').toDate();

  const [
    statusCounts,
    totalUsers,
    newSignups,
    expiringRaw,
    recentActivityRaw,
  ] = await withoutTenant(() =>
    Promise.all([
      Company.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      User.countDocuments({ isDeleted: { $ne: true } }).skipTenant(),
      Company.countDocuments({ createdAt: { $gte: since30 }, isDeleted: { $ne: true } }),
      Company.find({
        isDeleted: { $ne: true },
        status: { $in: [COMPANY_STATUS.ACTIVE, COMPANY_STATUS.TRIAL] },
        $or: [{ subscriptionEnd: { $lte: in30, $gte: now } }, { trialEndsAt: { $lte: in30, $gte: now } }],
      })
        .select('code businessName subscriptionEnd trialEndsAt status')
        .sort({ subscriptionEnd: 1, trialEndsAt: 1 })
        .limit(10)
        .lean(),
      PlatformAuditLog.find({})
        .sort({ occurredAt: -1 })
        .limit(8)
        .select('actor.name action entityType entityLabel description occurredAt')
        .lean(),
    ])
  );

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));

  // MRR proxy: sum of active subscription plan prices, normalised to monthly.
  let mrr = 0;
  let revenueYtd = 0;
  try {
    const [{ default: Subscription }, { default: Plan }] = await Promise.all([
      import('../../models/Subscription.js'),
      import('../../models/Plan.js'),
    ]);

    const [activeSubs, plans] = await withoutTenant(() =>
      Promise.all([
        Subscription.find({ status: 'ACTIVE', end: { $gte: now } }).select('plan billingCycle').lean(),
        Plan.find({}).select('price billingCycle').lean(),
      ])
    );

    const priceByPlan = new Map(plans.map((p) => [String(p._id), p]));
    const cycleFactor = { MONTHLY: 1, QUARTERLY: 1 / 3, YEARLY: 1 / 12, ONCE: 0 };

    for (const sub of activeSubs) {
      const plan = priceByPlan.get(String(sub.plan));
      if (!plan) continue;
      mrr += (Number(plan.price) || 0) * (cycleFactor[plan.billingCycle] ?? 1 / 12);
    }
    revenueYtd = Math.round(mrr * Math.max(1, dayjs().month() + 1));
  } catch (err) {
    logger.debug?.(`platform dashboard: revenue proxy unavailable (${err.message})`);
  }

  // Top companies by order volume (Phase 4+ ships real aggregation).
  let topCompanies = [];
  try {
    const { default: Order } = await import('../../models/Order.js');
    topCompanies = await withoutTenant(() =>
      Order.aggregate([
        { $match: { createdAt: { $gte: since30 } } },
        {
          $group: {
            _id: '$companyId',
            orders: { $sum: 1 },
            value: { $sum: '$total' },
          },
        },
        { $sort: { orders: -1 } },
        { $limit: 10 },
      ])
    );
    if (topCompanies.length) {
      const ids = topCompanies.map((t) => t._id);
      const companies = await withoutTenant(() =>
        Company.find({ _id: { $in: ids } })
          .select('code businessName status address.city')
          .lean()
      );
      const map = new Map(companies.map((c) => [String(c._id), c]));
      topCompanies = topCompanies
        .map((t) => {
          const c = map.get(String(t._id));
          return c
            ? {
                id: String(t._id),
                name: c.businessName,
                code: c.code,
                city: c.address?.city || '',
                status: c.status,
                orders: t.orders,
                value: t.value,
              }
            : null;
        })
        .filter(Boolean);
    }
  } catch {
    // Order model not shipped yet.
  }

  const expiring = expiringRaw.map((c) => {
    const end = c.subscriptionEnd || c.trialEndsAt;
    return {
      id: String(c._id),
      name: c.businessName,
      code: c.code,
      status: c.status,
      subscriptionEnd: end,
      daysLeft: Math.max(0, Math.ceil((new Date(end).getTime() - now.getTime()) / 86400000)),
    };
  });

  const data = {
    stats: {
      totalCompanies: statusCounts.reduce((s, c) => s + c.count, 0),
      activeCompanies: byStatus[COMPANY_STATUS.ACTIVE] || 0,
      trialCompanies: byStatus[COMPANY_STATUS.TRIAL] || 0,
      suspended: byStatus[COMPANY_STATUS.SUSPENDED] || 0,
      expired: byStatus[COMPANY_STATUS.EXPIRED] || 0,
      cancelled: byStatus[COMPANY_STATUS.CANCELLED] || 0,
      totalUsers,
      newSignups,
      expiringSoon: expiring.length,
      mrr: Math.round(mrr),
      revenueYtd,
    },
    topCompanies,
    expiring,
    health: {
      apiStatus: 'Operational',
      errorRate: '0%',
      avgResponseMs: null,
      lastActivity: recentActivityRaw[0]?.occurredAt || null,
    },
    recentActivity: recentActivityRaw.map((a) => ({
      actor: a.actor?.name || 'system',
      action: a.action,
      entityType: a.entityType,
      entityLabel: a.entityLabel,
      description: a.description,
      occurredAt: a.occurredAt,
    })),
  };

  return success(res, { message: 'OK', data });
});

export default { overview };
