import { z } from 'zod';
import { paginationSchema, objectIdSchema, notFutureDate, dateNotBefore } from '../middlewares/validate.js';
import {
  MOVEMENT_TYPE_LIST,
  ADJUSTMENT_REASONS,
  ADJUSTMENT_STATUS_LIST,
  GRN_STATUS_LIST,
  TRANSFER_STATUS_LIST,
  PURCHASE_ORDER_STATUS_LIST,
} from '../config/constants.js';

/**
 * Phase 7 - Inventory validators.
 * Covers the stock ledger, adjustments, transfers, purchase orders and GRNs.
 * Quantities and costs are coerced so the client may send numbers as strings.
 */

const softString = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date' });

const refId = objectIdSchema.optional().or(z.literal(''));

/** Signed quantity for adjustments (may be negative). */
const signedQty = z.coerce.number().refine((n) => Number.isFinite(n) && n !== 0, {
  message: 'Quantity must be a non-zero number',
});

const positiveQty = z.coerce.number().positive('Quantity must be greater than zero').max(1e9);
const rate = z.coerce.number().min(0).max(1e9).optional();
const taxRate = z.coerce.number().min(0).max(100).optional();

// ---------------------------------------------------------------------------
// Stock ledger / balances
// ---------------------------------------------------------------------------

export const stockListQuerySchema = paginationSchema.extend({
  warehouseId: refId,
  productId: refId,
  lowStock: z.enum(['true', 'false']).optional(),
  outOfStock: z.enum(['true', 'false']).optional(),
});

