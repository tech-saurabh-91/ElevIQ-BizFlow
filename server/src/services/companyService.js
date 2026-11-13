import dayjs from 'dayjs';
import Company from '../models/Company.js';
import User from '../models/User.js';
import Plan from '../models/Plan.js';
import Subscription from '../models/Subscription.js';
import Setting from '../models/Setting.js';
import PlatformAuditLog from '../models/PlatformAuditLog.js';
import { COMPANY_STATUS, COMPANY_ROLES, AUDIT_ACTIONS } from '../config/constants.js';
import { ConflictError, NotFoundError, BadRequestError } from '../utils/errors.js';
import { runWithContext } from '../middlewares/tenantContext.js';
import { withoutTenant } from '../middlewares/tenant.js';
import logger from '../utils/logger.js';
import { assertAddresses, findCountry } from './locationService.js';
import { assertIdentity, panFromGstin } from './identityRules.js';

// Company contact / tax fields and where their errors are reported (form field names).
const IDENTITY_PATHS = { phone: 'phone', website: 'website', gstin: 'gstin', pan: 'pan', state: 'state', country: 'country' };
const identityValues = (c) => ({
  phone: c.phone,
  website: c.website,
  gstin: c.gstin,
  pan: c.pan,
  state: c.address?.state,
  country: c.address?.country,
});
const changedIdentity = (fields) =>
  new Set([
    ...['phone', 'website', 'gstin', 'pan'].filter((k) => fields[k] !== undefined),
    ...(fields.address?.state !== undefined ? ['state'] : []),
    ...(fields.address?.country !== undefined ? ['country'] : []),
  ]);
import { assertUnlocked } from './settingLocks.js';

/**
 * Platform company lifecycle service.
 *
 * Everything here runs OUTSIDE a tenant context (the platform operates across
 * tenants), so cross-tenant reads use `.skipTenant()` / `withoutTenant()`,
 * while writes that must land inside a tenant use `runWithContext(...)`.
 *
 * Mongo transactions are intentionally avoided: the product must run on a
 * standalone Atlas tier as well as a replica set. Instead each multi-step
 * operation is ordered so a partial failure leaves a repairable state, and
 * compensating cleanup is attempted on error.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const slugify = (s = '') =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58);

/** Derive a compact uppercase code from a business name: "Acme Traders" -> "ACTR". */
const codeFromName = (name = '') => {
  const words = String(name)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'CO';
  if (words.length === 1) return words[0].slice(0, 4);
  return (words[0].slice(0, 2) + words[1].slice(0, 2)).slice(0, 4);
};

/** Try `base`, then `base2`, `base3`... until the code is free. */
const uniqueCode = async (base) => {
  const seed = (base || 'CO').toUpperCase().slice(0, 8);
  for (let i = 1; i <= 500; i += 1) {
    const candidate = i === 1 ? seed : `${seed}${i}`.slice(0, 10);
    const taken = await Company.exists({ code: candidate });
    if (!taken) return candidate;
  }
  // Fall back to a short random suffix.
  return `${seed}${Date.now().toString(36).toUpperCase()}`.slice(0, 10);
};

/** Try `base`, then `base-2`... until the slug is free. */
const uniqueSlug = async (base) => {
  const seed = (slugify(base) || 'company').slice(0, 54);
  for (let i = 1; i <= 500; i += 1) {
    const candidate = i === 1 ? seed : `${seed}-${i}`;
    const taken = await Company.exists({ slug: candidate });
    if (!taken) return candidate;
  }
  return `${seed}-${Date.now().toString(36)}`.slice(0, 60);
};

const cycleMonths = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12, ONCE: 12 };

