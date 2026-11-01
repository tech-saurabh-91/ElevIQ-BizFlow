import dayjs from 'dayjs';
import Company from '../../models/Company.js';
import User from '../../models/User.js';
import Plan from '../../models/Plan.js';
import Subscription from '../../models/Subscription.js';
import AuditLog from '../../models/AuditLog.js';
import PlatformAuditLog from '../../models/PlatformAuditLog.js';
import { COMPANY_STATUS, AUDIT_ACTIONS } from '../../config/constants.js';
import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { NotFoundError, ForbiddenError } from '../../utils/errors.js';
import { applySearch, applyFilters, applyDateRange, parseSort } from '../../utils/query.js';
import { withoutTenant } from '../../middlewares/tenant.js';
import { runWithContext } from '../../middlewares/tenantContext.js';
import * as companyService from '../../services/companyService.js';
import { signImpersonationToken } from '../../utils/tokens.js';
import logger from '../../utils/logger.js';

const { serializeCompany, allowedStatusTransitions } = companyService;

const actorOf = (req) => ({
  id: req.user?.id,
  name: req.user?.name,
  email: req.user?.email,
  role: req.user?.role,
});

// ---------------------------------------------------------------------------
// GET /api/platform/companies
// ---------------------------------------------------------------------------
export const list = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;

  const filter = { isDeleted: { $ne: true } };
  applySearch(filter, req.query.search, ['businessName', 'code', 'slug', 'email', 'phone', 'gstin']);

  applyFilters(filter, req.query, {
    status: { type: 'in' },
    businessType: { type: 'exact' },
    plan: { type: 'objectId' },
  });

  // "Expiring in N days" convenience filter.
  if (req.query.expiringIn !== undefined && req.query.expiringIn !== null && req.query.expiringIn !== '') {
    const now = new Date();
    const horizon = dayjs().add(Number(req.query.expiringIn), 'day').toDate();
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { subscriptionEnd: { $gte: now, $lte: horizon } },
          { trialEndsAt: { $gte: now, $lte: horizon } },
        ],
      },
    ];
  }

  if (req.query.dateFrom || req.query.dateTo) applyDateRange(filter, req.query, 'createdAt');

  const sort = parseSort(req.query, ['createdAt', 'businessName', 'code', 'status', 'subscriptionEnd', 'lastActivityAt'], '-createdAt');

  const q = Company.find(filter).sort(sort).populate('plan', 'code name price billingCycle').lean();
  q.skip((Math.max(1, Number(page) || 1) - 1) * Number(limit || 20)).limit(Number(limit || 20));

  const [rows, total, byStatus] = await Promise.all([
    q,
    Company.countDocuments(filter),
    // Status facet counts ignore the status filter so the chips stay useful.
    withoutTenant(() =>
      Company.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
    ),
  ]);

  // Resolve each tenant's first administrator so the list can show who owns it.
  const adminIds = rows.map((c) => c.adminUser).filter(Boolean);
  const admins = adminIds.length
    ? await User.find({ _id: { $in: adminIds }, isDeleted: { $ne: true } })
        .skipTenant() // deliberate cross-tenant read (one admin per company)
        .select('name email')
        .lean()
    : [];
  const adminById = new Map(admins.map((u) => [String(u._id), u]));

  return paginated(res, {
    data: rows.map((c) =>
      serializeCompany(c, {
        admin: c.adminUser && adminById.get(String(c.adminUser))
          ? { name: adminById.get(String(c.adminUser)).name, email: adminById.get(String(c.adminUser)).email }
          : null,
      })
    ),
    page,
    limit,
    total,
    extra: {
      statusCounts: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/platform/companies
// ---------------------------------------------------------------------------
export const create = asyncHandler(async (req, res) => {
  const result = await companyService.createCompany(req.body, actorOf(req));
  return created(res, {
    message: `Company ${result.company.code} created. Admin login: ${result.admin.email}`,
    data: result,
  });
});

// ---------------------------------------------------------------------------
// GET /api/platform/companies/:id  (Company 360°)
// ---------------------------------------------------------------------------
export const detail = asyncHandler(async (req, res) => {
  const company = await companyService.getCompanyOr404(req.params.id);

  const [stats, subscriptions, users, activity, ordersByStatus] = await Promise.all([
    companyService.getCompanyStats(company._id),
    companyService.getSubscriptionHistory(company._id),
    runWithContext({ scope: 'company', companyId: String(company._id) }, () =>
      User.find({ isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .limit(8)
        .select('name email phone role isActive title lastLoginAt mustChangePassword createdAt')
        .lean()
    ).catch(() => []),
    PlatformAuditLog.find({ targetCompanyId: company._id })
      .sort({ occurredAt: -1 })
      .limit(15)
      .select('actor.name action entityType entityLabel description severity occurredAt')
      .lean()
      .catch(() => []),
    // Order-by-status is only meaningful once Phase 4 ships.
    (async () => {
      try {
        const { default: Order } = await import('../../models/Order.js');
        if (!Order?.modelName) return [];
        return await runWithContext({ scope: 'company', companyId: String(company._id) }, () =>
          Order.aggregate([
            { $match: { isDeleted: { $ne: true } } },
            { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } },
          ])
        );
      } catch {
        return [];
      }
    })(),
  ]);

  const plan = company.plan
    ? await withoutTenant(() => Plan.findById(company.plan).lean().catch(() => null))
    : null;

  const planCounts = await withoutTenant(() =>
    Company.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ])
  );

  const data = {
    company: serializeCompany(
      { ...company, plan },
      { allowedTransitions: allowedStatusTransitions(company) }
    ),
    stats,
    subscriptions,
    currentSubscription: subscriptions.find((s) => s.status === 'ACTIVE') || null,
    users,
    activity,
    ordersByStatus,
    tenantCounts: {
      users: stats.users,
      activeUsers: stats.activeUsers,
      customers: stats.customers,
      products: stats.products,
      orders: stats.orders,
      invoices: stats.invoices,
    },
    platformContext: {
      planDistribution: planCounts.map((p) => ({ planId: p._id ? String(p._id) : null, count: p.count })),
      userLimit: company.limits?.maxUsers ?? company.userLimit ?? 5,
      usagePct: Math.min(
        100,
        Math.round(((stats.users || 0) / (company.limits?.maxUsers ?? company.userLimit ?? 5)) * 100)
      ),
    },
  };

  return success(res, { message: 'OK', data });
});

// ---------------------------------------------------------------------------
// PATCH /api/platform/companies/:id
// ---------------------------------------------------------------------------
export const update = asyncHandler(async (req, res) => {
  const company = await companyService.updateCompany(req.params.id, req.body, actorOf(req));
  return success(res, { message: 'Company updated', data: { company } });
});

// ---------------------------------------------------------------------------
// PATCH /api/platform/companies/:id/status
// ---------------------------------------------------------------------------
export const changeStatus = asyncHandler(async (req, res) => {
  const company = await companyService.changeCompanyStatus(req.params.id, req.body, actorOf(req));
  return success(res, {
    message: `Company is now ${company.status}`,
    data: { company },
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/platform/companies/:id
// ---------------------------------------------------------------------------
export const remove = asyncHandler(async (req, res) => {
  const result = await companyService.softDeleteCompany(req.params.id, actorOf(req));
  return success(res, { message: 'Company deleted', data: result });
});

// ---------------------------------------------------------------------------
// GET /api/platform/companies/:id/users
// ---------------------------------------------------------------------------
export const listUsers = asyncHandler(async (req, res) => {
  const company = await companyService.getCompanyOr404(req.params.id);

  const filter = { companyId: company._id, isDeleted: { $ne: true } };
  applySearch(filter, req.query.search, ['name', 'email', 'phone', 'loginId', 'designation', 'territory']);
  applyFilters(filter, req.query, {
    role: { type: 'in' },
    isActive: { type: 'bool' },
  });

  const sort = parseSort(req.query, ['createdAt', 'name', 'role', 'lastLoginAt'], '-createdAt');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 20);

  const [rows, total] = await Promise.all([
    runWithContext({ scope: 'company', companyId: String(company._id) }, () =>
      User.find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .select('name email phone role title territory isActive mustChangePassword lastLoginAt createdAt')
        .lean()
    ),
    runWithContext({ scope: 'company', companyId: String(company._id) }, () => User.countDocuments(filter)),
  ]);

  return paginated(res, {
    data: rows.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email || '',
      phone: u.phone || '',
      role: u.role,
      title: u.title || '',
      territory: u.territory || '',
      isActive: Boolean(u.isActive),
      mustChangePassword: Boolean(u.mustChangePassword),
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })),
    page,
    limit,
    total,
  });
});

// ---------------------------------------------------------------------------
// GET /api/platform/companies/:id/audit-logs
// ---------------------------------------------------------------------------
export const companyAuditLogs = asyncHandler(async (req, res) => {
  const company = await companyService.getCompanyOr404(req.params.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 20);

  const tenantFilter = { companyId: company._id, isDeleted: { $ne: true } };
  applySearch(tenantFilter, req.query.search, ['description', 'entityLabel', 'actor.name']);
  applyFilters(tenantFilter, req.query, { action: { type: 'exact' }, entityType: { type: 'exact' } });
  if (req.query.dateFrom || req.query.dateTo) applyDateRange(tenantFilter, req.query, 'occurredAt');

  const platformFilter = { targetCompanyId: company._id };
  applySearch(platformFilter, req.query.search, ['description', 'entityLabel', 'actor.name']);
  if (req.query.action) platformFilter.action = req.query.action;
  if (req.query.dateFrom || req.query.dateTo) applyDateRange(platformFilter, req.query, 'occurredAt');

  const [tenantRows, platformRows, tenantTotal, platformTotal] = await Promise.all([
    AuditLog.find(tenantFilter).sort({ occurredAt: -1 }).limit(200).lean().catch(() => []),
    PlatformAuditLog.find(platformFilter).sort({ occurredAt: -1 }).limit(200).lean().catch(() => []),
    AuditLog.countDocuments(tenantFilter).catch(() => 0),
    PlatformAuditLog.countDocuments(platformFilter).catch(() => 0),
  ]);

  const merged = [...tenantRows, ...platformRows]
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    .slice((page - 1) * limit, page * limit);

  return paginated(res, {
    data: merged.map((a) => ({
      id: String(a._id),
      source: a.targetCompanyId && !a.companyId ? 'platform' : 'tenant',
      actor: a.actor?.name || 'system',
      actorRole: a.actor?.role || '',
      action: a.action,
      entityType: a.entityType,
      entityLabel: a.entityLabel || '',
      description: a.description || '',
      severity: a.severity || 'INFO',
      occurredAt: a.occurredAt,
      changes: a.changes || a.after || null,
    })),
    page,
    limit,
    total: tenantTotal + platformTotal,
  });
});

// ---------------------------------------------------------------------------
// POST /api/platform/companies/:id/impersonate
// ---------------------------------------------------------------------------
export const impersonate = asyncHandler(async (req, res) => {
  const company = await companyService.getCompanyOr404(req.params.id);

  if (![COMPANY_STATUS.ACTIVE, COMPANY_STATUS.TRIAL].includes(company.status)) {
    throw new ForbiddenError(
      `Cannot enter a workspace while the company is ${company.status}`,
      'COMPANY_SUSPENDED'
    );
  }

  // Pick the target user: explicit id, else the company admin, else any admin/manager.
  const target = await runWithContext({ scope: 'company', companyId: String(company._id) }, async () => {
    if (req.body?.userId) {
      const u = await User.findOne({
        _id: req.body.userId,
        companyId: company._id,
        isDeleted: { $ne: true },
        isActive: true,
      }).lean();
      if (!u) throw new NotFoundError('Target user not found in this company', 'NOT_FOUND');
      return u;
    }
    if (company.adminUser) {
      const u = await User.findOne({
        _id: company.adminUser,
        companyId: company._id,
        isDeleted: { $ne: true },
        isActive: true,
      }).lean();
      if (u) return u;
    }
    const u = await User.findOne({
      companyId: company._id,
      isDeleted: { $ne: true },
      isActive: true,
      role: { $in: ['COMPANY_ADMIN', 'MANAGER'] },
    })
      .sort({ role: 1 })
      .lean();
    if (!u) throw new NotFoundError('No active user available to act as', 'NOT_FOUND');
    return u;
  });

  const accessToken = signImpersonationToken({
    platformUserId: req.user.id,
    companyId: String(company._id),
    actingAs: String(target._id),
  });

  // Audit on BOTH trails: the platform trail records who initiated it, and the
  // tenant trail makes it visible inside the company's own audit page.
  const entry = {
    action: AUDIT_ACTIONS.IMPERSONATE,
    entityType: 'Company',
    entityId: company._id,
    entityLabel: `${company.code} · ${company.businessName}`,
    targetCompanyId: company._id,
    severity: 'WARN',
    description: `Impersonated ${target.name} (${target.role}) in ${company.businessName}`,
    before: null,
    after: { actingAs: String(target._id), role: target.role },
  };

  await Promise.all([
    PlatformAuditLog.create({
      actor: {
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
      },
      ...entry,
      channel: 'WEB',
      occurredAt: new Date(),
    }).catch((e) => logger.warn(`impersonation audit failed: ${e.message}`)),
    runWithContext({ scope: 'company', companyId: String(company._id) }, () =>
      AuditLog.create({
        companyId: company._id,
        actor: {
          userId: req.user.id,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role,
        },
        action: AUDIT_ACTIONS.IMPERSONATE,
        entityType: 'Company',
        entityId: company._id,
        entityLabel: company.businessName,
        description: `${req.user.name} from ElevIQ support entered this workspace`,
        severity: 'WARN',
        channel: 'WEB',
        status: '',
        occurredAt: new Date(),
      })
    ).catch((e) => logger.warn(`tenant impersonation audit failed: ${e.message}`)),
  ]);

  return success(res, {
    message: `Entered ${company.businessName}`,
    data: {
      accessToken,
      expiresInMinutes: 30,
      company: serializeCompany(company),
      actingAs: {
        id: String(target._id),
        name: target.name,
        email: target.email || '',
        role: target.role,
        title: target.title || '',
      },
      startedAt: new Date().toISOString(),
    },
  });
});

// ---------------------------------------------------------------------------
// POST /api/platform/companies/:id/subscription  (assign / renew a plan)
// ---------------------------------------------------------------------------
export const assignSubscription = asyncHandler(async (req, res) => {
  const company = await companyService.assignSubscription(req.params.id, req.body, actorOf(req));
  return success(res, { message: 'Subscription updated', data: { company } });
});

// ---------------------------------------------------------------------------
// GET /api/platform/companies/:id/subscription/usage  (lightweight health)
// ---------------------------------------------------------------------------
export const health = asyncHandler(async (req, res) => {
  const company = await companyService.getCompanyOr404(req.params.id);
  const end = company.subscriptionEnd || company.trialEndsAt;
  const daysLeft = end ? Math.ceil((new Date(end).getTime() - Date.now()) / 86400000) : null;

  const subscriptions = await Subscription.find({ companyId: company._id })
    .sort({ start: -1 })
    .limit(5)
    .lean();

  return success(res, {
    message: 'OK',
    data: {
      id: String(company._id),
      status: company.status,
      statusReason: company.statusReason || '',
      plan: company.plan ? String(company.plan) : null,
      subscriptionEnd: company.subscriptionEnd,
      trialEndsAt: company.trialEndsAt,
      daysLeft,
      graceDays: company.graceDays ?? 3,
      isLive: company.isLive?.() ?? [COMPANY_STATUS.ACTIVE, COMPANY_STATUS.TRIAL].includes(company.status),
      allowedTransitions: allowedStatusTransitions(company),
      recentSubscriptions: subscriptions.length,
    },
  });
});

export default {
  list,
  create,
  detail,
  update,
  changeStatus,
  remove,
  listUsers,
  companyAuditLogs,
  impersonate,
  health,
  assignSubscription,
};
