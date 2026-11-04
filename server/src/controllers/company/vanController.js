import VanDayClose from '../../models/VanDayClose.js';
import VanAssignment from '../../models/VanAssignment.js';
import Setting from '../../models/Setting.js';
import { success, created } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError, BadRequestError, ConflictError, ForbiddenError } from '../../utils/errors.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, COMPANY_ROLES, DEFAULT_PERMISSIONS, MOVEMENT_TYPES } from '../../config/constants.js';
import { toPlain } from './_helpers.js';
import { recordMovement } from '../../services/inventoryService.js';
import {
  activeVanOf,
  assertDayClosed,
  daySummary,
  executiveOn,
  loadVan,
  moveVanStock,
  pendingDays,
  todayIn,
  tzOf,
  vanStock,
} from '../../services/vanService.js';

/**
 * Van sales: stock on a van, loading / unloading it and the day close.
 * Inventory staff manage every van; the executive driving a van may see its
 * stock and close its day.
 */

const can = (req, permission) => {
  if (req.user?.role === COMPANY_ROLES.COMPANY_ADMIN) return true;
  const matrix = req.settings?.rolePermissions?.[permission] || DEFAULT_PERMISSIONS[permission] || [];
  return matrix.includes(req.user?.role);
};

const isDriver = async (req, van) =>
  Boolean(await VanAssignment.exists({ warehouse: van._id, executive: req.user.id, active: true }));

const assertAccess = async (req, van, permission) => {
  if (can(req, permission) || (await isDriver(req, van))) return;
  throw new ForbiddenError('You do not have access to this van', 'FORBIDDEN');
};

const round3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** GET /vans/mine - the van the signed-in executive is driving. */
export const mine = asyncHandler(async (req, res) => {
  const active = await activeVanOf(req.user.id);
  if (!active) return success(res, { data: null });
  const tz = tzOf(req.company);
  const [stock, pending] = await Promise.all([vanStock(active.van._id), pendingDays(active.van, active.spell, tz)]);
  return success(res, {
    data: {
      van: { id: String(active.van._id), code: active.van.code, name: active.van.name, vehicleNumber: active.van.vehicleNumber },
      dayCloseMandatory: active.spell.dayCloseMandatory,
      pendingDays: pending,
      stock,
    },
  });
});

/** GET /vans/:id/stock */
export const stock = asyncHandler(async (req, res) => {
  const van = await loadVan(req.params.id);
  await assertAccess(req, van, 'inventory.view');
  return success(res, { data: await vanStock(van._id) });
});

const move = (direction) =>
  asyncHandler(async (req, res) => {
    const van = await loadVan(req.params.id);
    if (!can(req, 'inventory.manage')) throw new ForbiddenError('You cannot load or unload vans', 'FORBIDDEN');
    if (van.isActive === false) throw new BadRequestError('This van is inactive', 'WAREHOUSE_INACTIVE');
    // An unsettled earlier day must be closed before the van is loaded again.
    if (direction === 'LOAD') {
      const spell = await VanAssignment.findOne({ warehouse: van._id, active: true }).lean();
      if (spell) await assertDayClosed(spell.executive, req.company);
    }
    const settings = await Setting.forCompany(req.companyId);
    const doc = await moveVanStock({
      van,
      direction,
      items: req.body.items,
      notes: req.body.notes || '',
      userId: req.user.id,
      settings,
      companyId: req.companyId,
    });
    audit(req, {
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'StockTransfer',
      entityId: doc._id,
      entityLabel: doc.transferNo,
      description: `Van ${van.code} ${direction === 'LOAD' ? 'loaded' : 'unloaded'} (${doc.transferNo})`,
    });
    return created(res, {
      message: direction === 'LOAD' ? 'Van loaded' : 'Van unloaded',
      data: { transferNo: doc.transferNo, stock: await vanStock(van._id) },
    });
  });

export const load = move('LOAD');
export const unload = move('UNLOAD');

/** GET /vans/:id/day-close?date=YYYY-MM-DD - what the day should look like. */
export const dayClosePreview = asyncHandler(async (req, res) => {
  const van = await loadVan(req.params.id);
  await assertAccess(req, van, 'inventory.view');
  const tz = tzOf(req.company);
  const day = DAY.test(req.query.date || '') ? req.query.date : todayIn(tz);
  const [closed, executive] = await Promise.all([
    VanDayClose.findOne({ warehouse: van._id, day }).populate('closedBy', 'name').populate('executive', 'name').lean(),
    executiveOn(van._id, day, tz),
  ]);
  const spell = await VanAssignment.findOne({ warehouse: van._id, active: true }).lean();
  const pending = await pendingDays(van, spell, tz);
  if (closed) return success(res, { data: { day, closed: toPlain(closed), pendingDays: pending } });
  const summary = await daySummary(van, day, { tz, executiveId: executive });
  return success(res, { data: { day, closed: null, executive: executive ? String(executive) : null, pendingDays: pending, ...summary } });
});

