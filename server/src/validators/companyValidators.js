import { z } from 'zod';
import { paginationSchema, objectIdSchema, dateNotBefore } from '../middlewares/validate.js';
import {
  CUSTOMER_TYPES,
  PAYMENT_TERMS,
  COMPANY_ROLE_LIST,
  AUDIT_ACTIONS,
  SALES_TYPES,
} from '../config/constants.js';

/**
 * Phase 3 - Company Workspace validators.
 * Covers customers, products, suppliers, warehouses, routes, price lists,
 * users and company settings. Every mutating endpoint validates through here.
 */

const softString = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date' });

const money = z.coerce.number().min(0, 'Cannot be negative').max(1e12).optional();

const refId = objectIdSchema.optional().or(z.literal(''));

const addressSchema = z
  .object({
    line1: softString(160),
    line2: softString(160),
    city: softString(80),
    state: softString(80),
    country: softString(80),
    pincode: softString(12),
    gps: z
      .object({
        lat: z.coerce.number().min(-90).max(90).nullable().optional(),
        lng: z.coerce.number().min(-180).max(180).nullable().optional(),
      })
      .optional(),
  })
  .partial();

const boolQuery = z.enum(['true', 'false']).optional();

const PASSWORD_RULES = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Must contain a symbol');

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------
export const idParamsSchema = z.object({ id: objectIdSchema });

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export const customerCreateSchema = z.object({
  name: z.string().trim().min(2, 'Customer name is required').max(160),
  code: softString(24),
  type: z.enum(CUSTOMER_TYPES).optional(),
  contactPerson: softString(120),
  phone: softString(20),
  alternatePhone: softString(20),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),

  gstin: softString(20),
  pan: softString(12),
  taxId: softString(40),

  address: addressSchema.optional(),
  shippingAddress: addressSchema.optional(),
  shippingSameAsBilling: z.boolean().optional(),

  creditLimit: money,
  creditDays: z.coerce.number().int().min(0).max(365).optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
  openingBalance: money,

  priceList: refId,
  assignedTo: refId,
  route: refId,
  warehouse: refId,
  territory: softString(80),

  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  notes: softString(1000),
  isActive: z.boolean().optional(),
});

export const customerUpdateSchema = customerCreateSchema.partial();