export const movementListQuerySchema = paginationSchema.extend({
  warehouseId: refId,
  productId: refId,
  type: z.enum(MOVEMENT_TYPE_LIST).optional(),
  refType: z.string().trim().max(40).optional(),
  refId: refId,
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

export const productHistoryQuerySchema = paginationSchema.extend({
  warehouseId: refId,
  type: z.enum(MOVEMENT_TYPE_LIST).optional(),
});

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export const poLineSchema = z.object({
  // Base unit or one of the product's pack units (e.g. CTN).
  unit: z.string().trim().max(10).optional(),
  product: objectIdSchema,
  qty: positiveQty,
  unitPrice: rate,
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  taxRate,
  freeQty: z.coerce.number().min(0).max(1e9).optional(),
  note: softString(300),
});

export const poCreateSchema = z.object({
  supplierId: objectIdSchema,
  warehouse: refId,
  poDate: optionalDate.refine(notFutureDate, { message: 'PO date cannot be in the future' }),
  expectedDate: optionalDate,
  paymentTerms: z.string().trim().max(30).optional(),
  leadDays: z.coerce.number().min(0).max(365).optional(),
  poReference: softString(60),
  notes: softString(1000),
  internalNotes: softString(1000),
  terms: softString(2000),
  items: z.array(poLineSchema).min(1, 'Add at least one line').max(500),
  /** Optionally send the PO immediately on create. */
  send: z.boolean().optional(),
}).superRefine(dateNotBefore('expectedDate', 'poDate', 'Expected delivery cannot be before the PO date'));

export const poUpdateSchema = z
  .object({
    warehouse: refId,
    poDate: optionalDate.refine(notFutureDate, { message: 'PO date cannot be in the future' }),
    expectedDate: optionalDate,
    paymentTerms: z.string().trim().max(30).optional(),
    leadDays: z.coerce.number().min(0).max(365).optional(),
    poReference: softString(60),
    notes: softString(1000),
    internalNotes: softString(1000),
    terms: softString(2000),
    items: z.array(poLineSchema).min(1, 'Add at least one line').max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const poStatusSchema = z.object({ note: softString(500) });
export const poCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const poListQuerySchema = paginationSchema.extend({
  status: z.enum(PURCHASE_ORDER_STATUS_LIST).optional(),
  supplierId: refId,
  warehouseId: refId,
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

// ---------------------------------------------------------------------------
// Goods receipts
// ---------------------------------------------------------------------------

export const grnLineSchema = z.object({
  product: objectIdSchema,
  receivedQty: z.coerce.number().min(0, 'Cannot be negative').max(1e9),
  rejectedQty: z.coerce.number().min(0).max(1e9).optional(),
  rejectReason: softString(300),
  unitCost: rate,
  note: softString(300),
});

export const grnCreateSchema = z.object({
  purchaseOrder: refId,
  warehouse: objectIdSchema,
  grnDate: optionalDate.refine(notFutureDate, { message: 'Receipt date cannot be in the future' }),
  supplierId: refId,
  invoiceNo: softString(60),
  vehicleNo: softString(30),
  eWayBillNo: softString(30),
  notes: softString(1000),
  items: z.array(grnLineSchema).min(1, 'Add at least one line').max(500),
  /** Post the GRN immediately, booking stock in. */
  post: z.boolean().optional(),
});

export const grnUpdateSchema = z
  .object({
    warehouse: refId,
    grnDate: optionalDate.refine(notFutureDate, { message: 'Receipt date cannot be in the future' }),
    invoiceNo: softString(60),
    vehicleNo: softString(30),
    eWayBillNo: softString(30),
    notes: softString(1000),
    items: z.array(grnLineSchema).min(1, 'Add at least one line').max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const grnPostSchema = z.object({ note: softString(500) });
export const grnCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const grnListQuerySchema = paginationSchema.extend({
  status: z.enum(GRN_STATUS_LIST).optional(),
  warehouseId: refId,
  purchaseOrder: refId,
  supplierId: refId,
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

export const grnFormOptionsQuerySchema = z.object({
  purchaseOrder: objectIdSchema.optional().or(z.literal('')),
  warehouseId: objectIdSchema.optional().or(z.literal('')),
});

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

export const adjustmentLineSchema = z.object({
  product: objectIdSchema,
  qty: signedQty,
  unitCost: rate,
  reason: z.enum(ADJUSTMENT_REASONS).optional(),
  note: softString(300),
});

export const adjustmentCreateSchema = z.object({
  warehouse: objectIdSchema,
  adjustmentDate: optionalDate,
  reason: z.enum(ADJUSTMENT_REASONS),
  notes: softString(1000),
  items: z.array(adjustmentLineSchema).min(1, 'Add at least one line').max(500),
  post: z.boolean().optional(),
});

export const adjustmentUpdateSchema = z
  .object({
    warehouse: refId,
    adjustmentDate: optionalDate,
    reason: z.enum(ADJUSTMENT_REASONS).optional(),
    notes: softString(1000),
    items: z.array(adjustmentLineSchema).min(1, 'Add at least one line').max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const adjustmentPostSchema = z.object({ note: softString(500) });
export const adjustmentCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const adjustmentListQuerySchema = paginationSchema.extend({
  status: z.enum(ADJUSTMENT_STATUS_LIST).optional(),
  warehouseId: refId,
  reason: z.enum(ADJUSTMENT_REASONS).optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export const transferLineSchema = z.object({
  product: objectIdSchema,
  qty: positiveQty,
  note: softString(300),
});

export const transferCreateSchema = z
  .object({
    fromWarehouse: objectIdSchema,
    toWarehouse: objectIdSchema,
    transferDate: optionalDate,
    vehicleNo: softString(30),
    notes: softString(1000),
    items: z.array(transferLineSchema).min(1, 'Add at least one line').max(500),
  })
  .refine((v) => v.fromWarehouse !== v.toWarehouse, {
    message: 'Source and destination warehouses must be different',
    path: ['toWarehouse'],
  });

export const transferUpdateSchema = z
  .object({
    fromWarehouse: refId,
    toWarehouse: refId,
    transferDate: optionalDate,
    vehicleNo: softString(30),
    notes: softString(1000),
    items: z.array(transferLineSchema).min(1, 'Add at least one line').max(500).optional(),
  })
  .refine((v) => !v.fromWarehouse || !v.toWarehouse || v.fromWarehouse !== v.toWarehouse, {
    message: 'Source and destination warehouses must be different',
    path: ['toWarehouse'],
  });

export const transferDispatchSchema = z.object({ note: softString(500) });

export const transferReceiveSchema = z.object({
  note: softString(500),
  /** Optional per-line received quantities for short receipts. */
  received: z
    .array(z.object({ product: objectIdSchema, receivedQty: z.coerce.number().min(0).max(1e9) }))
    .max(500)
    .optional(),
});

export const transferCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const transferListQuerySchema = paginationSchema.extend({
  status: z.enum(TRANSFER_STATUS_LIST).optional(),
  fromWarehouse: refId,
  toWarehouse: refId,
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

export default {
  stockListQuerySchema,
  movementListQuerySchema,
  productHistoryQuerySchema,
  poCreateSchema,
  poUpdateSchema,
  poStatusSchema,
  poCancelSchema,
  poListQuerySchema,
  grnCreateSchema,
  grnUpdateSchema,
  grnPostSchema,
  grnCancelSchema,
  grnListQuerySchema,
  grnFormOptionsQuerySchema,
  adjustmentCreateSchema,
  adjustmentUpdateSchema,
  adjustmentPostSchema,
  adjustmentCancelSchema,
  adjustmentListQuerySchema,
  transferCreateSchema,
  transferUpdateSchema,
  transferDispatchSchema,
  transferReceiveSchema,
  transferCancelSchema,
  transferListQuerySchema,
};
