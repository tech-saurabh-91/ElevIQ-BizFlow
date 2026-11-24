import { z } from 'zod';
import { objectIdSchema } from '../middlewares/validate.js';

/** Customer portal request bodies (mobile + PIN login, cart, balance answer). */

const pin = z.string().trim().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');
const mobile = z
  .string()
  .trim()
  .refine((v) => v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15, 'Enter your mobile number');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().or(z.literal(''));

export const portalCodeParams = z.object({ code: z.string().trim().min(2).max(24) });

export const portalLoginSchema = z.object({
  companyCode: z.string().trim().min(2, 'Company link is incomplete').max(24),
  mobile,
  pin: z.string().trim().min(1, 'Enter your PIN').max(6),
});

export const portalChangePinSchema = z
  .object({ currentPin: z.string().trim().min(1, 'Enter your current PIN').max(6), newPin: pin, confirmPin: z.string().trim() })
  .refine((v) => v.newPin === v.confirmPin, { path: ['confirmPin'], message: 'PINs do not match' });

const cartLine = z.object({
  product: objectIdSchema,
  qty: z.coerce.number().positive('Quantity must be more than 0').max(1000000),
  unit: z.string().trim().max(16).optional(),
  note: z.string().trim().max(200).optional(),
});

export const portalCartSchema = z.object({
  items: z.array(cartLine).min(1, 'Add at least one product').max(200),
  note: z.string().trim().max(500).optional(),
  reference: z.string().trim().max(60).optional(),
});

export const portalCancelSchema = z.object({ reason: z.string().trim().max(300).optional() });

export const portalStatementQuery = z.object({ from: ymd, to: ymd }).partial();

export const portalConfirmSchema = z
  .object({
    status: z.enum(['CONFIRMED', 'DISPUTED']),
    note: z.string().trim().max(500).optional(),
    asOf: ymd,
  })
  .refine((v) => v.status !== 'DISPUTED' || (v.note && v.note.length >= 3), {
    path: ['note'],
    message: 'Tell the company what does not match',
  });

/** Staff: switch a customer's portal login on/off and set its mobile. */
export const portalAccessSchema = z.object({
  enabled: z.boolean(),
  mobile: mobile.optional(),
  // Trusted: online orders confirmed at once when stock / credit allow.
  autoConfirm: z.boolean().optional(),
});

export const portalOtpRequestSchema = z.object({
  companyCode: z.string().trim().min(2).max(24),
  mobile,
});
export const portalOtpVerifySchema = portalOtpRequestSchema.extend({
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

const money = z.coerce.number().positive('Enter the amount').max(100000000);

export const portalPaymentClaimSchema = z.object({
  amount: money,
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  mode: z.enum(['UPI', 'BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER']).default('UPI'),
  reference: z.string().trim().max(80).optional().default(''),
  note: z.string().trim().max(500).optional().default(''),
  invoices: z.preprocess(
    (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []),
    z.array(objectIdSchema).max(50)
  ),
});

export const portalReturnSchema = z.object({
  kind: z.enum(['RETURN', 'COMPLAINT']).default('RETURN'),
  reason: z.enum(['DAMAGED', 'EXPIRED', 'WRONG_ITEM', 'SHORT_SUPPLY', 'QUALITY', 'OTHER']),
  invoice: objectIdSchema.optional().or(z.literal('')),
  note: z.string().trim().max(1000).optional().default(''),
  items: z.preprocess(
    (v) => {
      if (typeof v === 'string') {
        try {
          return JSON.parse(v);
        } catch {
          return [];
        }
      }
      return v || [];
    },
    z
      .array(
        z.object({
          product: objectIdSchema,
          unit: z.string().trim().max(16).optional(),
          qty: z.coerce.number().positive().max(1000000),
        })
      )
      .max(100)
  ),
});

/** Staff: answer a return / complaint. */
export const returnDecisionSchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED', 'RESOLVED']),
  note: z.string().trim().max(500).optional().default(''),
});

export const claimRejectSchema = z.object({ reason: z.string().trim().min(3, 'Say why').max(300) });
