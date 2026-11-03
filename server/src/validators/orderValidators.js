import { z } from 'zod';
import { paginationSchema, objectIdSchema } from '../middlewares/validate.js';
import { ORDER_STATUS_LIST, PAYMENT_TERMS } from '../config/constants.js';
import { ORDER_PAYMENT_MODES } from '../models/Order.js';

/**
 * Phase 4 - Order Booking validators.
 *
 * The client never sends money totals: only quantities, an optional price
 * override and a discount. Prices/tax/totals are recomputed server-side.
 */

const softString = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date' });

const refId = objectIdSchema.optional().or(z.literal(''));

const orderItemSchema = z.object({
  product: objectIdSchema,
  qty: z.coerce.number().positive('Quantity must be greater than zero').max(1_000_000),
  freeQty: z.coerce.number().min(0).max(1_000_000).optional(),
  unitPrice: z.coerce.number().min(0, 'Price cannot be negative').max(1e12).optional(),
  discountPercent: z.coerce.number().min(0).max(100, 'Discount cannot exceed 100%').optional(),
  taxRate: z.coerce.number().min(0).max(100, 'Tax rate cannot exceed 100%').optional(),
  note: softString(300),
});

const orderBaseSchema = z.object({
  customerId: objectIdSchema,
  orderDate: optionalDate,
  expectedDeliveryDate: optionalDate,

  salesman: refId,
  route: refId,
  warehouse: refId,
  priceList: refId,

  items: z.array(orderItemSchema).min(1, 'Add at least one product').max(200),

  paymentMode: z.enum(ORDER_PAYMENT_MODES).optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
  creditDays: z.coerce.number().int().min(0).max(365).optional(),
  poReference: softString(60),

  notes: softString(1000),
  internalNotes: softString(1000),
  deliveryInstructions: softString(1000),

  /** Create-and-submit shortcut used by the "Save & submit" button. */
  submit: z.boolean().optional(),
});

export const orderCreateSchema = orderBaseSchema;

export const orderUpdateSchema = orderBaseSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const reasonSchema = z.string().trim().min(3, 'Reason must be at least 3 characters').max(500);

export const orderSubmitSchema = z.object({ note: softString(500) });

export const orderApproveSchema = z.object({ note: softString(500) });

export const orderRejectSchema = z.object({ reason: reasonSchema });

export const orderCancelSchema = z.object({ reason: softString(500) });

export const orderDispatchSchema = z.object({
  note: softString(500),
  dispatchedAt: optionalDate,
});

export const orderDeliverSchema = z.object({ note: softString(500) });

export const orderListQuerySchema = paginationSchema.extend({
  status: z.enum(ORDER_STATUS_LIST).optional(),
  customerId: objectIdSchema.optional(),
  salesman: objectIdSchema.optional(),
  route: objectIdSchema.optional(),
  warehouse: objectIdSchema.optional(),
  paymentMode: z.enum(ORDER_PAYMENT_MODES).optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  pendingApproval: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export const orderFormOptionsQuerySchema = z.object({
  customerId: objectIdSchema.optional().or(z.literal('')),
  warehouse: objectIdSchema.optional().or(z.literal('')),
});

export default {
  orderCreateSchema,
  orderUpdateSchema,
  orderSubmitSchema,
  orderApproveSchema,
  orderRejectSchema,
  orderCancelSchema,
  orderDispatchSchema,
  orderDeliverSchema,
  orderListQuerySchema,
  orderFormOptionsQuerySchema,
};
