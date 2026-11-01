import { boot, shutdown, clearDb } from './helpers.js';

let app;
let request;
let companyCreds;
let platformCreds;
let companyId;

const seedBase = async () => {
  const PlatformUser = (await import('../src/models/PlatformUser.js')).default;
  const Company = (await import('../src/models/Company.js')).default;
  const User = (await import('../src/models/User.js')).default;
  const { runWithContext } = await import('../src/middlewares/tenantContext.js');

  const admin = await PlatformUser.create({
    name: 'Dash Admin',
    email: 'dash@eleviq.test',
    password: 'Dash#Pass123',
    role: 'SUPER_ADMIN',
  });
  platformCreds = { email: 'dash@eleviq.test', password: 'Dash#Pass123' };

  const company = await Company.create({
    code: 'DASH01',
    slug: 'dash-traders',
    businessName: 'Dash Traders',
    businessType: 'WHOLESALE',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    createdBy: admin._id,
  });
  companyId = String(company._id);

  const user = await runWithContext({ scope: 'company', companyId }, () =>
    User.create({
      companyId: company._id,
      name: 'Dash Manager',
      email: 'manager@dash01.test',
      phone: '+919999900001',
      password: 'Manager#Pass123',
      role: 'MANAGER',
      isActive: true,
    })
  );
  companyCreds = { identifier: 'manager@dash01.test', password: 'Manager#Pass123' };
  void user;
};

beforeAll(async () => {
  ({ app } = await boot());
  const st = (await import('supertest')).default;
  request = st(app);
  await clearDb();
  await seedBase();
});

afterAll(async () => {
  await shutdown();
});

describe('Phase 1 - Dashboards', () => {
  test('company dashboard summary returns KPI defaults + setup checklist', async () => {
    const login = await request.post('/api/auth/login').send(companyCreds);
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken;

    const res = await request.get('/api/v1/dashboard/summary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const d = res.body.data;

    // Numeric KPIs present and zero before any transactions exist.
    expect(d.salesToday).toBe(0);
    expect(d.ordersToday).toBe(0);
    expect(d.outstanding).toBe(0);
    expect(Array.isArray(d.recentOrders)).toBe(true);

    // Identity echoed back for the workspace shell.
    expect(d.company.name).toBe('Dash Traders');
    expect(d.user.role).toBe('MANAGER');

    // Setup checklist object exists (may be all-false).
    expect(d.setup).toBeTruthy();
    expect(typeof d.setup).toBe('object');
  });

  test('company dashboard is tenant-scoped (never throws TENANT_SCOPE_MISSING)', async () => {
    const login = await request.post('/api/auth/login').send(companyCreds);
    const token = login.body.data.accessToken;
    // Call twice — both must succeed and return this company's context only.
    const [a, b] = await Promise.all([
      request.get('/api/v1/dashboard/summary').set('Authorization', `Bearer ${token}`),
      request.get('/api/v1/dashboard/summary').set('Authorization', `Bearer ${token}`),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.company.id).toBe(companyId);
    expect(b.body.data.company.id).toBe(companyId);
  });

  test('platform dashboard returns stats, expiring list and activity feed', async () => {
    const login = await request.post('/api/platform/auth/login').send(platformCreds);
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken;

    const res = await request.get('/api/platform/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const d = res.body.data;

    expect(d.stats.totalCompanies).toBeGreaterThanOrEqual(1);
    expect(d.stats.activeCompanies).toBeGreaterThanOrEqual(1);
    expect(typeof d.stats.mrr).toBe('number');
    expect(Array.isArray(d.expiring)).toBe(true);
    expect(Array.isArray(d.topCompanies)).toBe(true);
    expect(Array.isArray(d.recentActivity)).toBe(true);
    expect(d.health.apiStatus).toBe('Operational');

    // The seeded company must appear in the expiring window (ends in ~1 year? no).
    // DASH01 ends in 365 days -> NOT in 30-day window; assert it's absent instead.
    expect(d.expiring.some((c) => c.code === 'DASH01')).toBe(false);
  });

  test('platform dashboard is blocked for company tokens', async () => {
    const login = await request.post('/api/auth/login').send(companyCreds);
    const token = login.body.data.accessToken;
    const res = await request.get('/api/platform/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('company dashboard is blocked for platform tokens', async () => {
    const login = await request.post('/api/platform/auth/login').send(platformCreds);
    const token = login.body.data.accessToken;
    const res = await request
      .get('/api/v1/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
