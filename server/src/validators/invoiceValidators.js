import { z } from 'zod';
import { paginationSchema, objectIdSchema, notFutureDate, dateNotBefore } from '../middlewares/validate.js';
import { INVOICE_STATUS_LIST, PAYMENT_TERMS } from '../config/constants.js';
import { ORDER_PAYMENT_MODES } from '../models/Order.js';

/**
 * Phase 5 - Invoice validators.
 *
 * The client never sends totals: only quantities (plus optional price
 * overrides on direct invoices). Everything else is recomputed on the server.
 */

const softString = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date' });

const refId = objectIdSchema.optional().or(z.literal(''));

const invoiceItemSchema = z.object({
  product: objectIdSchema.optional(),
  // Base unit or one of the product's pack units (default: base unit).
  unit: z.string().trim().max(10).optional(),
  orderItemId: objectIdSchema.optional(),
  qty: z.coerce.number().positive('Quantity must be greater than zero').max(1_000_000),
  unitPrice: z.coerce.number().min(0, 'Price cannot be negative').max(1e12).optional(),
  discountPercent: z.coerce.number().min(0).max(100, 'Discount cannot exceed 100%').optional(),
  taxRate: z.coerce.number().min(0).max(100, 'Tax rate cannot exceed 100%').optional(),
  note: softString(300),
});

const invoiceBaseSchema = z.object({
  orderId: refId,
  customerId: refId,

  invoiceDate: optionalDate.refine(notFutureDate, { message: 'Invoice date cannot be in the future' }),
  dueDate: optionalDate,

  salesman: refId,
  route: refId,
  warehouse: refId,

  items: z.array(invoiceItemSchema).max(200).optional(),

  paymentMode: z.enum(ORDER_PAYMENT_MODES).optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
  creditDays: z.coerce.number().int().min(0).max(365).optional(),
  poReference: softString(60),
  placeOfSupply: softString(120),

  notes: softString(1000),
  terms: softString(2000),
  footerNote: softString(500),

  /** Issue immediately instead of saving a draft. */
  issue: z.boolean().optional(),
});

const requireLineReference = (value, ctx) => {
  const hasOrder = Boolean(value.orderId);
  (value.items || []).forEach((item, index) => {
    if (!item.product && !item.orderItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index, 'product'],
        message: 'Select a product',
      });
    }
    if (!hasOrder && !item.product) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index, 'product'],
        message: 'A product is required on a direct invoice',
      });
    }
  });
  if (!hasOrder && !value.customerId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customerId'],
      message: 'Customer is required for a direct invoice',
    });
  }
  if (!hasOrder && !(value.items || []).length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: 'Add at least one product',
    });
  }
};

const dueAfterInvoice = dateNotBefore('dueDate', 'invoiceDate', 'Due date cannot be before the invoice date');

export const invoiceCreateSchema = invoiceBaseSchema.superRefine(requireLineReference).superRefine(dueAfterInvoice);

export const invoiceUpdateSchema = invoiceBaseSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const invoiceIssueSchema = z.object({ note: softString(500) });

export const invoiceCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const invoiceListQuerySchema = paginationSchema.extend({
  status: z.enum(INVOICE_STATUS_LIST).optional(),
  customerId: objectIdSchema.optional(),
  salesman: objectIdSchema.optional(),
  orderId: objectIdSchema.optional(),
  route: objectIdSchema.optional(),
  warehouse: objectIdSchema.optional(),
  paymentMode: z.enum(ORDER_PAYMENT_MODES).optional(),
  overdue: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

export const invoiceFormOptionsQuerySchema = z.object({
  orderId: objectIdSchema.optional().or(z.literal('')),
  customerId: objectIdSchema.optional().or(z.literal('')),
  invoiceId: objectIdSchema.optional().or(z.literal('')),
});

export default {
  invoiceCreateSchema,
  invoiceUpdateSchema,
  invoiceIssueSchema,
  invoiceCancelSchema,
  invoiceListQuerySchema,
  invoiceFormOptionsQuerySchema,
};