export const customerListQuerySchema = paginationSchema.extend({
  sort: z
    .enum(['createdAt', 'name', 'code', 'outstanding', 'creditLimit', 'lastOrderAt'])
    .optional(),
  type: z.enum(CUSTOMER_TYPES).optional(),
  isActive: boolQuery,
  route: objectIdSchema.optional(),
  assignedTo: objectIdSchema.optional(),
  priceList: objectIdSchema.optional(),
  territory: softString(80),
  city: softString(80),
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
const packUnitSchema = z.object({
  unit: z.string().trim().min(1, 'Choose a unit').max(10),
  factor: z.coerce.number().positive('Must be more than 0').max(100000),
  barcode: softString(14),
  price: z.coerce.number().min(0, 'Cannot be negative').max(1e12).optional(),
});

// The product code (sku) and stock are system-maintained, so they are not
// accepted here; opening stock is only taken when a product is created.
export const productCreateSchema = z.object({
  name: z.string().trim().min(2, 'Product name is required').max(180),
  customCode: softString(40),
  barcode: softString(14),

  classificationId: refId,
  categoryId: refId,
  subCategoryId: refId,
  // Names are accepted for imports and older clients (matched against the master).
  classification: softString(80),
  category: softString(80),
  subCategory: softString(80),
  brand: softString(80),

  unit: softString(10),
  packUnits: z.array(packUnitSchema).max(10).optional(),

  hsnCode: softString(20),
  gstRate: z.coerce.number().min(0).max(100).optional(),

  mrp: money,
  sellingPrice: money,
  dealerPrice: money,
  purchasePrice: money,

  openingStock: z.coerce.number().min(0, 'Cannot be negative').max(1e9).optional(),
  openingWarehouse: refId,
  lowStockLevel: z.coerce.number().min(0).max(1e9).optional(),

  image: softString(500),
  description: softString(1000),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),

  isBatchTracked: z.boolean().optional(),
  isReturnable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const productUpdateSchema = productCreateSchema.omit({ openingStock: true, openingWarehouse: true }).partial();

export const productListQuerySchema = paginationSchema.extend({
  sort: z.enum(['createdAt', 'name', 'sku', 'sellingPrice', 'stock', 'mrp']).optional(),
  category: softString(80),
  categoryId: objectIdSchema.optional(),
  classificationId: objectIdSchema.optional(),
  brand: softString(80),
  isActive: boolQuery,
  lowStock: z.enum(['true', 'false']).optional(),
});

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------
export const supplierCreateSchema = z.object({
  name: z.string().trim().min(2, 'Supplier name is required').max(160),
  code: softString(24),
  contactPerson: softString(120),
  phone: softString(20),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
  website: softString(200),

  gstin: softString(20),
  pan: softString(12),

  address: addressSchema.optional(),
  bank: z
    .object({
      accountName: softString(120),
      accountNumber: softString(40),
      ifsc: softString(16),
      bankName: softString(120),
      branch: softString(120),
      upiVpa: softString(80),
    })
    .partial()
    .optional(),

  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
  creditDays: z.coerce.number().int().min(0).max(365).optional(),
  openingBalance: money,

  categories: z.array(z.string().trim().max(60)).max(30).optional(),
  notes: softString(1000),
  isActive: z.boolean().optional(),
});

export const supplierUpdateSchema = supplierCreateSchema.partial();

export const supplierListQuerySchema = paginationSchema.extend({
  sort: z.enum(['createdAt', 'name', 'code', 'outstanding']).optional(),
  isActive: boolQuery,
});

// ---------------------------------------------------------------------------
// Warehouses (hierarchy + van tracking - Phase A)
// ---------------------------------------------------------------------------
const WAREHOUSE_TYPES = ['MAIN', 'SUB', 'VAN', 'TRANSIT', 'DAMAGED'];

export const warehouseCreateSchema = z.object({
  name: z.string().trim().min(2, 'Warehouse name is required').max(120),
  code: z.string().trim().toUpperCase().min(2, 'Warehouse code is required').max(20),
  type: z.enum(WAREHOUSE_TYPES).optional(),
  // Parent rules (MAIN parentless, SUB/TRANSIT/DAMAGED under MAIN, VAN under
  // MAIN|SUB) are enforced in the controller, which must load the parent doc.
  parent: refId,
  // Van-only fields; ignored for other types.
  vehicleNumber: z.string().trim().toUpperCase().max(20).optional().or(z.literal('')),
  vehicleType: softString(40),
  image: softString(500),
  address: addressSchema.optional(),
  phone: softString(20),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
  manager: refId,
  capacity: z.coerce.number().min(0).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: softString(500),
});

export const warehouseUpdateSchema = warehouseCreateSchema.partial();

export const warehouseListQuerySchema = paginationSchema.extend({
  sort: z.enum(['createdAt', 'name', 'code']).optional(),
  type: z.enum(WAREHOUSE_TYPES).optional(),
  isActive: boolQuery,
});

// --- Van assignments -------------------------------------------------------

export const vanAssignmentCreateSchema = z.object({
  executive: objectIdSchema,
  // Defaults to "now" in the controller when omitted.
  fromDate: z.coerce.date().optional(),
  dayCloseMandatory: z.boolean().optional(),
  notes: softString(500),
});

export const vanAssignmentCloseSchema = z.object({
  // Defaults to "now" in the controller when omitted.
  toDate: z.coerce.date().optional(),
  closeNotes: softString(500),
});

export const vanAssignmentListQuerySchema = paginationSchema.extend({
  active: boolQuery,
  executive: refId,
});

export const warehouseAssignmentParamsSchema = z.object({
  id: objectIdSchema,
  assignmentId: objectIdSchema,
});

// ---------------------------------------------------------------------------
// Routes / beats
// ---------------------------------------------------------------------------
const BEAT_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export const routeCreateSchema = z.object({
  name: z.string().trim().min(2, 'Route name is required').max(120),
  code: z.string().trim().toUpperCase().min(2, 'Route code is required').max(20),
  description: softString(500),
  territory: softString(80),
  warehouse: refId,
  assignedTo: refId,
  beatDays: z.array(z.enum(BEAT_DAYS)).max(7).optional(),
  sequence: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  notes: softString(500),
});

export const routeUpdateSchema = routeCreateSchema.partial();

export const routeListQuerySchema = paginationSchema.extend({
  sort: z.enum(['createdAt', 'name', 'code', 'sequence']).optional(),
  isActive: boolQuery,
  assignedTo: objectIdSchema.optional(),
  territory: softString(80),
});

// ---------------------------------------------------------------------------
// Price lists
// ---------------------------------------------------------------------------
const PRICE_LIST_TYPES = ['RETAIL', 'WHOLESALE', 'DISTRIBUTOR', 'CUSTOM'];

const priceListItemSchema = z.object({
  product: objectIdSchema,
  price: z.coerce.number().min(0).max(1e12),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  minQty: z.coerce.number().min(0).optional(),
});

const priceListBaseSchema = z.object({
  // code (auto PL-0001...) and currency (the company's) are set by the server.
  name: z.string().trim().min(2, 'Price list name is required').max(120),
  description: softString(500),
  type: z.enum(PRICE_LIST_TYPES).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  validFrom: optionalDate,
  validTo: optionalDate,
  items: z.array(priceListItemSchema).max(5000).optional(),
  notes: softString(500),
});

const validToAfterFrom = dateNotBefore('validTo', 'validFrom', 'Valid to cannot be before valid from');
export const priceListCreateSchema = priceListBaseSchema.superRefine(validToAfterFrom);
export const priceListUpdateSchema = priceListBaseSchema.partial().superRefine(validToAfterFrom);

export const priceListListQuerySchema = paginationSchema.extend({
  sort: z.enum(['createdAt', 'name', 'code']).optional(),
  type: z.enum(PRICE_LIST_TYPES).optional(),
  isActive: boolQuery,
});

// ---------------------------------------------------------------------------
// Users & teams
// ---------------------------------------------------------------------------
export const userCreateSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(120),
    email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
    phone: z
      .string()
      .trim()
      .regex(/^[+0-9()\-\s]{6,20}$/, 'Enter a valid phone number')
      .optional()
      .or(z.literal('')),
    password: PASSWORD_RULES.optional(),
    role: z.enum(COMPANY_ROLE_LIST),
    salesType: z.enum(SALES_TYPES).optional(),
    title: softString(80),
    designation: softString(80),
    territory: softString(80),
    reportingManager: refId,
    teamMembers: z.array(objectIdSchema).max(200).optional(),
    routes: z.array(objectIdSchema).max(50).optional(),
    warehouse: refId,
    isActive: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: 'Email or phone is required',
    path: ['email'],
  });

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120).optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9()\-\s]{6,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  role: z.enum(COMPANY_ROLE_LIST).optional(),
  salesType: z.enum(SALES_TYPES).optional(),
  title: softString(80),
  designation: softString(80),
  territory: softString(80),
  reportingManager: refId,
  teamMembers: z.array(objectIdSchema).max(200).optional(),
  routes: z.array(objectIdSchema).max(50).optional(),
  warehouse: refId,
  isActive: z.boolean().optional(),
});

