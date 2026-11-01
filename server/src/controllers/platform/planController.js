import Plan from '../../models/Plan.js';
import Company from '../../models/Company.js';
import Subscription from '../../models/Subscription.js';
import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../utils/errors.js';
import { applySearch, parseSort } from '../../utils/query.js';
import { withoutTenant } from '../../middlewares/tenant.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import PlatformAuditLog from '../../models/PlatformAuditLog.js';

const actorOf = (req) => ({
  userId: req.user?.id || null,
  name: req.user?.name || 'system',
  email: req.user?.email || '',
  role: req.user?.role || 'SYSTEM',
});

const record = (req, entry) =>
  PlatformAuditLog.create({
    actor: actorOf(req),
    channel: 'WEB',
    severity: 'INFO',
    occurredAt: new Date(),
    ...entry,
  }).catch(() => {});

const serialize = (p, extras = {}) => ({
  id: String(p._id),
  code: p.code,
  name: p.name,
  description: p.description || '',
  price: p.price,
  currency: p.currency,
  billingCycle: p.billingCycle,
  trialDays: p.trialDays,
  maxUsers: p.maxUsers,
  maxCustomers: p.maxCustomers,
  maxInvoicesPerMonth: p.maxInvoicesPerMonth,
  features: p.features || {},
  highlights: p.highlights || [],
  sortOrder: p.sortOrder,
  isActive: Boolean(p.isActive),
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  ...extras,
});

// ---------------------------------------------------------------------------
// GET /api/platform/plans
// ---------------------------------------------------------------------------
export const list = asyncHandler(async (req, res) => {
  const filter = { isDeleted: { $ne: true } };
  applySearch(filter, req.query.search, ['name', 'code', 'description']);
  if (req.query.active === 'true') filter.isActive = true;
  if (req.query.active === 'false') filter.isActive = false;

  const sort = parseSort(req.query, ['sortOrder', 'price', 'createdAt', 'name'], 'sortOrder');
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 50);

  const [rows, total, usage] = await Promise.all([
    Plan.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Plan.countDocuments(filter),
    withoutTenant(() =>
      Company.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: '$plan', count: { $sum: 1 } } },
      ])
    ),
  ]);

  const usageByPlan = new Map(usage.map((u) => [String(u._id), u.count]));

  return paginated(res, {
    data: rows.map((p) => serialize(p, { companyCount: usageByPlan.get(String(p._id)) || 0 })),
    page,
    limit,
    total,
  });
});

// ---------------------------------------------------------------------------
// POST /api/platform/plans
// ---------------------------------------------------------------------------
export const create = asyncHandler(async (req, res) => {
  const code = req.body.code.toUpperCase();
  const exists = await Plan.exists({ code });
  if (exists) throw new ConflictError(`A plan with code ${code} already exists`, 'DUPLICATE');

  const plan = await Plan.create({ ...req.body, code, createdBy: req.user.id });

  record(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'Plan',
    entityId: plan._id,
    entityLabel: `${plan.code} · ${plan.name}`,
    description: `Created plan ${plan.name} at ${plan.price}/${plan.billingCycle}`,
    after: { code: plan.code, price: plan.price, billingCycle: plan.billingCycle },
  });

  return created(res, { message: 'Plan created', data: { plan: serialize(plan, { companyCount: 0 }) } });
});

// ---------------------------------------------------------------------------
// PATCH /api/platform/plans/:id
// ---------------------------------------------------------------------------
export const update = asyncHandler(async (req, res) => {
  const before = await Plan.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
  if (!before) throw new NotFoundError('Plan not found', 'NOT_FOUND');

  const payload = { ...req.body };
  if (payload.code) {
    const code = payload.code.toUpperCase();
    if (code !== before.code) {
      const clash = await Plan.exists({ code, _id: { $ne: before._id } });
      if (clash) throw new ConflictError(`A plan with code ${code} already exists`, 'DUPLICATE');
    }
    payload.code = code;
  }

  const plan = await Plan.findOneAndUpdate(
    { _id: before._id },
    { $set: payload, $setOnInsert: {} },
    { new: true, runValidators: true }
  ).lean();

  record(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Plan',
    entityId: plan._id,
    entityLabel: `${plan.code} · ${plan.name}`,
    description: `Updated plan ${plan.name}`,
    before: { price: before.price, isActive: before.isActive, maxUsers: before.maxUsers },
    after: { price: plan.price, isActive: plan.isActive, maxUsers: plan.maxUsers },
  });

  const companyCount = await withoutTenant(() => Company.countDocuments({ plan: plan._id, isDeleted: { $ne: true } }));
  return success(res, { message: 'Plan updated', data: { plan: serialize(plan, { companyCount }) } });
});

// ---------------------------------------------------------------------------
// DELETE /api/platform/plans/:id  (soft delete; blocked while in use)
// ---------------------------------------------------------------------------
export const remove = asyncHandler(async (req, res) => {
  const plan = await Plan.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
  if (!plan) throw new NotFoundError('Plan not found', 'NOT_FOUND');

  const inUseDocs = await withoutTenant(() =>
    Company.find({ plan: plan._id, isDeleted: { $ne: true } })
      .select('code businessName')
      .limit(3)
      .lean()
  );
  if (inUseDocs.length) {
    const total = await withoutTenant(() =>
      Company.countDocuments({ plan: plan._id, isDeleted: { $ne: true } })
    );
    const names = inUseDocs.map((c) => `${c.code} (${c.businessName})`).join(', ');
    const more = total > inUseDocs.length ? ` and ${total - inUseDocs.length} more` : '';
    throw new BadRequestError(
      `This plan is assigned to ${total} compan${total === 1 ? 'y' : 'ies'}: ${names}${more}. Reassign them before deleting.`,
      'PLAN_IN_USE'
    );
  }

  const activeSubs = await Subscription.countDocuments({ plan: plan._id, status: 'ACTIVE' }).catch(() => 0);
  if (activeSubs > 0) {
    throw new BadRequestError(
      `This plan has ${activeSubs} active subscription${activeSubs === 1 ? '' : 's'}.`,
      'PLAN_IN_USE'
    );
  }

  await Plan.updateOne({ _id: plan._id }, { $set: { isDeleted: true, isActive: false } });

  record(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'Plan',
    entityId: plan._id,
    entityLabel: `${plan.code} · ${plan.name}`,
    severity: 'WARN',
    description: `Deleted plan ${plan.name}`,
    before: { isActive: plan.isActive },
    after: { isDeleted: true },
  });

  return success(res, { message: 'Plan deleted', data: { id: String(plan._id) } });
});

// ---------------------------------------------------------------------------
// GET /api/platform/plans/:id
// ---------------------------------------------------------------------------
export const detail = asyncHandler(async (req, res) => {
  const plan = await Plan.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
  if (!plan) throw new NotFoundError('Plan not found', 'NOT_FOUND');

  const [companyCount, activeSubs] = await Promise.all([
    withoutTenant(() => Company.countDocuments({ plan: plan._id, isDeleted: { $ne: true } })),
    Subscription.countDocuments({ plan: plan._id, status: 'ACTIVE' }).catch(() => 0),
  ]);

  return success(res, {
    message: 'OK',
    data: { plan: serialize(plan, { companyCount, activeSubscriptions: activeSubs }) },
  });
});

export default { list, create, update, remove, detail };
