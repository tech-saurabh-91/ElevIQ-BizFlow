import { Router } from 'express';
import * as ctrl from '../../controllers/company/reportController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import {
  reportOverviewQuerySchema,
  reportWindowQuerySchema,
  receivablesQuerySchema,
  inventoryReportQuerySchema,
  fieldForceReportQuerySchema,
  reportExportQuerySchema,
} from '../../validators/reportValidators.js';

/**
 * Phase 8 - Reports API.
 *
 * Every endpoint is read-only and requires `reports.view`; the Excel export
 * requires the stricter `reports.export`. Windows default to the last 30 days
 * when the client omits dateFrom/dateTo.
 */
const router = Router();

router.get('/overview', authorize('reports.view'), validate({ query: reportOverviewQuerySchema }), ctrl.overview);
router.get('/sales', authorize('reports.view'), validate({ query: reportWindowQuerySchema }), ctrl.sales);
router.get('/receivables', authorize('reports.view'), validate({ query: receivablesQuerySchema }), ctrl.receivables);
router.get('/collections', authorize('reports.view'), validate({ query: reportWindowQuerySchema }), ctrl.collections);
router.get('/inventory', authorize('reports.view'), validate({ query: inventoryReportQuerySchema }), ctrl.inventory);
router.get('/field-force', authorize('reports.view'), validate({ query: fieldForceReportQuerySchema }), ctrl.fieldForce);
router.get('/export', authorize('reports.export'), validate({ query: reportExportQuerySchema }), ctrl.exportXlsx);

export default router;
