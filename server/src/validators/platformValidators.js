import { z } from 'zod';
import {
  COMPANY_STATUS_LIST,
  BUSINESS_TYPES,
  COMPANY_ROLES,
  AUDIT_ACTIONS,
} from '../config/constants.js';
import { paginationSchema } from '../middlewares/validate.js';

/**
 * Phase 2 — Platform Admin Panel validators.
 * Every /api/platform/* mutating or listing endpoint validates through these.
 */

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid id' });

const STATUS_VALUES = [...COMPANY_STATUS_LIST];
const BUSINESS_TYPE_VALUES = [...BUSINESS_TYPES];
const CYCLES = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONCE'];

/** Trimmed optional string that also accepts an explicit empty value. */
const softString = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date' });

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const statusList = z
  .string()
  .trim()
  .optional()
  .transform((v) =>
    v ? v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined
  )
  .refine((arr) => !arr || arr.every((s) => STATUS_VALUES.includes(s)), {
    message: 'Invalid company status',
  });

export const companyListQuerySchema = paginationSchema.extend({
  sort: z
    .enum(['createdAt', 'businessName', 'code', 'status', 'subscriptionEnd', 'lastActivityAt'])
    .optional(),
  status: statusList,
  businessType: z.enum(BUSINESS_TYPE_VALUES).optional(),
  plan: objectIdSchema.optional(),
  /** Only return companies whose subscription ends within N days. */
  expiringIn: z.coerce.number().int().min(0).max(365).optional(),
});

const addressSchema = z.object({
  line1: softString(160),
  line2: softString(160),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  country: z.string().trim().max(80).optional().or(z.literal('')),
  pincode: z.string().trim().max(12).optional().or(z.literal('')),
  gstin: z.string().trim().max(20).optional().or(z.literal('')),
});

const adminSchema = z.object({
  name: z.string().trim().min(2, 'Admin name is required').max(120),
  email: z.string().trim().toLowerCase().email('A valid admin email is required'),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9()\-\s]{6,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .max(128)
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Must contain a symbol'),
  title: z.string().trim().max(80).optional().or(z.literal('')),
});

export const createCompanySchema = z.object({
  businessName: z.string().trim().min(2, 'Business name is required').max(160),
  legalName: softString(200),
  /** Auto-generated from the business name when omitted. */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,10}$/, 'Code must be 3-10 letters or numbers')
    .optional()
    .or(z.literal('')),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/, 'Slug must be 3-60 lowercase characters')
    .optional()
    .or(z.literal('')),

  businessType: z.enum(BUSINESS_TYPE_VALUES).default('BOTH'),
  email: z.string().trim().toLowerCase().email('A valid email is required').optional().or(z.literal('')),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  website: z.string().trim().max(200).optional().or(z.literal('')),
  gstin: z.string().trim().toUpperCase().max(20).optional().or(z.literal('')),
  pan: z.string().trim().toUpperCase().max(12).optional().or(z.literal('')),
  address: addressSchema.optional().default({}),

  timezone: z.string().trim().max(60).optional(),
  currency: z.string().trim().max(8).optional(),
  currencySymbol: z.string().trim().max(6).optional(),
  financialYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
  // Set once at registration; locks with the first transaction.
  taxRegime: z.enum(['GST', 'VAT', 'SALES_TAX', 'NONE']).optional(),

  // ---- plan + billing ----
  planId: objectIdSchema.optional().or(z.literal('')),
  startMode: z.enum(['TRIAL', 'PAID', 'CUSTOM']).default('TRIAL'),
  trialDays: z.coerce.number().int().min(0).max(120).optional(),
  billingCycle: z.enum(CYCLES).optional(),
  startDate: optionalDate,
  endDate: optionalDate,

  admin: adminSchema,
});

export const updateCompanySchema = createCompanySchema
  .omit({ admin: true, planId: true, startMode: true, trialDays: true, billingCycle: true, startDate: true, endDate: true })
  .partial()
  .extend({
    // Fields the create schema makes optional-but-validated stay editable here.
    businessName: z.string().trim().min(2, 'Business name is required').max(160).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/, 'Slug must be 3-60 lowercase characters')
      .optional()
      .or(z.literal('')),
    graceDays: z.coerce.number().int().min(0).max(60).optional(),
    userLimit: z.coerce.number().int().min(1).max(10000).optional(),
  });

