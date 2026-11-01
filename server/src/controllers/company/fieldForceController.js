import mongoose from 'mongoose';
import dayjs from 'dayjs';

import Attendance from '../../models/Attendance.js';
import Visit from '../../models/Visit.js';
import Customer from '../../models/Customer.js';
import Route from '../../models/Route.js';
import User from '../../models/User.js';
import Setting from '../../models/Setting.js';

import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import {
  AUDIT_ACTIONS,
  ATTENDANCE_STATUS,
  VISIT_STATUS,
  VISIT_OUTCOMES,
} from '../../config/constants.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';
import { toPlain, loadDoc, refOrNull, dateOrNull } from './_helpers.js';
import {
  distanceMeters,
  withinGeofence,
  startOfDay,
  ensureAttendanceDay,
  assertCheckoutOrder,
  nextVisitNumber,
} from '../../services/fieldForceService.js';

/**
 * Phase 7 - Field Force controller: attendance + visits.
 *
 * Attendance is a per-user, per-day document driven by GPS check-in/check-out.
 * Visits are per-customer stops with their own GPS capture and an outcome that
 * links back to the order/collection it produced. Both enforce the salesman ->
 * own, manager -> team data scope so a rep only ever sees their own activity.
 */

const POPULATE_ATTENDANCE = [
  { path: 'user', select: 'name email role title avatar territory' },
  { path: 'reviewedBy', select: 'name email' },
];

const POPULATE_VISIT = [
  { path: 'customerId', select: 'name code phone type route address' },
  { path: 'salesman', select: 'name email role title' },
  { path: 'route', select: 'name code territory' },
  { path: 'order', select: 'orderNo status total' },
  { path: 'payment', select: 'paymentNo status amount' },
  { path: 'createdBy', select: 'name email' },
];

const settingsOf = async (req) => req.settings || (await Setting.forCompany(req.companyId));
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

/** Restrict to own records (SALESMAN) or team records (MANAGER). */
const activityScope = (req, field) => {
  const role = req.user?.role;
  if (role === 'SALESMAN') return { [field]: req.user.id };
  if (role === 'MANAGER') {
    const ids = [req.user.id, ...(req.dataScope?.teamIds || [])];
    return { [field]: { $in: ids } };
  }
  return {};
};

const settingsFieldForce = (settings) => ({
  geofenceRadiusM: Number(settings?.fieldForce?.geofenceRadiusM || 100),
  requireGps: settings?.fieldForce?.requireGps !== false,
  requireSelfie: Boolean(settings?.fieldForce?.requireSelfie),
  workStart: settings?.fieldForce?.workStart || '09:30',
  workEnd: settings?.fieldForce?.workEnd || '18:30',
});

// ===========================================================================
// Attendance
// ===========================================================================

export const listAttendance = asyncHandler(async (req, res) => {
  const filter = { ...activityScope(req, 'user') };

  // `me=true` always collapses to the signed-in user regardless of role.
  if (req.query.me === 'true') filter.user = req.user.id;
  else if (req.query.userId) filter.user = req.query.userId;

  const result = await listDocuments(Attendance, {
    filter,
    query: req.query,
    searchFields: ['userName', 'notes', 'manualReason'],
    filtersSpec: {
      user: { type: 'objectId' },
      status: { type: 'string' },
    },
    sortAllowed: ['day', 'workedMinutes', 'status', 'createdAt', 'userName'],
    defaultSort: '-day',
    dateField: 'day',
    populate: POPULATE_ATTENDANCE,
  });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const getAttendance = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Attendance, req.params.id, {
    populate: POPULATE_ATTENDANCE,
    filter: activityScope(req, 'user'),
    label: 'Attendance',
  });
  return success(res, { data: toPlain(doc) });
});

