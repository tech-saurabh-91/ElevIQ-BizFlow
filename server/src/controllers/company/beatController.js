import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import BeatPlan from '../../models/BeatPlan.js';
import Route from '../../models/Route.js';
import Customer from '../../models/Customer.js';
import User from '../../models/User.js';
import Visit from '../../models/Visit.js';
import Setting from '../../models/Setting.js';
import { success, created } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, VISIT_STATUS } from '../../config/constants.js';
import { toPlain } from './_helpers.js';
import { distanceMeters, nextVisitNumber, assertCanStartVisit, markGeofence } from '../../services/fieldForceService.js';
import { tzOf, todayIn, dayBounds } from '../../services/vanService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Beat planning: which salesman works which route on which day, and the
 * salesman's day - routes for today, their customers, check-in at a customer.
 *
 * A route's standing plan is Route.assignedTo + beatDays (e.g. Mon/Thu); a
 * BeatPlan row overrides it for one day (cover for leave, extra beat...).
 */

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const weekdayOf = (day) => WEEKDAYS[dayjs(`${day}T12:00:00Z`).utc().day()];

const routeOut = (r, customers = 0) => ({
  id: String(r._id),
  name: r.name,
  code: r.code,
  territory: r.territory || '',
  assignedTo: r.assignedTo ? String(r.assignedTo._id || r.assignedTo) : null,
  assignedToName: r.assignedTo?.name || '',
  beatDays: r.beatDays || [],
  customers,
});

const customerCounts = async () => {
  const rows = await Customer.find({ isActive: true, route: { $ne: null } }).select('route').lean();
  const counts = {};
  rows.forEach((c) => {
    counts[String(c.route)] = (counts[String(c.route)] || 0) + 1;
  });
  return counts;
};

/**
 * Who works each route on each day of [from, to]: the day's BeatPlan if any,
 * else the route's standing weekday plan.
 */
const resolvePlans = async (from, to) => {
  const [routes, plans] = await Promise.all([
    Route.find({ isActive: { $ne: false } }).populate('assignedTo', 'name').sort({ sequence: 1, name: 1 }).lean(),
    BeatPlan.find({ day: { $gte: from, $lte: to } }).populate('salesman', 'name').lean(),
  ]);
  const days = [];
  for (let d = dayjs(from); !d.isAfter(dayjs(to)); d = d.add(1, 'day')) days.push(d.format('YYYY-MM-DD'));
  const explicit = new Map(plans.map((p) => [`${p.route}|${p.day}`, p]));
  const cells = [];
  routes.forEach((r) =>
    days.forEach((day) => {
      const plan = explicit.get(`${r._id}|${day}`);
      if (plan) {
        cells.push({ route: String(r._id), day, salesman: String(plan.salesman._id), salesmanName: plan.salesman.name, source: 'PLAN', planId: String(plan._id) });
      } else if (r.assignedTo && (r.beatDays || []).includes(weekdayOf(day))) {
        cells.push({ route: String(r._id), day, salesman: String(r.assignedTo._id), salesmanName: r.assignedTo.name, source: 'WEEKLY' });
      }
    })
  );
  return { routes, days, cells };
};

/** GET /beat-plans?from=&to= - the planning grid (max 31 days). */
export const grid = asyncHandler(async (req, res) => {
  const tz = tzOf(req.company);
  const from = DAY.test(req.query.from || '') ? req.query.from : todayIn(tz);
  const to = DAY.test(req.query.to || '') ? req.query.to : dayjs(from).add(6, 'day').format('YYYY-MM-DD');
  if (dayjs(to).diff(dayjs(from), 'day') > 31 || to < from) throw new BadRequestError('Choose up to 31 days', 'VALIDATION_ERROR');
  const { routes, days, cells } = await resolvePlans(from, to);
  const counts = await customerCounts();
  return success(res, { data: { days, routes: routes.map((r) => routeOut(r, counts[String(r._id)] || 0)), cells } });
});

/**
 * PUT /beat-plans { route, salesman, days[] } - plan a route for days.
 * `salesman: null` removes the day plans (back to the weekly plan).
 */
