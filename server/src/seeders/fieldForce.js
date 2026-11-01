import dayjs from 'dayjs';
import { runWithContext } from '../middlewares/tenantContext.js';
import logger from '../utils/logger.js';

import Customer from '../models/Customer.js';
import Route from '../models/Route.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Attendance from '../models/Attendance.js';
import Visit from '../models/Visit.js';
import Expense from '../models/Expense.js';
import Target from '../models/Target.js';
import Setting from '../models/Setting.js';

import {
  ATTENDANCE_STATUS,
  VISIT_STATUS,
  EXPENSE_STATUS,
  TARGET_STATUS,
} from '../config/constants.js';
import {
  nextVisitNumber,
  nextExpenseNumber,
  distanceMeters,
  startOfDay,
  refreshTargetAchievements,
} from '../services/fieldForceService.js';

/**
 * Phase 7 demo field force.
 *
 * Builds a believable week of territory activity for the two seeded salesmen:
 *
 *   1. attendance days - GPS check-in/out, one leave, one half day, a week-off
 *      row and an open "checked in today" record so the check-out button is
 *      live in the workspace,
 *   2. visits - completed stops with real outcomes (linked to the seeded
 *      orders / payments where one exists), a skipped stop, an in-progress
 *      stop and a planned stop for today,
 *   3. expense claims across the whole DRAFT -> SUBMITTED -> APPROVED -> PAID
 *      workflow (plus a rejection),
 *   4. monthly sales targets whose achievements are refreshed from the orders
 *      the reps actually booked.
 *
 * Safe to re-run: each block is skipped when its collection already holds
 * rows for the tenant.
 */

// Rough territory anchors (Pune).
const BEAT = [
  { start: { lat: 18.5362, lng: 73.9467 }, end: { lat: 18.5642, lng: 73.9105 }, area: 'Kharadi', endArea: 'Viman Nagar' },
  { start: { lat: 18.5074, lng: 73.8077 }, end: { lat: 18.559, lng: 73.7868 }, area: 'Kothrud', endArea: 'Baner' },
];

const isSunday = (d) => dayjs(d).day() === 0;

const gpsEvent = (at, location, source, address, accuracy = 12) => ({
  at,
  location,
  accuracy,
  address,
  source,
  note: '',
});

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

