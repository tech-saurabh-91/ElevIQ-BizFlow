import { Router } from 'express';
import * as ctrl from '../../controllers/company/reportController.js';
import * as hub from '../../controllers/company/reportHubController.js';
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

// Reports hub (Register / MIS / Listing). Each report also checks its own
// permissions and the business mode in the registry.
const ANY_REPORT_GROUP = ['reports.register.view', 'reports.mis.view', 'reports.listing.view'];
router.get('/hub/catalog', authorize(...ANY_REPORT_GROUP), hub.catalog);
router.get('/hub/run/:code', authorize(...ANY_REPORT_GROUP), hub.run);
router.get('/hub/run/:code/export', authorize(...ANY_REPORT_GROUP), hub.exportXlsx);

router.get('/overview', authorize('reports.view'), validate({ query: reportOverviewQuerySchema }), ctrl.overview);
router.get('/sales', authorize('reports.view'), validate({ query: reportWindowQuerySchema }), ctrl.sales);
router.get('/receivables', authorize('reports.view'), validate({ query: receivablesQuerySchema }), ctrl.receivables);
router.get('/collections', authorize('reports.view'), validate({ query: reportWindowQuerySchema }), ctrl.collections);
router.get('/inventory', authorize('reports.view'), validate({ query: inventoryReportQuerySchema }), ctrl.inventory);
router.get('/field-force', authorize('reports.view'), validate({ query: fieldForceReportQuerySchema }), ctrl.fieldForce);
router.get('/export', authorize('reports.export'), validate({ query: reportExportQuerySchema }), ctrl.exportXlsx);

export default router;