/** Today's attendance for the signed-in user (drives the check-in/out button). */
export const myToday = asyncHandler(async (req, res) => {
  const day = startOfDay(dateOrNull(req.query.day) || new Date());
  const doc = await Attendance.findOne({ user: req.user.id, day });
  const settings = await settingsOf(req);

  return success(res, {
    data: {
      day,
      attendance: doc ? toPlain(doc) : null,
      config: settingsFieldForce(settings),
    },
  });
});

/** Check in (start of day) with GPS. Idempotent per day: re-checking in updates the time. */
export const checkIn = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const config = settingsFieldForce(settings);
  const payload = { ...req.body };

  const at = dateOrNull(payload.at) || new Date();
  const day = startOfDay(dateOrNull(payload.day) || at);
  const location = payload.location || {};

  if (config.requireGps && (location.lat == null || location.lng == null)) {
    throw new BadRequestError('Location is required to check in', 'GPS_REQUIRED');
  }

  const doc = await ensureAttendanceDay(req.user.id, day, {
    userName: req.user.name,
    userRole: req.user.role,
  });

  if (doc.isCheckedIn && !doc.isCheckedOut) {
    throw new ConflictError('You are already checked in for today', 'ALREADY_CHECKED_IN');
  }
  if (doc.isCheckedIn && doc.isCheckedOut) {
    throw new ConflictError('This day is already completed. Ask a manager to reopen it.', 'DAY_COMPLETED');
  }

  doc.checkIn = {
    at,
    location: { lat: numberOrNull(location.lat), lng: numberOrNull(location.lng) },
    accuracy: payload.accuracy == null ? null : Number(payload.accuracy),
    address: payload.address || '',
    source: payload.source || 'WEB',
    note: payload.note || '',
  };
  doc.status = ATTENDANCE_STATUS.PRESENT;
  doc.isManual = false;
  await doc.save();

  // Mirror the live position onto the user record for the team map.
  if (location.lat != null && location.lng != null) {
    await User.updateOne({ _id: req.user.id }, {
      $set: { gps: { lat: Number(location.lat), lng: Number(location.lng), updatedAt: new Date() } },
    }).skipTenant();
  }

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Attendance',
    entityId: doc._id,
    entityLabel: `${req.user.name} ${dayjs(day).format('YYYY-MM-DD')}`,
    after: { status: doc.status, checkIn: doc.checkIn.at },
    description: `${req.user.name} checked in`,
  });

  const full = await loadDoc(Attendance, doc._id, { populate: POPULATE_ATTENDANCE, label: 'Attendance' });
  return success(res, { message: 'Checked in', data: toPlain(full) });
});

/** Check out (end of day) with GPS. Computes worked minutes and distance. */
export const checkOut = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const config = settingsFieldForce(settings);
  const payload = { ...req.body };

  const at = dateOrNull(payload.at) || new Date();
  const day = startOfDay(dateOrNull(payload.day) || at);
  const location = payload.location || {};

  if (config.requireGps && (location.lat == null || location.lng == null)) {
    throw new BadRequestError('Location is required to check out', 'GPS_REQUIRED');
  }

  const doc = await Attendance.findOne({ user: req.user.id, day });
  if (!doc) throw new NotFoundError('No check-in found for that day');
  if (!doc.isCheckedIn) throw new ConflictError('You have not checked in for this day', 'NOT_CHECKED_IN');
  if (doc.isCheckedOut) throw new ConflictError('You are already checked out', 'ALREADY_CHECKED_OUT');

  doc.checkOut = {
    at,
    location: { lat: numberOrNull(location.lat), lng: numberOrNull(location.lng) },
    accuracy: payload.accuracy == null ? null : Number(payload.accuracy),
    address: payload.address || '',
    source: payload.source || 'WEB',
    note: payload.note || '',
  };

  // Straight-line distance walked between check-in and check-out.
  const meters = distanceMeters(doc.checkIn?.location, doc.checkOut?.location);
  if (meters != null) doc.distanceMeters = meters;

  assertCheckoutOrder(doc);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Attendance',
    entityId: doc._id,
    entityLabel: `${req.user.name} ${dayjs(day).format('YYYY-MM-DD')}`,
    before: { isCheckedOut: false },
    after: { isCheckedOut: true, workedMinutes: doc.workedMinutes },
    description: `${req.user.name} checked out (${doc.workedLabel})`,
  });

  const full = await loadDoc(Attendance, doc._id, { populate: POPULATE_ATTENDANCE, label: 'Attendance' });
  return success(res, { message: 'Checked out', data: toPlain(full) });
});

