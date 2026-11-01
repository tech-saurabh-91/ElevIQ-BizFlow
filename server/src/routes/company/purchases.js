import { Router } from 'express';
import * as ctrl from '../../controllers/company/purchaseController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import {
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
} from '../../validators/inventoryValidators.js';

/**
 * Phase 7 - Purchasing API: Purchase Orders + Goods Receipts.
 * Mounted at /api/v1/purchase-orders and /api/v1/goods-receipts.
 * Static routes are declared before `/:id`.
 */

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------
export const purchaseOrders = Router();

purchaseOrders.get('/', authorize('purchases.view'), validate({ query: poListQuerySchema }), ctrl.listPos);
purchaseOrders.get('/form-options', authorize('purchases.view'), ctrl.poFormOptions);
purchaseOrders.get('/export', authorize('purchases.export'), validate({ query: poListQuerySchema }), ctrl.exportPos);
purchaseOrders.post('/', authorize('purchases.create'), validate({ body: poCreateSchema }), ctrl.createPo);

purchaseOrders.get('/:id', authorize('purchases.view'), validate({ params: idParamsSchema }), ctrl.getPo);
purchaseOrders.patch(
  '/:id',
  authorize('purchases.update'),
  validate({ params: idParamsSchema, body: poUpdateSchema }),
  ctrl.updatePo
);
purchaseOrders.put(
  '/:id',
  authorize('purchases.update'),
  validate({ params: idParamsSchema, body: poUpdateSchema }),
  ctrl.updatePo
);
purchaseOrders.delete('/:id', authorize('purchases.delete'), validate({ params: idParamsSchema }), ctrl.removePo);

purchaseOrders.post(
  '/:id/send',
  authorize('purchases.update'),
  validate({ params: idParamsSchema, body: poStatusSchema }),
  ctrl.sendPo
);
purchaseOrders.post(
  '/:id/cancel',
  authorize('purchases.cancel'),
  validate({ params: idParamsSchema, body: poCancelSchema }),
  ctrl.cancelPo
);

// ---------------------------------------------------------------------------
// Goods receipt notes
// ---------------------------------------------------------------------------
export const goodsReceipts = Router();

goodsReceipts.get('/', authorize('grn.view'), validate({ query: grnListQuerySchema }), ctrl.listGrns);
goodsReceipts.get('/form-options', authorize('grn.view'), validate({ query: grnFormOptionsQuerySchema }), ctrl.grnFormOptions);
goodsReceipts.post('/', authorize('grn.create'), validate({ body: grnCreateSchema }), ctrl.createGrn);

goodsReceipts.get('/:id', authorize('grn.view'), validate({ params: idParamsSchema }), ctrl.getGrn);
goodsReceipts.patch(
  '/:id',
  authorize('grn.update'),
  validate({ params: idParamsSchema, body: grnUpdateSchema }),
  ctrl.updateGrn
);
goodsReceipts.put(
  '/:id',
  authorize('grn.update'),
  validate({ params: idParamsSchema, body: grnUpdateSchema }),
  ctrl.updateGrn
);
goodsReceipts.delete('/:id', authorize('grn.delete'), validate({ params: idParamsSchema }), ctrl.removeGrn);

goodsReceipts.post(
  '/:id/post',
  authorize('grn.post'),
  validate({ params: idParamsSchema, body: grnPostSchema }),
  ctrl.postGrn
);
goodsReceipts.post(
  '/:id/cancel',
  authorize('grn.update'),
  validate({ params: idParamsSchema, body: grnCancelSchema }),
  ctrl.cancelGrn
);

export default { purchaseOrders, goodsReceipts };
