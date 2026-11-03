import Setting from '../../models/Setting.js';
import Company from '../../models/Company.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, DEFAULT_PERMISSIONS, buildDefaultPermissions, COMPANY_ROLE_LIST } from '../../config/constants.js';
import { toPlain, refOrNull } from './_helpers.js';
import { assertAddresses } from '../../services/locationService.js';

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

// The Company document is the single source for the registered profile,
// address and localisation; Setting keeps a mirror for document generation.
const LOCALE_KEYS = ['timezone', 'currency', 'currencySymbol', 'financialYearStartMonth'];
const PROFILE_KEYS = ['legalName', 'businessType', 'email', 'phone', 'website', 'gstin', 'pan', 'taxId'];

const hasAddress = (a) => Boolean(a && (a.line1 || a.city || a.state || a.pincode));

const companyOf = (req) => Company.findById(req.companyId).populate('plan', 'name code').lean();

/** Settings payload with the company's registration data merged in. */
const present = (doc, company) => {
  const data = toPlain(doc);
  if (company) {
    LOCALE_KEYS.forEach((k) => {
      if (company[k] !== undefined && company[k] !== null && company[k] !== '') data[k] = company[k];
    });
    // Older workspaces kept a separate settings address; prefer the registered one.
    data.address = hasAddress(company.address) ? company.address : data.address || {};
    data.company = {
      code: company.code,
      businessName: company.businessName,
      status: company.status,
      plan: company.plan ? { name: company.plan.name, code: company.plan.code } : null,
      registeredAt: company.createdAt,
      ...Object.fromEntries(PROFILE_KEYS.map((k) => [k, company[k] || ''])),
    };
  }
  // Always return a complete matrix so the admin UI can render every toggle.
  data.rolePermissions = { ...buildDefaultPermissions(), ...(doc.rolePermissions || {}) };
  data.permissionCatalog = DEFAULT_PERMISSIONS;
  data.roles = COMPANY_ROLE_LIST;
  return data;
};

/** GET /api/v1/settings - full workspace configuration. */
export const get = asyncHandler(async (req, res) => {
  const [doc, company] = await Promise.all([Setting.forCompany(req.companyId), companyOf(req)]);
  return success(res, { data: present(doc, company) });
});

/** PATCH /api/v1/settings - merge-update the editable configuration. */
export const update = asyncHandler(async (req, res) => {
  const doc = await Setting.forCompany(req.companyId);
  const before = toPlain(doc);
  const payload = req.body || {};
  await assertAddresses(payload, { address: 'body.address' });

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

  // Write the registered profile, address and localisation to the Company so
  // login, dashboard and documents all read the same values.
  const companySet = {};
  LOCALE_KEYS.forEach((k) => {
    if (payload[k] !== undefined) companySet[k] = payload[k];
  });
  if (payload.address) companySet.address = { ...doc.get('address') };
  if (payload.profile) {
    PROFILE_KEYS.forEach((k) => {
      if (payload.profile[k] !== undefined) companySet[k] = payload.profile[k];
    });
  }
  if (payload.logo !== undefined) companySet.logo = payload.logo;
  if (Object.keys(companySet).length) {
    await Company.updateOne({ _id: req.companyId }, { $set: companySet });
  }

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Setting',
    entityId: doc._id,
    entityLabel: 'Company settings',
    before,
    after: { ...toPlain(doc), ...(payload.profile ? { profile: payload.profile } : {}) },
    description: 'Company settings updated',
  });

  return success(res, { message: 'Settings saved', data: present(doc, await companyOf(req)) });
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