/** Manager correction of an existing day (status + times), with a reason. */
export const updateAttendance = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Attendance, req.params.id, {
    populate: POPULATE_ATTENDANCE,
    filter: activityScope(req, 'user'),
    label: 'Attendance',
  });

  const before = toPlain(doc);
  const payload = { ...req.body };

  if (payload.status) doc.status = payload.status;
  if (payload.checkIn) doc.checkIn = normalizeEvent(payload.checkIn, doc.checkIn);
  if (payload.checkOut) doc.checkOut = normalizeEvent(payload.checkOut, doc.checkOut);
  if (payload.notes !== undefined) doc.notes = payload.notes;

  doc.isManual = true;
  doc.manualReason = payload.manualReason || doc.manualReason || 'Manual correction';
  doc.reviewedBy = req.user.id;
  doc.reviewedAt = new Date();

  assertCheckoutOrder(doc);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Attendance',
    entityId: doc._id,
    entityLabel: `${doc.userName || 'User'} ${dayjs(doc.day).format('YYYY-MM-DD')}`,
    before,
    after: toPlain(doc),
    description: `Attendance corrected: ${doc.manualReason}`,
  });

  const full = await loadDoc(Attendance, doc._id, { populate: POPULATE_ATTENDANCE, label: 'Attendance' });
  return success(res, { message: 'Attendance updated', data: toPlain(full) });
});

/** Manager review/override of a day's status. */
export const reviewAttendance = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Attendance, req.params.id, {
    populate: POPULATE_ATTENDANCE,
    filter: activityScope(req, 'user'),
    label: 'Attendance',
  });

  const before = doc.status;
  if (req.body?.status) doc.status = req.body.status;
  if (req.body?.reviewNote !== undefined) doc.reviewNote = req.body.reviewNote;
  doc.reviewedBy = req.user.id;
  doc.reviewedAt = new Date();
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Attendance',
    entityId: doc._id,
    entityLabel: `${doc.userName || 'User'} ${dayjs(doc.day).format('YYYY-MM-DD')}`,
    before: { status: before },
    after: { status: doc.status },
    description: `Attendance reviewed: ${doc.userName} -> ${doc.status}`,
  });

  const full = await loadDoc(Attendance, doc._id, { populate: POPULATE_ATTENDANCE, label: 'Attendance' });
  return success(res, { message: 'Attendance reviewed', data: toPlain(full) });
});

