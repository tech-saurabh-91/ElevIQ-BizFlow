import { Router } from 'express';
import platformAuthRoutes from './auth.js';
import impersonationRoutes from './impersonation.js';
import companyRoutes from './companies.js';
import planRoutes from './plans.js';
import announcementRoutes from './announcements.js';
import auditLogRoutes from './audit-logs.js';
import profileRoutes from './profile.js';
import * as dashboardController from '../../controllers/platform/dashboardController.js';
import { authenticate } from '../../middlewares/auth.js';
import { requirePlatformScope } from '../../middlewares/rbac.js';

/**
 * Platform (Service Provider) API root: /api/platform/*
 *
 * Mount order is intentional:
 *  1. /auth            — public login/me (does its own auth)
 *  2. /impersonation   — must precede the platform guard because it is called
 *                        with the short-lived impersonation token (scope='impersonate')
 *  3. everything else  — requires a platform-scope session
 */
const router = Router();

// Public: login
router.use('/auth', platformAuthRoutes);

// Impersonation exit: accepts scope='impersonate' (and a plain platform token)
router.use('/impersonation', impersonationRoutes);

// Everything else needs platform auth
router.use(authenticate, requirePlatformScope);

router.get('/ping', (req, res) => {
  res.json({ success: true, message: 'Platform API OK', data: { user: req.user } });
});

// ---- Platform dashboard ----------------------------------------------------
router.get('/dashboard', dashboardController.overview);

// ---- Phase 2 ---------------------------------------------------------------
router.use('/companies', companyRoutes);
router.use('/plans', planRoutes);
router.use('/announcements', announcementRoutes);
router.use('/audit-logs', auditLogRoutes);
router.use('/profile', profileRoutes);

export default router;