const seedAttendance = async ({ users }) => {
  const existing = await Attendance.countDocuments({});
  if (existing > 0) {
    logger.info(`Attendance already seeded (${existing} days found).`);
    return;
  }

  const manager = users.find((u) => u.role === 'MANAGER') || null;
  const salesmen = users.filter((u) => u.role === 'SALESMAN');
  if (!salesmen.length) {
    logger.warn('Skipping attendance seed: no salesmen found.');
    return;
  }

  let created = 0;

  // Six calendar days back -> yesterday.
  for (let back = 6; back >= 1; back -= 1) {
    const day = startOfDay(dayjs().subtract(back, 'day').toDate());

    for (const [idx, rep] of salesmen.entries()) {
      const beat = BEAT[idx % BEAT.length];

      if (isSunday(day)) {
         
        await Attendance.create({
          user: rep._id,
          userName: rep.name,
          userRole: rep.role,
          day,
          status: ATTENDANCE_STATUS.WEEK_OFF,
          notes: 'Weekly off as per roster',
          source: 'MANUAL',
          reviewedBy: manager?._id || null,
          reviewedAt: day,
          reviewNote: 'Weekly off as per roster',
        });
        created += 1;
         
        continue;
      }

      // Sneha takes a leave two days back, Amit a half day three days back.
      const isLeave = idx === 1 && back === 2;
      const isHalf = idx === 0 && back === 3;

      if (isLeave) {
         
        await Attendance.create({
          user: rep._id,
          userName: rep.name,
          userRole: rep.role,
          day,
          status: ATTENDANCE_STATUS.LEAVE,
          notes: 'Casual leave (approved)',
          source: 'MANUAL',
          reviewedBy: manager?._id || null,
          reviewedAt: dayjs(day).hour(9).minute(40).toDate(),
          reviewNote: 'Approved casual leave',
        });
        created += 1;
         
        continue;
      }

      const inAt = dayjs(day).hour(9).minute(5 + idx * 10).toDate();
      const outAt = isHalf
        ? dayjs(day).hour(14).minute(0).toDate()
        : dayjs(day).hour(18).minute(10 + idx * 15).toDate();

      const doc = new Attendance({
        user: rep._id,
        userName: rep.name,
        userRole: rep.role,
        day,
        status: isHalf ? ATTENDANCE_STATUS.HALF_DAY : ATTENDANCE_STATUS.PRESENT,
        checkIn: gpsEvent(inAt, beat.start, 'MOBILE', beat.area, 8 + idx),
        checkOut: gpsEvent(outAt, beat.end, 'MOBILE', beat.endArea, 10),
        source: 'MOBILE',
        notes: isHalf ? 'Left early for a family function' : 'Regular beat day',
      });

      if (isHalf) {
        doc.isManual = true;
        doc.manualReason = 'Left early for a family function';
        doc.reviewedBy = manager?._id || null;
        doc.reviewedAt = dayjs(day).hour(19).toDate();
        doc.reviewNote = 'Half day approved by manager';
      }

      const meters = distanceMeters(doc.checkIn.location, doc.checkOut.location);
      if (meters != null) doc.distanceMeters = meters;

       
      await doc.save();
      created += 1;
    }
  }

  // Today: the first rep is out on the beat right now (open, no check-out yet)
  // so the workspace shows a live "Check out" state. Check in 45 minutes ago so
  // the record is open no matter what time of day the seeder runs.
  const today = startOfDay(new Date());
  const todayIn = dayjs().subtract(45, 'minute').toDate();
  if (!isSunday(today) && todayIn >= today) {
    const rep = salesmen[0];
    await Attendance.create({
      user: rep._id,
      userName: rep.name,
      userRole: rep.role,
      day: today,
      status: ATTENDANCE_STATUS.PRESENT,
      checkIn: gpsEvent(todayIn, BEAT[0].start, 'MOBILE', BEAT[0].area, 9),
      source: 'MOBILE',
      notes: 'Beat in progress',
    });
    created += 1;
  }

  logger.info(`Seeded ${created} attendance days.`);
};

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