/** Period summary per user (for the attendance grid + payroll export). */
export const attendanceSummary = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const config = settingsFieldForce(settings);

  const filter = { ...activityScope(req, 'user') };
  if (req.query.dateFrom || req.query.dateTo) {
    filter.day = {};
    if (req.query.dateFrom) filter.day.$gte = startOfDay(new Date(req.query.dateFrom));
    if (req.query.dateTo) filter.day.$lte = startOfDay(new Date(req.query.dateTo));
  }

  const rows = await Attendance.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(req.companyId),
        isDeleted: { $ne: true },
        ...serializeIds(filter),
      },
    },
    {
      $group: {
        _id: '$user',
        userName: { $first: '$userName' },
        days: { $sum: 1 },
        presentDays: {
          $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'HALF_DAY', 'WORK_FROM_HOME']] }, 1, 0] },
        },
        absentDays: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
        leaveDays: { $sum: { $cond: [{ $eq: ['$status', 'LEAVE'] }, 1, 0] } },
        workedMinutes: { $sum: '$workedMinutes' },
        overtimeMinutes: { $sum: '$overtimeMinutes' },
        distanceMeters: { $sum: '$distanceMeters' },
        checkedInDays: { $sum: { $cond: ['$isCheckedIn', 1, 0] } },
      },
    },
    { $sort: { userName: 1 } },
  ]);

  return success(res, {
    data: {
      config,
      totals: rows.reduce(
        (acc, r) => ({
          days: acc.days + r.days,
          presentDays: acc.presentDays + r.presentDays,
          workedMinutes: acc.workedMinutes + r.workedMinutes,
          overtimeMinutes: acc.overtimeMinutes + r.overtimeMinutes,
        }),
        { days: 0, presentDays: 0, workedMinutes: 0, overtimeMinutes: 0 }
      ),
      users: rows.map((r) => ({
        userId: String(r._id),
        userName: r.userName || '',
        days: r.days,
        presentDays: r.presentDays,
        absentDays: r.absentDays,
        leaveDays: r.leaveDays,
        workedMinutes: r.workedMinutes,
        overtimeMinutes: r.overtimeMinutes,
        distanceMeters: round2(r.distanceMeters),
        checkedInDays: r.checkedInDays,
      })),
    },
  });
});

// ===========================================================================
// Visits
// ===========================================================================

export const listVisits = asyncHandler(async (req, res) => {
  const filter = { ...activityScope(req, 'salesman') };
  if (req.query.me === 'true') filter.salesman = req.user.id;
  else if (req.query.salesman) filter.salesman = req.query.salesman;
  if (req.query.customerId) filter.customerId = req.query.customerId;
  if (req.query.route) filter.route = req.query.route;
  if (req.query.outcome) filter.outcome = req.query.outcome;
  if (req.query.purpose) filter.purpose = req.query.purpose;

  const result = await listDocuments(Visit, {
    filter,
    query: req.query,
    searchFields: ['visitNo', 'customerName', 'customerCode', 'salesmanName', 'routeName'],
    filtersSpec: {
      customerId: { type: 'objectId' },
      route: { type: 'objectId' },
      status: { type: 'string' },
      salesman: { type: 'objectId' },
    },
    sortAllowed: ['visitDay', 'createdAt', 'status', 'outcome', 'durationMinutes', 'customerName'],
    defaultSort: '-visitDay',
    dateField: 'visitDay',
    populate: POPULATE_VISIT,
  });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const getVisit = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Visit, req.params.id, {
    populate: POPULATE_VISIT,
    filter: activityScope(req, 'salesman'),
    label: 'Visit',
  });
  return success(res, { data: toPlain(doc) });
});

export const createVisit = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const payload = { ...req.body };

  const customer = await Customer.findById(payload.customerId);
  if (!customer) throw new BadRequestError('Customer not found', 'INVALID_REFERENCE');

  // A rep books visits for themselves; only managers/admins may assign others.
  const salesmanId =
    req.user.role === 'SALESMAN' ? req.user.id : payload.salesman || req.user.id;
  const salesman = await User.findById(salesmanId);
  if (!salesman) throw new BadRequestError('Salesman not found', 'INVALID_REFERENCE');

  let route = refOrNull(payload.route);
  if (!route && customer.route) route = customer.route;
  const routeDoc = route ? await Route.findById(route).lean() : null;

  const visitDay = dateOrNull(payload.visitDay) || startOfDay(new Date());

  const doc = new Visit({
    customerId: customer._id,
    customerName: customer.name || '',
    customerCode: customer.code || '',
    customerPhone: customer.phone || '',
    salesman: salesman._id,
    salesmanName: salesman.name || '',
    route: routeDoc?._id || route || null,
    routeName: routeDoc?.name || '',
    purpose: payload.purpose || 'ORDER',
    visitDay,
    plannedAt: dateOrNull(payload.plannedAt),
    notes: payload.notes || '',
    status: VISIT_STATUS.PLANNED,
    statusHistory: [],
    source: payload.source || 'WEB',
  });

  doc.statusHistory.push({
    status: VISIT_STATUS.PLANNED,
    at: new Date(),
    by: req.user.id,
    byName: req.user.name,
    note: 'Planned',
  });
  doc.visitNo = await nextVisitNumber(req.companyId, settings, visitDay);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'Visit',
    entityId: doc._id,
    entityLabel: doc.visitNo,
    after: toPlain(doc),
    description: `Visit ${doc.visitNo} planned for ${customer.name} by ${salesman.name}`,
  });

  const full = await loadDoc(Visit, doc._id, { populate: POPULATE_VISIT, label: 'Visit' });
  return created(res, { message: 'Visit planned', data: toPlain(full) });
});

