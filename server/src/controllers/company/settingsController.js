import Setting from '../../models/Setting.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, DEFAULT_PERMISSIONS, buildDefaultPermissions, COMPANY_ROLE_LIST } from '../../config/constants.js';
import { toPlain, refOrNull } from './_helpers.js';

const SECTIONS = ['series', 'tax', 'invoice', 'order', 'inventory', 'collections', 'fieldForce'];
const SCALARS = [
  'displayName',
  'logo',
  'timezone',
  'currency',
  'currencySymbol',
  'financialYearStartMonth',
  'dateFormat',
  'maintenanceMode',
  'maintenanceMessage',
];

/** GET /api/v1/settings - full workspace configuration. */
export const get = asyncHandler(async (req, res) => {
  const doc = await Setting.forCompany(req.companyId);
  const data = toPlain(doc);

  // Always return a complete matrix so the admin UI can render every toggle.
  data.rolePermissions = { ...buildDefaultPermissions(), ...(doc.rolePermissions || {}) };
  data.permissionCatalog = DEFAULT_PERMISSIONS;
  data.roles = COMPANY_ROLE_LIST;

  return success(res, { data });
});

/** PATCH /api/v1/settings - merge-update the editable configuration. */
export const update = asyncHandler(async (req, res) => {
  const doc = await Setting.forCompany(req.companyId);
  const before = toPlain(doc);
  const payload = req.body || {};

  SECTIONS.forEach((section) => {
    if (payload[section]) {
      const current = doc.get(section)?.toObject?.() || doc.get(section) || {};
      doc.set(section, { ...current, ...payload[section] });
    }
  });

  if (payload.address) {
    const current = doc.get('address')?.toObject?.() || doc.get('address') || {};
    doc.set('address', { ...current, ...payload.address });
  }

  if (payload.featureFlags) {
    doc.set('featureFlags', { ...(doc.get('featureFlags') || {}), ...payload.featureFlags });
  }

  SCALARS.forEach((key) => {
    if (payload[key] !== undefined) doc.set(key, payload[key]);
  });

  // Mark onboarding profile step complete once the admin has personalised it.
  if (payload.displayName || payload.logo || payload.address) {
    doc.set('setupProgress.profile', true);
  }

  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Setting',
    entityId: doc._id,
    entityLabel: 'Company settings',
    before,
    after: toPlain(doc),
    description: 'Company settings updated',
  });

  const data = toPlain(doc);
  data.rolePermissions = { ...buildDefaultPermissions(), ...(doc.rolePermissions || {}) };
  data.permissionCatalog = DEFAULT_PERMISSIONS;
  data.roles = COMPANY_ROLE_LIST;
  return success(res, { message: 'Settings saved', data });
});

/** PUT /api/v1/settings/permissions - replace the role -> permission matrix. */
export const updatePermissions = asyncHandler(async (req, res) => {
  const doc = await Setting.forCompany(req.companyId);
  const before = toPlain(doc);

  // express-mongo-sanitize rewrites "." in request keys to "_" (it cannot know
  // these are permission names, not Mongo paths). Normalize them back.
  const incoming = {};
  for (const [rawKey, value] of Object.entries(req.body.rolePermissions || {})) {
    incoming[rawKey.replace(/_/g, '.')] = value;
  }

  const defaults = buildDefaultPermissions();
  const existing = doc.rolePermissions || {};

  const clean = {};
  for (const key of Object.keys(defaults)) {
    const source = Array.isArray(incoming[key]) ? incoming[key] : existing[key] || defaults[key];
    clean[key] = [...new Set(source.filter((role) => COMPANY_ROLE_LIST.includes(role)))];
  }

  doc.rolePermissions = clean;
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Setting',
    entityId: doc._id,
    entityLabel: 'Role permissions',
    before: { rolePermissions: before.rolePermissions },
    after: { rolePermissions: clean },
    description: 'Role permission matrix updated',
    severity: 'WARN',
  });

  return success(res, { message: 'Permissions updated', data: { rolePermissions: clean } });
});

/** POST /api/v1/settings/permissions/reset - restore the shipped defaults. */
export const resetPermissions = asyncHandler(async (req, res) => {
  const doc = await Setting.forCompany(req.companyId);
  const before = doc.rolePermissions;
  doc.rolePermissions = buildDefaultPermissions();
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Setting',
    entityId: doc._id,
    entityLabel: 'Role permissions',
    before: { rolePermissions: before },
    after: { rolePermissions: doc.rolePermissions },
    description: 'Role permissions reset to defaults',
    severity: 'WARN',
  });

  return success(res, { message: 'Permissions reset', data: { rolePermissions: doc.rolePermissions } });
});

/** PATCH /api/v1/settings/inventory-default - helper for the warehouse page. */
export const setDefaultWarehouse = asyncHandler(async (req, res) => {
  const doc = await Setting.forCompany(req.companyId);
  doc.set('inventory.defaultWarehouse', refOrNull(req.body.warehouseId));
  await doc.save();
  return success(res, { message: 'Default warehouse saved', data: { warehouse: doc.inventory.defaultWarehouse } });
});

export default { get, update, updatePermissions, resetPermissions, setDefaultWarehouse };
