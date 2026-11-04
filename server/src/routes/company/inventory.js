import { Router } from 'express';
import * as ctrl from '../../controllers/company/inventoryController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { spreadsheetUpload } from '../../middlewares/upload.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import {
  stockListQuerySchema,
  movementListQuerySchema,
  productHistoryQuerySchema,
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
} from '../../validators/inventoryValidators.js';

/**
 * Phase 7 - Inventory API: stock ledger, adjustments and transfers.
 * Mounted at /api/v1/inventory. Static routes precede `/:id`.
 */
const router = Router();

// ---- Stock ledger ----------------------------------------------------------
router.get('/stock', authorize('inventory.view'), validate({ query: stockListQuerySchema }), ctrl.listStock);
router.get('/stock/export', authorize('inventory.export'), validate({ query: stockListQuerySchema }), ctrl.exportStock);
router.get('/movements', authorize('inventory.view'), validate({ query: movementListQuerySchema }), ctrl.listMovements);
router.get('/stats', authorize('inventory.view'), ctrl.stats);

// Opening stock for a warehouse from Excel (?warehouse=<id>; dryRun=true validates only).
router.get('/opening-stock/import/template', authorize('inventory.adjustments.manage'), ctrl.openingStockTemplate);
router.post(
  '/opening-stock/import',
  authorize('inventory.adjustments.manage'),
  spreadsheetUpload.single('file'),
  ctrl.openingStockImport
);
router.get('/low-stock', authorize('inventory.view'), ctrl.lowStock);
router.get('/form-options', authorize('inventory.view'), ctrl.formOptions);

// Product stock history (has a path param; declared before /:id style routes)
router.get(
  '/products/:id/movements',
  authorize('inventory.view'),
  validate({ params: idParamsSchema, query: productHistoryQuerySchema }),
  ctrl.productHistory
);

// ---- Adjustments -----------------------------------------------------------
router.get('/adjustments', authorize('inventory.adjustments.view'), validate({ query: adjustmentListQuerySchema }), ctrl.listAdjustments);
router.post(
  '/adjustments',
  authorize('inventory.adjustments.manage'),
  validate({ body: adjustmentCreateSchema }),
  ctrl.createAdjustment
);

router.get('/adjustments/:id', authorize('inventory.adjustments.view'), validate({ params: idParamsSchema }), ctrl.getAdjustment);
router.patch(
  '/adjustments/:id',
  authorize('inventory.adjustments.manage'),
  validate({ params: idParamsSchema, body: adjustmentUpdateSchema }),
  ctrl.updateAdjustment
);
router.put(
  '/adjustments/:id',
  authorize('inventory.adjustments.manage'),
  validate({ params: idParamsSchema, body: adjustmentUpdateSchema }),
  ctrl.updateAdjustment
);
router.delete(
  '/adjustments/:id',
  authorize('inventory.adjustments.manage'),
  validate({ params: idParamsSchema }),
  ctrl.removeAdjustment
);
router.post(
  '/adjustments/:id/post',
  authorize('inventory.adjustments.manage'),
  validate({ params: idParamsSchema, body: adjustmentPostSchema }),
  ctrl.postAdjustment
);
router.post(
  '/adjustments/:id/cancel',
  authorize('inventory.adjustments.manage'),
  validate({ params: idParamsSchema, body: adjustmentCancelSchema }),
  ctrl.cancelAdjustment
);

// ---- Transfers -------------------------------------------------------------
router.get('/transfers', authorize('inventory.transfers.view'), validate({ query: transferListQuerySchema }), ctrl.listTransfers);
router.post(
  '/transfers',
  authorize('inventory.transfers.manage'),
  validate({ body: transferCreateSchema }),
  ctrl.createTransfer
);

router.get('/transfers/:id', authorize('inventory.transfers.view'), validate({ params: idParamsSchema }), ctrl.getTransfer);
router.patch(
  '/transfers/:id',
  authorize('inventory.transfers.manage'),
  validate({ params: idParamsSchema, body: transferUpdateSchema }),
  ctrl.updateTransfer
);
router.put(
  '/transfers/:id',
  authorize('inventory.transfers.manage'),
  validate({ params: idParamsSchema, body: transferUpdateSchema }),
  ctrl.updateTransfer
);
router.delete(
  '/transfers/:id',
  authorize('inventory.transfers.manage'),
  validate({ params: idParamsSchema }),
  ctrl.removeTransfer
);
router.post(
  '/transfers/:id/dispatch',
  authorize('inventory.transfers.manage'),
  validate({ params: idParamsSchema, body: transferDispatchSchema }),
  ctrl.dispatchTransfer
);
router.post(
  '/transfers/:id/receive',
  authorize('inventory.transfers.manage'),
  validate({ params: idParamsSchema, body: transferReceiveSchema }),
  ctrl.receiveTransfer
);
router.post(
  '/transfers/:id/cancel',
  authorize('inventory.transfers.manage'),
  validate({ params: idParamsSchema, body: transferCancelSchema }),
  ctrl.cancelTransfer
);

export default router;