export const updateVisit = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Visit, req.params.id, {
    populate: POPULATE_VISIT,
    filter: activityScope(req, 'salesman'),
    label: 'Visit',
  });
  if ([VISIT_STATUS.COMPLETED, VISIT_STATUS.CANCELLED].includes(doc.status)) {
    throw new ConflictError('A completed or cancelled visit cannot be edited', 'VISIT_LOCKED');
  }

  const before = toPlain(doc);
  const payload = { ...req.body };

  if (payload.salesman && req.user.role !== 'SALESMAN') {
    const salesman = await User.findById(payload.salesman);
    if (salesman) {
      doc.salesman = salesman._id;
      doc.salesmanName = salesman.name || '';
    }
  }
  if (payload.route !== undefined) {
    const routeDoc = payload.route ? await Route.findById(payload.route).lean() : null;
    doc.route = routeDoc?._id || null;
    doc.routeName = routeDoc?.name || '';
  }
  if (payload.visitDay !== undefined) doc.visitDay = dateOrNull(payload.visitDay) || doc.visitDay;
  if (payload.plannedAt !== undefined) doc.plannedAt = dateOrNull(payload.plannedAt);
  if (payload.purpose !== undefined) doc.purpose = payload.purpose;
  if (payload.notes !== undefined) doc.notes = payload.notes;
  if (payload.skipReason !== undefined) doc.skipReason = payload.skipReason;

  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Visit',
    entityId: doc._id,
    entityLabel: doc.visitNo,
    before,
    after: toPlain(doc),
    description: `Visit ${doc.visitNo} updated`,
  });

  const full = await loadDoc(Visit, doc._id, { populate: POPULATE_VISIT, label: 'Visit' });
  return success(res, { message: 'Visit updated', data: toPlain(full) });
});

export const removeVisit = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Visit, req.params.id, {
    populate: POPULATE_VISIT,
    filter: activityScope(req, 'salesman'),
    label: 'Visit',
  });
  if (doc.status === VISIT_STATUS.COMPLETED) {
    throw new ConflictError('A completed visit cannot be deleted. Cancel it instead.', 'VISIT_LOCKED');
  }

  const snapshot = toPlain(doc);
  await doc.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'Visit',
    entityId: doc._id,
    entityLabel: doc.visitNo,
    before: snapshot,
    description: `Visit ${doc.visitNo} deleted`,
  });

  return success(res, { message: 'Visit deleted', data: { id: String(doc._id) } });
});