/** Compute subscription window from a plan + start mode. */
const resolveSubscriptionWindow = ({
  plan,
  startMode,
  trialDays,
  billingCycle,
  startDate,
  endDate,
}) => {
  const start = startDate ? dayjs(startDate) : dayjs();
  const cycle = billingCycle || plan?.billingCycle || 'YEARLY';

  if (startMode === 'TRIAL') {
    const days = trialDays ?? plan?.trialDays ?? 14;
    const trialEnd = start.add(Math.max(0, days), 'day').toDate();
    return {
      status: COMPANY_STATUS.TRIAL,
      trialEndsAt: trialEnd,
      subscriptionStart: start.toDate(),
      subscriptionEnd: trialEnd,
    };
  }

  if (startMode === 'CUSTOM') {
    if (!endDate)
      throw new BadRequestError('An end date is required for a custom period', 'VALIDATION_ERROR');
    const end = dayjs(endDate);
    if (!end.isValid() || end.valueOf() <= start.valueOf()) {
      throw new BadRequestError('End date must be after the start date', 'VALIDATION_ERROR');
    }
    return {
      status: COMPANY_STATUS.ACTIVE,
      trialEndsAt: null,
      subscriptionStart: start.toDate(),
      subscriptionEnd: end.toDate(),
    };
  }

  // PAID
  return {
    status: COMPANY_STATUS.ACTIVE,
    trialEndsAt: null,
    subscriptionStart: start.toDate(),
    subscriptionEnd: start.add(cycleMonths[cycle] ?? 12, 'month').toDate(),
  };
};

const limitsFromPlan = (plan) =>
  plan
    ? {
        maxUsers: plan.maxUsers,
        maxCustomers: plan.maxCustomers,
        maxInvoicesPerMonth: plan.maxInvoicesPerMonth,
      }
    : { maxUsers: 5, maxCustomers: 500, maxInvoicesPerMonth: 500 };

/**
 * Best-effort platform audit trail (never fails the request).
 * Awaiting it keeps list/detail responses consistent immediately after a write.
 */
const recordPlatformAudit = (actor, entry) =>
  PlatformAuditLog.create({
    actor: {
      userId: actor?.id || null,
      name: actor?.name || 'system',
      email: actor?.email || '',
      role: actor?.role || 'SYSTEM',
    },
    targetCompanyId: entry.targetCompanyId || null,
    channel: 'WEB',
    severity: entry.severity || 'INFO',
    occurredAt: new Date(),
    ...entry,
  }).catch((err) => logger.warn(`platform audit failed: ${err.message}`));

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const getCompanyOr404 = async (id) => {
  const company = await Company.findById(id).lean();
  if (!company || company.isDeleted) {
    throw new NotFoundError('Company not found', 'NOT_FOUND');
  }
  return company;
};

/** PII-safe projection used by every platform list/detail response. */
export const serializeCompany = (c, extras = {}) => {
  if (!c) return null;
  const end = c.subscriptionEnd || c.trialEndsAt;
  const daysLeft = end ? Math.ceil((new Date(end).getTime() - Date.now()) / 86400000) : null;

  return {
    id: String(c._id),
    code: c.code,
    slug: c.slug,
    name: c.businessName,
    legalName: c.legalName || '',
    businessType: c.businessType,
    status: c.status,
    statusReason: c.statusReason || '',

    email: c.email || '',
    phone: c.phone || '',
    website: c.website || '',
    gstin: c.gstin || '',
    pan: c.pan || '',
    address: c.address || {},
    logo: c.logo || '',

    timezone: c.timezone,
    currency: c.currency,
    currencySymbol: c.currencySymbol,
    financialYearStartMonth: c.financialYearStartMonth,

    plan: c.plan
      ? { id: String(c.plan._id || c.plan), code: c.plan.code, name: c.plan.name }
      : null,
    trialEndsAt: c.trialEndsAt,
    subscriptionStart: c.subscriptionStart,
    subscriptionEnd: c.subscriptionEnd,
    daysLeft,
    graceDays: c.graceDays,

    limits: c.limits,
    userLimit: c.userLimit ?? c.limits?.maxUsers ?? 5,
    featureFlags: c.featureFlags || {},

    hasAdmin: Boolean(c.adminUser),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    lastActivityAt: c.lastActivityAt,
    activatedAt: c.activatedAt,
    suspendedAt: c.suspendedAt,
    ...extras,
  };
};

// ---------------------------------------------------------------------------
// Create (company + settings + first administrator + subscription)
// ---------------------------------------------------------------------------

/**
 * Provision a new tenant end to end.
 *
 * Order matters: company -> settings -> admin -> subscription. Each step that
 * touches tenant collections runs inside `runWithContext` so the tenant plugin
 * injects companyId (and fails closed if it is missing).
 */
/**
 * Currency / time zone / tax a new company inherits from its country in the
 * location master. Returns empty objects when the country is unknown.
 */
