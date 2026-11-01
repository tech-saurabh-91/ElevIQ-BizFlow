import { boot, shutdown, clearDb } from './helpers.js';

let app;
let request;
let mongoose;

// ---- fixtures -------------------------------------------------------------
let superCreds;
let supportCreds;
let supportId;
let growthPlan; // { id, code }
let starterPlan;

const seedBase = async () => {
  const PlatformUser = (await import('../src/models/PlatformUser.js')).default;
  const Plan = (await import('../src/models/Plan.js')).default;

  const superAdmin = await PlatformUser.create({
    name: 'Phase2 Root',
    email: 'root2@eleviq.test',
    password: 'Root#Pass123',
    role: 'SUPER_ADMIN',
  });
  superCreds = { email: 'root2@eleviq.test', password: 'Root#Pass123' };

  const support = await PlatformUser.create({
    name: 'Phase2 Support',
    email: 'support2@eleviq.test',
    password: 'Support#Pass123',
    role: 'PLATFORM_SUPPORT',
  });
  supportCreds = { email: 'support2@eleviq.test', password: 'Support#Pass123' };
  supportId = String(support._id);
  void superAdmin;

  growthPlan = await Plan.create({
    code: 'GROWTH2',
    name: 'Growth',
    description: 'Growing field teams',
    price: 24000,
    billingCycle: 'YEARLY',
    trialDays: 14,
    maxUsers: 15,
    maxCustomers: 2000,
    maxInvoicesPerMonth: 2000,
    features: { gpsTracking: true, multiWarehouse: true, eInvoice: false },
    highlights: ['GPS tracking', 'Schemes'],
    sortOrder: 1,
  });
  starterPlan = await Plan.create({
    code: 'STARTER2',
    name: 'Starter',
    price: 6000,
    billingCycle: 'YEARLY',
    trialDays: 7,
    maxUsers: 5,
    maxCustomers: 500,
    maxInvoicesPerMonth: 500,
    sortOrder: 0,
  });
  growthPlan = { id: String(growthPlan._id), code: growthPlan.code };
  starterPlan = { id: String(starterPlan._id), code: starterPlan.code };
};

