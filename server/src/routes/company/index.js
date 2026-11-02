import { Router } from 'express';
import companyAuthRoutes from './auth.js';
import customerRoutes from './customers.js';
import productRoutes from './products.js';
import supplierRoutes from './suppliers.js';
import warehouseRoutes from './warehouses.js';
import routeRoutes from './routes.js';
import priceListRoutes from './priceLists.js';
import orderRoutes from './orders.js';
import invoiceRoutes from './invoices.js';
import creditNoteRoutes from './creditNotes.js';
import paymentRoutes from './payments.js';
import inventoryRoutes from './inventory.js';
import { purchaseOrders, goodsReceipts } from './purchases.js';
import { attendance, visits, expenses, targets } from './fieldForce.js';
import reportRoutes from './reports.js';
import notificationRoutes from './notifications.js';
import userRoutes from './users.js';
import settingsRoutes from './settings.js';
import auditLogRoutes from './auditLogs.js';
import lookupRoutes from './lookups.js';
import * as dashboardController from '../../controllers/company/dashboardController.js';
import { authenticate } from '../../middlewares/auth.js';
import { requireCompanyScope } from '../../middlewares/rbac.js';
import { tenant } from '../../middlewares/tenant.js';

/**
 * Company workspace API root: /api/v1/*
 * Requires a company-scope session; tenant middleware injects companyId
 * from the verified JWT into every downstream query.
 */
const router = Router();

// Session/profile (does its own auth so /auth/me works right after login)
router.use('/auth', companyAuthRoutes);

// Everything else requires an authenticated company session + tenant scope
router.use(authenticate, requireCompanyScope, tenant);

router.get('/ping', (req, res) => {
  res.json({
    success: true,
    message: 'Company API OK',
    data: { user: req.user, companyId: req.companyId },
  });
});

// ---- Workspace dashboard ---------------------------------------------------
router.get('/dashboard/summary', dashboardController.summary);

// ---- Phase 3: workspace masters -------------------------------------------
router.use('/customers', customerRoutes);
router.use('/products', productRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/warehouses', warehouseRoutes);
router.use('/routes', routeRoutes);
router.use('/price-lists', priceListRoutes);
router.use('/users', userRoutes);
router.use('/settings', settingsRoutes);
router.use('/audit-logs', auditLogRoutes);
router.use('/lookups', lookupRoutes);

// ---- Phase 4: order booking ------------------------------------------------
router.use('/orders', orderRoutes);

// ---- Phase 5: invoices & credit notes -------------------------------------
router.use('/invoices', invoiceRoutes);
router.use('/credit-notes', creditNoteRoutes);

// ---- Phase 6: payments & collections ---------------------------------------
router.use('/payments', paymentRoutes);

// ---- Phase 7: inventory + field force --------------------------------------
router.use('/inventory', inventoryRoutes);
router.use('/purchase-orders', purchaseOrders);
router.use('/goods-receipts', goodsReceipts);
router.use('/field-force/attendance', attendance);
router.use('/field-force/visits', visits);
router.use('/field-force/expenses', expenses);
router.use('/field-force/targets', targets);

// ---- Phase 8: reports + notifications --------------------------------------
router.use('/reports', reportRoutes);
router.use('/notifications', notificationRoutes);

export default router;
