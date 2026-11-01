import dayjs from 'dayjs';

import Target from '../../models/Target.js';
import Route from '../../models/Route.js';
import User from '../../models/User.js';

import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, TARGET_PERIODS, TARGET_STATUS } from '../../config/constants.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';
import { toPlain, loadDoc, refOrNull, dateOrNull } from './_helpers.js';
import { periodWindow, refreshTargetAchievements } from '../../services/fieldForceService.js';

/**
 * Phase 7 - Sales targets controller.
 *
 * A target is scoped to exactly one salesman OR one route for a period. The
 * period window is derived server-side from `periodType` + `anchorDate` (or an
 * explicit `periodKey`), so two clients can never disagree about what "October"
 * means. Achievements are rolled up from booked orders and refreshed on write.
 */

const POPULATE = [
  { path: 'salesman', select: 'name email role title avatar territory' },
  { path: 'route', select: 'name code territory' },
  { path: 'createdBy', select: 'name email' },
];

const SEARCH_FIELDS = ['name', 'periodKey', 'periodLabel', 'salesmanName', 'routeName'];

const SORT_ALLOWED = ['endDate', 'startDate', 'createdAt', 'targetValue', 'achievedValue', 'status', 'name'];

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const labelOf = (d) => d?.name || d?.periodLabel || (d?._id ? String(d._id) : 'Target');

/** Salesman -> own targets, manager -> own + team, admin -> all. */
const scopeFilter = (req) => {
  const role = req.user?.role;
  if (role === 'SALESMAN') return { salesman: req.user.id };
  if (role === 'MANAGER') {
    const ids = [req.user.id, ...(req.dataScope?.teamIds || [])];
    return { salesman: { $in: ids } };
  }
  return {};
};

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------

export const list = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req) };
  if (req.query.me === 'true') filter.salesman = req.user.id;
  else if (req.query.salesman) filter.salesman = req.query.salesman;
  if (req.query.route) filter.route = req.query.route;
  if (req.query.periodType) filter.periodType = req.query.periodType;
  if (req.query.periodKey) filter.periodKey = req.query.periodKey;
  if (req.query.status) filter.status = req.query.status;

  const result = await listDocuments(Target, {
    filter,
    query: req.query,
    searchFields: SEARCH_FIELDS,
    filtersSpec: {
      salesman: { type: 'objectId' },
      route: { type: 'objectId' },
      status: { type: 'string' },
      periodType: { type: 'string' },
    },
    sortAllowed: SORT_ALLOWED,
    defaultSort: '-endDate',
    dateField: 'endDate',
    populate: POPULATE,
  });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const get = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Target, req.params.id, {
    populate: POPULATE,
    filter: scopeFilter(req),
    label: 'Target',
  });
  return success(res, { data: toPlain(doc) });
});

/** Dashboard-style progress: goals vs achieved for a period. */
export const progress = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req) };
  if (req.query.periodType) filter.periodType = req.query.periodType;
  if (req.query.periodKey) filter.periodKey = req.query.periodKey;
  if (req.query.me === 'true') filter.salesman = req.user.id;
  else if (req.query.salesman) filter.salesman = req.query.salesman;

  const targets = await Target.find(filter).populate('salesman', 'name email').populate('route', 'name code').lean();

  const totalTarget = targets.reduce((s, t) => s + Number(t.targetValue || 0), 0);
  const totalAchieved = targets.reduce((s, t) => s + Number(t.achievedValue || 0), 0);

  return success(res, {
    data: {
      total: targets.length,
      totalTarget: round2(totalTarget),
      totalAchieved: round2(totalAchieved),
      overallPercent: totalTarget > 0 ? Math.min(100, Math.round((totalAchieved / totalTarget) * 10000) / 100) : 0,
      achievedCount: targets.filter((t) => t.status === TARGET_STATUS.ACHIEVED).length,
      missedCount: targets.filter((t) => t.status === TARGET_STATUS.MISSED).length,
      activeCount: targets.filter((t) => t.status === TARGET_STATUS.ACTIVE).length,
      targets: targets.map((t) => ({
        ...toPlain(t),
        percent: Number(t.targetValue || 0) > 0
          ? Math.min(100, Math.round((Number(t.achievedValue || 0) / Number(t.targetValue || 1)) * 10000) / 100)
          : 0,
        remaining: Math.max(0, Number(t.targetValue || 0) - Number(t.achievedValue || 0)),
      })),
    },
  });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const create = asyncHandler(async (req, res) => {
  const payload = { ...req.body };

  const salesman = refOrNull(payload.salesman) ? await User.findById(payload.salesman) : null;
  const route = refOrNull(payload.route) ? await Route.findById(payload.route) : null;
  if (!salesman && !route) {
    throw new BadRequestError('Assign the target to a salesman or a route', 'VALIDATION_ERROR');
  }

  // Derive the period window server-side unless an explicit key + window came in.
  let window;
  if (payload.periodKey && payload.startDate && payload.endDate) {
    window = {
      periodKey: String(payload.periodKey),
      periodLabel: payload.periodLabel || String(payload.periodKey),
      startDate: new Date(payload.startDate),
      endDate: new Date(payload.endDate),
    };
  } else {
    window = periodWindow(payload.periodType, dateOrNull(payload.anchorDate) || new Date());
  }

  const doc = new Target({
    name: payload.name || window.periodLabel,
    periodType: payload.periodType,
    periodKey: window.periodKey,
    periodLabel: window.periodLabel,
    startDate: window.startDate,
    endDate: window.endDate,
    salesman: salesman?._id || null,
    salesmanName: salesman?.name || '',
    route: route?._id || null,
    routeName: route?.name || '',
    targetValue: round2(payload.targetValue || 0),
    targetOrders: Number(payload.targetOrders || 0),
    targetVisits: Number(payload.targetVisits || 0),
    notes: payload.notes || '',
    status: TARGET_STATUS.ACTIVE,
    source: 'WEB',
  });

  await refreshTargetAchievements(doc);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'Target',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    after: toPlain(doc),
    description: `Target ${labelOf(doc)} created for ${salesman?.name || route?.name} (${doc.targetValue})`,
  });

  const full = await loadDoc(Target, doc._id, { populate: POPULATE, label: 'Target' });
  return created(res, { message: 'Target created', data: toPlain(full) });
});