const seedVisits = async ({ company, users, settings }) => {
  const existing = await Visit.countDocuments({});
  if (existing > 0) {
    logger.info(`Visits already seeded (${existing} found).`);
    return;
  }

  const salesmen = users.filter((u) => u.role === 'SALESMAN');
  if (!salesmen.length) {
    logger.warn('Skipping visit seed: no salesmen found.');
    return;
  }

  const customers = await Customer.find({ isActive: { $ne: false } }).sort({ code: 1 }).lean();
  const routes = await Route.find({ isActive: { $ne: false } }).lean();
  if (!customers.length) {
    logger.warn('Skipping visit seed: no customers found.');
    return;
  }

  let created = 0;

  for (const [idx, rep] of salesmen.entries()) {
    const beat = BEAT[idx % BEAT.length];
    const mine = customers.filter((c) => String(c.assignedTo || '') === String(rep._id));
    const pool = mine.length >= 3 ? mine : customers;
    const route = routes.find((r) => String(r.assignedTo || '') === String(rep._id)) || routes[idx] || null;

    // Real bookings this rep made, so ORDER_TAKEN visits link to a real order.
    const orders = await Order.find({
      salesman: rep._id,
      status: { $in: ['CONFIRMED', 'PARTIALLY_INVOICED', 'FULLY_INVOICED', 'DISPATCHED', 'DELIVERED'] },
    })
      .sort({ orderDate: -1 })
      .limit(5)
      .lean();
    const payments = await Payment.find({ status: 'RECEIVED', collectedBy: rep._id })
      .sort({ paymentDate: -1 })
      .limit(5)
      .lean();
    const anyPayments = payments.length
      ? payments
      : await Payment.find({ status: 'RECEIVED' }).sort({ paymentDate: -1 }).limit(5).lean();

    const addVisit = async ({
      customer,
      daysAgo,
      hour,
      status,
      outcome = '',
      purpose = 'ORDER',
      order = null,
      payment = null,
      stayMinutes = 25,
      skipReason = '',
      notes = '',
      at = null,
    }) => {
      const day = startOfDay(dayjs().subtract(daysAgo, 'day').toDate());
      const plannedAt = dayjs(day).hour(hour).minute(0).toDate();
      const inAt = at || dayjs(day).hour(hour).minute(10 + idx * 5).toDate();
      const outAt = dayjs(inAt).add(stayMinutes, 'minute').toDate();
      const completed = status === VISIT_STATUS.COMPLETED;
      const started = completed || status === VISIT_STATUS.IN_PROGRESS;

      const visit = new Visit({
        visitNo: await nextVisitNumber(company._id, settings, day),
        visitDay: day,
        plannedAt,
        customerId: customer._id,
        customerName: customer.name || '',
        customerCode: customer.code || '',
        customerPhone: customer.phone || '',
        salesman: rep._id,
        salesmanName: rep.name || '',
        route: route?._id || customer.route || null,
        routeName: route?.name || '',
        purpose,
        status,
        skipReason,
        notes,
        source: 'MOBILE',
        statusHistory: [
          {
            status: VISIT_STATUS.PLANNED,
            at: dayjs(day).hour(8).minute(30).toDate(),
            by: rep._id,
            byName: rep.name,
            note: 'Planned on the beat chart',
          },
        ],
      });

      if (started) {
        visit.checkIn = gpsEvent(inAt, beat.start, 'MOBILE', customer.address?.line1 || beat.area, 9);
        visit.statusHistory.push({
          status: VISIT_STATUS.IN_PROGRESS,
          at: inAt,
          by: rep._id,
          byName: rep.name,
          note: 'Checked in at the premises',
        });
      }

      if (completed) {
        visit.checkOut = gpsEvent(outAt, beat.start, 'MOBILE', customer.address?.line1 || beat.area, 11);
        visit.outcome = outcome;
        visit.statusHistory.push({
          status: VISIT_STATUS.COMPLETED,
          at: outAt,
          by: rep._id,
          byName: rep.name,
          note: `Outcome: ${outcome}`,
        });
        if (order) {
          visit.order = order._id;
          visit.orderNo = order.orderNo || '';
          visit.orderValue = Number(order.total || 0);
        }
        if (payment) {
          visit.payment = payment._id;
          visit.paymentNo = payment.paymentNo || '';
          visit.collectionAmount = Number(payment.amount || 0);
        }
      }

      if (status === VISIT_STATUS.SKIPPED) {
        visit.outcome = 'CUSTOMER_UNAVAILABLE';
        visit.statusHistory.push({
          status: VISIT_STATUS.SKIPPED,
          at: inAt,
          by: rep._id,
          byName: rep.name,
          note: skipReason || 'Customer unavailable',
        });
      }

      const meters = distanceMeters(visit.checkIn?.location, visit.checkOut?.location);
      if (meters != null) visit.distanceMeters = meters;

      await visit.save();
      created += 1;
      return visit;
    };

    const first = pool[0];
    const second = pool[1] || pool[0];
    const third = pool[2] || pool[0];

    // Yesterday: an order taken on the beat.
    if (orders[0]) {
      await addVisit({
        customer: first,
        daysAgo: 1,
        hour: 10,
        status: VISIT_STATUS.COMPLETED,
        outcome: 'ORDER_TAKEN',
        order: orders[0],
        stayMinutes: 35,
        notes: 'Pushed the new SKU range; repeat order expected next week.',
      });
    } else {
      await addVisit({
        customer: first,
        daysAgo: 1,
        hour: 10,
        status: VISIT_STATUS.COMPLETED,
        outcome: 'NO_ORDER',
        stayMinutes: 20,
        notes: 'Stock still running; will reorder after the weekend.',
      });
    }

    // Two days back: a collection stop.
    await addVisit({
      customer: second,
      daysAgo: 2,
      hour: 12,
      purpose: anyPayments.length ? 'COLLECTION' : 'RELATIONSHIP',
      status: VISIT_STATUS.COMPLETED,
      outcome: anyPayments.length ? 'PAYMENT_COLLECTED' : 'CLOSED',
      payment: anyPayments[idx % anyPayments.length] || null,
      stayMinutes: 15,
      notes: 'Collected the outstanding against last month’s bills.',
    });

    // Three days back: the stop could not be covered.
    await addVisit({
      customer: third,
      daysAgo: 3,
      hour: 11,
      status: VISIT_STATUS.SKIPPED,
      skipReason: 'Shutter down for a family function',
      notes: 'Will revisit on the next beat day.',
    });

    // Four days back: another booking (when a second order exists).
    if (orders[1]) {
      await addVisit({
        customer: second,
        daysAgo: 4,
        hour: 15,
        status: VISIT_STATUS.COMPLETED,
        outcome: 'ORDER_TAKEN',
        order: orders[1],
        stayMinutes: 30,
      });
    }

    // Five days back: a complaint handled on site.
    await addVisit({
      customer: first,
      daysAgo: 5,
      hour: 16,
      purpose: 'COMPLAINT',
      status: VISIT_STATUS.COMPLETED,
      outcome: 'NO_ORDER',
      stayMinutes: 25,
      notes: 'Resolved a short-delivery complaint; credit note requested.',
    });

    // Today: one stop in progress right now, one still planned for the evening.
    const today = startOfDay(new Date());
    if (!isSunday(today)) {
      await addVisit({
        customer: third,
        daysAgo: 0,
        hour: 10,
        status: VISIT_STATUS.IN_PROGRESS,
        at: new Date(),
        notes: 'On site now - discussing the festive scheme.',
      });
      await addVisit({
        customer: second,
        daysAgo: 0,
        hour: 16,
        status: VISIT_STATUS.PLANNED,
        notes: 'Evening stop for the collection follow-up.',
      });
    }
  }

  logger.info(`Seeded ${created} visits.`);
};

