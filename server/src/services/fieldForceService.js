import mongoose from 'mongoose';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

import Attendance from '../models/Attendance.js';
import Visit from '../models/Visit.js';
import Target from '../models/Target.js';
import Order from '../models/Order.js';
import Setting from '../models/Setting.js';

import { BadRequestError, ConflictError } from '../utils/errors.js';
import { round2 } from '../models/helpers.js';
import { nextSeries, getFinancialYearTag } from '../utils/numberSeries.js';
import { getCompanyId } from '../middlewares/tenantContext.js';
import { ORDER_STATUS, TARGET_STATUS } from '../config/constants.js';

dayjs.extend(isoWeek);
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Field force domain rules (Phase 7).
 *
 * Owns the GPS maths (distance + geofence), attendance day resolution, visit
 * numbering and the target achievement refresh that rolls booked orders back
 * into each rep's goal progress.
 */

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Great-circle (haversine) distance in metres between two GPS points.
 * Returns null when either point is incomplete so callers can treat missing
 * coordinates as "unknown" rather than zero metres.
 */
export const distanceMeters = (a, b) => {
  // A missing coordinate (null / '') is not 0 - Number(null) would be.
  if ([a?.lat, a?.lng, b?.lat, b?.lng].some((v) => v == null || v === '')) return null;
  const lat1 = Number(a?.lat);
  const lng1 = Number(a?.lng);
  const lat2 = Number(b?.lat);
  const lng2 = Number(b?.lng);
  if (![lat1, lng1, lat2, lng2].every((n) => Number.isFinite(n))) return null;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
};

/** True when a point falls within `radiusM` of a centre (geofence check). */
export const withinGeofence = (point, centre, radiusM = 100) => {
  const d = distanceMeters(point, centre);
  if (d == null) return null; // unknown, not "outside"
  return d <= Number(radiusM || 0);
};

/** Company time zone (same default as the van day cashout). */
export const DEFAULT_TZ = 'Asia/Kolkata';
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The company's calendar day ('YYYY-MM-DD') for a moment. A plain
 * 'YYYY-MM-DD' string is already a day and is returned as is.
 */
export const dayKey = (value = new Date(), tz = DEFAULT_TZ) =>
  typeof value === 'string' && DAY_KEY.test(value.trim()) ? value.trim() : dayjs(value).tz(tz).format('YYYY-MM-DD');

/**
 * Start of the company's day (tenant-date boundary for attendance/visits).
 * Counted in the company time zone, never the server's, so "today" here is the
 * same day the van cashout uses (vanService.todayIn).
 */
export const startOfDay = (value = new Date(), tz = DEFAULT_TZ) => dayjs.tz(dayKey(value, tz), tz).toDate();

/** [start, end) of the company day holding `value`, for range queries. */
export const dayRange = (value = new Date(), tz = DEFAULT_TZ) => {
  const start = startOfDay(value, tz);
  return { start, end: dayjs.tz(dayKey(value, tz), tz).add(1, 'day').toDate() };
};

/**
 * Rules before a salesman checks in at a customer: the working day must be
 * started (attendance) when the company asks for it, and only one shop can be
 * open at a time.
 */
export const assertCanStartVisit = async (userId, settings, { exceptVisit = null } = {}) => {
  const open = await Visit.findOne({ salesman: userId, status: 'IN_PROGRESS', ...(exceptVisit ? { _id: { $ne: exceptVisit } } : {}) }).lean();
  if (open) throw new ConflictError(`Check out of ${open.customerName} first`, 'VISIT_IN_PROGRESS');
};

/**
 * What the salesman booked at the visit's customer since checking in: the
 * latest invoice, order and collection (any may be null). Drives the
 * check-out outcome, and whether a no-order reason is needed.
 */
