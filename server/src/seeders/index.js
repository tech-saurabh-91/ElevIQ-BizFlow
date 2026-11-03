import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import { connectDB, disconnectDB } from '../config/db.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { COMPANY_ROLES, PLATFORM_ROLES, COMPANY_STATUS, BUSINESS_TYPES } from '../config/constants.js';
import { runWithContext } from '../middlewares/tenantContext.js';

import PlatformUser from '../models/PlatformUser.js';
import Company from '../models/Company.js';
import Plan from '../models/Plan.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import Subscription from '../models/Subscription.js';
import PlatformAuditLog from '../models/PlatformAuditLog.js';

// Phase-specific seeders are wired in lazily so this file always runs.
const tryImport = async (path) => {
  try {
    return await import(path);
  } catch {
    return null;
  }
};

const SEED_PASSWORD = process.env.SEED_USER_PASSWORD || 'Eleviq@123';

const seedPlans = async () => {
  const plans = [
    {
      code: 'STARTER',
      name: 'Starter',
      description: 'For small retail businesses getting started with field sales.',
      price: 999,
      billingCycle: 'YEARLY',
      trialDays: 14,
      maxUsers: 3,
      maxCustomers: 300,
      maxInvoicesPerMonth: 300,
      features: { gpsTracking: false, multiWarehouse: false, eInvoice: false, apiAccess: false, fieldForce: true, barcode: true, schemes: false, purchase: true },
      highlights: ['Order booking & invoicing', 'Customer & product masters', 'Basic reports', 'Email support'],
      sortOrder: 1,
    },
    {
      code: 'GROWTH',
      name: 'Growth',
      description: 'For growing distributors & wholesalers with a field team.',
      price: 3999,
      billingCycle: 'YEARLY',
      trialDays: 14,
      maxUsers: 15,
      maxCustomers: 3000,
      maxInvoicesPerMonth: 5000,
      features: { gpsTracking: true, multiWarehouse: true, eInvoice: false, apiAccess: false, fieldForce: true, barcode: true, schemes: true, purchase: true },
      highlights: ['Everything in Starter', 'GPS visit tracking', 'Schemes & discounts', 'Multi-warehouse', 'Ageing & GST reports'],
      sortOrder: 2,
    },
    {
      code: 'ENTERPRISE',
      name: 'Enterprise',
      description: 'For large operations needing e-invoicing, API access & scale.',
      price: 11999,
      billingCycle: 'YEARLY',
      trialDays: 30,
      maxUsers: 100,
      maxCustomers: 100000,
      maxInvoicesPerMonth: 100000,
      features: { gpsTracking: true, multiWarehouse: true, eInvoice: true, apiAccess: true, fieldForce: true, barcode: true, schemes: true, purchase: true },
      highlights: ['Everything in Growth', 'E-invoice & e-way bill', 'REST API access', 'Priority support', 'Custom roles'],
      sortOrder: 3,
    },
  ];

  const docs = [];
  for (const p of plans) {
    const plan = await Plan.findOneAndUpdate({ code: p.code }, { $setOnInsert: p }, { new: true, upsert: true });
    docs.push(plan);
  }
  logger.info(`Seeded ${docs.length} plans.`);
  return docs;
};

const seedSuperAdmin = async () => {
  const existing = await PlatformUser.findOne({ email: env.superAdmin.email.toLowerCase() });
  if (existing) {
    logger.info(`Super admin already exists: ${env.superAdmin.email}`);
    return existing;
  }
  const admin = await PlatformUser.create({
    name: env.superAdmin.name,
    email: env.superAdmin.email,
    password: env.superAdmin.password,
    role: PLATFORM_ROLES.SUPER_ADMIN,
    isActive: true,
  });
  logger.info(`Created super admin: ${admin.email} (password from env)`);
  return admin;
};

