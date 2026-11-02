import { z } from 'zod';
import { paginationSchema, objectIdSchema } from '../middlewares/validate.js';

/**
 * Phase 8 - Report validators.
 *
 * Reports are read-only aggregations. Every report honours an optional
 * dateFrom/dateTo window (inclusive) plus report-specific knobs. The client
 * sends ISO dates; an empty/absent window falls back to a sensible default in
 * the controller (last 30 days for trend reports, "all time" for balances).
 */

const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date' });

/** Shared window + grouping knobs for every trend-style report. */
export const reportWindowQuerySchema = z.object({
  dateFrom: optionalDate,
  dateTo: optionalDate,
  /** day | week | month — how to bucket the time series. */
  granularity: z.enum(['day', 'week', 'month']).optional(),
  /** How many rows to keep in the "top N" breakdowns. */
  top: z.coerce.number().int().min(1).max(50).optional(),
  salesman: objectIdSchema.optional().or(z.literal('')),
  customerId: objectIdSchema.optional().or(z.literal('')),
  warehouseId: objectIdSchema.optional().or(z.literal('')),
  routeId: objectIdSchema.optional().or(z.literal('')),
});

export const reportOverviewQuerySchema = z.object({
  dateFrom: optionalDate,
  dateTo: optionalDate,
});

export const receivablesQuerySchema = z.object({
  /** Bucket by days overdue: 30 | 60 | 90 — controls the aging brackets. */
  buckets: z.coerce.number().int().min(7).max(120).optional(),
  customerId: objectIdSchema.optional().or(z.literal('')),
  top: z.coerce.number().int().min(1).max(50).optional(),
});

export const inventoryReportQuerySchema = z.object({
  dateFrom: optionalDate,
  dateTo: optionalDate,
  granularity: z.enum(['day', 'week', 'month']).optional(),
  warehouseId: objectIdSchema.optional().or(z.literal('')),
  top: z.coerce.number().int().min(1).max(50).optional(),
});

export const fieldForceReportQuerySchema = z.object({
  dateFrom: optionalDate,
  dateTo: optionalDate,
  granularity: z.enum(['day', 'week', 'month']).optional(),
  salesman: objectIdSchema.optional().or(z.literal('')),
  top: z.coerce.number().int().min(1).max(50).optional(),
});

/** Which dataset to dump to Excel. */
export const REPORT_EXPORT_TYPES = Object.freeze({
  SALES: 'sales',
  RECEIVABLES: 'receivables',
  COLLECTIONS: 'collections',
  INVENTORY: 'inventory',
  FIELD_FORCE: 'field-force',
});
export const REPORT_EXPORT_TYPE_LIST = Object.values(REPORT_EXPORT_TYPES);

export const reportExportQuerySchema = reportWindowQuerySchema.extend({
  type: z.enum(REPORT_EXPORT_TYPE_LIST),
});

/** Notifications (Phase 8 inbox). */
export const notificationListQuerySchema = paginationSchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  type: z.string().trim().max(40).optional(),
});

export const notificationIdParamsSchema = z.object({ id: objectIdSchema });