export const update = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Target, req.params.id, {
    populate: POPULATE,
    filter: scopeFilter(req),
    label: 'Target',
  });
  if (doc.status === TARGET_STATUS.CLOSED) {
    throw new ConflictError('A closed target cannot be edited', 'TARGET_LOCKED');
  }

  const before = toPlain(doc);
  const payload = { ...req.body };

  if (payload.name !== undefined) doc.name = payload.name;
  if (payload.targetValue !== undefined) doc.targetValue = round2(payload.targetValue);
  if (payload.targetOrders !== undefined) doc.targetOrders = Number(payload.targetOrders);
  if (payload.targetVisits !== undefined) doc.targetVisits = Number(payload.targetVisits);
  if (payload.notes !== undefined) doc.notes = payload.notes;

  await refreshTargetAchievements(doc);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Target',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    before,
    after: toPlain(doc),
    description: `Target ${labelOf(doc)} updated`,
  });

  const full = await loadDoc(Target, doc._id, { populate: POPULATE, label: 'Target' });
  return success(res, { message: 'Target updated', data: toPlain(full) });
});

export const remove = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Target, req.params.id, {
    populate: POPULATE,
    filter: scopeFilter(req),
    label: 'Target',
  });

  const snapshot = toPlain(doc);
  await doc.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'Target',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    before: snapshot,
    description: `Target ${labelOf(doc)} deleted`,
  });

  return success(res, { message: 'Target deleted', data: { id: String(doc._id) } });
});

/** Close a target so it stops tracking (end-of-period housekeeping). */
export const close = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Target, req.params.id, {
    populate: POPULATE,
    filter: scopeFilter(req),
    label: 'Target',
  });
  if (doc.status === TARGET_STATUS.CLOSED) {
    throw new ConflictError('Target is already closed', 'TARGET_CLOSED');
  }

  const before = doc.status;
  await refreshTargetAchievements(doc);
  doc.status = TARGET_STATUS.CLOSED;
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Target',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    before: { status: before },
    after: { status: TARGET_STATUS.CLOSED },
    description: `Target ${labelOf(doc)} closed`,
  });

  const full = await loadDoc(Target, doc._id, { populate: POPULATE, label: 'Target' });
  return success(res, { message: 'Target closed', data: toPlain(full) });
});

/** Force a refresh of achievements from booked orders. */
export const refresh = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req) };
  if (req.params.id) filter._id = req.params.id;

  const targets = await Target.find(filter);
  for (const t of targets) {
    await refreshTargetAchievements(t);
    await t.save();
  }

  if (req.params.id) {
    const full = await loadDoc(Target, req.params.id, { populate: POPULATE, label: 'Target' });
    return success(res, { message: 'Target refreshed', data: toPlain(full) });
  }

  return success(res, { message: `Refreshed ${targets.length} targets`, data: { count: targets.length } });
});

// ---------------------------------------------------------------------------
// Form options
// ---------------------------------------------------------------------------

export const formOptions = asyncHandler(async (req, res) => {
  const [salesmen, routes] = await Promise.all([
    User.find({ isActive: { $ne: false }, role: { $in: ['SALESMAN', 'MANAGER'] } })
      .select('name email role territory')
      .sort({ name: 1 })
      .limit(500)
      .lean(),
    Route.find({ isActive: { $ne: false } }).select('name code territory').sort({ name: 1 }).limit(500).lean(),
  ]);

  const now = dayjs();
  const windows = {};
  TARGET_PERIODS.forEach((p) => {
    windows[p] = periodWindow(p, now.toDate());
  });

  return success(res, {
    data: {
      periods: TARGET_PERIODS,
      windows,
      salesmen: salesmen.map((u) => ({ ...u, id: String(u._id) })),
      routes: routes.map((r) => ({ ...r, id: String(r._id) })),
      statusList: Object.values(TARGET_STATUS),
      settings: {
        currency: (req.settings?.currency) || 'INR',
        currencySymbol: (req.settings?.currencySymbol) || '₹',
      },
    },
  });
});

export default {
  list,
  get,
  progress,
  create,
  update,
  remove,
  close,
  refresh,
  formOptions,
};
