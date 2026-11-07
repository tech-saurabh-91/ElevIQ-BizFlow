import { z } from 'zod';
import { paginationSchema, objectIdSchema, dateNotBefore } from '../middlewares/validate.js';
import { CUSTOMER_TYPES } from '../config/constants.js';

/** Discount master, trade schemes and the sale pricing preview. */

const softString = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const boolQuery = z.enum(['true', 'false']).optional();
const optionalDate = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .or(z.null())
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date' });
const percent = z.coerce.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100%');
const tags = z.array(z.string().trim().min(1).max(80)).max(200);

const CUSTOMER_SCOPES = ['ALL', 'CUSTOMER_TYPE', 'CUSTOMER'];
const PRODUCT_SCOPES = ['ALL', 'CATEGORY', 'BRAND', 'PRODUCT'];
const SCHEME_TYPES = ['FREE_GOODS', 'QTY_DISCOUNT', 'VALUE_DISCOUNT'];

const scopeFields = {
  customerScope: z.enum(CUSTOMER_SCOPES).optional(),
  customers: z.array(objectIdSchema).max(2000).optional(),
  customerTypes: z.array(z.enum(CUSTOMER_TYPES)).max(10).optional(),
  productScope: z.enum(PRODUCT_SCOPES).optional(),
  products: z.array(objectIdSchema).max(2000).optional(),
  categories: tags.optional(),
  brands: tags.optional(),
};

/** The chosen scope must name who / what it is for. */
const scopeFilled = (v, ctx) => {
  if (v.customerScope === 'CUSTOMER' && !v.customers?.length) ctx.addIssue({ code: 'custom', path: ['customers'], message: 'Pick at least one customer' });
  if (v.customerScope === 'CUSTOMER_TYPE' && !v.customerTypes?.length) ctx.addIssue({ code: 'custom', path: ['customerTypes'], message: 'Pick at least one customer type' });
  if (v.productScope === 'PRODUCT' && !v.products?.length) ctx.addIssue({ code: 'custom', path: ['products'], message: 'Pick at least one product' });
  if (v.productScope === 'CATEGORY' && !v.categories?.length) ctx.addIssue({ code: 'custom', path: ['categories'], message: 'Pick at least one category' });
  if (v.productScope === 'BRAND' && !v.brands?.length) ctx.addIssue({ code: 'custom', path: ['brands'], message: 'Pick at least one brand' });
};
const validToAfterFrom = dateNotBefore('validTo', 'validFrom', 'Valid to cannot be before valid from');

// ---- Discount rules -----------------------------------------------------------
const discountBase = z.object({
  name: z.string().trim().min(2, 'Discount name is required').max(120),
  code: softString(24),
  description: softString(500),
  discountPercent: percent.refine((n) => n > 0, 'Enter a discount above 0%'),
  ...scopeFields,
  validFrom: optionalDate,
  validTo: optionalDate,
  isActive: z.boolean().optional(),
  notes: softString(500),
});
const discountChecks = (v, ctx) => {
  scopeFilled(v, ctx);
  validToAfterFrom(v, ctx);
};
export const discountCreateSchema = discountBase.superRefine(discountChecks);
export const discountUpdateSchema = discountBase.partial().superRefine(discountChecks);
export const discountListQuerySchema = paginationSchema.extend({
  sort: z.enum(['createdAt', 'name', 'code', 'discountPercent']).optional(),
  customerScope: z.enum(CUSTOMER_SCOPES).optional(),
  productScope: z.enum(PRODUCT_SCOPES).optional(),
  isActive: boolQuery,
});

// ---- Schemes ------------------------------------------------------------------
const slab = z.object({
  from: z.coerce.number().min(0, 'Cannot be negative').max(1e12),
  discountPercent: percent.refine((n) => n > 0, 'Enter a discount above 0%'),
});
const schemeBase = z.object({
  name: z.string().trim().min(2, 'Scheme name is required').max(120),
  code: softString(24),
  description: softString(500),
  type: z.enum(SCHEME_TYPES),
  ...scopeFields,
  buyQty: z.coerce.number().min(0).max(1e9).optional(),
  freeQty: z.coerce.number().min(0).max(1e9).optional(),
  freeProduct: objectIdSchema.optional().or(z.literal('')).or(z.null()),
  repeat: z.boolean().optional(),
  slabs: z.array(slab).max(20).optional(),
  validFrom: z.string().trim().min(1, 'Choose the start date').refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date'),
  validTo: optionalDate,
  isActive: z.boolean().optional(),
  notes: softString(500),
});
const schemeChecks = (v, ctx) => {
  scopeFilled(v, ctx);
  validToAfterFrom(v, ctx);
  if (v.type === 'FREE_GOODS') {
    if (!(Number(v.buyQty) > 0)) ctx.addIssue({ code: 'custom', path: ['buyQty'], message: 'Enter the quantity to buy' });
    if (!(Number(v.freeQty) > 0)) ctx.addIssue({ code: 'custom', path: ['freeQty'], message: 'Enter the free quantity' });
  }
  if ((v.type === 'QTY_DISCOUNT' || v.type === 'VALUE_DISCOUNT') && v.slabs !== undefined) {
    if (!v.slabs.length) ctx.addIssue({ code: 'custom', path: ['slabs'], message: 'Add at least one slab' });
    const froms = v.slabs.map((s) => Number(s.from));
    if (new Set(froms).size !== froms.length) ctx.addIssue({ code: 'custom', path: ['slabs'], message: 'Two slabs start at the same figure' });
  }
};
export const schemeCreateSchema = schemeBase.superRefine((v, ctx) => {
  schemeChecks(v, ctx);
  if ((v.type === 'QTY_DISCOUNT' || v.type === 'VALUE_DISCOUNT') && v.slabs === undefined) {
    ctx.addIssue({ code: 'custom', path: ['slabs'], message: 'Add at least one slab' });
  }
});
export const schemeUpdateSchema = schemeBase.partial().superRefine(schemeChecks);
export const schemeListQuerySchema = paginationSchema.extend({
  sort: z.enum(['createdAt', 'name', 'code', 'validFrom']).optional(),
  type: z.enum(SCHEME_TYPES).optional(),
  isActive: boolQuery,
});

// ---- Preview ------------------------------------------------------------------
export const pricingPreviewSchema = z.object({
  customerId: objectIdSchema,
  date: optionalDate,
  priceList: objectIdSchema.optional().or(z.literal('')),
  items: z
    .array(
      z.object({
        product: objectIdSchema,
        unit: z.string().trim().max(10).optional(),
        qty: z.coerce.number().positive().max(1_000_000),
        unitPrice: z.coerce.number().min(0).max(1e12).optional(),
        discountPercent: z.coerce.number().min(0).max(100).optional(),
        taxRate: z.coerce.number().min(0).max(100).optional(),
      })
    )
    .max(200),
});