const loginPlatform = async (creds) => {
  const res = await request.post('/api/platform/auth/login').send(creds);
  if (res.status !== 200) {
    throw new Error(`platform login failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
};

const asSuper = () => loginPlatform(superCreds);

let alphaId; // company created through the API
let alphaAdmin; // { email, password, id }

const createAlpha = async () => {
  const token = await asSuper();
  const res = await request
    .post('/api/platform/companies')
    .set('Authorization', `Bearer ${token}`)
    .send({
      businessName: 'Alpha Logistics Pvt Ltd',
      businessType: 'WHOLESALE',
      email: 'hello@alphalogistics.test',
      phone: '+919876501234',
      gstin: '27AAAAA0000A1Z5',
      address: { line1: '7, MIDC Road', city: 'Pune', state: 'Maharashtra', pincode: '411019' },
      planId: growthPlan.id,
      startMode: 'TRIAL',
      trialDays: 14,
      admin: {
        name: 'Alpha Admin',
        email: 'admin@alphalogistics.test',
        phone: '+919876501239',
        password: 'Alpha#Pass123',
      },
    });
  if (res.status !== 201) throw new Error(`create failed ${res.status}: ${JSON.stringify(res.body)}`);
  alphaId = String(res.body.data.company.id);
  alphaAdmin = {
    identifier: res.body.data.admin.email,
    password: 'Alpha#Pass123',
    id: String(res.body.data.admin.id),
  };
  return res.body.data;
};

beforeAll(async () => {
  ({ app, mongoose } = await boot());
  const st = (await import('supertest')).default;
  request = st(app);
  await clearDb();
  await seedBase();
  await createAlpha();
});

afterAll(async () => {
  await shutdown();
});

// ---------------------------------------------------------------------------
describe('Phase 2 - Company provisioning', () => {
  test('creates a company with tenant settings, subscription and first admin', async () => {
    const Setting = (await import('../src/models/Setting.js')).default;
    const Subscription = (await import('../src/models/Subscription.js')).default;
    const Company = (await import('../src/models/Company.js')).default;
    const User = (await import('../src/models/User.js')).default;

    const company = await Company.findById(alphaId).lean();
    expect(company).toBeTruthy();
    expect(company.code).toMatch(/^[A-Z0-9]{3,10}$/);
    expect(company.slug).toMatch(/^[a-z0-9-]+$/);
    expect(company.status).toBe('TRIAL');
    expect(company.trialEndsAt).toBeTruthy();
    expect(String(company.plan)).toBe(growthPlan.id);
    expect(company.limits.maxUsers).toBe(15);
    expect(company.adminUser).toBeTruthy();

    // Tenant-scoped records exist for the new company.
    const settings = await Setting.findOne({ companyId: mongoose.Types.ObjectId.createFromHexString(alphaId) }).lean();
    expect(settings).toBeTruthy();
    expect(settings.featureFlags.multiWarehouse).toBe(true);

    const subs = await Subscription.find({
      companyId: mongoose.Types.ObjectId.createFromHexString(alphaId),
    }).lean();
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe('PENDING'); // trial subscription

    // The admin belongs to THIS tenant and must rotate the platform-set password.
    const admin = await User.findById(alphaAdmin.id).skipTenant().lean();
    expect(String(admin.companyId)).toBe(alphaId);
    expect(admin.role).toBe('COMPANY_ADMIN');
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.isActive).toBe(true);
  });

  test('first admin can log in to the new workspace', async () => {
    const login = await request.post('/api/auth/login').send(alphaAdmin);
    expect(login.status).toBe(200);
    const data = login.body.data;
    expect(data.company.name).toBe('Alpha Logistics Pvt Ltd');
    expect(data.user.mustChangePassword).toBe(true);
    expect(data.branding.app).toBe('ElevIQ SFA');
    expect(data.branding.company).toBe('Alpha Logistics Pvt Ltd');
  });

  test('rejects duplicate company code, slug and admin email', async () => {
    const token = await asSuper();

    const dupCode = await request
      .post('/api/platform/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Duplicate Code Co',
        code: 'ALPHA01X',
        admin: { name: 'X Admin', email: 'x@dupcode.test', password: 'Dup#Pass123' },
      });
    // 201 only if auto-generated; explicitly re-using an existing code must 409.
    const alphaCode = (await (await import('../src/models/Company.js')).default
      .findById(alphaId)
      .lean()).code;

    const dupCode2 = await request
      .post('/api/platform/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Duplicate Code Co 2',
        code: alphaCode,
        admin: { name: 'Y Admin', email: 'y@dupcode.test', password: 'Dup#Pass123' },
      });
    expect(dupCode2.status).toBe(409);
    expect(dupCode2.body.code).toBe('DUPLICATE');
    void dupCode;

    const dupSlug = await request
      .post('/api/platform/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Duplicate Slug Co',
        slug: 'alpha-logistics-pvt-ltd',
        admin: { name: 'Z Admin', email: 'z@dupslice.test', password: 'Dup#Pass123' },
      });
    expect(dupSlug.status).toBe(409);

    const dupEmail = await request
      .post('/api/platform/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Duplicate Email Co',
        admin: { name: 'E Admin', email: alphaAdmin.identifier, password: 'Dup#Pass123' },
      });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.code).toBe('DUPLICATE');
  });

  test('validates the create payload (422 with field errors)', async () => {
    const token = await asSuper();
    const res = await request
      .post('/api/platform/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: '', admin: { name: '', email: 'not-an-email', password: 'weak' } });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.some((e) => e.field.includes('businessName'))).toBe(true);
    expect(res.body.errors.some((e) => e.field.includes('admin.password'))).toBe(true);
  });

  test('a failed provisioning leaves no headless tenant behind', async () => {
    const token = await asSuper();
    const Company = (await import('../src/models/Company.js')).default;
    const before = await Company.countDocuments({});

    // Invalid billing window (custom end before start) fails after validation.
    const res = await request
      .post('/api/platform/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Rollback Traders',
        startMode: 'CUSTOM',
        startDate: '2027-01-10',
        endDate: '2027-01-01',
        admin: { name: 'R Admin', email: 'admin@rollback.test', password: 'Roll#Pass123' },
      });
    expect(res.status).toBe(400);

    const after = await Company.countDocuments({});
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 2 - Company list, detail and update', () => {
  test('lists companies with search, status filters and statusCounts', async () => {
    const token = await asSuper();

    const all = await request.get('/api/platform/companies').set('Authorization', `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThanOrEqual(1);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(all.body.meta.statusCounts.TRIAL).toBeGreaterThanOrEqual(1);

    const search = await request
      .get('/api/platform/companies?search=alpha logistics')
      .set('Authorization', `Bearer ${token}`);
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].name).toBe('Alpha Logistics Pvt Ltd');

    const filtered = await request
      .get('/api/platform/companies?status=ACTIVE,TRIAL&page=1&limit=10')
      .set('Authorization', `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.some((c) => c.id === alphaId)).toBe(true);

    const none = await request
      .get('/api/platform/companies?status=CANCELLED')
      .set('Authorization', `Bearer ${token}`);
    expect(none.status).toBe(200);
    expect(none.body.data).toHaveLength(0);

    const badStatus = await request
      .get('/api/platform/companies?status=NOT_A_STATUS')
      .set('Authorization', `Bearer ${token}`);
    expect(badStatus.status).toBe(422);
  });

  test('company 360° detail returns stats, users, subscriptions and activity', async () => {
    const token = await asSuper();
    const res = await request
      .get(`/api/platform/companies/${alphaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const d = res.body.data;

    expect(d.company.id).toBe(alphaId);
    expect(d.company.plan.code).toBe(growthPlan.code);
    expect(d.company.allowedTransitions).toContain('ACTIVE');
    expect(d.stats.users).toBe(1);
    expect(d.stats.customers).toBe(0); // Phase 3 model not shipped yet
    expect(d.tenantCounts.users).toBe(1);
    expect(d.users).toHaveLength(1);
    expect(d.users[0].role).toBe('COMPANY_ADMIN');
    expect(d.subscriptions).toHaveLength(1);
    expect(d.platformContext.userLimit).toBe(15);
    expect(d.platformContext.usagePct).toBe(Math.round((1 / 15) * 100));
    expect(Array.isArray(d.activity)).toBe(true);
  });

  test('lists the company users with pagination', async () => {
    const token = await asSuper();
    const res = await request
      .get(`/api/platform/companies/${alphaId}/users?page=1&limit=10`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].email).toBe(alphaAdmin.identifier);
    expect(res.body.data[0].password).toBeUndefined();
  });

  test('updates company profile fields and rejects duplicate slug', async () => {
    const token = await asSuper();

    const ok = await request
      .patch(`/api/platform/companies/${alphaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+919876507777', website: 'https://alphalogistics.test', address: { city: 'Nashik' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.company.phone).toBe('+919876507777');
    expect(ok.body.data.company.website).toBe('https://alphalogistics.test');
    expect(ok.body.data.company.address.city).toBe('Nashik');

    // Second company to collide with.
    const other = await request
      .post('/api/platform/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Beta Logistics',
        admin: { name: 'B Admin', email: 'admin@betalogistics.test', password: 'Beta#Pass123' },
      });
    expect(other.status).toBe(201);
    const betaId = String(other.body.data.company.id);

    const clash = await request
      .patch(`/api/platform/companies/${betaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: 'alpha-logistics-pvt-ltd' });
    expect(clash.status).toBe(409);

    const bad = await request
      .patch(`/api/platform/companies/${betaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: 'x' });
    expect(bad.status).toBe(422);
  });

  test('unknown or malformed company id returns 404 / 422 (never 500)', async () => {
    const token = await asSuper();

    const missing = await request
      .get('/api/platform/companies/64b000000000000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND');

    const malformed = await request
      .get('/api/platform/companies/not-an-id')
      .set('Authorization', `Bearer ${token}`);
    expect(malformed.status).toBe(422);
    expect(malformed.body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
describe('Phase 2 - Status lifecycle (suspend / activate / delete)', () => {
  let victimId;
  let victimAdminCreds;

  test('setup: a second company to suspend', async () => {
    const token = await asSuper();
    const res = await request
      .post('/api/platform/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Gamma Retail',
        startMode: 'PAID',
        planId: starterPlan.id,
        billingCycle: 'YEARLY',
        admin: { name: 'G Admin', email: 'admin@gammaretail.test', password: 'Gamma#Pass123' },
      });
    expect(res.status).toBe(201);
    victimId = String(res.body.data.company.id);
    victimAdminCreds = { identifier: 'admin@gammaretail.test', password: 'Gamma#Pass123' };
    expect(res.body.data.company.status).toBe('ACTIVE');
  });

  test('invalid status transition is rejected with 400 INVALID_STATUS_TRANSITION', async () => {
    const token = await asSuper();
    const res = await request
      .patch(`/api/platform/companies/${victimId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'EXPIRED', reason: 'Attempting an illegal transition' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('suspending blocks company login with 403 COMPANY_SUSPENDED', async () => {
    const token = await asSuper();
    const res = await request
      .patch(`/api/platform/companies/${victimId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED', reason: 'Non-payment of invoices' });
    expect(res.status).toBe(200);
    expect(res.body.data.company.status).toBe('SUSPENDED');
    expect(res.body.data.company.statusReason).toBe('Non-payment of invoices');

    const login = await request.post('/api/auth/login').send(victimAdminCreds);
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('COMPANY_SUSPENDED');
  });

  test('impersonation is refused for a suspended company', async () => {
    const token = await asSuper();
    const res = await request
      .post(`/api/platform/companies/${victimId}/impersonate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMPANY_SUSPENDED');
  });

  test('activating restores access and is audit-trailed', async () => {
    const token = await asSuper();
    const res = await request
      .patch(`/api/platform/companies/${victimId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE', reason: 'Payment received' });
    expect(res.status).toBe(200);
    expect(res.body.data.company.status).toBe('ACTIVE');

    const login = await request.post('/api/auth/login').send(victimAdminCreds);
    expect(login.status).toBe(200);

    const audit = await request
      .get(`/api/platform/companies/${victimId}/audit-logs?action=STATUS_CHANGE`)
      .set('Authorization', `Bearer ${token}`);
    expect(audit.status).toBe(200);
    expect(audit.body.data.some((a) => a.action === 'STATUS_CHANGE')).toBe(true);
  });

  test('no-change and duplicate-status requests are handled gracefully', async () => {
    const token = await asSuper();
    const res = await request
      .patch(`/api/platform/companies/${victimId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE', reason: 'Already active' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_CHANGE');
  });

  test('deleting an ACTIVE company is refused', async () => {
    const token = await asSuper();
    const res = await request
      .delete(`/api/platform/companies/${victimId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('a cancelled company can be soft-deleted and disappears from lists', async () => {
    const token = await asSuper();

    await request
      .patch(`/api/platform/companies/${victimId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED', reason: 'Customer churned' });

    const del = await request
      .delete(`/api/platform/companies/${victimId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);

    const list = await request.get('/api/platform/companies?search=Gamma').set('Authorization', `Bearer ${token}`);
    expect(list.body.data).toHaveLength(0);

    const detail = await request
      .get(`/api/platform/companies/${victimId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 2 - Plans', () => {
  let tempPlanId;

  test('lists plans with usage counts', async () => {
    const token = await asSuper();
    const res = await request.get('/api/platform/plans').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const growth = res.body.data.find((p) => p.code === growthPlan.code);
    expect(growth.companyCount).toBeGreaterThanOrEqual(1); // Alpha uses it
    expect(growth.features.multiWarehouse).toBe(true);
  });

  test('creates, updates and validates plans', async () => {
    const token = await asSuper();

    const created = await request
      .post('/api/platform/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'temp2',
        name: 'Temp Plan',
        price: 999,
        billingCycle: 'MONTHLY',
        trialDays: 3,
        maxUsers: 3,
        highlights: ['Cheap'],
      });
    expect(created.status).toBe(201);
    expect(created.body.data.plan.code).toBe('TEMP2');
    tempPlanId = created.body.data.plan.id;

    const dup = await request
      .post('/api/platform/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'temp2', name: 'Dup', price: 1 });
    expect(dup.status).toBe(409);

    const invalid = await request
      .post('/api/platform/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'X', name: '', price: -5 });
    expect(invalid.status).toBe(422);

    const updated = await request
      .patch(`/api/platform/plans/${tempPlanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 1299, name: 'Temp Plan v2' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.plan.price).toBe(1299);
    expect(updated.body.data.plan.name).toBe('Temp Plan v2');
  });

  test('deleting an unused plan works; deleting one in use is blocked', async () => {
    const token = await asSuper();

    const inUse = await request
      .delete(`/api/platform/plans/${growthPlan.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(inUse.status).toBe(400);
    expect(inUse.body.code).toBe('PLAN_IN_USE');
    expect(inUse.body.message).toMatch(/Alpha Logistics/);

    const ok = await request
      .delete(`/api/platform/plans/${tempPlanId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);

    const gone = await request
      .get(`/api/platform/plans/${tempPlanId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(gone.status).toBe(404);
  });

  test('assigning a new subscription moves the company to ACTIVE', async () => {
    const token = await asSuper();

    const res = await request
      .post(`/api/platform/companies/${alphaId}/subscription`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planId: growthPlan.id, billingCycle: 'YEARLY', price: 26000, notes: 'Yearly renewal' });
    expect(res.status).toBe(200);
    const company = res.body.data.company;
    expect(company.status).toBe('ACTIVE');
    expect(company.plan.code).toBe(growthPlan.code);

    const detail = await request
      .get(`/api/platform/companies/${alphaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.data.subscriptions.length).toBe(2); // trial + paid
    expect(detail.body.data.currentSubscription.status).toBe('ACTIVE');
    expect(detail.body.data.currentSubscription.price).toBe(26000);
  });

  test('assigning an unknown plan returns 404', async () => {
    const token = await asSuper();
    const res = await request
      .post(`/api/platform/companies/${alphaId}/subscription`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planId: '64b000000000000000000000' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 2 - Impersonation', () => {
  let impToken;

  test('super admin can enter a company workspace', async () => {
    const token = await asSuper();
    const res = await request
      .post(`/api/platform/companies/${alphaId}/impersonate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.expiresInMinutes).toBe(30);
    expect(res.body.data.actingAs.role).toBe('COMPANY_ADMIN');
    expect(res.body.data.actingAs.email).toBe(alphaAdmin.identifier);
    expect(res.body.data.company.id).toBe(alphaId);
    impToken = res.body.data.accessToken;
  });

  test('the impersonation token works on company workspace routes', async () => {
    const ping = await request.get('/api/v1/ping').set('Authorization', `Bearer ${impToken}`);
    expect(ping.status).toBe(200);
    expect(ping.body.data.user.scope).toBe('impersonate');
    expect(ping.body.data.user.companyId).toBe(alphaId);

    const summary = await request
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${impToken}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.company.id).toBe(alphaId);
  });

  test('the impersonation token cannot touch platform routes', async () => {
    const res = await request
      .get('/api/platform/companies')
      .set('Authorization', `Bearer ${impToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('entering the workspace is recorded on both audit trails', async () => {
    const token = await asSuper();

    const platformTrail = await request
      .get('/api/platform/audit-logs?action=IMPERSONATE')
      .set('Authorization', `Bearer ${token}`);
    expect(platformTrail.status).toBe(200);
    expect(platformTrail.body.data.some((a) => a.action === 'IMPERSONATE')).toBe(true);
    expect(platformTrail.body.data[0].severity).toBe('WARN');

    const tenantTrail = await request
      .get(`/api/platform/companies/${alphaId}/audit-logs`)
      .set('Authorization', `Bearer ${token}`);
    expect(tenantTrail.status).toBe(200);
    expect(tenantTrail.body.data.some((a) => a.action === 'IMPERSONATE')).toBe(true);
  });

  test('exiting impersonation works with the impersonation token', async () => {
    const res = await request
      .post('/api/platform/impersonation/exit')
      .set('Authorization', `Bearer ${impToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.exited).toBe(true);
    expect(res.body.data.companyId).toBe(alphaId);
  });

  test('exit is idempotent for a normal platform token', async () => {
    const token = await asSuper();
    const res = await request
      .post('/api/platform/impersonation/exit')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.exited).toBe(true);
  });

  test('exit is refused without a session', async () => {
    const res = await request.post('/api/platform/impersonation/exit').send({});
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 2 - Platform audit logs', () => {
  test('lists platform activity with search and pagination', async () => {
    const token = await asSuper();
    const res = await request
      .get('/api/platform/audit-logs?page=1&limit=50')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].actor).toBeTruthy();
    expect(res.body.data.some((a) => a.action === 'CREATE')).toBe(true);
    expect(res.body.data.some((a) => a.action === 'STATUS_CHANGE')).toBe(true);
  });

  test('filters by action and rejects malformed query', async () => {
    const token = await asSuper();

    const filtered = await request
      .get('/api/platform/audit-logs?action=CREATE&entityType=Company')
      .set('Authorization', `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.every((a) => a.action === 'CREATE')).toBe(true);

    const bad = await request
      .get('/api/platform/audit-logs?page=0')
      .set('Authorization', `Bearer ${token}`);
    expect(bad.status).toBe(422);
  });

  test('summary endpoint reports totals', async () => {
    const token = await asSuper();
    const res = await request.get('/api/platform/audit-logs/summary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.last30d).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 2 - Announcements', () => {
  let announcementId;

  test('publishes a broadcast announcement', async () => {
    const token = await asSuper();
    const res = await request
      .post('/api/platform/announcements')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Scheduled maintenance this Sunday',
        body: 'The API will be read-only between 02:00 and 04:00 IST.',
        type: 'MAINTENANCE',
        broadcast: true,
        ctaLabel: 'Status page',
        ctaLink: 'https://status.eleviq.test',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.announcement.broadcast).toBe(true);
    expect(res.body.data.announcement.active).toBe(true);
    announcementId = res.body.data.announcement.id;
  });

  test('lists announcements and rejects unknown targets', async () => {
    const token = await asSuper();

    const list = await request.get('/api/platform/announcements').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((a) => a.id === announcementId)).toBe(true);
    expect(list.body.meta.totalCompanies).toBeGreaterThanOrEqual(1);

    const badTarget = await request
      .post('/api/platform/announcements')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Targeted note', broadcast: false, targetCompanies: ['64b000000000000000000000'] });
    expect(badTarget.status).toBe(404);
  });

  test('updates and retires an announcement', async () => {
    const token = await asSuper();

    const upd = await request
      .patch(`/api/platform/announcements/${announcementId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false });
    expect(upd.status).toBe(200);
    expect(upd.body.data.announcement.active).toBe(false);

    const del = await request
      .delete(`/api/platform/announcements/${announcementId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const list = await request.get('/api/platform/announcements').set('Authorization', `Bearer ${token}`);
    expect(list.body.data.some((a) => a.id === announcementId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 2 - Access control', () => {
  test('company tokens are blocked from every platform route', async () => {
    const login = await request.post('/api/auth/login').send(alphaAdmin);
    const token = login.body.data.accessToken;

    for (const [method, path] of [
      ['get', '/api/platform/companies'],
      ['get', `/api/platform/companies/${alphaId}`],
      ['get', '/api/platform/plans'],
      ['get', '/api/platform/audit-logs'],
      ['post', '/api/platform/companies'],
    ]) {
      const res = await request[method](path).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
  });

  test('platform support is read-only (non-GET blocked, GET allowed)', async () => {
    const token = await loginPlatform(supportCreds);

    const read = await request.get('/api/platform/companies').set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);

    const write = await request
      .post('/api/platform/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessName: 'Should Not Exist', admin: { name: 'N Admin', email: 'n@nope.test', password: 'Nope#Pass123' } });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('FORBIDDEN');

    const statusChange = await request
      .patch(`/api/platform/companies/${alphaId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED', reason: 'Support cannot do this' });
    expect(statusChange.status).toBe(403);

    const planDelete = await request
      .delete(`/api/platform/plans/${starterPlan.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(planDelete.status).toBe(403);
  });

  test('unauthenticated platform requests get 401', async () => {
    const res = await request.get('/api/platform/companies');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  test('support role can read its own profile but the id of other roles is irrelevant', async () => {
    const token = await loginPlatform(supportCreds);
    const res = await request.get('/api/platform/profile').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('PLATFORM_SUPPORT');
    expect(res.body.data.user.id).toBe(supportId);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 2 - Platform profile', () => {
  test('updates the signed-in platform admin profile', async () => {
    const token = await asSuper();

    const before = await request.get('/api/platform/profile').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);
    expect(before.body.data.user.email).toBe(superCreds.email);

    const upd = await request
      .patch('/api/platform/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Phase2 Root Renamed', phone: '+919000000001' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.user.name).toBe('Phase2 Root Renamed');
    expect(upd.body.data.user.phone).toBe('+919000000001');

    // Restore so other tests / reruns see the original name.
    await request
      .patch('/api/platform/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Phase2 Root' });
  });

  test('rejects an invalid profile payload', async () => {
    const token = await asSuper();
    const res = await request
      .patch('/api/platform/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'x' });
    expect(res.status).toBe(422);
  });
});