// ---------------------------------------------------------------------------
// Expense claims
// ---------------------------------------------------------------------------

const seedExpenses = async ({ company, users, settings }) => {
  const existing = await Expense.countDocuments({});
  if (existing > 0) {
    logger.info(`Expense claims already seeded (${existing} found).`);
    return;
  }

  const admin = users.find((u) => u.role === 'COMPANY_ADMIN') || null;
  const manager = users.find((u) => u.role === 'MANAGER') || null;
  const accountant = users.find((u) => u.role === 'ACCOUNTANT') || null;
  const salesmen = users.filter((u) => u.role === 'SALESMAN');
  if (!salesmen.length) {
    logger.warn('Skipping expense seed: no salesmen found.');
    return;
  }

  const approver = manager || admin;
  let created = 0;

  const addClaim = async ({
    rep,
    category,
    amount,
    description,
    daysAgo,
    finalStatus,
    approvedAmount = null,
    paymentMode = '',
    paymentReference = '',
    rejectionReason = '',
    fromPlace = '',
    toPlace = '',
    distanceKm = 0,
    hasReceipt = true,
    notes = '',
  }) => {
    const date = dayjs().subtract(daysAgo, 'day').hour(13).minute(0).toDate();
    const doc = new Expense({
      expenseNo: await nextExpenseNumber(company._id, settings, date),
      expenseDate: date,
      claimant: rep._id,
      claimantName: rep.name || '',
      claimantRole: rep.role || '',
      category,
      amount,
      description,
      fromPlace,
      toPlace,
      distanceKm,
      hasReceipt,
      receiptUrl: hasReceipt ? `/uploads/receipts/receipt-${daysAgo}-${category.toLowerCase()}.jpg` : '',
      notes,
      status: EXPENSE_STATUS.DRAFT,
      statusHistory: [
        {
          status: EXPENSE_STATUS.DRAFT,
          at: date,
          by: rep._id,
          byName: rep.name,
          note: 'Claim created',
        },
      ],
      source: 'MOBILE',
    });

    // Walk the chain up to the requested terminal status.
    const chain = [EXPENSE_STATUS.DRAFT];
    if (finalStatus !== EXPENSE_STATUS.DRAFT) chain.push(EXPENSE_STATUS.SUBMITTED);
    if (finalStatus === EXPENSE_STATUS.APPROVED || finalStatus === EXPENSE_STATUS.PAID) {
      chain.push(EXPENSE_STATUS.APPROVED);
    }
    if (finalStatus === EXPENSE_STATUS.REJECTED) chain.push(EXPENSE_STATUS.REJECTED);
    if (finalStatus === EXPENSE_STATUS.PAID) chain.push(EXPENSE_STATUS.PAID);

    chain.slice(1).forEach((status, i) => {
      const at = dayjs(date).add(i + 1, 'day').hour(10 + i * 2).minute(15).toDate();

      if (status === EXPENSE_STATUS.SUBMITTED) {
        doc.submittedAt = at;
        doc.statusHistory.push({ status, at, by: rep._id, byName: rep.name, note: 'Submitted for approval' });
      } else if (status === EXPENSE_STATUS.APPROVED) {
        doc.approvedBy = approver?._id || null;
        doc.approvedAt = at;
        doc.approvedAmount = approvedAmount ?? amount;
        doc.statusHistory.push({
          status,
          at,
          by: approver?._id || null,
          byName: approver?.name || 'System',
          note:
            approvedAmount != null && approvedAmount !== amount
              ? `Approved ${approvedAmount} of ${amount}`
              : 'Approved in full',
        });
      } else if (status === EXPENSE_STATUS.REJECTED) {
        doc.rejectedBy = approver?._id || null;
        doc.rejectedAt = at;
        doc.rejectionReason = rejectionReason;
        doc.statusHistory.push({
          status,
          at,
          by: approver?._id || null,
          byName: approver?.name || 'System',
          note: rejectionReason || 'Rejected',
        });
      } else if (status === EXPENSE_STATUS.PAID) {
        doc.paidAt = at;
        doc.paidBy = accountant?._id || null;
        doc.paymentMode = paymentMode || 'UPI';
        doc.paymentReference = paymentReference || '';
        doc.statusHistory.push({
          status,
          at,
          by: accountant?._id || null,
          byName: accountant?.name || 'System',
          note: `Paid via ${doc.paymentMode}`,
        });
      }
      doc.status = status;
    });

    await doc.save();
    created += 1;
  };

  const [amit, sneha] = salesmen;

  if (amit) {
    await addClaim({
      rep: amit,
      category: 'TRAVEL',
      amount: 480,
      description: 'Auto rickshaw - Kharadi to Viman Nagar beat',
      daysAgo: 6,
      finalStatus: EXPENSE_STATUS.PAID,
      paymentMode: 'UPI',
      paymentReference: 'UPI-2410781',
      fromPlace: 'Kharadi',
      toPlace: 'Viman Nagar',
      distanceKm: 7.4,
    });
    await addClaim({
      rep: amit,
      category: 'FUEL',
      amount: 1250,
      description: 'Fuel for the beat vehicle',
      daysAgo: 3,
      finalStatus: EXPENSE_STATUS.APPROVED,
      approvedAmount: 1100,
      notes: 'Approved for 310 km as per the mileage policy.',
    });
    await addClaim({
      rep: amit,
      category: 'FOOD',
      amount: 260,
      description: 'Lunch during the PCMC beat',
      daysAgo: 1,
      finalStatus: EXPENSE_STATUS.SUBMITTED,
      fromPlace: 'Bhosari',
      toPlace: 'Nigdi',
    });
    await addClaim({
      rep: amit,
      category: 'TRAVEL',
      amount: 190,
      description: 'Local train pass - Pune to Chinchwad',
      daysAgo: 0,
      finalStatus: EXPENSE_STATUS.DRAFT,
      hasReceipt: false,
      notes: 'Receipt to be attached before submitting.',
    });
  }

  if (sneha) {
    await addClaim({
      rep: sneha,
      category: 'LODGING',
      amount: 2100,
      description: 'Overnight stay at the Satara dealer meet',
      daysAgo: 5,
      finalStatus: EXPENSE_STATUS.PAID,
      paymentMode: 'BANK_TRANSFER',
      paymentReference: 'NEFT-889214',
      fromPlace: 'Pune',
      toPlace: 'Satara',
    });
    await addClaim({
      rep: sneha,
      category: 'TRAVEL',
      amount: 340,
      description: 'Cab - Baner to Aundh market survey',
      daysAgo: 2,
      finalStatus: EXPENSE_STATUS.SUBMITTED,
      fromPlace: 'Baner',
      toPlace: 'Aundh',
      distanceKm: 4.2,
    });
    await addClaim({
      rep: sneha,
      category: 'FOOD',
      amount: 415,
      description: 'Team dinner after the quarter-end push',
      daysAgo: 4,
      finalStatus: EXPENSE_STATUS.REJECTED,
      rejectionReason: 'Receipt missing - please re-upload the bill and resubmit.',
      hasReceipt: false,
    });
  }

  logger.info(`Seeded ${created} expense claims.`);
};

