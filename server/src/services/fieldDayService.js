import Attendance from '../models/Attendance.js';
import VanDayClose from '../models/VanDayClose.js';
import Visit from '../models/Visit.js';
import Invoice from '../models/Invoice.js';
import Order from '../models/Order.js';
import Setting from '../models/Setting.js';
import { AppError } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { blockedBySalesType, salesTypeAllows } from '../config/constants.js';
import { dayKey, dayRange } from './fieldForceService.js';
import { activeVanOf, pendingDays, todayIn, tzOf } from './vanService.js';

/**
 * A field salesman's working day, start to finish:
 *
 *   mark in (attendance)  ->  orders / invoices / collections / van work
 *   -> (van sale) day cashout, approved by a manager  ->  mark out
 *
 * Nothing can be booked before marking in or after marking out. A day left
 * open (not marked out) blocks the next day until it is marked out, and a van
 * salesman cannot mark out - or start the next day - while a day cashout is
 * missing or waiting for approval.
 */

/**
 * Days are counted in the company time zone (as the van cashout does), never
 * the server's: on a UTC server at 01:00 IST it is already the new day here.
 */
const fmt = (d, tz) => dayKey(d, tz);
const fail = (message, code, details) => new AppError(message, { status: 409, code, details });

/** The van a salesman sells from, when their sales type includes van sale. */
export const vanDutyOf = async (user) => {
  if (user.role !== 'SALESMAN' && user.role !== 'MANAGER') return null;
  if (user.role === 'SALESMAN' && !salesTypeAllows(user.salesType || 'BOTH', 'VAN_SALE')) return null;
  return activeVanOf(user.id);
};

/** Earlier van days that are not settled: never cashed out, or not approved yet. */
const unsettledVanDays = async (duty, company) => {
  const tz = tzOf(company);
  const today = todayIn(tz);
  const [missing, open] = await Promise.all([
    pendingDays(duty.van, duty.spell, tz),
    VanDayClose.find({ warehouse: duty.van._id, day: { $lt: today }, status: { $in: ['SUBMITTED', 'REJECTED'] } })
      .select('day status')
      .lean(),
  ]);
  return { missing, open };
};

/** Full picture of the day for the attendance screen and the gate. */
export const fieldDayState = async (req) => {
  const settings = req.settings || (await Setting.forCompany(req.companyId));
  const required = settings?.fieldForce?.requireAttendance !== false;
  const tz = tzOf(req.company);
  const { start: today, end } = dayRange(new Date(), tz);
  const [attendance, previousOpen, duty] = await Promise.all([
    Attendance.findOne({ user: req.user.id, day: { $gte: today, $lt: end } }).lean(),
    Attendance.findOne({ user: req.user.id, isCheckedIn: true, isCheckedOut: false, day: { $lt: today } }).sort({ day: -1 }).lean(),
    vanDutyOf(req.user),
  ]);

  let cashout = null;
  let unsettled = { missing: [], open: [] };
  if (duty) {
    const day = todayIn(tz);
    const doc = await VanDayClose.findOne({ warehouse: duty.van._id, day }).select('status rejectReason day').lean();
    cashout = { required: true, day, status: doc?.status || 'NONE', rejectReason: doc?.rejectReason || '', van: { id: String(duty.van._id), code: duty.van.code } };
    unsettled = await unsettledVanDays(duty, req.company);
  }

  // What blocks new transactions right now (null = free to work).
  let blocked = null;
  if (required) {
    if (previousOpen) {
      blocked = { code: 'ATTENDANCE_OUT_PENDING', message: `Mark out your attendance for ${fmt(previousOpen.day, tz)} first.`, day: fmt(previousOpen.day, tz) };
    } else if (unsettled.open.length) {
      const d = unsettled.open[0];
      blocked = {
        code: 'DAY_CASHOUT_PENDING',
        message: d.status === 'REJECTED' ? `Your day cashout for ${d.day} was rejected - submit it again.` : `Your day cashout for ${d.day} is waiting for manager approval.`,
        day: d.day,
      };
    } else if (unsettled.missing.length) {
      blocked = { code: 'DAY_CASHOUT_PENDING', message: `Submit the day cashout for ${unsettled.missing[0]} first.`, day: unsettled.missing[0] };
    } else if (!attendance?.isCheckedIn) {
      blocked = { code: 'ATTENDANCE_REQUIRED', message: 'Mark your attendance in to start the day.' };
    } else if (attendance.isCheckedOut) {
      blocked = { code: 'DAY_ENDED', message: 'Your day is marked out. New work starts tomorrow.' };
    }
  }

  return { required, tz, today: fmt(today, tz), attendance, previousOpen, cashout, unsettled, blocked };
};