export const visitBookings = async (visit, { order: orderId = null, payment: paymentId = null } = {}) => {
  const salesman = visit.salesman?._id || visit.salesman;
  const customerId = visit.customerId?._id || visit.customerId;
  const since = visit.checkIn?.at || visit.createdAt;
  const by = { $or: [{ salesman }, { createdBy: salesman }] };
  const [invoice, order, payment] = await Promise.all([
    mongoose.model('Invoice').findOne({ customerId, createdAt: { $gte: since }, status: { $ne: 'CANCELLED' }, ...by }).sort({ createdAt: -1 }).lean(),
    orderId
      ? mongoose.model('Order').findById(orderId).lean()
      : mongoose.model('Order').findOne({ customerId, createdAt: { $gte: since }, status: { $ne: 'CANCELLED' }, ...by }).sort({ createdAt: -1 }).lean(),
    paymentId
      ? mongoose.model('Payment').findById(paymentId).lean()
      : mongoose.model('Payment').findOne({ customerId, createdAt: { $gte: since }, collectedBy: salesman }).sort({ createdAt: -1 }).lean(),
  ]);
  return { invoice, order, payment };
};

/**
 * How far the check-in is from the customer's pinned location. Beyond the
 * radius the check-in is refused (when the company enforces it), else flagged.
 * Customers without a pinned location can always be checked in.
 */
export const markGeofence = (visit, customerGps, settings) => {
  const meters = distanceMeters(visit.checkIn?.location, customerGps);
  if (meters == null) return;
  const radius = Number(settings?.fieldForce?.geofenceRadiusM || 50);
  visit.checkInDistanceM = Math.round(meters);
  visit.outsideGeofence = meters > radius;
  if (visit.outsideGeofence && settings?.fieldForce?.enforceGeofence !== false) {
    throw new BadRequestError(
      `You are ${Math.round(meters)} m from this customer. Check in within ${radius} m of the shop.`,
      'OUTSIDE_GEOFENCE'
    );
  }
};

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