export const companyStatusSchema = z.object({
  status: z.enum(STATUS_VALUES, { errorMap: () => ({ message: 'Invalid status' }) }),
  reason: z.string().trim().min(3, 'A reason is required').max(300).optional().default(''),
  /** Optional new end date used when reactivating / renewing. */
  subscriptionEnd: optionalDate,
});

export const assignSubscriptionSchema = z.object({
  planId: objectIdSchema,
  billingCycle: z.enum(CYCLES).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  price: z.coerce.number().min(0).max(100000000).optional(),
  autoRenew: z.boolean().optional().default(true),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
  /** Move the company to ACTIVE when the subscription starts. */
  activate: z.boolean().optional().default(true),
});

export const companyParamsSchema = z.object({ id: objectIdSchema });

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

const planFeatures = z
  .object({
    gpsTracking: z.boolean().optional(),
    multiWarehouse: z.boolean().optional(),
    eInvoice: z.boolean().optional(),
    apiAccess: z.boolean().optional(),
    fieldForce: z.boolean().optional(),
    barcode: z.boolean().optional(),
    schemes: z.boolean().optional(),
    purchase: z.boolean().optional(),
  })
  .partial()
  .optional();

export const createPlanSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(20),
  name: z.string().trim().min(2, 'Plan name is required').max(80),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  price: z.coerce.number().min(0, 'Price cannot be negative').max(100000000),
  currency: z.string().trim().max(8).optional(),
  billingCycle: z.enum(CYCLES).default('YEARLY'),
  trialDays: z.coerce.number().int().min(0).max(365).default(14),
  maxUsers: z.coerce.number().int().min(1).max(10000).default(5),
  maxCustomers: z.coerce.number().int().min(1).max(1000000).default(500),
  maxInvoicesPerMonth: z.coerce.number().int().min(1).max(1000000).default(500),
  features: planFeatures,
  highlights: z.array(z.string().trim().min(1).max(160)).max(12).optional().default([]),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const updatePlanSchema = createPlanSchema.partial();

// ---------------------------------------------------------------------------
// Impersonation
// ---------------------------------------------------------------------------

export const impersonateSchema = z.object({
  /** Act as a specific user; defaults to the company administrator. */
  userId: objectIdSchema.optional(),
});

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

export const auditLogQuerySchema = paginationSchema.extend({
  sort: z.enum(['occurredAt']).optional(),
  action: z.string().trim().max(40).optional(),
  entityType: z.string().trim().max(60).optional(),
  severity: z.enum(['INFO', 'WARN', 'ERROR']).optional(),
  actorId: objectIdSchema.optional(),
  companyId: objectIdSchema.optional(),
});

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  body: z.string().trim().max(4000).optional().or(z.literal('')),
  type: z.enum(['INFO', 'UPDATE', 'MAINTENANCE', 'PROMO', 'FEATURE']).default('INFO'),
  broadcast: z.boolean().default(true),
  targetCompanies: z.array(objectIdSchema).max(500).optional().default([]),
  active: z.boolean().default(true),
  startsAt: optionalDate,
  endsAt: optionalDate,
  ctaLabel: z.string().trim().max(80).optional().or(z.literal('')),
  ctaLink: z.string().trim().max(400).optional().or(z.literal('')),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();

// ---------------------------------------------------------------------------
// Platform admin profile
// ---------------------------------------------------------------------------

export const updatePlatformProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9()\-\s]{6,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
});

export const platformChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'At least 8 characters')
    .max(128)
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Must contain a symbol'),
});

/** Kept for parity with other validator files. */
export const PLATFORM_ROLE_VALUES = Object.values(COMPANY_ROLES);
export const AUDIT_ACTION_VALUES = Object.values(AUDIT_ACTIONS);

export default {
  companyListQuerySchema,
  createCompanySchema,
  updateCompanySchema,
  companyStatusSchema,
  assignSubscriptionSchema,
  createPlanSchema,
  updatePlanSchema,
};