export const setPlan = asyncHandler(async (req, res) => {
  const route = await Route.findById(req.body.route).lean();
  if (!route) throw new BadRequestError('Route not found', 'INVALID_REFERENCE');
  const days = [...new Set(req.body.days || [])];
  const tz = tzOf(req.company);
  if (days.some((d) => d < todayIn(tz))) throw new BadRequestError('Past days cannot be planned', 'INVALID_DATE');

  if (!req.body.salesman) {
    await BeatPlan.softDeleteMany({ route: route._id, day: { $in: days } });
    return success(res, { message: 'Back to the weekly plan', data: { days } });
  }
  const salesman = await User.findOne({ _id: req.body.salesman, isActive: true }).lean();
  if (!salesman) throw new BadRequestError('Salesman not found or inactive', 'INVALID_REFERENCE');
  if (!['SALESMAN', 'MANAGER'].includes(salesman.role)) throw new BadRequestError('Routes are planned for salesmen or managers', 'INVALID_ROLE');

  for (const day of days) {
    const existing = await BeatPlan.findOne({ route: route._id, day });
    if (existing) {
      existing.salesman = salesman._id;
      existing.notes = req.body.notes || existing.notes;
      await existing.save();
    } else {
      await BeatPlan.create({ route: route._id, salesman: salesman._id, day, notes: req.body.notes || '' });
    }
  }
  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'BeatPlan',
    entityLabel: route.name,
    description: `Route ${route.name} planned for ${salesman.name} on ${days.join(', ')}`,
  });
  return success(res, { message: 'Beat plan saved', data: { days } });
});

/** Visits of a salesman on a day, keyed by customer. */
const visitsOn = async (salesmanId, day, tz) => {
  const { start, end } = dayBounds(day, tz);
  const visits = await Visit.find({ salesman: salesmanId, visitDay: { $gte: start, $lt: end } }).sort({ createdAt: -1 }).lean();
  const byCustomer = new Map();
  visits.forEach((v) => {
    if (!byCustomer.has(String(v.customerId))) byCustomer.set(String(v.customerId), v);
  });
  return byCustomer;
};

const visitOut = (v) =>
  v && {
    id: String(v._id),
    visitNo: v.visitNo,
    status: v.status,
    outcome: v.outcome || '',
    checkInAt: v.checkIn?.at || null,
    checkOutAt: v.checkOut?.at || null,
    orderNo: v.orderNo || '',
    invoiceNo: v.invoiceNo || '',
    noOrderReason: v.noOrderReason || '',
    outsideGeofence: Boolean(v.outsideGeofence),
    checkInDistanceM: v.checkInDistanceM ?? null,
  };

const customerOut = (c, visits) => ({
  id: String(c._id),
  name: c.name,
  code: c.code,
  phone: c.phone || '',
  address: [c.address?.line1, c.address?.city].filter(Boolean).join(', '),
  hasLocation: c.address?.gps?.lat != null && c.address?.gps?.lng != null,
  outstanding: Number(c.outstanding || 0),
  route: c.route ? String(c.route) : null,
  visit: visitOut(visits.get(String(c._id))) || null,
});

/**
 * GET /beat-plans/mine?date= - the routes a salesman works: routes given to
 * them (user master or route owner) and today's beat plan, today's first.
 * Customers come from /beat-plans/customers.
 */
export const mine = asyncHandler(async (req, res) => {
  const tz = tzOf(req.company);
  const day = DAY.test(req.query.date || '') ? req.query.date : todayIn(tz);
  const me = String(req.user.id);
  const [{ routes, cells }, user] = await Promise.all([resolvePlans(day, day), User.findById(me).select('routes').lean()]);
  const todayIds = new Set(cells.filter((c) => c.salesman === me).map((c) => c.route));
  const given = new Set((user?.routes || []).map(String));
  const counts = await customerCounts();
  const mineRoutes = routes
    .filter((r) => todayIds.has(String(r._id)) || given.has(String(r._id)) || String(r.assignedTo?._id || r.assignedTo || '') === me)
    .map((r) => ({ ...routeOut(r, counts[String(r._id)] || 0), today: todayIds.has(String(r._id)) }))
    .sort((a, b) => Number(b.today) - Number(a.today) || a.name.localeCompare(b.name));

  const visits = await visitsOn(req.user.id, day, tz);
  // The shop still open - from any day, so a visit left open yesterday shows
  // up here to be checked out (check-in elsewhere is refused until then).
  const open = await Visit.findOne({ salesman: req.user.id, status: VISIT_STATUS.IN_PROGRESS }).sort({ 'checkIn.at': -1 }).lean();
  let openVisit = visitOut(open) || null;
  if (open) {
    const openDay = open.visitDay ? dayjs(open.visitDay).tz(tz).format('YYYY-MM-DD') : day;
    openVisit = {
      ...openVisit,
      customerId: String(open.customerId),
      customerName: open.customerName,
      routeId: open.route ? String(open.route) : null,
      day: openDay,
      earlierDay: openDay < day,
    };
  }
  const done = [...visits.values()].filter((v) => v.status === VISIT_STATUS.COMPLETED).length;
  return success(res, { data: { day, routes: mineRoutes, openVisit, visitsDone: done } });
});