/** Start a visit: capture check-in GPS at the customer's premises. */
export const visitCheckIn = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const config = settingsFieldForce(settings);
  const doc = await loadDoc(Visit, req.params.id, {
    populate: POPULATE_VISIT,
    filter: activityScope(req, 'salesman'),
    label: 'Visit',
  });

  if (![VISIT_STATUS.PLANNED, VISIT_STATUS.IN_PROGRESS].includes(doc.status)) {
    throw new ConflictError('Only planned visits can be started', 'VISIT_NOT_PLANNED');
  }
  if (doc.checkIn?.at) {
    throw new ConflictError('This visit is already checked in', 'ALREADY_CHECKED_IN');
  }

  const payload = { ...req.body };
  const location = payload.location || {};
  if (config.requireGps && (location.lat == null || location.lng == null)) {
    throw new BadRequestError('Location is required to check in', 'GPS_REQUIRED');
  }

  doc.checkIn = {
    at: dateOrNull(payload.at) || new Date(),
    location: { lat: numberOrNull(location.lat), lng: numberOrNull(location.lng) },
    accuracy: payload.accuracy == null ? null : Number(payload.accuracy),
    address: payload.address || '',
    source: payload.source || 'WEB',
  };

  // Distance from the customer's registered address, when it has coordinates.
  const customerGps = doc.customerId?.address?.gps;
  const meters = distanceMeters(doc.checkIn.location, customerGps);
  if (meters != null) doc.distanceMeters = meters;

  doc.status = VISIT_STATUS.IN_PROGRESS;
  doc.statusHistory.push({
    status: VISIT_STATUS.IN_PROGRESS,
    at: new Date(),
    by: req.user.id,
    byName: req.user.name,
    note: 'Checked in',
  });
  await doc.save();

  const full = await loadDoc(Visit, doc._id, { populate: POPULATE_VISIT, label: 'Visit' });
  return success(res, { message: 'Visit started', data: toPlain(full) });
});

/** Finish a visit: check out, record the outcome and link the order/payment. */
export const visitCheckOut = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Visit, req.params.id, {
    populate: POPULATE_VISIT,
    filter: activityScope(req, 'salesman'),
    label: 'Visit',
  });

  if (doc.status !== VISIT_STATUS.IN_PROGRESS) {
    throw new ConflictError('Start the visit before checking out', 'VISIT_NOT_IN_PROGRESS');
  }

  const payload = { ...req.body };
  const location = payload.location || {};
  const outcome = payload.outcome;

  if (!outcome || !VISIT_OUTCOMES.includes(outcome)) {
    throw new BadRequestError('A valid visit outcome is required', 'VALIDATION_ERROR');
  }

  doc.checkOut = {
    at: dateOrNull(payload.at) || new Date(),
    location: { lat: numberOrNull(location.lat), lng: numberOrNull(location.lng) },
    accuracy: payload.accuracy == null ? null : Number(payload.accuracy),
    address: payload.address || '',
    source: payload.source || 'WEB',
  };

  doc.outcome = outcome;
  if (payload.notes !== undefined) doc.notes = payload.notes;
  if (payload.proofUrl !== undefined) doc.proofUrl = payload.proofUrl;

  if (payload.order) {
    const order = await mongoose.model('Order').findById(payload.order).lean();
    if (order) {
      doc.order = order._id;
      doc.orderNo = order.orderNo || '';
      doc.orderValue = Number(order.total || 0);
    }
  }
  if (payload.payment) {
    const payment = await mongoose.model('Payment').findById(payload.payment).lean();
    if (payment) {
      doc.payment = payment._id;
      doc.paymentNo = payment.paymentNo || '';
      doc.collectionAmount = Number(payload.collectionAmount ?? payment.amount ?? 0);
    }
  }

  doc.status = VISIT_STATUS.COMPLETED;
  doc.statusHistory.push({
    status: VISIT_STATUS.COMPLETED,
    at: new Date(),
    by: req.user.id,
    byName: req.user.name,
    note: `Completed: ${outcome}`,
  });
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Visit',
    entityId: doc._id,
    entityLabel: doc.visitNo,
    before: { status: VISIT_STATUS.IN_PROGRESS },
    after: { status: VISIT_STATUS.COMPLETED, outcome },
    description: `Visit ${doc.visitNo} completed (${outcome})`,
  });

  const full = await loadDoc(Visit, doc._id, { populate: POPULATE_VISIT, label: 'Visit' });
  return success(res, { message: 'Visit completed', data: toPlain(full) });
});