// ---------------------------------------------------------------------------
// Sales targets
// ---------------------------------------------------------------------------

const seedTargets = async ({ users }) => {
  const existing = await Target.countDocuments({});
  if (existing > 0) {
    logger.info(`Targets already seeded (${existing} found).`);
    return;
  }

  const salesmen = users.filter((u) => u.role === 'SALESMAN');
  if (!salesmen.length) {
    logger.warn('Skipping target seed: no salesmen found.');
    return;
  }

  const routes = await Route.find({ isActive: { $ne: false } }).sort({ sequence: 1 }).lean();
  const goals = [
    { rep: salesmen[0], value: 150000, orders: 25, visits: 60 },
    { rep: salesmen[1] || salesmen[0], value: 120000, orders: 20, visits: 50 },
  ];

  let created = 0;
  const window = {
    periodKey: dayjs().format('YYYY-MM'),
    periodLabel: dayjs().format('MMM YYYY'),
    startDate: dayjs().startOf('month').toDate(),
    endDate: dayjs().endOf('month').toDate(),
  };

  for (const goal of goals) {
    const target = new Target({
      name: `${goal.rep.name.split(' ')[0]} - monthly quota`,
      periodType: 'MONTH',
      ...window,
      salesman: goal.rep._id,
      salesmanName: goal.rep.name || '',
      targetValue: goal.value,
      targetOrders: goal.orders,
      targetVisits: goal.visits,
      status: TARGET_STATUS.ACTIVE,
      notes: 'Monthly revenue + activity target shared at the start of the month.',
      source: 'WEB',
    });

    // Achievement is always derived from the orders the rep actually booked.
     
    await refreshTargetAchievements(target);
     
    target.achievedVisits = await Visit.countDocuments({
      salesman: goal.rep._id,
      status: VISIT_STATUS.COMPLETED,
      visitDay: { $gte: window.startDate, $lte: window.endDate },
    });
    target.lastRefreshedAt = new Date();
     
    await target.save();
    created += 1;
  }

  // A route-level goal for the busiest beat.
  const beat = routes[0] || null;
  if (beat) {
    const routeTarget = new Target({
      name: `${beat.name} - monthly route target`,
      periodType: 'MONTH',
      ...window,
      route: beat._id,
      routeName: beat.name || '',
      targetValue: 300000,
      targetOrders: 45,
      targetVisits: 90,
      status: TARGET_STATUS.ACTIVE,
      notes: 'Beat-level goal rolled up from the reps on the route.',
      source: 'WEB',
    });
    await refreshTargetAchievements(routeTarget);
    routeTarget.lastRefreshedAt = new Date();
    await routeTarget.save();
    created += 1;
  }

  logger.info(`Seeded ${created} sales targets.`);
};

// ---------------------------------------------------------------------------

const run = async (company, users = []) =>
  runWithContext({ scope: 'company', companyId: String(company._id), userId: null }, async () => {
    const settings = await Setting.forCompany(company._id);

    await seedAttendance({ users });
    await seedVisits({ company, users, settings });
    await seedExpenses({ company, users, settings });
    await seedTargets({ users });
  });

export default run;
