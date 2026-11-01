import { z } from 'zod';
import { paginationSchema, objectIdSchema } from '../middlewares/validate.js';
import { PAYMENT_STATUS_LIST, PAYMENT_MODES } from '../config/constants.js';
import { PAYMENT_REASONS } from '../models/Payment.js';

/**
 * Phase 6 - Payment validators.
 * The client sends the money received + which invoices to settle; the server
 * caps each allocation at the invoice's live balanceDue on issue.
 */

const softString = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date' });

const allocationSchema = z.object({
  invoice: objectIdSchema,
  amount: z.coerce.number().positive('Amount must be greater than zero').max(100_000_000),
});

export const paymentCreateSchema = z
  .object({
    customerId: objectIdSchema,
    amount: z.coerce.number().positive('Amount must be greater than zero').max(100_000_000),
    paymentDate: optionalDate,
    mode: z.enum(PAYMENT_MODES).optional(),
    reference: softString(100),
    bankName: softString(120),
    chequeDate: optionalDate,
    reason: z.enum(PAYMENT_REASONS).optional(),
    collectedBy: objectIdSchema.optional().or(z.literal('')),
    notes: softString(1000),
    allocations: z.array(allocationSchema).max(100).optional(),
    receive: z.boolean().optional(),
  })
  .refine(
    (v) => !v.chequeDate || !v.paymentDate || Date.parse(v.chequeDate) >= Date.parse(v.paymentDate) - 86400000,
    { message: 'Cheque date cannot be before the payment date', path: ['chequeDate'] }
  );

export const paymentUpdateSchema = z
  .object({
    amount: z.coerce.number().positive('Amount must be greater than zero').max(100_000_000).optional(),
    paymentDate: optionalDate,
    mode: z.enum(PAYMENT_MODES).optional(),
    reference: softString(100),
    bankName: softString(120),
    chequeDate: optionalDate,
    reason: z.enum(PAYMENT_REASONS).optional(),
    collectedBy: objectIdSchema.optional().or(z.literal('')),
    notes: softString(1000),
    allocations: z.array(allocationSchema).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const paymentReceiveSchema = z.object({ note: softString(500) });

export const paymentBounceSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const paymentCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const paymentListQuerySchema = paginationSchema.extend({
  status: z.enum(PAYMENT_STATUS_LIST).optional(),
  customerId: objectIdSchema.optional(),
  invoiceId: objectIdSchema.optional(),
  mode: z.enum(PAYMENT_MODES).optional(),
  reason: z.enum(PAYMENT_REASONS).optional(),
  collectedBy: objectIdSchema.optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

export const paymentFormOptionsQuerySchema = z.object({
  invoiceId: objectIdSchema.optional().or(z.literal('')),
  customerId: objectIdSchema.optional().or(z.literal('')),
});

export default {
  paymentCreateSchema,
  paymentUpdateSchema,
  paymentReceiveSchema,
  paymentBounceSchema,
  paymentCancelSchema,
  paymentListQuerySchema,
  paymentFormOptionsQuerySchema,
};
