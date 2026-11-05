import { z } from 'zod';
import { paginationSchema, objectIdSchema } from '../middlewares/validate.js';
import {
  ATTENDANCE_STATUS_LIST,
  EXPENSE_CATEGORIES,
  EXPENSE_STATUS_LIST,
  TARGET_PERIODS,
  TARGET_STATUS_LIST,
  VISIT_OUTCOMES,
  VISIT_STATUS_LIST,
  VISIT_PURPOSES,
  NO_ORDER_REASONS,
} from '../config/constants.js';

/**
 * Phase 7 - Field Force validators.
 * Covers attendance (GPS check-in/out), visits, expense claims and targets.
 */

const softString = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date' });

const refId = objectIdSchema.optional().or(z.literal(''));

/** GPS point captured by the device (both coords required together). */
const locationSchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .optional();

/** Check-in / check-out payload shared by attendance and visits. */
const eventSchema = z.object({
  at: optionalDate,
  location: locationSchema,
  accuracy: z.coerce.number().min(0).max(1e6).optional(),
  address: softString(300),
  source: z.enum(['WEB', 'MOBILE', 'MANUAL']).optional(),
  note: softString(300),
});

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const attendanceCheckInSchema = z.object({
  at: optionalDate,
  location: locationSchema,
  accuracy: z.coerce.number().min(0).max(1e6).optional(),
  address: softString(300),
  source: z.enum(['WEB', 'MOBILE', 'MANUAL']).optional(),
  note: softString(300),
  /** Optional override of the calendar day (defaults to today). */
  day: optionalDate,
});

export const attendanceCheckOutSchema = z.object({
  at: optionalDate,
  location: locationSchema,
  accuracy: z.coerce.number().min(0).max(1e6).optional(),
  address: softString(300),
  source: z.enum(['WEB', 'MOBILE', 'MANUAL']).optional(),
  note: softString(300),
  day: optionalDate,
});

