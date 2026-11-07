import VanDayClose from '../../models/VanDayClose.js';
import Warehouse from '../../models/Warehouse.js';
import StockBalance from '../../models/StockBalance.js';
import Product from '../../models/Product.js';
import VanAssignment from '../../models/VanAssignment.js';
import Setting from '../../models/Setting.js';
import { success, created } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AppError, BadRequestError, ConflictError, ForbiddenError } from '../../utils/errors.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, COMPANY_ROLES, DEFAULT_PERMISSIONS, MOVEMENT_TYPES } from '../../config/constants.js';
import { toPlain } from './_helpers.js';
import { recordMovement } from '../../services/inventoryService.js';
import { notifyUsers, notifyPermission } from '../../services/notifyService.js';
import { fieldDayState } from '../../services/fieldDayService.js';
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

/**
 * GET /vans/stock-query?q= - free stock per product in the warehouses the
 * user may see: a salesman sees their van and the godown it is loaded from
 * (else the default godown); inventory staff and managers see every warehouse.
 */
export const stockQuery = asyncHandler(async (req, res) => {
  let warehouses;
  if (can(req, 'inventory.view') || req.user.role === COMPANY_ROLES.MANAGER) {
    warehouses = await Warehouse.find({ isActive: { $ne: false }, type: { $nin: ['DAMAGED', 'TRANSIT'] } })
      .select('name code type parent isDefault')
      .sort({ isDefault: -1, type: 1, name: 1 })
      .lean();
  } else {
    const active = await activeVanOf(req.user.id);
    const settings = req.settings || (await Setting.forCompany(req.companyId));
    const godownId = active?.van?.parent || settings?.inventory?.defaultWarehouse || null;
    const godown = godownId
      ? await Warehouse.findById(godownId).select('name code type isDefault').lean()
      : await Warehouse.findOne({ isActive: { $ne: false }, type: 'MAIN' }).sort({ isDefault: -1 }).select('name code type isDefault').lean();
    warehouses = [active?.van, godown].filter(Boolean);
  }
  const ids = warehouses.map((w) => w._id);
  const productFilter = { isActive: true };
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    productFilter.$or = [{ name: rx }, { sku: rx }, { customCode: rx }];
  }
  const [products, balances] = await Promise.all([
    Product.find(productFilter).select('name sku unit category').sort({ name: 1 }).limit(500).lean(),
    StockBalance.find({ warehouse: { $in: ids } }).select('product warehouse qty reservedQty').lean(),
  ]);
  const byProduct = new Map();
  const typeOf = new Map(warehouses.map((w) => [String(w._id), w.type]));
  balances.forEach((b) => {
    const key = String(b.product);
    if (!byProduct.has(key)) byProduct.set(key, {});
    // A godown keeps confirmed orders' units aside; a van's stock is all free.
    const reserved = typeOf.get(String(b.warehouse)) === 'VAN' ? 0 : Number(b.reservedQty || 0);
    byProduct.get(key)[String(b.warehouse)] = Math.round((Number(b.qty || 0) - reserved) * 1000) / 1000;
  });
  const rows = products.map((p) => {
    const qty = byProduct.get(String(p._id)) || {};
    return {
      product: String(p._id),
      name: p.name,
      sku: p.sku || '',
      unit: p.unit || 'PCS',
      category: p.category || '',
      qty,
      total: Math.round(Object.values(qty).reduce((s, v) => s + v, 0) * 1000) / 1000,
    };
  });
  return success(res, {
    data: {
      warehouses: warehouses.map((w) => ({ id: String(w._id), name: w.name, code: w.code || '', type: w.type })),
      rows,
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
  // A rejected cashout is counted again, so it shows the form with the reason.
  if (closed && closed.status !== 'REJECTED') return success(res, { data: { day, closed: toPlain(closed), pendingDays: pending } });
  const summary = await daySummary(van, day, { tz, executiveId: executive });
  return success(res, {
    data: {
      day,
      closed: null,
      rejected: closed ? { reason: closed.rejectReason || '', at: closed.updatedAt } : null,
      executive: executive ? String(executive) : null,
      pendingDays: pending,
      ...summary,
    },
  });
});

/** Book the counted stock differences into the van (on approval). */
const bookVariances = async (req, van, doc) => {
  const settings = await Setting.forCompany(req.companyId);
  for (const l of doc.lines.filter((x) => x.variance)) {
    await recordMovement({
      product: l.product,
      warehouse: van._id,
      qty: l.variance,
      type: MOVEMENT_TYPES.COUNT,
      refType: 'MANUAL',
      refNo: `DAYCLOSE-${van.code}-${doc.day}`,
      reason: 'Van day close count',
      note: doc.notes || '',
      movedBy: req.user.id,
      settings: { ...settings.toObject(), order: { ...settings.order, allowNegativeStock: true } },
    });
  }
};

const approveCashout = async (req, van, doc) => {
  await bookVariances(req, van, doc);
  doc.status = 'APPROVED';
  doc.approvedBy = req.user.id;
  doc.approvedAt = new Date();
  doc.rejectReason = '';
  await doc.save();
};

/**
 * POST /vans/:id/day-close - the day cashout: counted stock and cash for a
 * day. The executive submits it for approval; a user who may approve day
 * cashouts settles it at once. A rejected cashout is submitted again.
 */
export const closeDay = asyncHandler(async (req, res) => {
  const van = await loadVan(req.params.id);
  await assertAccess(req, van, 'inventory.manage');
  const tz = tzOf(req.company);
  const day = req.body.date;
  if (!DAY.test(day || '')) throw new BadRequestError('Choose the day to close', 'VALIDATION_ERROR');
  if (day > todayIn(tz)) throw new BadRequestError('A future day cannot be closed', 'INVALID_DATE');
  // A salesman's cashout for today is the end of a working day: it needs the
  // day started (marked in) and every earlier day settled. Earlier pending
  // days can still be cashed out - that is how the salesman catches up.
  if (req.user.role === COMPANY_ROLES.SALESMAN && day === todayIn(tz)) {
    const fieldDay = await fieldDayState(req);
    const blocked = fieldDay.required ? fieldDay.blocked : null;
    if (blocked && blocked.code !== 'DAY_ENDED') {
      const message =
        blocked.code === 'ATTENDANCE_REQUIRED' ? `Mark your attendance in for ${day} before submitting its day cashout.` : blocked.message;
      throw new AppError(message, { status: 409, code: blocked.code, details: { day: blocked.day || day } });
    }
  }
  const existing = await VanDayClose.findOne({ warehouse: van._id, day });
  if (existing && existing.status !== 'REJECTED') {
    throw new ConflictError(
      existing.status === 'SUBMITTED' ? `${van.code} cashout for ${day} is waiting for approval` : `${van.code} is already closed for ${day}`,
      'DAY_ALREADY_CLOSED'
    );
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

  const values = {
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
    status: 'SUBMITTED',
    rejectReason: '',
  };
  let doc;
  if (existing) {
    existing.set(values);
    doc = await existing.save();
  } else {
    doc = await VanDayClose.create(values);
  }

  const selfApprove = can(req, 'vans.daycash.approve');
  if (selfApprove) await approveCashout(req, van, doc);
  else {
    await notifyPermission(req.companyId, 'vans.daycash.approve', {
      type: 'APPROVAL_REQUIRED',
      title: `Day cashout ${van.code} ${day} needs approval`,
      body: `${req.user.name} · cash ${cashDeposited} (expected ${summary.cashExpected})${withVariance.length ? ` · ${withVariance.length} stock difference(s)` : ''}`,
      link: '/app/day-cashouts',
      entityType: 'VanDayClose',
      entityId: doc._id,
      priority: 'HIGH',
      exclude: req.user.id,
    });
  }

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'VanDayClose',
    entityId: doc._id,
    entityLabel: `${van.code} ${day}`,
    description: `Van ${van.code} day cashout for ${day} ${selfApprove ? 'settled' : 'submitted'}: cash ${doc.cashVariance >= 0 ? '+' : ''}${doc.cashVariance}, ${withVariance.length} stock difference(s)`,
  });
  return created(res, {
    message: selfApprove ? `${van.code} closed for ${day}` : 'Day cashout sent for approval',
    data: toPlain(doc),
  });
});

const loadCashout = async (req) => {
  const doc = await VanDayClose.findById(req.params.closeId);
  if (!doc) throw new BadRequestError('Day cashout not found', 'NOT_FOUND');
  if (doc.status !== 'SUBMITTED') throw new ConflictError('Only a cashout waiting for approval can be acted on', 'CASHOUT_LOCKED');
  return { doc, van: await loadVan(String(doc.warehouse)) };
};

/** GET /vans/day-closes?status= - day cashouts across vans (approvals queue). */
export const allDayCloses = asyncHandler(async (req, res) => {
  const filter = {};
  if (['SUBMITTED', 'APPROVED', 'REJECTED'].includes(req.query.status)) filter.status = req.query.status;
  const canApprove = can(req, 'vans.daycash.approve');
  if (!canApprove && !can(req, 'inventory.view')) filter.executive = req.user.id;
  const rows = await VanDayClose.find(filter)
    .sort({ day: -1, createdAt: -1 })
    .limit(100)
    .populate('warehouse', 'name code')
    .populate('executive', 'name')
    .populate('closedBy', 'name')
    .populate('approvedBy', 'name')
    .lean();
  return res.json({ success: true, message: 'OK', data: rows.map(toPlain), meta: { canApprove } });
});

/** POST /vans/day-closes/:closeId/approve */
export const approveDayClose = asyncHandler(async (req, res) => {
  if (!can(req, 'vans.daycash.approve')) throw new ForbiddenError('You cannot approve day cashouts', 'FORBIDDEN');
  const { doc, van } = await loadCashout(req);
  await approveCashout(req, van, doc);
  await notifyUsers([doc.executive], {
    type: 'SYSTEM',
    title: `Day cashout ${van.code} ${doc.day} approved`,
    body: 'You can mark out your attendance now.',
    link: '/app/attendance',
    entityType: 'VanDayClose',
    entityId: doc._id,
  });
  audit(req, { action: AUDIT_ACTIONS.APPROVE, entityType: 'VanDayClose', entityId: doc._id, entityLabel: `${van.code} ${doc.day}`, description: `Day cashout ${van.code} ${doc.day} approved` });
  return success(res, { message: 'Day cashout approved', data: toPlain(doc) });
});

/** POST /vans/day-closes/:closeId/reject { reason } */
export const rejectDayClose = asyncHandler(async (req, res) => {
  if (!can(req, 'vans.daycash.approve')) throw new ForbiddenError('You cannot reject day cashouts', 'FORBIDDEN');
  const { doc, van } = await loadCashout(req);
  doc.status = 'REJECTED';
  doc.rejectReason = req.body.reason;
  await doc.save();
  await notifyUsers([doc.executive], {
    type: 'SYSTEM',
    title: `Day cashout ${van.code} ${doc.day} rejected`,
    body: req.body.reason,
    link: '/app/my-van',
    entityType: 'VanDayClose',
    entityId: doc._id,
    priority: 'HIGH',
  });
  audit(req, { action: AUDIT_ACTIONS.REJECT, entityType: 'VanDayClose', entityId: doc._id, entityLabel: `${van.code} ${doc.day}`, description: `Day cashout ${van.code} ${doc.day} rejected: ${req.body.reason}` });
  return success(res, { message: 'Day cashout rejected', data: toPlain(doc) });
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
    .populate('approvedBy', 'name')
    .lean();
  return success(res, { data: rows.map(toPlain) });
});

export default { mine, stockQuery, stock, load, unload, dayClosePreview, closeDay, dayCloses, allDayCloses, approveDayClose, rejectDayClose };