/** Load (or lazily create) the attendance record for a user on a given day. */
export const ensureAttendanceDay = async (userId, day, extra = {}, tz = DEFAULT_TZ) => {
  // Match the whole company day, so a record stamped with an older boundary
  // (server-local midnight) is still found instead of duplicated.
  const { start, end } = dayRange(day, tz);
  const doc = await Attendance.findOneAndUpdate(
    { user: userId, day: { $gte: start, $lt: end } },
    { $setOnInsert: { user: userId, day: start, ...extra } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc;
};

/**
 * Validate a check-out is not before its check-in and that the day is open.
 * Returns the pair of dates so callers can stamp fields.
 */
export const assertCheckoutOrder = (attendance) => {
  const inAt = attendance.checkIn?.at ? new Date(attendance.checkIn.at) : null;
  const outAt = attendance.checkOut?.at ? new Date(attendance.checkOut.at) : null;
  if (inAt && outAt && outAt < inAt) {
    throw new BadRequestError('Check-out cannot be before check-in', 'VALIDATION_ERROR');
  }
};

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

export const nextVisitNumber = async (companyId, settings, date = new Date()) => {
  const prefix = settings?.series?.visit?.prefix || 'VIS';
  const pad = Number(settings?.series?.visit?.pad || 5);
  const fy = getFinancialYearTag(date, Number(settings?.financialYearStartMonth || 4));
  return nextSeries(companyId, 'VISIT', { prefix, pad, fy });
};

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export const nextExpenseNumber = async (companyId, settings, date = new Date()) => {
  const prefix = settings?.series?.expense?.prefix || 'EXP';
  const pad = Number(settings?.series?.expense?.pad || 5);
  const fy = getFinancialYearTag(date, Number(settings?.financialYearStartMonth || 4));
  return nextSeries(companyId, 'EXPENSE', { prefix, pad, fy });
};

/** Orders that count toward a target's achievement (booked, not cancelled). */
export const ACHIEVING_ORDER_STATUSES = [
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PARTIALLY_INVOICED,
  ORDER_STATUS.FULLY_INVOICED,
  ORDER_STATUS.DISPATCHED,
  ORDER_STATUS.DELIVERED,
];

/** Resolve a possibly-populated ref (document or ObjectId) to a usable id. */
const ownerId = (value) => {
  if (!value) return null;
  const raw = typeof value === 'object' && value._id ? value._id : value;
  const text = String(raw);
  return /^[0-9a-fA-F]{24}$/.test(text) ? text : null;
};

/**
 * Recompute a single target's achievements from the orders its owner booked
 * inside the target window. Only non-cancelled orders count, so a voided order
 * pulls the progress back down.
 */
export const refreshTargetAchievements = async (target) => {
  const companyId = getCompanyId();
  const match = {
    companyId: new mongoose.Types.ObjectId(companyId),
    isDeleted: { $ne: true },
    status: { $in: ACHIEVING_ORDER_STATUSES },
    orderDate: { $gte: new Date(target.startDate), $lte: new Date(target.endDate) },
  };

  // The target may arrive populated (loadDoc), so never String() a document.
  const salesmanId = ownerId(target.salesman);
  const routeId = ownerId(target.route);

  if (salesmanId) match.salesman = new mongoose.Types.ObjectId(salesmanId);
  else if (routeId) match.route = new mongoose.Types.ObjectId(routeId);
  else {
    target.achievedValue = 0;
    target.achievedOrders = 0;
    target.lastRefreshedAt = new Date();
    return target;
  }

  const [agg] = await Order.aggregate([
    { $match: match },
    { $group: { _id: null, value: { $sum: '$total' }, orders: { $sum: 1 } } },
  ]);

  target.achievedValue = round2(Number(agg?.value || 0));
  target.achievedOrders = Number(agg?.orders || 0);
  target.lastRefreshedAt = new Date();
  target.refreshStatus();
  return target;
};

/** Refresh every target in a window (used after an order write / nightly). */
export const refreshTargetsFor = async ({ salesman = null, from = null, to = null } = {}) => {
  const filter = {};
  if (salesman) filter.salesman = salesman;
  if (from || to) {
    filter.endDate = {};
    if (from) filter.endDate.$gte = new Date(from);
    if (to) filter.endDate.$lte = new Date(to);
  }

  const targets = await Target.find(filter);
  for (const t of targets) {
    await refreshTargetAchievements(t);
    await t.save();
  }
  return targets.length;
};

/**
 * Build the period key + window for a target from its type and anchor date.
 * Week uses the ISO week, month the calendar month, quarter the calendar
 * quarter and year the calendar year, so keys are stable and sortable.
 */
export const periodWindow = (periodType, anchor = new Date()) => {
  const d = dayjs(anchor);

  if (periodType === 'WEEK') {
    const start = d.startOf('week');
    const end = d.endOf('week');
    const iso = d.isoWeek();
    return {
      periodKey: `${d.year()}-W${String(iso).padStart(2, '0')}`,
      periodLabel: `Week ${iso}, ${d.year()}`,
      startDate: start.toDate(),
      endDate: end.toDate(),
    };
  }

  if (periodType === 'QUARTER') {
    const q = Math.floor(d.month() / 3) + 1;
    const start = d.month((q - 1) * 3).startOf('month');
    const end = start.add(2, 'month').endOf('month');
    return {
      periodKey: `${d.year()}-Q${q}`,
      periodLabel: `Q${q} ${d.year()}`,
      startDate: start.toDate(),
      endDate: end.toDate(),
    };
  }

  if (periodType === 'YEAR') {
    return {
      periodKey: String(d.year()),
      periodLabel: String(d.year()),
      startDate: d.startOf('year').toDate(),
      endDate: d.endOf('year').toDate(),
    };
  }

  // MONTH (default)
  return {
    periodKey: `${d.year()}-${String(d.month() + 1).padStart(2, '0')}`,
    periodLabel: d.format('MMM YYYY'),
    startDate: d.startOf('month').toDate(),
    endDate: d.endOf('month').toDate(),
  };
};

/** Settings snapshot for the field-force module (geofence + work hours). */
export const fieldForceSettings = async (settings) =>
  settings ||
  (await Setting.forCompany(getCompanyId())) || {
    fieldForce: { geofenceRadiusM: 100, requireGps: true, workStart: '09:30', workEnd: '18:30' },
  };

export default {
  distanceMeters,
  withinGeofence,
  startOfDay,
  dayKey,
  dayRange,
  ensureAttendanceDay,
  assertCheckoutOrder,
  nextVisitNumber,
  nextExpenseNumber,
  refreshTargetAchievements,
  refreshTargetsFor,
  periodWindow,
  ACHIEVING_ORDER_STATUSES,
  TARGET_STATUS,
};