/** Mark a planned visit as skipped (customer closed / rep ran out of time). */
export const skipVisit = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Visit, req.params.id, {
    populate: POPULATE_VISIT,
    filter: activityScope(req, 'salesman'),
    label: 'Visit',
  });
  if (doc.status !== VISIT_STATUS.PLANNED) {
    throw new ConflictError('Only planned visits can be skipped', 'VISIT_NOT_PLANNED');
  }

  doc.status = VISIT_STATUS.SKIPPED;
  doc.skipReason = req.body?.reason || doc.skipReason;
  doc.outcome = 'CUSTOMER_UNAVAILABLE';
  doc.statusHistory.push({
    status: VISIT_STATUS.SKIPPED,
    at: new Date(),
    by: req.user.id,
    byName: req.user.name,
    note: doc.skipReason,
  });
  await doc.save();

  const full = await loadDoc(Visit, doc._id, { populate: POPULATE_VISIT, label: 'Visit' });
  return success(res, { message: 'Visit skipped', data: toPlain(full) });
});

export const cancelVisit = asyncHandler(async (req, res) => {
  const doc = await loadDoc(Visit, req.params.id, {
    populate: POPULATE_VISIT,
    filter: activityScope(req, 'salesman'),
    label: 'Visit',
  });
  if ([VISIT_STATUS.COMPLETED, VISIT_STATUS.CANCELLED].includes(doc.status)) {
    throw new ConflictError('This visit cannot be cancelled', 'VISIT_LOCKED');
  }

  doc.status = VISIT_STATUS.CANCELLED;
  doc.skipReason = req.body?.reason || doc.skipReason;
  doc.statusHistory.push({
    status: VISIT_STATUS.CANCELLED,
    at: new Date(),
    by: req.user.id,
    byName: req.user.name,
    note: doc.skipReason,
  });
  await doc.save();

  const full = await loadDoc(Visit, doc._id, { populate: POPULATE_VISIT, label: 'Visit' });
  return success(res, { message: 'Visit cancelled', data: toPlain(full) });
});

