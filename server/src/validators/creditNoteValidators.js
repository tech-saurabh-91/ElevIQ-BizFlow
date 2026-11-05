import { z } from 'zod';
import { paginationSchema, objectIdSchema, notFutureDate } from '../middlewares/validate.js';
import { CREDIT_NOTE_STATUS_LIST } from '../config/constants.js';
import { CREDIT_NOTE_REASONS } from '../models/CreditNote.js';

/**
 * Phase 5 - Credit note validators.
 * A credit note always reverses a part of an issued invoice; the server
 * computes the amounts from the invoice line snapshots.
 */

const softString = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date' });

const creditItemSchema = z.object({
  product: objectIdSchema.optional(),
  invoiceItemId: objectIdSchema.optional(),
  qty: z.coerce.number().positive('Quantity must be greater than zero').max(1_000_000),
  note: softString(300),
});

export const creditNoteCreateSchema = z.object({
  invoiceId: objectIdSchema,
  creditNoteDate: optionalDate.refine(notFutureDate, { message: 'Credit note date cannot be in the future' }),
  reason: z.enum(CREDIT_NOTE_REASONS).optional(),
  reasonNote: softString(1000),
  items: z.array(creditItemSchema).max(200).optional(),
  notes: softString(1000),
  issue: z.boolean().optional(),
});

export const creditNoteUpdateSchema = z
  .object({
    creditNoteDate: optionalDate.refine(notFutureDate, { message: 'Credit note date cannot be in the future' }),
    reason: z.enum(CREDIT_NOTE_REASONS).optional(),
    reasonNote: softString(1000),
    items: z.array(creditItemSchema).max(200).optional(),
    notes: softString(1000),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const creditNoteIssueSchema = z.object({ note: softString(500) });

export const creditNoteCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const creditNoteListQuerySchema = paginationSchema.extend({
  status: z.enum(CREDIT_NOTE_STATUS_LIST).optional(),
  customerId: objectIdSchema.optional(),
  invoiceId: objectIdSchema.optional(),
  reason: z.enum(CREDIT_NOTE_REASONS).optional(),
  salesman: objectIdSchema.optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

export const creditNoteFormOptionsQuerySchema = z.object({
  invoiceId: objectIdSchema.optional().or(z.literal('')),
});

export default {
  creditNoteCreateSchema,
  creditNoteUpdateSchema,
  creditNoteIssueSchema,
  creditNoteCancelSchema,
  creditNoteListQuerySchema,
  creditNoteFormOptionsQuerySchema,
};