/**
 * Express gate for a salesman's transactions (orders, invoices, collections,
 * returns, stock requests, shop check-ins). Reads pass; writes need an open day.
 */
export const requireFieldDay = asyncHandler(async (req, _res, next) => {
  if (req.user?.role !== 'SALESMAN' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Closing a shop visit is never blocked: a visit left open has to be
  // checked out before the day can be marked out.
  if (req.baseUrl.endsWith('/field-force/visits') && /^\/[^/]+\/check-out\/?$/.test(req.path)) return next();
  const state = await fieldDayState(req);
  if (state.blocked) throw fail(state.blocked.message, state.blocked.code, { day: state.blocked.day });
  return next();
});

/**
 * A salesman sells only inside a shop visit: creating an order, invoice,
 * collection or return needs an open check-in, at that same customer.
 * (Applies with the field day flow on; companies can switch it off.)
 */
export const requireVisitForSale = asyncHandler(async (req, _res, next) => {
  if (req.user?.role !== 'SALESMAN') return next();
  // Not their channel at all (e.g. a van seller booking an order): the
  // permission check answers that, not "check in first".
  const perm = { '/orders': 'orders.create', '/invoices': 'invoices.create', '/credit-notes': 'creditnotes.create' }[req.path.replace(/\/$/, '')];
  if (perm && blockedBySalesType(req.user, perm)) return next();
  const settings = req.settings || (await Setting.forCompany(req.companyId));
  if (settings?.fieldForce?.requireAttendance === false || settings?.fieldForce?.saleOnlyInVisit === false) return next();
  const visit = await Visit.findOne({ salesman: req.user.id, status: 'IN_PROGRESS' }).select('customerId customerName').lean();
  if (!visit) {
    throw fail('Check in at the shop from Sales visit first - orders, invoices, collections and returns are booked during the visit.', 'VISIT_REQUIRED');
  }
  // The shop being sold to: given directly, or through the invoice / order.
  let customerId = req.body?.customerId || req.body?.customer;
  if (!customerId && req.body?.invoiceId) customerId = (await Invoice.findById(req.body.invoiceId).select('customerId').lean().catch(() => null))?.customerId;
  const firstOrder = req.body?.orderId || req.body?.orderIds?.[0];
  if (!customerId && firstOrder) customerId = (await Order.findById(firstOrder).select('customerId').lean().catch(() => null))?.customerId;
  if (customerId && String(customerId) !== String(visit.customerId)) {
    throw fail(`You are checked in at ${visit.customerName} - book for that shop, or check out first.`, 'VISIT_CUSTOMER_MISMATCH', {
      customerName: visit.customerName,
    });
  }
  return next();
});

/** Before marking in: yesterday marked out, earlier van days settled. */
export const assertCanMarkIn = async (req) => {
  const state = await fieldDayState(req);
  if (state.previousOpen) {
    const day = fmt(state.previousOpen.day, state.tz);
    throw fail(`Mark out your attendance for ${day} first.`, 'ATTENDANCE_OUT_PENDING', { day });
  }
  if (state.blocked?.code === 'DAY_CASHOUT_PENDING') throw fail(state.blocked.message, state.blocked.code, { day: state.blocked.day });
};

/**
 * Before marking out a day: no shop left checked in, and a van salesman's
 * cashout for the day must be approved.
 */
export const assertCanMarkOut = async (req, attendanceDay) => {
  const openVisit = await Visit.findOne({ salesman: req.user.id, status: 'IN_PROGRESS' }).select('customerName').lean();
  if (openVisit) {
    throw fail(`Check out of ${openVisit.customerName} (Sales visit) before marking out.`, 'VISIT_IN_PROGRESS', { customerName: openVisit.customerName });
  }
  const duty = await vanDutyOf(req.user);
  if (!duty) return;
  const day = fmt(attendanceDay, tzOf(req.company));
  const doc = await VanDayClose.findOne({ warehouse: duty.van._id, day }).select('status').lean();
  if (!doc) throw fail(`Submit your day cashout for ${day} before marking out.`, 'DAY_CASHOUT_REQUIRED', { day });
  if (doc.status === 'SUBMITTED') throw fail(`Your day cashout for ${day} is waiting for manager approval.`, 'DAY_CASHOUT_PENDING', { day });
  if (doc.status === 'REJECTED') throw fail(`Your day cashout for ${day} was rejected - submit it again.`, 'DAY_CASHOUT_PENDING', { day });
};

export default { fieldDayState, requireFieldDay, requireVisitForSale, assertCanMarkIn, assertCanMarkOut, vanDutyOf };
