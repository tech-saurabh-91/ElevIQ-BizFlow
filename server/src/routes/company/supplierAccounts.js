import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../../controllers/company/supplierAccountsController.js';
import { validate, objectIdSchema } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import { PAYMENT_MODES } from '../../config/constants.js';

/**
 * Accounts payable: /purchase-bills, /supplier-payments, /purchase-returns
 * (mounted separately in routes/company/index.js).
 */
const text = (max) => z.string().trim().max(max).optional().or(z.literal(''));
const supplierQuery = z.object({ supplierId: objectIdSchema.optional() }).passthrough();
const cancelBody = z.object({ reason: text(500) }).partial();

// ---- Bills ------------------------------------------------------------------
const billBody = z.object({
  supplierId: objectIdSchema,
  supplierInvoiceNo: z.string().trim().min(1, 'Enter the supplier invoice number').max(60),
  supplierInvoiceDate: z.string().min(1, 'Enter the supplier invoice date'),
  grnIds: z.array(objectIdSchema).min(1, 'Pick at least one goods receipt').max(50),
  items: z
    .array(
      z.object({
        grnItemId: objectIdSchema,
        qty: z.coerce.number().min(0).optional(),
        taxRate: z.coerce.number().min(0).max(100).optional(),
      })
    )
    .max(1000)
    .optional(),
  otherCharges: z.coerce.number().min(0).max(1e9).optional(),
  notes: text(1000),
});

export const bills = Router();
bills.get('/', authorize('bills.view'), ctrl.listBills);
bills.get('/summary', authorize('bills.view'), ctrl.payablesSummary);
bills.get('/form-options', authorize('bills.create'), validate({ query: supplierQuery }), ctrl.billFormOptions);
bills.post('/', authorize('bills.create'), validate({ body: billBody }), ctrl.createBill);
bills.get('/:id', authorize('bills.view'), validate({ params: idParamsSchema }), ctrl.getBill);
bills.post('/:id/cancel', authorize('bills.cancel'), validate({ params: idParamsSchema, body: cancelBody }), ctrl.cancelBill);

// ---- Payments -----------------------------------------------------------------
const paymentBody = z.object({
  supplierId: objectIdSchema,
  amount: z.coerce.number().positive('Enter the amount paid').max(1e11),
  paymentDate: z.string().optional(),
  mode: z.enum(PAYMENT_MODES).optional(),
  reference: text(80),
  allocations: z.array(z.object({ bill: objectIdSchema, amount: z.coerce.number().min(0) })).max(500).optional(),
  notes: text(1000),
});

export const payments = Router();
payments.get('/', authorize('supplierpayments.view'), ctrl.listPayments);
payments.get('/form-options', authorize('supplierpayments.create'), validate({ query: supplierQuery }), ctrl.paymentFormOptions);
payments.post('/', authorize('supplierpayments.create'), validate({ body: paymentBody }), ctrl.createPayment);
payments.get('/:id', authorize('supplierpayments.view'), validate({ params: idParamsSchema }), ctrl.getPayment);
payments.post('/:id/cancel', authorize('supplierpayments.cancel'), validate({ params: idParamsSchema, body: cancelBody }), ctrl.cancelPayment);

// ---- Purchase returns -----------------------------------------------------------
const returnBody = z.object({
  grnId: objectIdSchema,
  items: z.array(z.object({ grnItemId: objectIdSchema, qty: z.coerce.number().min(0) })).min(1).max(500),
  reason: text(300),
  notes: text(1000),
  returnDate: z.string().optional(),
});

export const returns = Router();
returns.get('/', authorize('purchasereturns.view'), ctrl.listReturns);
returns.get('/form-options', authorize('purchasereturns.create'), validate({ query: supplierQuery }), ctrl.returnFormOptions);
returns.post('/', authorize('purchasereturns.create'), validate({ body: returnBody }), ctrl.createReturn);
returns.get('/:id', authorize('purchasereturns.view'), validate({ params: idParamsSchema }), ctrl.getReturn);
returns.post('/:id/cancel', authorize('purchasereturns.cancel'), validate({ params: idParamsSchema, body: cancelBody }), ctrl.cancelReturn);