const countryDefaults = async (countryName) => {
  const country = await findCountry(countryName);
  if (!country) return { company: {}, tax: null };
  return {
    company: {
      ...(country.currency ? { currency: country.currency, currencySymbol: country.currencySymbol || country.currency } : {}),
      ...(country.timezones?.[0] ? { timezone: country.timezones[0] } : {}),
    },
    tax: {
      regime: country.tax?.regime || 'VAT',
      taxLabel: country.tax?.label || 'Tax',
      defaultTaxRate: country.tax?.regime === 'NONE' ? 0 : country.tax?.defaultRate ?? 0,
      enableCgstSgst: Boolean(country.tax?.splitIntraState),
    },
  };
};

export const createCompany = async (payload, actor) => {
  const {
    admin,
    planId,
    startMode = 'TRIAL',
    trialDays,
    billingCycle,
    startDate,
    endDate,
    taxRegime,
    modules,
    ...companyFields
  } = payload;
  // The plan's modules, with any the platform switched for this company.

  // ---- pre-flight: field rules, uniqueness + plan ----------------------------
  await assertIdentity(identityValues(companyFields), IDENTITY_PATHS);
  companyFields.pan = panFromGstin(companyFields.gstin, companyFields.pan);

  const trimmedCode = (companyFields.code || '').trim();
  const trimmedSlug = (companyFields.slug || '').trim();

  const clashCode = trimmedCode ? await Company.exists({ code: trimmedCode.toUpperCase() }) : null;
  if (clashCode) throw new ConflictError('That company code is already in use', 'DUPLICATE');

  const clashSlug = trimmedSlug ? await Company.exists({ slug: trimmedSlug.toLowerCase() }) : null;
  if (clashSlug) throw new ConflictError('That company URL slug is already in use', 'DUPLICATE');

  const emailTaken = admin.email
    ? // Cross-tenant uniqueness check -> deliberately outside any tenant scope.
      await User.exists({ email: admin.email.toLowerCase() }).skipTenant()
    : null;
  if (emailTaken) {
    throw new ConflictError(
      'That admin email already belongs to an account in another company',
      'DUPLICATE'
    );
  }

  const plan = planId ? await Plan.findOne({ _id: planId, isDeleted: { $ne: true } }).lean() : null;
  if (planId && !plan) throw new NotFoundError('Plan not found', 'NOT_FOUND');

  await assertAddresses(companyFields, { address: 'body' });
  const locale = await countryDefaults(companyFields.address?.country);

  const window = resolveSubscriptionWindow({
    plan,
    startMode,
    trialDays,
    billingCycle,
    startDate,
    endDate,
  });
  const code = await uniqueCode(trimmedCode || codeFromName(companyFields.businessName));
  const slug = await uniqueSlug(trimmedSlug || slugify(companyFields.businessName));

  // ---- 1. company ----------------------------------------------------------
  let company;
  try {
    company = await Company.create({
      ...locale.company,
      ...companyFields,
      code,
      slug,
      businessName: companyFields.businessName,
      email: (companyFields.email || '').toLowerCase(),
      status: window.status,
      statusReason: '',
      plan: plan?._id || null,
      trialEndsAt: window.trialEndsAt,
      subscriptionStart: window.subscriptionStart,
      subscriptionEnd: window.subscriptionEnd,
      userLimit: plan?.maxUsers ?? 5,
      limits: limitsFromPlan(plan),
      featureFlags: { ...(plan?.features || {}), ...(modules || {}) },
      createdBy: actor?.id || null,
      activatedAt: window.status === COMPANY_STATUS.ACTIVE ? new Date() : null,
      lastActivityAt: new Date(),
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new ConflictError(
        'A company with that code, slug or identifier already exists',
        'DUPLICATE'
      );
    }
    throw err;
  }

  const companyId = String(company._id);

  try {
    // ---- 2. tenant settings ------------------------------------------------
    await runWithContext({ scope: 'company', companyId }, async () => {
      const settings = await Setting.forCompany(company._id);
      settings.featureFlags = { ...(plan?.features || {}), ...(modules || {}) };
      // Start the workspace on its country's currency, time zone and tax.
      const tax = { ...(locale.tax || {}), ...(taxRegime ? { regime: taxRegime } : {}) };
      if (taxRegime === 'NONE') tax.defaultTaxRate = 0;
      settings.set({
        timezone: company.timezone,
        currency: company.currency,
        currencySymbol: company.currencySymbol,
        financialYearStartMonth: company.financialYearStartMonth,
        ...(Object.keys(tax).length ? { tax: { ...settings.tax.toObject(), ...tax, placeOfSupply: '' } } : {}),
      });
      await settings.save();
    });

    // ---- 3. first administrator -------------------------------------------
    const adminUser = await runWithContext({ scope: 'company', companyId }, () =>
      User.create({
        companyId: company._id,
        name: admin.name,
        email: admin.email.toLowerCase(),
        phone: (admin.phone || '').trim() || undefined,
        password: admin.password,
        role: COMPANY_ROLES.COMPANY_ADMIN,
        title: admin.title || 'Administrator',
        isActive: true,
        // A platform-provisioned password is a temporary credential.
        mustChangePassword: true,
      })
    );

    await Company.updateOne(
      { _id: company._id },
      { $set: { adminUser: adminUser._id } }
    ).skipTenant();

    // ---- 4. subscription record ------------------------------------------
    if (plan) {
      await Subscription.create({
        companyId: company._id,
        plan: plan._id,
        status: startMode === 'TRIAL' ? 'PENDING' : 'ACTIVE',
        start: window.subscriptionStart,
        end: window.subscriptionEnd,
        trialEnd: window.trialEndsAt,
        price: plan.price,
        currency: plan.currency,
        billingCycle: billingCycle || plan.billingCycle,
        limits: limitsFromPlan(plan),
        features: plan.features || {},
        autoRenew: true,
        notes: `Provisioned at company creation (${startMode})`,
        createdBy: actor?.id || null,
      });
    }

    await recordPlatformAudit(actor, {
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'Company',
      entityId: company._id,
      entityLabel: `${company.code} · ${company.businessName}`,
      targetCompanyId: company._id,
      description: `Created company ${company.businessName} on the ${plan?.name || 'no'} plan (${startMode})`,
      before: null,
      after: { status: window.status, plan: plan?.code || null, admin: admin.email },
    });

    const created = await Company.findById(company._id)
      .populate('plan', 'code name price billingCycle')
      .lean();

    return {
      company: serializeCompany(created, { hasAdmin: true }),
      admin: {
        id: String(adminUser._id),
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
        mustChangePassword: true,
      },
      plan: plan ? { id: String(plan._id), code: plan.code, name: plan.name } : null,
    };
  } catch (err) {
    // Compensating cleanup: never leave a headless tenant behind.
    logger.error(`company provisioning failed for ${companyId}: ${err.message}`);
    await Company.deleteOne({ _id: company._id })
      .hardDelete()
      .catch(() => {});
    await User.deleteMany({ companyId: company._id })
      .hardDelete()
      .catch(() => {});
    await Subscription.deleteMany({ companyId: company._id })
      .hardDelete()
      .catch(() => {});
    await Setting.deleteMany({ companyId: company._id })
      .hardDelete()
      .catch(() => {});
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const updateCompany = async (id, fields, actor) => {
  const before = await getCompanyOr404(id);
  await assertAddresses(fields, { address: 'body' });
  // Judge the changed fields against the stored ones (e.g. a new GSTIN vs the saved state).
  await assertIdentity(
    identityValues({ ...before, ...fields, address: { ...(before.address || {}), ...(fields.address || {}) } }),
    IDENTITY_PATHS,
    changedIdentity(fields)
  );
  if (fields.gstin !== undefined && !fields.pan) {
    const derived = panFromGstin(fields.gstin, '');
    if (derived) fields.pan = derived;
  }

  // The platform may correct the tax ID or registered state, but never the
  // currency, country or financial year once the company has transactions.
  await assertUnlocked(
    before._id,
    {
      currency: before.currency,
      country: before.address?.country,
      financialYearStartMonth: before.financialYearStartMonth,
    },
    {
      currency: fields.currency,
      country: fields.address?.country,
      financialYearStartMonth: fields.financialYearStartMonth,
    },
    { allowSupport: true, errorPaths: { currency: 'body.currency', country: 'body.country', financialYearStartMonth: 'body.financialYearStartMonth' } }
  );

  const set = {};
  const assignable = [
    'businessName',
    'legalName',
    'businessType',
    'email',
    'phone',
    'website',
    'gstin',
    'pan',
    'address',
    'timezone',
    'currency',
    'currencySymbol',
    'financialYearStartMonth',
    'logo',
    'graceDays',
    'userLimit',
  ];

  for (const key of assignable) {
    if (fields[key] !== undefined) set[key] = fields[key];
  }
  if (fields.email !== undefined) set.email = (fields.email || '').toLowerCase();
  if (fields.userLimit !== undefined) set['limits.maxUsers'] = fields.userLimit;
  // Modules are the platform's to switch (the company cannot).
  Object.entries(fields.modules || {}).forEach(([key, on]) => {
    set[`featureFlags.${key}`] = Boolean(on);
  });

  if (fields.slug && fields.slug.toLowerCase() !== before.slug) {
    const taken = await Company.exists({
      slug: fields.slug.toLowerCase(),
      _id: { $ne: before._id },
    });
    if (taken) throw new ConflictError('That URL slug is already in use', 'DUPLICATE');
    set.slug = fields.slug.toLowerCase();
  }

  if (fields.code && fields.code.toUpperCase() !== before.code) {
    const taken = await Company.exists({
      code: fields.code.toUpperCase(),
      _id: { $ne: before._id },
    });
    if (taken) throw new ConflictError('That company code is already in use', 'DUPLICATE');
    set.code = fields.code.toUpperCase();
  }

  if (!Object.keys(set).length) return serializeCompany(before);

  await Company.updateOne({ _id: before._id }, { $set: set }, { runValidators: true }).skipTenant();

  // Keep the workspace settings mirror in step with the company record.
  const mirror = {};
  ['timezone', 'currency', 'currencySymbol', 'financialYearStartMonth'].forEach((k) => {
    if (set[k] !== undefined) mirror[k] = set[k];
  });
  const oldState = before.address?.state || '';
  const newState = set.address?.state;
  await runWithContext({ scope: 'company', companyId: String(before._id) }, async () => {
    const settings = await Setting.forCompany(before._id);
    if (Object.keys(mirror).length) settings.set(mirror);
    // A moved office takes its place of supply with it.
    if (newState !== undefined && newState !== oldState && (settings.tax?.placeOfSupply || '') === oldState) {
      settings.set('tax.placeOfSupply', '');
    }
    if (settings.isModified()) await settings.save();
  });

  await recordPlatformAudit(actor, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Company',
    entityId: before._id,
    entityLabel: `${before.code} · ${before.businessName}`,
    targetCompanyId: before._id,
    description: `Updated company profile for ${before.businessName}`,
    before: Object.fromEntries(Object.keys(set).map((k) => [k, before[k]])),
    after: set,
  });

  const after = await Company.findById(before._id)
    .populate('plan', 'code name price billingCycle')
    .lean();
  return serializeCompany(after);
};

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/** Which status changes are legal right now. */
export const allowedStatusTransitions = (company) => {
  const s = company.status;
  const out = [COMPANY_STATUS.ACTIVE, COMPANY_STATUS.TRIAL, COMPANY_STATUS.SUSPENDED];
  if (s === COMPANY_STATUS.CANCELLED) return [COMPANY_STATUS.ACTIVE];
  if (s === COMPANY_STATUS.EXPIRED) return [COMPANY_STATUS.ACTIVE, COMPANY_STATUS.SUSPENDED];
  if (s === COMPANY_STATUS.SUSPENDED) return [COMPANY_STATUS.ACTIVE, COMPANY_STATUS.CANCELLED];
  if (s === COMPANY_STATUS.ACTIVE) return [COMPANY_STATUS.SUSPENDED, COMPANY_STATUS.CANCELLED];
  if (s === COMPANY_STATUS.TRIAL)
    return [COMPANY_STATUS.ACTIVE, COMPANY_STATUS.SUSPENDED, COMPANY_STATUS.CANCELLED];
  return out;
};

export const changeCompanyStatus = async (id, { status, reason = '', subscriptionEnd }, actor) => {
  const before = await getCompanyOr404(id);

  if (before.status === status) {
    throw new BadRequestError(`Company is already ${status}`, 'NO_CHANGE');
  }
  if (!allowedStatusTransitions(before).includes(status)) {
    throw new BadRequestError(
      `Cannot change status from ${before.status} to ${status}`,
      'INVALID_STATUS_TRANSITION'
    );
  }

  const set = { status, statusReason: reason || '' };

  if (status === COMPANY_STATUS.SUSPENDED) set.suspendedAt = new Date();
  if (status === COMPANY_STATUS.ACTIVE) {
    set.activatedAt = new Date();
    set.suspendedAt = null;
    // Reactivating an expired account must extend the clock or it will be
    // kicked straight back out on the next request.
    const end = before.subscriptionEnd || before.trialEndsAt;
    if (!end || new Date(end).getTime() < Date.now()) {
      set.subscriptionEnd = subscriptionEnd
        ? new Date(subscriptionEnd)
        : dayjs().add(1, 'month').toDate();
      if (before.status === COMPANY_STATUS.TRIAL) set.trialEndsAt = null;
    }
  }

  await Company.updateOne({ _id: before._id }, { $set: set }).skipTenant();

  // Flipping to ACTIVE closes the active subscription's window check.
  if (status === COMPANY_STATUS.ACTIVE) {
    await Subscription.updateMany(
      { companyId: before._id, status: 'EXPIRED' },
      { $set: { status: 'ACTIVE' } }
    )
      .skipTenant()
      .catch(() => {});
  }

  await recordPlatformAudit(actor, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Company',
    entityId: before._id,
    entityLabel: `${before.code} · ${before.businessName}`,
    targetCompanyId: before._id,
    severity:
      status === COMPANY_STATUS.SUSPENDED || status === COMPANY_STATUS.CANCELLED ? 'WARN' : 'INFO',
    description: `Changed ${before.businessName} from ${before.status} to ${status}${reason ? ` — ${reason}` : ''}`,
    before: { status: before.status, statusReason: before.statusReason },
    after: { status, statusReason: reason, subscriptionEnd: set.subscriptionEnd },
  });

  const after = await Company.findById(before._id)
    .populate('plan', 'code name price billingCycle')
    .lean();
  return serializeCompany(after);
};

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

export const softDeleteCompany = async (id, actor) => {
  const before = await getCompanyOr404(id);

  if (before.status === COMPANY_STATUS.ACTIVE) {
    throw new BadRequestError(
      'Suspend or cancel the company before deleting it',
      'INVALID_STATUS_TRANSITION'
    );
  }

  await Company.updateOne(
    { _id: before._id },
    {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        status: COMPANY_STATUS.CANCELLED,
        statusReason: 'Deleted by platform',
      },
    }
  ).skipTenant();

  await recordPlatformAudit(actor, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'Company',
    entityId: before._id,
    entityLabel: `${before.code} · ${before.businessName}`,
    targetCompanyId: before._id,
    severity: 'WARN',
    description: `Soft-deleted company ${before.businessName}`,
    before: { status: before.status, isDeleted: false },
    after: { isDeleted: true },
  });

  return { id: String(before._id), deleted: true };
};

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const assignSubscription = async (id, payload, actor) => {
  const company = await getCompanyOr404(id);
  const plan = await Plan.findOne({ _id: payload.planId, isDeleted: { $ne: true } }).lean();
  if (!plan) throw new NotFoundError('Plan not found', 'NOT_FOUND');

  const window = resolveSubscriptionWindow({
    plan,
    startMode: payload.endDate ? 'CUSTOM' : 'PAID',
    billingCycle: payload.billingCycle,
    startDate: payload.startDate,
    endDate: payload.endDate,
  });

  const start = payload.startDate ? dayjs(payload.startDate) : dayjs();
  const end = payload.endDate ? dayjs(payload.endDate) : dayjs(window.subscriptionEnd);

  // Close out the previous subscription, then open the new one.
  await Subscription.updateMany(
    { companyId: company._id, status: { $in: ['ACTIVE', 'PENDING'] } },
    { $set: { status: 'EXPIRED', autoRenew: false } }
  ).skipTenant();

  const sub = await Subscription.create({
    companyId: company._id,
    plan: plan._id,
    status: 'ACTIVE',
    start: start.toDate(),
    end: end.toDate(),
    trialEnd: null,
    price: payload.price ?? plan.price,
    currency: plan.currency,
    billingCycle: payload.billingCycle || plan.billingCycle,
    limits: limitsFromPlan(plan),
    features: plan.features || {},
    autoRenew: payload.autoRenew ?? true,
    notes: payload.notes || '',
    createdBy: actor?.id || null,
  });

  const set = {
    plan: plan._id,
    subscriptionStart: start.toDate(),
    subscriptionEnd: end.toDate(),
    trialEndsAt: null,
    graceDays: company.graceDays ?? 3,
    limits: limitsFromPlan(plan),
    featureFlags: plan.features || {},
    userLimit: plan.maxUsers,
    updatedBy: actor?.id || null,
  };
  if (payload.activate) {
    set.status = COMPANY_STATUS.ACTIVE;
    set.statusReason = '';
    set.activatedAt = new Date();
  }

  await Company.updateOne({ _id: company._id }, { $set: set }).skipTenant();

  await recordPlatformAudit(actor, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Subscription',
    entityId: sub._id,
    entityLabel: `${company.code} → ${plan.code}`,
    targetCompanyId: company._id,
    description: `Assigned plan ${plan.name} to ${company.businessName} until ${dayjs(end).format('DD MMM YYYY')}`,
    before: { plan: company.plan ? String(company.plan) : null, end: company.subscriptionEnd },
    after: { plan: plan.code, end: end.toDate(), status: set.status || company.status },
  });

  const after = await Company.findById(company._id)
    .populate('plan', 'code name price billingCycle')
    .lean();
  return serializeCompany(after);
};