/** Visit stats: today's plan vs completed, outcomes, coverage. */
export const visitStats = asyncHandler(async (req, res) => {
  const base = {
    companyId: new mongoose.Types.ObjectId(req.companyId),
    isDeleted: { $ne: true },
    ...aggregateScopeIds(req, 'salesman'),
  };

  const todayStart = startOfDay();
  const todayEnd = dayjs(todayStart).add(1, 'day').toDate();

  const [byStatus, today, byOutcome, month] = await Promise.all([
    Visit.aggregate([{ $match: base }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Visit.aggregate([
      { $match: { ...base, visitDay: { $gte: todayStart, $lt: todayEnd } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Visit.aggregate([
      { $match: { ...base, status: VISIT_STATUS.COMPLETED, outcome: { $ne: '' } } },
      { $group: { _id: '$outcome', count: { $sum: 1 }, value: { $sum: '$orderValue' } } },
    ]),
    Visit.aggregate([
      {
        $match: {
          ...base,
          visitDay: { $gte: dayjs().startOf('month').toDate() },
          status: VISIT_STATUS.COMPLETED,
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          orderValue: { $sum: '$orderValue' },
          collection: { $sum: '$collectionAmount' },
          duration: { $sum: '$durationMinutes' },
        },
      },
    ]),
  ]);

  const countBy = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const statusCounts = countBy(byStatus);
  const todayCounts = countBy(today);
  const outcomeCounts = countBy(byOutcome);
  const outcomeValues = Object.fromEntries(byOutcome.map((r) => [r._id, round2(r.value)]));

  const plannedToday = Object.values(todayCounts).reduce((s, n) => s + n, 0);
  const completedToday = todayCounts[VISIT_STATUS.COMPLETED] || 0;
  const m = month[0] || {};

  return success(res, {
    data: {
      total: Object.values(statusCounts).reduce((s, n) => s + n, 0),
      byStatus: statusCounts,
      today: {
        planned: plannedToday,
        completed: completedToday,
        inProgress: todayCounts[VISIT_STATUS.IN_PROGRESS] || 0,
        skipped: todayCounts[VISIT_STATUS.SKIPPED] || 0,
        byStatus: todayCounts,
      },
      outcomeCounts,
      outcomeValues,
      month: {
        visits: Number(m.count || 0),
        orderValue: round2(m.orderValue),
        collection: round2(m.collection),
        avgDuration: m.count ? Math.round(Number(m.duration || 0) / Number(m.count)) : 0,
      },
    },
  });
});

/** Customers near a GPS point (for "start visit" picking the right stop). */
export const nearbyCustomers = asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new BadRequestError('lat and lng query params are required', 'VALIDATION_ERROR');
  }

  const settings = await settingsOf(req);
  const radius = Number(req.query.radius || settingsFieldForce(settings).geofenceRadiusM);

  // Candidates: active customers with coordinates (nearest first, capped).
  const customers = await Customer.find({
    isActive: { $ne: false },
    'address.gps.lat': { $ne: null },
    'address.gps.lng': { $ne: null },
  })
    .select('name code phone type address route')
    .limit(500)
    .lean();

  const withDistance = customers
    .map((c) => {
      const meters = distanceMeters({ lat, lng }, c.address?.gps);
      return { ...c, id: String(c._id), distanceMeters: meters };
    })
    .filter((c) => c.distanceMeters != null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 50)
    .map((c) => ({
      ...c,
      withinGeofence: withinGeofence({ lat, lng }, c.address?.gps, radius),
    }));

  return success(res, {
    data: { radiusM: radius, customers: withDistance },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const numberOrNull = (v) => (v == null || v === '' ? null : Number(v));

/** Merge an incoming GPS event over an existing one (partial updates). */
const normalizeEvent = (incoming, existing = {}) => ({
  at: dateOrNull(incoming.at) || existing.at || null,
  location: {
    lat: numberOrNull(incoming.location?.lat ?? existing.location?.lat),
    lng: numberOrNull(incoming.location?.lng ?? existing.location?.lng),
  },
  accuracy: incoming.accuracy == null ? (existing.accuracy ?? null) : Number(incoming.accuracy),
  address: incoming.address ?? existing.address ?? '',
  source: incoming.source || existing.source || 'WEB',
  note: incoming.note ?? existing.note ?? '',
});

/** Convert ObjectId-valued filters to ObjectId instances for aggregate(). */
const serializeIds = (filter) => {
  const out = {};
  Object.entries(filter).forEach(([key, value]) => {
    if (value && typeof value === 'object' && value.$in) {
      out[key] = { $in: value.$in.map((v) => new mongoose.Types.ObjectId(String(v))) };
    } else if (value && typeof value === 'object' && !(value instanceof Date)) {
      out[key] = value;
    } else if (value != null) {
      out[key] = new mongoose.Types.ObjectId(String(value));
    }
  });
  return out;
};

/** Same as serializeIds but for the salesman-scope aggregate match. */
const aggregateScopeIds = (req, field) => {
  const role = req.user?.role;
  const oid = (id) => new mongoose.Types.ObjectId(id);
  if (role === 'SALESMAN') return { [field]: oid(req.user.id) };
  if (role === 'MANAGER') {
    return { [field]: { $in: [req.user.id, ...(req.dataScope?.teamIds || [])].map(oid) } };
  }
  return {};
};

export default {
  listAttendance,
  getAttendance,
  myToday,
  checkIn,
  checkOut,
  updateAttendance,
  reviewAttendance,
  attendanceSummary,
  listVisits,
  getVisit,
  createVisit,
  updateVisit,
  removeVisit,
  visitCheckIn,
  visitCheckOut,
  skipVisit,
  cancelVisit,
  visitStats,
  nearbyCustomers,
};
