import Setting from '../../models/Setting.js';
import logger from '../../utils/logger.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { hasPermission, roleHasPermission } from '../../middlewares/rbac.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, COMPANY_ROLE_LIST } from '../../config/constants.js';
import { DASHBOARD_WIDGETS, findWidget, widgetOn, widgetMissing } from '../../services/dashboardWidgets.js';
import { DEFAULT_TZ } from '../../services/fieldForceService.js';

/**
 * Role-based dashboard: the widgets this user gets (with their data), and the
 * admin's widget-by-role control.
 */

export const myWidgets = asyncHandler(async (req, res) => {
  const settings = req.settings || (await Setting.forCompany(req.companyId));
  const ctx = {
    can: (perm) => hasPermission(req, perm),
    company: req.company,
    settings,
    role: req.user.role,
    companyId: req.companyId,
    tz: req.company?.timezone || settings?.timezone || DEFAULT_TZ,
    user: { id: req.user.id, role: req.user.role, teamIds: req.dataScope?.teamIds || [] },
  };
  const mine = DASHBOARD_WIDGETS.filter((w) => widgetOn(w, ctx));
  // One slow or failing widget must not take the dashboard down.
  const data = await Promise.all(
    mine.map(async (w) => {
      try {
        return { key: w.key, title: w.title, type: w.type, icon: w.icon, wide: Boolean(w.wide), data: await w.load(ctx) };
      } catch (err) {
        logger.warn(`dashboard widget ${w.key} failed: ${err.message}`);
        return { key: w.key, title: w.title, type: w.type, icon: w.icon, wide: Boolean(w.wide), error: 'Could not load' };
      }
    })
  );
  return success(res, { data });
});

// ---- admin: which role sees which widget ------------------------------------

const ROLES = COMPANY_ROLE_LIST;

const accessView = (settings, company) => ({
  roles: ROLES,
  groups: [
    { key: 'kpi', label: 'Number tiles' },
    { key: 'chart', label: 'Charts' },
    { key: 'list', label: 'Lists' },
  ],
  // Same shape as the report access screen (reports -> items).
  reports: DASHBOARD_WIDGETS.filter((w) => !(w.module && company?.featureFlags?.[w.module] === false)).map((w) => {
    const roles = {};
    ROLES.forEach((role) => {
      const can = (perm) => roleHasPermission(settings, role, perm);
      roles[role] = { allowed: widgetOn(w, { can, company, settings, role }), missing: widgetMissing(w, can) };
    });
    return {
      code: w.key,
      group: w.type,
      title: w.title,
      description: `Default for: ${w.roles.map((r) => r.replace('COMPANY_', '').toLowerCase()).join(', ')}`,
      custom: Array.isArray(settings?.dashboardAccess?.[w.key]),
      roles,
    };
  }),
});

export const getAccess = asyncHandler(async (req, res) => {
  const settings = await Setting.forCompany(req.companyId);
  return success(res, { data: accessView(settings, req.company) });
});

export const saveAccess = asyncHandler(async (req, res) => {
  const settings = await Setting.forCompany(req.companyId);
  const next = { ...(settings.dashboardAccess || {}) };
  Object.entries(req.body.access || {}).forEach(([key, roles]) => {
    if (!findWidget(key)) return;
    if (roles === null) delete next[key];
    else next[key] = [...new Set(roles.filter((r) => ROLES.includes(r)))];
  });
  settings.dashboardAccess = next;
  settings.markModified('dashboardAccess');
  await settings.save();
  audit(req, { action: AUDIT_ACTIONS.UPDATE, entityType: 'Setting', entityLabel: 'Dashboard widgets', description: 'Dashboard widgets per role updated' });
  return success(res, { message: 'Dashboard saved', data: accessView(settings, req.company) });
});

export const resetAccess = asyncHandler(async (req, res) => {
  const settings = await Setting.forCompany(req.companyId);
  settings.dashboardAccess = {};
  settings.markModified('dashboardAccess');
  await settings.save();
  audit(req, { action: AUDIT_ACTIONS.UPDATE, entityType: 'Setting', entityLabel: 'Dashboard widgets', description: 'Dashboard widgets reset to defaults' });
  return success(res, { message: 'Dashboard reset', data: accessView(settings, req.company) });
});

export default { myWidgets, getAccess, saveAccess, resetAccess };