/**
 * GET /beat-plans/customers?route=<id>|none&q= - customers to visit: one
 * route's customers, or every active customer ("No route"), with today's visit.
 */
export const customers = asyncHandler(async (req, res) => {
  const tz = tzOf(req.company);
  const day = todayIn(tz);
  const filter = { isActive: true };
  if (req.query.route && req.query.route !== 'none') filter.route = req.query.route;
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { code: rx }, { phone: rx }];
  }
  const [rows, visits] = await Promise.all([
    Customer.find(filter).select('name code phone address.line1 address.city address.gps outstanding route').sort({ name: 1 }).limit(300).lean(),
    visitsOn(req.user.id, day, tz),
  ]);
  return success(res, { data: rows.map((c) => customerOut(c, visits)) });
});

/**
 * POST /beat-plans/check-in { customerId, route, location } - start a visit
 * at a customer of my route (planned visit reused, else created). One open
 * visit at a time: check out of the last shop first.
 */
export const checkIn = asyncHandler(async (req, res) => {
  const tz = tzOf(req.company);
  const day = todayIn(tz);
  const { start, end } = dayBounds(day, tz);
  const customer = await Customer.findById(req.body.customerId).lean();
  if (!customer) throw new NotFoundError('Customer not found');

  const settings = await Setting.forCompany(req.companyId);
  await assertCanStartVisit(req.user.id, settings);
  const location = req.body.location || {};
  if (settings?.fieldForce?.requireGps !== false && (location.lat == null || location.lng == null)) {
    throw new BadRequestError('Location is required to check in', 'GPS_REQUIRED');
  }

  let visit = await Visit.findOne({
    salesman: req.user.id,
    customerId: customer._id,
    visitDay: { $gte: start, $lt: end },
    status: VISIT_STATUS.PLANNED,
  });
  const route = req.body.route ? await Route.findById(req.body.route).lean() : null;
  if (!visit) {
    visit = new Visit({
      customerId: customer._id,
      customerName: customer.name || '',
      customerCode: customer.code || '',
      customerPhone: customer.phone || '',
      salesman: req.user.id,
      salesmanName: req.user.name,
      route: route?._id || customer.route || null,
      routeName: route?.name || '',
      purpose: 'ORDER',
      visitDay: start,
      status: VISIT_STATUS.PLANNED,
      statusHistory: [{ status: VISIT_STATUS.PLANNED, at: new Date(), by: req.user.id, byName: req.user.name, note: 'From beat' }],
      source: 'WEB',
    });
    visit.visitNo = await nextVisitNumber(req.companyId, settings, start);
  }
  const at = new Date();
  visit.checkIn = {
    at,
    location: { lat: location.lat == null ? null : Number(location.lat), lng: location.lng == null ? null : Number(location.lng) },
    accuracy: req.body.accuracy == null ? null : Number(req.body.accuracy),
    address: req.body.address || '',
    source: 'WEB',
  };
  const meters = distanceMeters(visit.checkIn.location, customer.address?.gps);
  if (meters != null) visit.distanceMeters = meters;
  markGeofence(visit, customer.address?.gps, settings);
  visit.status = VISIT_STATUS.IN_PROGRESS;
  visit.statusHistory.push({ status: VISIT_STATUS.IN_PROGRESS, at, by: req.user.id, byName: req.user.name, note: 'Checked in' });
  await visit.save();
  return created(res, { message: `Checked in at ${customer.name}`, data: toPlain(visit) });
});

export default { grid, setPlan, mine, customers, checkIn };