const seedDemoCompany = async (superAdmin, growthPlan) => {
  const code = 'DEMO01';
  let company = await Company.findOne({ code });
  if (company) {
    logger.info(`Demo company already exists: ${code}`);
    return company;
  }

  const trialEnd = dayjs().add(30, 'day').toDate();
  const subStart = dayjs().toDate();
  const subEnd = dayjs().add(1, 'year').toDate();

  company = await Company.create({
    code,
    slug: 'demo-retail-wholesale',
    businessName: 'Demo Retail & Wholesale Traders',
    legalName: 'Demo Retail & Wholesale Traders Pvt Ltd',
    businessType: BUSINESS_TYPES.BOTH,
    gstin: '27ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    email: 'hello@demotraders.com',
    phone: '+919876543210',
    website: 'https://demotraders.com',
    address: {
      line1: '12, Market Yard Road',
      line2: 'Shivaji Nagar',
      city: 'Pune',
      state: 'Maharashtra',
      country: 'India',
      pincode: '411005',
      gstin: '27ABCDE1234F1Z5',
    },
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    currencySymbol: '₹',
    financialYearStartMonth: 4,
    status: COMPANY_STATUS.ACTIVE,
    plan: growthPlan?._id || null,
    trialEndsAt: trialEnd,
    subscriptionStart: subStart,
    subscriptionEnd: subEnd,
    userLimit: growthPlan?.maxUsers ?? 15,
    limits: {
      maxUsers: growthPlan?.maxUsers ?? 15,
      maxCustomers: growthPlan?.maxCustomers ?? 3000,
      maxInvoicesPerMonth: growthPlan?.maxInvoicesPerMonth ?? 5000,
    },
    featureFlags: growthPlan?.features || {},
    createdBy: superAdmin._id,
    activatedAt: new Date(),
  });

  logger.info(`Created demo company: ${company.code} - ${company.businessName}`);

  // Seed settings inside the tenant context so companyId is injected.
  await runWithContext({ scope: 'company', companyId: String(company._id) }, async () => {
    await Setting.forCompany(company._id);
  });

  // Subscription record so the 360° view shows real billing history.
  if (growthPlan) {
    await Subscription.findOneAndUpdate(
      { companyId: company._id, isDeleted: { $ne: true } },
      {
        $setOnInsert: {
          companyId: company._id,
          plan: growthPlan._id,
          status: 'ACTIVE',
          start: subStart,
          end: subEnd,
          price: growthPlan.price ?? 0,
          currency: growthPlan.currency || 'INR',
          billingCycle: growthPlan.billingCycle || 'YEARLY',
          limits: {
            maxUsers: growthPlan.maxUsers ?? 15,
            maxCustomers: growthPlan.maxCustomers ?? 3000,
            maxInvoicesPerMonth: growthPlan.maxInvoicesPerMonth ?? 5000,
          },
          features: growthPlan.features || {},
          autoRenew: true,
          notes: 'Provisioned with demo seed',
          createdBy: superAdmin._id,
        },
      },
      { upsert: true, new: true }
    );
    logger.info(`Seeded subscription for ${company.code}.`);
  }

  // Platform audit entry so the 360° Activity tab is not empty on first run.
  await PlatformAuditLog.findOneAndUpdate(
    { action: 'CREATE', entityType: 'Company', 'entityLabel': company.code },
    {
      $setOnInsert: {
        actor: {
          userId: superAdmin._id,
          name: superAdmin.name,
          email: superAdmin.email,
          role: superAdmin.role,
        },
        channel: 'SYSTEM',
        severity: 'INFO',
        action: 'CREATE',
        entityType: 'Company',
        entityLabel: company.code,
        description: `Company ${company.businessName} provisioned (${company.code})`,
        targetCompanyId: company._id,
        occurredAt: company.createdAt || new Date(),
      },
    },
    { upsert: true }
  );

  return company;
};

