import dayjs from 'dayjs';
import Attendance from '../models/Attendance.js';
import VanDayClose from '../models/VanDayClose.js';
import Setting from '../models/Setting.js';
import { AppError } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { salesTypeAllows } from '../config/constants.js';
import { startOfDay } from './fieldForceService.js';
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

const fmt = (d) => dayjs(d).format('YYYY-MM-DD');
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
  const today = startOfDay();
  const [attendance, previousOpen, duty] = await Promise.all([
    Attendance.findOne({ user: req.user.id, day: today }).lean(),
    Attendance.findOne({ user: req.user.id, isCheckedIn: true, isCheckedOut: false, day: { $lt: today } }).sort({ day: -1 }).lean(),
    vanDutyOf(req.user),
  ]);

  let cashout = null;
  let unsettled = { missing: [], open: [] };
  if (duty) {
    const day = todayIn(tzOf(req.company));
    const doc = await VanDayClose.findOne({ warehouse: duty.van._id, day }).select('status rejectReason day').lean();
    cashout = { required: true, day, status: doc?.status || 'NONE', rejectReason: doc?.rejectReason || '', van: { id: String(duty.van._id), code: duty.van.code } };
    unsettled = await unsettledVanDays(duty, req.company);
  }

  // What blocks new transactions right now (null = free to work).
  let blocked = null;
  if (required) {
    if (previousOpen) {
      blocked = { code: 'ATTENDANCE_OUT_PENDING', message: `Mark out your attendance for ${fmt(previousOpen.day)} first.`, day: fmt(previousOpen.day) };
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

  return { required, today: fmt(today), attendance, previousOpen, cashout, unsettled, blocked };
};

/**
 * Express gate for a salesman's transactions (orders, invoices, collections,
 * returns, stock requests, shop check-ins). Reads pass; writes need an open day.
 */
export const requireFieldDay = asyncHandler(async (req, _res, next) => {
  if (req.user?.role !== 'SALESMAN' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const state = await fieldDayState(req);
  if (state.blocked) throw fail(state.blocked.message, state.blocked.code, { day: state.blocked.day });
  return next();
});

/** Before marking in: yesterday marked out, earlier van days settled. */
export const assertCanMarkIn = async (req) => {
  const state = await fieldDayState(req);
  if (state.previousOpen) {
    throw fail(`Mark out your attendance for ${fmt(state.previousOpen.day)} first.`, 'ATTENDANCE_OUT_PENDING', { day: fmt(state.previousOpen.day) });
  }
  if (state.blocked?.code === 'DAY_CASHOUT_PENDING') throw fail(state.blocked.message, state.blocked.code, { day: state.blocked.day });
};

/** Before marking out a day: a van salesman's cashout for it must be approved. */
export const assertCanMarkOut = async (req, attendanceDay) => {
  const duty = await vanDutyOf(req.user);
  if (!duty) return;
  const day = fmt(attendanceDay);
  const doc = await VanDayClose.findOne({ warehouse: duty.van._id, day }).select('status').lean();
  if (!doc) throw fail(`Submit your day cashout for ${day} before marking out.`, 'DAY_CASHOUT_REQUIRED', { day });
  if (doc.status === 'SUBMITTED') throw fail(`Your day cashout for ${day} is waiting for manager approval.`, 'DAY_CASHOUT_PENDING', { day });
  if (doc.status === 'REJECTED') throw fail(`Your day cashout for ${day} was rejected - submit it again.`, 'DAY_CASHOUT_PENDING', { day });
};

export default { fieldDayState, requireFieldDay, assertCanMarkIn, assertCanMarkOut, vanDutyOf };
