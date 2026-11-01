import { boot, shutdown, clearDb } from './helpers.js';

let seeders;

beforeAll(async () => {
  await boot();
  await clearDb();
  seeders = await import('../src/seeders/index.js');
});

afterAll(async () => {
  await shutdown();
});

describe('Phase 1 - Seed data', () => {
  test('seeds super admin, 3 plans, demo company and users', async () => {
    // Run the seeder's individual steps (already-imported module).
    const PlatformUser = (await import('../src/models/PlatformUser.js')).default;
    const Company = (await import('../src/models/Company.js')).default;
    const Plan = (await import('../src/models/Plan.js')).default;
    const User = (await import('../src/models/User.js')).default;

    const superAdmin = await seeders.seedSuperAdmin();
    expect(superAdmin).toBeTruthy();
    expect(superAdmin.role).toBe('SUPER_ADMIN');
    // password must never be serialised in API payloads
    expect(superAdmin.toJSON()).not.toHaveProperty('password');
    expect(JSON.stringify(superAdmin)).not.toMatch(/\$2[aby]\$/);

    const plans = await seeders.seedPlans();
    expect(plans.length).toBe(3);
    expect(plans.map((p) => p.code).sort()).toEqual(['ENTERPRISE', 'GROWTH', 'STARTER']);
    expect(plans.every((p) => p.maxUsers > 0)).toBe(true);

    const company = await seeders.seedDemoCompany(superAdmin, plans.find((p) => p.code === 'GROWTH'));
    expect(company.code).toBe('DEMO01');
    expect(company.status).toBe('ACTIVE');
    expect(company.subscriptionEnd.getTime()).toBeGreaterThan(Date.now());

    const users = await seeders.seedDemoUsers(company);
    expect(users.length).toBe(6);
    const roles = users.map((u) => u.role);
    expect(roles).toContain('COMPANY_ADMIN');
    expect(roles).toContain('MANAGER');
    expect(roles.filter((r) => r === 'SALESMAN').length).toBe(2);
    expect(roles).toContain('ACCOUNTANT');
    expect(roles).toContain('WAREHOUSE');

    // Settings singleton exists for the demo company.
    const Setting = (await import('../src/models/Setting.js')).default;
    const setting = await Setting.findOne({ companyId: company._id }).skipTenant().lean();
    expect(setting).toBeTruthy();
    expect(setting.rolePermissions['orders.create']).toBeTruthy();

    // Company admin link set (re-read from DB — seedDemoUsers updates it there)
    const refreshed = await Company.findById(company._id).lean();
    expect(String(refreshed.adminUser || '')).not.toBe('');
  });

  test('seeding is idempotent (running twice does not duplicate)', async () => {
    const Company = (await import('../src/models/Company.js')).default;
    const User = (await import('../src/models/User.js')).default;
    const Plan = (await import('../src/models/Plan.js')).default;

    const beforeCompanies = await Company.countDocuments({});
    const beforeUsers = await User.countDocuments({}).skipTenant();
    const beforePlans = await Plan.countDocuments({});

    const superAdmin = await seeders.seedSuperAdmin();
    await seeders.seedPlans();
    const company = await seeders.seedDemoCompany(superAdmin, null);
    await seeders.seedDemoUsers(company);

    expect(await Company.countDocuments({})).toBe(beforeCompanies);
    expect(await User.countDocuments({}).skipTenant()).toBe(beforeUsers);
    expect(await Plan.countDocuments({})).toBe(beforePlans);
  });

  test('seeds demo masters, orders, invoices and credit notes', async () => {
    const Company = (await import('../src/models/Company.js')).default;
    const User = (await import('../src/models/User.js')).default;
    const Order = (await import('../src/models/Order.js')).default;
    const Invoice = (await import('../src/models/Invoice.js')).default;
    const CreditNote = (await import('../src/models/CreditNote.js')).default;

    const company = await Company.findOne({ code: 'DEMO01' }).lean();
    expect(company).toBeTruthy();

    const users = await User.find({ companyId: company._id }).skipTenant().lean();
    expect(users.length).toBeGreaterThanOrEqual(6);

    const masters = await import('../src/seeders/masters.js');
    await masters.default(company, users);

    const transactions = await import('../src/seeders/transactions.js');
    await transactions.default(company, users);

    const invoices = await import('../src/seeders/invoices.js');
    await invoices.default(company, users);

    const invoiceDocs = await Invoice.find({}).skipTenant().lean();
    const notes = await CreditNote.find({}).skipTenant().lean();
    const orders = await Order.find({}).skipTenant().lean();

    expect(orders.length).toBeGreaterThanOrEqual(6);
    expect(invoiceDocs.length).toBeGreaterThanOrEqual(5);
    expect(notes.length).toBeGreaterThanOrEqual(2);

    const statuses = new Set(invoiceDocs.map((i) => i.status));
    expect(statuses).toContain('DRAFT');
    expect(statuses).toContain('ISSUED');
    expect(statuses).toContain('PARTIALLY_PAID');
    expect(statuses).toContain('PAID');
    expect(statuses).toContain('OVERDUE');

    // At least one issued invoice is linked to an order and has moved its progress.
    const orderInvoices = invoiceDocs.filter((i) => i.order && i.status !== 'DRAFT');
    expect(orderInvoices.length).toBeGreaterThan(0);
    expect(orders.some((o) => Number(o.invoicedQty || 0) > 0)).toBe(true);

    // An issued credit note reduced its invoice balance and was applied.
    const issuedNotes = notes.filter((n) => n.status === 'ISSUED');
    expect(issuedNotes.length).toBeGreaterThan(0);
    expect(issuedNotes[0].appliedAmount).toBeGreaterThan(0);
    const creditedInvoice = invoiceDocs.find(
      (i) => String(i._id) === String(issuedNotes[0].invoice)
    );
    expect(creditedInvoice.creditNoteTotal).toBeGreaterThan(0);

    // Re-running the invoice seeder must not duplicate documents.
    await invoices.default(company, users);
    expect(await Invoice.countDocuments({}).skipTenant()).toBe(invoiceDocs.length);
    expect(await CreditNote.countDocuments({}).skipTenant()).toBe(notes.length);
  });
});