/** Manager correction of an existing day. */
export const attendanceUpdateSchema = z
  .object({
    status: z.enum(ATTENDANCE_STATUS_LIST).optional(),
    checkIn: eventSchema.optional(),
    checkOut: eventSchema.optional(),
    manualReason: z.string().trim().min(3, 'Provide a reason for the correction').max(300),
    notes: softString(1000),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const attendanceReviewSchema = z.object({
  status: z.enum(ATTENDANCE_STATUS_LIST).optional(),
  reviewNote: softString(500),
});

export const attendanceListQuerySchema = paginationSchema.extend({
  userId: refId,
  status: z.enum(ATTENDANCE_STATUS_LIST).optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  /** `me=true` restricts to the signed-in user. */
  me: z.enum(['true', 'false']).optional(),
});

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

export const visitCreateSchema = z.object({
  customerId: objectIdSchema,
  salesman: refId,
  route: refId,
  visitDay: optionalDate,
  plannedAt: optionalDate,
  purpose: z.enum(VISIT_PURPOSES).optional(),
  notes: softString(1000),
  source: z.enum(['WEB', 'MOBILE', 'IMPORT', 'API']).optional(),
});

export const visitUpdateSchema = z
  .object({
    salesman: refId,
    route: refId,
    visitDay: optionalDate,
    plannedAt: optionalDate,
    purpose: z.enum(VISIT_PURPOSES).optional(),
    notes: softString(1000),
    skipReason: softString(300),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const visitCheckInSchema = z.object({
  at: optionalDate,
  location: locationSchema,
  accuracy: z.coerce.number().min(0).max(1e6).optional(),
  address: softString(300),
  source: z.enum(['WEB', 'MOBILE', 'MANUAL']).optional(),
});

export const visitCheckOutSchema = z.object({
  at: optionalDate,
  location: locationSchema,
  accuracy: z.coerce.number().min(0).max(1e6).optional(),
  address: softString(300),
  source: z.enum(['WEB', 'MOBILE', 'MANUAL']).optional(),
  // The outcome is derived from what was booked; kept optional for old clients.
  outcome: z.enum(VISIT_OUTCOMES).optional(),
  noOrderReason: z.enum(NO_ORDER_REASONS).optional(),
  order: refId,
  payment: refId,
  collectionAmount: z.coerce.number().min(0).max(1e9).optional(),
  skipReason: softString(300),
  notes: softString(1000),
  proofUrl: softString(500),
});

export const visitSkipSchema = z.object({
  reason: z.string().trim().min(3, 'Provide a reason for skipping').max(300),
});

export const visitCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Provide a reason for cancelling').max(300),
});

export const visitListQuerySchema = paginationSchema.extend({
  status: z.enum(VISIT_STATUS_LIST).optional(),
  outcome: z.enum(VISIT_OUTCOMES).optional(),
  purpose: z.enum(VISIT_PURPOSES).optional(),
  customerId: refId,
  salesman: refId,
  route: refId,
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  me: z.enum(['true', 'false']).optional(),
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const expenseCreateSchema = z.object({
  claimant: refId,
  expenseDate: optionalDate,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce.number().positive('Amount must be greater than zero').max(1e8),
  description: softString(500),
  customer: refId,
  visit: refId,
  receiptUrl: softString(500),
  fromPlace: softString(120),
  toPlace: softString(120),
  distanceKm: z.coerce.number().min(0).max(1e5).optional(),
  notes: softString(1000),
  /** Submit for approval right away instead of saving a draft. */
  submit: z.boolean().optional(),
});

export const expenseUpdateSchema = z
  .object({
    expenseDate: optionalDate,
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    amount: z.coerce.number().positive('Amount must be greater than zero').max(1e8).optional(),
    description: softString(500),
    customer: refId,
    visit: refId,
    receiptUrl: softString(500),
    fromPlace: softString(120),
    toPlace: softString(120),
    distanceKm: z.coerce.number().min(0).max(1e5).optional(),
    notes: softString(1000),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const expenseSubmitSchema = z.object({ note: softString(500) });

export const expenseApproveSchema = z.object({
  /** Optional partial approval: defaults to the claimed amount. */
  approvedAmount: z.coerce.number().min(0).max(1e8).optional(),
  note: softString(500),
});

export const expenseRejectSchema = z.object({
  reason: z.string().trim().min(3, 'Provide a reason for rejecting').max(500),
});

export const expensePaySchema = z.object({
  paymentMode: z.string().trim().max(30).optional(),
  paymentReference: softString(100),
  paidAt: optionalDate,
  note: softString(500),
});

export const expenseListQuerySchema = paginationSchema.extend({
  status: z.enum(EXPENSE_STATUS_LIST).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  claimant: refId,
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  me: z.enum(['true', 'false']).optional(),
});

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export const targetCreateSchema = z
  .object({
    name: softString(120),
    periodType: z.enum(TARGET_PERIODS),
    periodKey: softString(20),
    anchorDate: optionalDate,
    salesman: refId,
    route: refId,
    targetValue: z.coerce.number().min(0).max(1e12).optional(),
    targetOrders: z.coerce.number().min(0).max(1e6).optional(),
    targetVisits: z.coerce.number().min(0).max(1e6).optional(),
    notes: softString(1000),
  })
  .refine((v) => Boolean(v.salesman) !== Boolean(v.route), {
    message: 'Target must be assigned to exactly one salesman or one route',
    path: ['salesman'],
  });

export const targetUpdateSchema = z
  .object({
    name: softString(120),
    targetValue: z.coerce.number().min(0).max(1e12).optional(),
    targetOrders: z.coerce.number().min(0).max(1e6).optional(),
    targetVisits: z.coerce.number().min(0).max(1e6).optional(),
    notes: softString(1000),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const targetCloseSchema = z.object({ note: softString(500) });

export const targetListQuerySchema = paginationSchema.extend({
  status: z.enum(TARGET_STATUS_LIST).optional(),
  periodType: z.enum(TARGET_PERIODS).optional(),
  periodKey: z.string().trim().max(20).optional(),
  salesman: refId,
  route: refId,
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  me: z.enum(['true', 'false']).optional(),
});

export default {
  attendanceCheckInSchema,
  attendanceCheckOutSchema,
  attendanceUpdateSchema,
  attendanceReviewSchema,
  attendanceListQuerySchema,
  visitCreateSchema,
  visitUpdateSchema,
  visitCheckInSchema,
  visitCheckOutSchema,
  visitSkipSchema,
  visitCancelSchema,
  visitListQuerySchema,
  expenseCreateSchema,
  expenseUpdateSchema,
  expenseSubmitSchema,
  expenseApproveSchema,
  expenseRejectSchema,
  expensePaySchema,
  expenseListQuerySchema,
  targetCreateSchema,
  targetUpdateSchema,
  targetCloseSchema,
  targetListQuerySchema,
};