/** Subscription history + current plan for the company 360° view. */
export const getSubscriptionHistory = async (companyId) => {
  const rows = await Subscription.find({ companyId })
    .sort({ start: -1 })
    .populate('plan', 'code name price billingCycle')
    .lean();

  return rows.map((s) => ({
    id: String(s._id),
    plan: s.plan ? { id: String(s.plan._id), code: s.plan.code, name: s.plan.name } : null,
    status: s.status,
    start: s.start,
    end: s.end,
    price: s.price,
    currency: s.currency,
    billingCycle: s.billingCycle,
    autoRenew: s.autoRenew,
    notes: s.notes || '',
    createdAt: s.createdAt,
  }));
};

// ---------------------------------------------------------------------------
// Counts for the 360° view (degrade gracefully before later phases ship)
// ---------------------------------------------------------------------------

export const getCompanyStats = async (companyId) => {
  const ctx = { scope: 'company', companyId: String(companyId) };
  const stats = {
    users: 0,
    activeUsers: 0,
    customers: 0,
    products: 0,
    orders: 0,
    invoices: 0,
    revenue: 0,
  };

  const countIn = async (importPath, filter = {}, key) => {
    try {
      const mod = await import(importPath);
      const M = mod.default;
      if (!M || !M.modelName) return;
      stats[key] = await runWithContext(ctx, () => M.countDocuments(filter));
    } catch {
      /* model not shipped yet (later phase) */
    }
  };

  await Promise.all([
    countIn('../models/User.js', { isDeleted: { $ne: true } }, 'users'),
    countIn('../models/User.js', { isDeleted: { $ne: true }, isActive: true }, 'activeUsers'),
    countIn('../models/Customer.js', { isDeleted: { $ne: true } }, 'customers'),
    countIn('../models/Product.js', { isDeleted: { $ne: true } }, 'products'),
    countIn(
      '../models/Order.js',
      { isDeleted: { $ne: true }, status: { $ne: 'CANCELLED' } },
      'orders'
    ),
    countIn(
      '../models/Invoice.js',
      { isDeleted: { $ne: true }, status: { $ne: 'CANCELLED' } },
      'invoices'
    ),
  ]);

  try {
    const { default: Invoice } = await import('../models/Invoice.js');
    if (Invoice?.modelName) {
      stats.revenue = await runWithContext(ctx, () =>
        Invoice.aggregate([
          { $match: { isDeleted: { $ne: true }, status: { $ne: 'CANCELLED' } } },
          { $group: { _id: null, total: { $sum: '$total' } } },
        ])
      ).then((r) => r?.[0]?.total ?? 0);
    }
  } catch {
    /* later phase */
  }

  return stats;
};

/** Cross-check user limit while a tenant is being provisioned / edited. */
export const checkUserLimit = async (companyId) => {
  const company = await withoutTenant(() => Company.findById(companyId).lean());
  if (!company) return { ok: true };
  const limit = company.limits?.maxUsers ?? company.userLimit ?? 5;
  const used = await runWithContext({ scope: 'company', companyId: String(companyId) }, () =>
    User.countDocuments({ isDeleted: { $ne: true } })
  );
  return { ok: used < limit, used, limit };
};

export default {
  createCompany,
  updateCompany,
  changeCompanyStatus,
  softDeleteCompany,
  assignSubscription,
  getCompanyOr404,
  serializeCompany,
};