const seedDemoUsers = async (company) => {
  const existing = await User.findOne({ companyId: company._id, role: COMPANY_ROLES.COMPANY_ADMIN });
  if (existing) {
    logger.info('Demo users already exist.');
    // Re-runs must still hand the roster to the phase seeders (inventory and
    // field force look salesmen/managers up by role), so load what is there.
    return runWithContext({ scope: 'company', companyId: String(company._id) }, () =>
      User.find({ companyId: company._id, isActive: { $ne: false } }).sort({ createdAt: 1 }).lean()
    );
  }

  const users = [
    { name: 'Rajesh Kumar', email: 'admin@demotraders.com', role: COMPANY_ROLES.COMPANY_ADMIN, title: 'Director' },
    { name: 'Priya Sharma', email: 'manager@demotraders.com', role: COMPANY_ROLES.MANAGER, title: 'Sales Manager' },
    { name: 'Amit Patel', email: 'amit@demotraders.com', role: COMPANY_ROLES.SALESMAN, title: 'Sales Executive', territory: 'Pune East' },
    { name: 'Sneha Iyer', email: 'sneha@demotraders.com', role: COMPANY_ROLES.SALESMAN, title: 'Sales Executive', territory: 'Pune West' },
    { name: 'Vikram Rao', email: 'accountant@demotraders.com', role: COMPANY_ROLES.ACCOUNTANT, title: 'Accountant' },
    { name: 'Suresh Menon', email: 'warehouse@demotraders.com', role: COMPANY_ROLES.WAREHOUSE, title: 'Store Keeper' },
  ];

  // Manager id used as reporting manager for salesmen.
  const managerEmail = 'manager@demotraders.com';

  const created = [];
  for (const u of users) {
    const user = await runWithContext({ scope: 'company', companyId: String(company._id) }, () =>
      User.create({
        companyId: company._id,
        name: u.name,
        email: u.email,
        phone: `+9198765${String(10000 + created.length)}`,
        password: SEED_PASSWORD,
        role: u.role,
        title: u.title,
        territory: u.territory || '',
        isActive: true,
        mustChangePassword: false,
      })
    );
    created.push(user);
  }

  // Link salesmen -> manager.
  const manager = created.find((u) => u.email === managerEmail);
  if (manager) {
    await runWithContext({ scope: 'company', companyId: String(company._id) }, () =>
      User.updateMany(
        { companyId: company._id, role: { $in: [COMPANY_ROLES.SALESMAN] } },
        { $set: { reportingManager: manager._id } }
      )
    );
    await runWithContext({ scope: 'company', companyId: String(company._id) }, () =>
      User.updateOne({ _id: manager._id }, { $set: { teamMembers: created.filter((u) => u.role === COMPANY_ROLES.SALESMAN).map((u) => u._id) } })
    );
  }

  // Company admin reference
  const admin = created.find((u) => u.role === COMPANY_ROLES.COMPANY_ADMIN);
  if (admin) {
    await Company.updateOne({ _id: company._id }, { $set: { adminUser: admin._id } }).skipTenant();
  }

  logger.info(`Created ${created.length} demo users (password: ${SEED_PASSWORD})`);
  return created;
};

/** Optional: master data + transactions seeders added in later phases. */
const seedOptionalModules = async (company, users) => {
  const masters = await tryImport('./masters.js');
  if (masters?.default) await masters.default(company, users);

  const transactions = await tryImport('./transactions.js');
  if (transactions?.default) await transactions.default(company, users);

  const invoices = await tryImport('./invoices.js');
  if (invoices?.default) await invoices.default(company, users);

  const payments = await tryImport('./payments.js');
  if (payments?.default) await payments.default(company, users);

  // Phase 7: inventory (stock ledger, adjustments, transfers, PO + GRN) and
  // field force (attendance, visits, expenses, targets). Both depend on the
  // masters/transactions seeders that ran above.
  const inventory = await tryImport('./inventory.js');
  if (inventory?.default) await inventory.default(company, users);

  const fieldForce = await tryImport('./fieldForce.js');
  if (fieldForce?.default) await fieldForce.default(company, users);
};

const run = async () => {
  logger.info('---- ElevIQ SFA seeding started ----');
  await connectDB();

  try {
    const locations = await (await import('../services/locationService.js')).seedLocations();
    logger.info(`Locations: ${locations.countries} countries, ${locations.states} states`);
    const superAdmin = await seedSuperAdmin();
    const plans = await seedPlans();
    const growthPlan = plans.find((p) => p.code === 'GROWTH') || plans[1];

    const company = await seedDemoCompany(superAdmin, growthPlan);
    const users = await seedDemoUsers(company);

    await seedOptionalModules(company, users);

    logger.info('---- Seeding complete ----');
    logger.info(`Platform admin : ${env.superAdmin.email}`);
    logger.info(`Company admin  : admin@demotraders.com (code: DEMO01)`);
    logger.info(`Demo password  : ${SEED_PASSWORD}`);
  } catch (err) {
    logger.error('Seeding failed:', err);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
};

// Run only when executed directly (`node src/seeders/index.js`), not on import.
const isMain = (() => {
  try {
    const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
    return entry === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  run();
}

export default run;
export { seedPlans, seedSuperAdmin, seedDemoCompany, seedDemoUsers, SEED_PASSWORD };