export const userListQuerySchema = paginationSchema.extend({
  sort: z.enum(['createdAt', 'name', 'role', 'lastLoginAt']).optional(),
  role: z.enum(COMPANY_ROLE_LIST).optional(),
  isActive: boolQuery,
  reportingManager: objectIdSchema.optional(),
  territory: softString(80),
});

export const userResetPasswordSchema = z.object({
  newPassword: PASSWORD_RULES,
});

// ---------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------
const seriesEntry = z
  .object({
    prefix: z.string().trim().max(10).optional(),
    pad: z.coerce.number().int().min(1).max(12).optional(),
  })
  .partial();

export const settingsUpdateSchema = z.object({
  displayName: softString(160),
  logo: softString(500),
  address: addressSchema.optional(),

  // Registration details (stored on the Company). Code and registered
  // business name stay platform-managed.
  profile: z
    .object({
      legalName: softString(200),
      businessType: z.enum(['RETAIL', 'WHOLESALE', 'BOTH']).optional(),
      email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
      phone: softString(20),
      website: softString(200),
      gstin: softString(30),
      pan: softString(20),
      taxId: softString(40),
    })
    .partial()
    .optional(),

  timezone: softString(60),
  currency: softString(8),
  currencySymbol: softString(4),
  financialYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),

  series: z
    .object({
      order: seriesEntry.optional(),
      invoice: seriesEntry.optional(),
      creditNote: seriesEntry.optional(),
      payment: seriesEntry.optional(),
      purchase: seriesEntry.optional(),
      grn: seriesEntry.optional(),
      customer: seriesEntry.optional(),
      product: seriesEntry.optional(),
      supplier: seriesEntry.optional(),
    })
    .partial()
    .optional(),

  tax: z
    .object({
      regime: z.enum(['GST', 'VAT', 'SALES_TAX', 'NONE']).optional(),
      defaultTaxRate: z.coerce.number().min(0).max(100).optional(),
      taxInclusive: z.boolean().optional(),
      placeOfSupply: softString(80),
      enableCgstSgst: z.boolean().optional(),
      eInvoiceEnabled: z.boolean().optional(),
      eInvoiceGstin: softString(20),
      taxLabel: softString(20),
    })
    .partial()
    .optional(),

  invoice: z
    .object({
      terms: softString(2000),
      footerNote: softString(500),
      defaultDueDays: z.coerce.number().int().min(0).max(365).optional(),
      showQr: z.boolean().optional(),
      upiVpa: softString(80),
      showGstin: z.boolean().optional(),
      rounding: z.enum(['NEAREST', 'DOWN', 'NONE']).optional(),
      defaultPaymentTerms: z.enum(PAYMENT_TERMS).optional(),
      allowDirectInvoice: z.boolean().optional(),
    })
    .partial()
    .optional(),

  order: z
    .object({
      approvalThreshold: z.coerce.number().min(0).optional(),
      creditLimitAction: z.enum(['WARN', 'BLOCK', 'NONE']).optional(),
      reserveStockOnConfirm: z.boolean().optional(),
      allowNegativeStock: z.boolean().optional(),
      defaultPaymentMode: z.enum(['CASH', 'CREDIT']).optional(),
      showStockOnOrder: z.boolean().optional(),
    })
    .partial()
    .optional(),

  inventory: z
    .object({
      defaultWarehouse: refId,
      lowStockThreshold: z.coerce.number().min(0).optional(),
      // Only moving average is implemented; anything sent is stored as AVERAGE.
      valuationMethod: z.enum(['FIFO', 'AVERAGE', 'LIFO']).transform(() => 'AVERAGE').optional(),
      batchExpiry: z.boolean().optional(),
      mode: z.enum(['STOCK', 'SALES_ONLY']).optional(),
      defaultMarkupPercent: z.coerce.number().min(0).max(1000).optional(),
    })
    .partial()
    .optional(),

  collections: z
    .object({
      overdueReminderDays: z.coerce.number().int().min(0).max(90).optional(),
      sendOverdueReminders: z.boolean().optional(),
      fifoAllocationDefault: z.boolean().optional(),
    })
    .partial()
    .optional(),

  fieldForce: z
    .object({
      geofenceRadiusM: z.coerce.number().int().min(10).max(5000).optional(),
      requireGps: z.boolean().optional(),
      requireAttendance: z.boolean().optional(),
      saleOnlyInVisit: z.boolean().optional(),
      enforceGeofence: z.boolean().optional(),
      requireSelfie: z.boolean().optional(),
      trackLiveLocation: z.boolean().optional(),
      workStart: softString(5),
      workEnd: softString(5),
    })
    .partial()
    .optional(),

  featureFlags: z.record(z.boolean()).optional(),
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: softString(500),
});