/** POST /vans/:id/day-close - settle a day: book stock variances, record cash. */
export const closeDay = asyncHandler(async (req, res) => {
  const van = await loadVan(req.params.id);
  await assertAccess(req, van, 'inventory.manage');
  const tz = tzOf(req.company);
  const day = req.body.date;
  if (!DAY.test(day || '')) throw new BadRequestError('Choose the day to close', 'VALIDATION_ERROR');
  if (day > todayIn(tz)) throw new BadRequestError('A future day cannot be closed', 'INVALID_DATE');
  if (await VanDayClose.exists({ warehouse: van._id, day })) {
    throw new ConflictError(`${van.code} is already closed for ${day}`, 'DAY_ALREADY_CLOSED');
  }
  const spell = await VanAssignment.findOne({ warehouse: van._id, active: true }).lean();
  const earlier = (await pendingDays(van, spell, tz)).filter((d) => d < day);
  if (earlier.length) {
    throw new AppError(`Close ${earlier[0]} first - days are settled in order.`, { status: 409, code: 'DAY_CLOSE_PENDING' });
  }

  const executive = await executiveOn(van._id, day, tz);
  const summary = await daySummary(van, day, { tz, executiveId: executive });
  const counted = new Map((req.body.counts || []).map((c) => [String(c.product), Number(c.counted)]));
  const errors = [];
  const lines = summary.lines.map((l, i) => {
    const value = counted.has(l.product) ? counted.get(l.product) : l.expected;
    if (!Number.isFinite(value) || value < 0) errors.push({ field: `counts.${i}.counted`, message: `${l.name}: enter the counted quantity` });
    return { ...l, counted: round3(value), variance: round3(value - l.expected) };
  });
  const cashDeposited = Number(req.body.cashDeposited ?? summary.cashExpected);
  if (!Number.isFinite(cashDeposited) || cashDeposited < 0) errors.push({ field: 'cashDeposited', message: 'Enter the cash deposited' });
  const withVariance = lines.filter((l) => l.variance);
  if ((withVariance.length || cashDeposited !== summary.cashExpected) && !String(req.body.notes || '').trim()) {
    errors.push({ field: 'notes', message: 'Explain the difference in the notes' });
  }
  if (errors.length) {
    throw new AppError(errors[0].message, { status: 422, code: 'VALIDATION_ERROR', errors: errors.map((e) => ({ ...e, field: `body.${e.field}` })) });
  }

  // Shortages / excess found on the count are booked into the van.
  const settings = await Setting.forCompany(req.companyId);
  for (const l of withVariance) {
    await recordMovement({
      product: l.product,
      warehouse: van._id,
      qty: l.variance,
      type: MOVEMENT_TYPES.COUNT,
      refType: 'MANUAL',
      refNo: `DAYCLOSE-${van.code}-${day}`,
      reason: 'Van day close count',
      note: req.body.notes || '',
      movedBy: req.user.id,
      settings: { ...settings.toObject(), order: { ...settings.order, allowNegativeStock: true } },
    });
  }

  const doc = await VanDayClose.create({
    warehouse: van._id,
    executive,
    day,
    lines: lines.map(({ packUnits, ...l }) => l),
    stockVarianceQty: round3(withVariance.reduce((s, l) => s + l.variance, 0)),
    cashExpected: summary.cashExpected,
    cashDeposited,
    cashVariance: Math.round((cashDeposited - summary.cashExpected) * 100) / 100,
    payments: summary.payments,
    notes: req.body.notes || '',
    closedBy: req.user.id,
    closedAt: new Date(),
  });

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'VanDayClose',
    entityId: doc._id,
    entityLabel: `${van.code} ${day}`,
    description: `Van ${van.code} closed for ${day}: cash ${doc.cashVariance >= 0 ? '+' : ''}${doc.cashVariance}, ${withVariance.length} stock difference(s)`,
  });
  return created(res, { message: `${van.code} closed for ${day}`, data: toPlain(doc) });
});

/** GET /vans/:id/day-closes - settlement history, newest first. */
export const dayCloses = asyncHandler(async (req, res) => {
  const van = await loadVan(req.params.id);
  await assertAccess(req, van, 'inventory.view');
  const rows = await VanDayClose.find({ warehouse: van._id })
    .sort({ day: -1 })
    .limit(60)
    .populate('executive', 'name')
    .populate('closedBy', 'name')
    .lean();
  return success(res, { data: rows.map(toPlain) });
});

export default { mine, stock, load, unload, dayClosePreview, closeDay, dayCloses };