export const rolePermissionsSchema = z.object({
  rolePermissions: z.record(z.array(z.enum(COMPANY_ROLE_LIST))),
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------
export const auditListQuerySchema = paginationSchema.extend({
  sort: z.enum(['occurredAt', 'action', 'entityType']).optional(),
  action: z.enum(Object.values(AUDIT_ACTIONS)).optional(),
  entityType: softString(60),
  actorId: objectIdSchema.optional(),
  dateFrom: optionalDate,
  dateTo: optionalDate,
});

// ---------------------------------------------------------------------------
// Lookups (shared select options)
// ---------------------------------------------------------------------------
export const lookupQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export default {
  idParamsSchema,
  customerCreateSchema,
  customerUpdateSchema,
  customerListQuerySchema,
  productCreateSchema,
  productUpdateSchema,
  productListQuerySchema,
  supplierCreateSchema,
  supplierUpdateSchema,
  supplierListQuerySchema,
  warehouseCreateSchema,
  warehouseUpdateSchema,
  warehouseListQuerySchema,
  vanAssignmentCreateSchema,
  vanAssignmentCloseSchema,
  vanAssignmentListQuerySchema,
  warehouseAssignmentParamsSchema,
  routeCreateSchema,
  routeUpdateSchema,
  routeListQuerySchema,
  priceListCreateSchema,
  priceListUpdateSchema,
  priceListListQuerySchema,
  userCreateSchema,
  userUpdateSchema,
  userListQuerySchema,
  userResetPasswordSchema,
  settingsUpdateSchema,
  rolePermissionsSchema,
  auditListQuerySchema,
  lookupQuerySchema,
};
