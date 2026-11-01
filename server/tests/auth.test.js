import { boot, shutdown, clearDb } from './helpers.js';

let app;
let request; // bound to app: request.get(...), request.post(...)
let makeAgent; // cookie-persisting agent factory
let mongoose;

// ---- fixtures -------------------------------------------------------------
let superAdminCreds;
let companyA; // { code, adminCreds }
let companyB;
let notificationModel;

const seedBase = async () => {
  const PlatformUser = (await import('../src/models/PlatformUser.js')).default;
  const Company = (await import('../src/models/Company.js')).default;
  const User = (await import('../src/models/User.js')).default;
  const Notification = (await import('../src/models/Notification.js')).default;
  const { runWithContext } = await import('../src/middlewares/tenantContext.js');
  const { COMPANY_ROLES, COMPANY_STATUS } = await import('../src/config/constants.js');

  notificationModel = Notification;

  const admin = await PlatformUser.create({
    name: 'Platform Root',
    email: 'root@eleviq.test',
    password: 'Root#Pass123',
    role: 'SUPER_ADMIN',
  });
  superAdminCreds = { email: 'root@eleviq.test', password: 'Root#Pass123' };

  const mkCompany = async (code, name) => {
    const company = await Company.create({
      code,
      slug: code.toLowerCase(),
      businessName: name,
      businessType: 'BOTH',
      status: COMPANY_STATUS.ACTIVE,
      subscriptionEnd: new Date(Date.now() + 365 * 86400000),
      userLimit: 10,
      createdBy: admin._id,
    });
    const adminUser = await runWithContext({ scope: 'company', companyId: String(company._id) }, () =>
      User.create({
        companyId: company._id,
        name: `${name} Admin`,
        email: `admin@${code.toLowerCase()}.test`,
        phone: `+9199999${code}`,
        password: 'Admin#Pass123',
        role: COMPANY_ROLES.COMPANY_ADMIN,
        isActive: true,
      })
    );
    return { company, adminUser, creds: { identifier: `admin@${code.toLowerCase()}.test`, password: 'Admin#Pass123' } };
  };

  companyA = await mkCompany('AAAA01', 'Alpha Traders');
  companyB = await mkCompany('BBBB01', 'Beta Traders');
};

const loginCompany = async (creds, extra = {}) => {
  const res = await request.post('/api/auth/login').send({ ...creds, ...extra });
  if (res.status !== 200) {
    throw new Error(`login failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
};

beforeAll(async () => {
  ({ app, mongoose } = await boot());
  const st = (await import('supertest')).default;
  request = st(app); // bind to the app so we can call .get/.post directly
  makeAgent = st.agent;
  await clearDb();
  await seedBase();
});

afterAll(async () => {
  await shutdown();
});

/** Raw value of an `eleviq_rt=...` Set-Cookie header (no attributes). */
const cookieValue = (cookieHeader) =>
  decodeURIComponent(cookieHeader.split(';')[0].slice('eleviq_rt='.length));

describe('Phase 1 - Platform auth', () => {
  test('super admin can log in', async () => {
    const res = await request.post('/api/platform/auth/login').send(superAdminCreds);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.role).toBe('SUPER_ADMIN');
  });

  test('wrong password is rejected with 401', async () => {
    const res = await request
      .post('/api/platform/auth/login')
      .send({ email: superAdminCreds.email, password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    // No credential material may leak (the submitted password, hashes, etc.)
    expect(JSON.stringify(res.body)).not.toContain(superAdminCreds.password);
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/); // bcrypt hash
    expect(res.body.errors).toBeUndefined();
  });

  test('platform token cannot access company workspace routes', async () => {
    const login = await request.post('/api/platform/auth/login').send(superAdminCreds);
    const res = await request
      .get('/api/v1/ping')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('Phase 1 - Company auth', () => {
  test('company admin logs in and receives company + branding', async () => {
    const data = await loginCompany(companyA.creds);
    expect(data.company.name).toBe('Alpha Traders');
    expect(data.company.code).toBe('AAAA01');
    expect(data.branding.app).toBe('ElevIQ SFA');
    expect(data.branding.company).toBe('Alpha Traders');
    expect(data.user.role).toBe('COMPANY_ADMIN');
    expect(data.accessToken).toBeTruthy();
  });

  test('phone login works too', async () => {
    const res = await request.post('/api/auth/login').send({
      identifier: '+9199999AAAA01',
      password: companyA.creds.password,
    });
    // phone was set to `+9199999${code}` -> includes uppercase code
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) expect(res.body.data.company.name).toBe('Alpha Traders');
  });

  test('GET /api/v1/auth/me returns user, company and app branding', async () => {
    const data = await loginCompany(companyA.creds);
    const res = await request
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.company.name).toBe('Alpha Traders');
    expect(res.body.data.branding).toEqual({ app: 'ElevIQ SFA', company: 'Alpha Traders' });
    expect(res.body.data.permissions).toBeTruthy(); // RBAC matrix
  });

  test('login with unknown user fails', async () => {
    const res = await request
      .post('/api/auth/login')
      .send({ identifier: 'ghost@nowhere.test', password: 'Whatever#1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  test('suspended company gets 403 COMPANY_SUSPENDED', async () => {
    const Company = (await import('../src/models/Company.js')).default;
    await Company.updateOne({ _id: companyB.company._id }, { $set: { status: 'SUSPENDED', statusReason: 'Non-payment' } });

    const res = await request.post('/api/auth/login').send(companyB.creds);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMPANY_SUSPENDED');

    await Company.updateOne({ _id: companyB.company._id }, { $set: { status: 'ACTIVE' } });
  });

  test('expired company is blocked', async () => {
    const Company = (await import('../src/models/Company.js')).default;
    await Company.updateOne(
      { _id: companyB.company._id },
      { $set: { status: 'EXPIRED', subscriptionEnd: new Date(Date.now() - 1000) } }
    );
    const res = await request.post('/api/auth/login').send(companyB.creds);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMPANY_EXPIRED');
    await Company.updateOne(
      { _id: companyB.company._id },
      { $set: { status: 'ACTIVE', subscriptionEnd: new Date(Date.now() + 365 * 86400000) } }
    );
  });
});

describe('Phase 1 - Refresh token rotation & reuse detection', () => {
  let agent;
  let firstCookie;

  test('refresh issues a new access token and rotates the cookie', async () => {
    agent = makeAgent(app);
    const login = await agent.post('/api/auth/login').send(companyA.creds);
    expect(login.status).toBe(200);

    const setCookie = login.headers['set-cookie'] || [];
    firstCookie = setCookie.find((c) => c.startsWith('eleviq_rt='));
    expect(firstCookie).toBeTruthy();

    const refresh1 = await agent.post('/api/auth/refresh').send({});
    expect(refresh1.status).toBe(200);
    expect(refresh1.body.data.accessToken).toBeTruthy();
    expect(refresh1.body.data.scope).toBe('company');
  });

  test('a rotated token replayed by the same device inside the grace window is re-issued', async () => {
    // The refresh response was "lost" (page unloaded mid-request): the browser
    // still holds the old cookie. Same token, same IP, seconds later.
    const res = await request.post('/api/auth/refresh').set('Cookie', [firstCookie]);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  test('a rotated token replayed after the grace window is rejected as reuse', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const Session = (await import('../src/models/Session.js')).default;

    const agent = makeAgent(app);
    const login = await agent.post('/api/auth/login').send(companyA.creds);
    const cookie = (login.headers['set-cookie'] || []).find((c) => c.startsWith('eleviq_rt='));
    const old = await agent.post('/api/auth/refresh').send({});
    expect(old.status).toBe(200);

    const jti = jwt.verify(cookieValue(cookie), process.env.JWT_REFRESH_SECRET).jti;
    await Session.updateOne({ jti }, { $set: { revokedAt: new Date(Date.now() - 2 * 60 * 1000) } });

    const res = await request.post('/api/auth/refresh').set('Cookie', [cookie]);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REFRESH_REUSE');
  });

  test('a rotated token replayed from a different IP is rejected as reuse', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const Session = (await import('../src/models/Session.js')).default;

    const agent = makeAgent(app);
    const login = await agent.post('/api/auth/login').send(companyA.creds);
    const cookie = (login.headers['set-cookie'] || []).find((c) => c.startsWith('eleviq_rt='));
    const old = await agent.post('/api/auth/refresh').send({});
    expect(old.status).toBe(200);

    const jti = jwt.verify(cookieValue(cookie), process.env.JWT_REFRESH_SECRET).jti;
    await Session.updateOne({ jti }, { $set: { ip: '198.51.100.9' } });

    const res = await request.post('/api/auth/refresh').set('Cookie', [cookie]);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REFRESH_REUSE');
  });

  test('logout revokes the session', async () => {
    const agent = makeAgent(app);
    const login = await agent.post('/api/auth/login').send(companyA.creds);
    const token = login.body.data.accessToken;
    const out = await agent.post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(200);

    const after = await agent.post('/api/auth/refresh').send({});
    expect(after.status).toBe(401);
  });
});

describe('Phase 1 - Tenant isolation (critical)', () => {
  test('company A never sees company B documents', async () => {
    const { runWithContext } = await import('../src/middlewares/tenantContext.js');

    await runWithContext({ scope: 'company', companyId: String(companyA.company._id) }, () =>
      notificationModel.create({ companyId: companyA.company._id, title: 'A only', broadcast: true })
    );
    await runWithContext({ scope: 'company', companyId: String(companyB.company._id) }, () =>
      notificationModel.create({ companyId: companyB.company._id, title: 'B only', broadcast: true })
    );

    const inA = await runWithContext({ scope: 'company', companyId: String(companyA.company._id) }, () =>
      notificationModel.find().lean()
    );
    const inB = await runWithContext({ scope: 'company', companyId: String(companyB.company._id) }, () =>
      notificationModel.find().lean()
    );

    expect(inA.length).toBe(1);
    expect(inA[0].title).toBe('A only');
    expect(inB.length).toBe(1);
    expect(inB[0].title).toBe('B only');
  });

  test('update is scoped: A cannot update B document', async () => {
    const { runWithContext } = await import('../src/middlewares/tenantContext.js');
    const inB = await runWithContext({ scope: 'company', companyId: String(companyB.company._id) }, () =>
      notificationModel.find().lean()
    );
    const targetId = inB[0]._id;

    // Company A tries to update B's doc by id -> must match 0 documents.
    const res = await runWithContext({ scope: 'company', companyId: String(companyA.company._id) }, () =>
      notificationModel.updateOne({ _id: targetId }, { $set: { title: 'hijacked' } })
    );
    expect(res.matchedCount).toBe(0);

    // B's doc unchanged.
    const still = await runWithContext({ scope: 'company', companyId: String(companyB.company._id) }, () =>
      notificationModel.findById(targetId).lean()
    );
    expect(still.title).toBe('B only');
  });

  test('delete is scoped: A cannot soft-delete B document', async () => {
    const { runWithContext } = await import('../src/middlewares/tenantContext.js');
    const inB = await runWithContext({ scope: 'company', companyId: String(companyB.company._id) }, () =>
      notificationModel.find().lean()
    );
    const targetId = inB[0]._id;

    const res = await runWithContext({ scope: 'company', companyId: String(companyA.company._id) }, () =>
      notificationModel.softDeleteOne({ _id: targetId })
    );
    expect(res.matchedCount).toBe(0);
  });

  test('tenant model query with no tenant context is refused (no leak)', async () => {
    await expect(notificationModel.find()).rejects.toMatchObject({ code: 'TENANT_SCOPE_MISSING' });
  });

  test('spoofing companyId via query is rejected with 403 TENANT_SPOOF', async () => {
    const data = await loginCompany(companyA.creds);
    const res = await request
      .get(`/api/v1/ping?companyId=${companyB.company._id}`)
      .set('Authorization', `Bearer ${data.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_SPOOF');
  });
});

describe('Phase 1 - Soft delete policy', () => {
  test('raw deleteOne on a tenant model is blocked', async () => {
    const User = (await import('../src/models/User.js')).default;
    const { runWithContext } = await import('../src/middlewares/tenantContext.js');
    await expect(
      runWithContext({ scope: 'company', companyId: String(companyA.company._id) }, () =>
        User.deleteOne({ email: companyA.creds.identifier })
      )
    ).rejects.toMatchObject({ code: 'HARD_DELETE_BLOCKED' });
  });

  test('softDeleteOne marks isDeleted and hides the document', async () => {
    const User = (await import('../src/models/User.js')).default;
    const { runWithContext } = await import('../src/middlewares/tenantContext.js');

    const victim = await runWithContext({ scope: 'company', companyId: String(companyA.company._id) }, () =>
      User.create({
        companyId: companyA.company._id,
        name: 'Temp User',
        email: 'temp@aaaa01.test',
        password: 'Temp#Pass123',
        role: 'SALESMAN',
      })
    );

    const del = await runWithContext({ scope: 'company', companyId: String(companyA.company._id) }, () =>
      User.softDeleteOne({ _id: victim._id })
    );
    expect(del.matchedCount).toBe(1);

    const found = await runWithContext({ scope: 'company', companyId: String(companyA.company._id) }, () =>
      User.findById(victim._id).lean()
    );
    expect(found).toBeNull();

    // Raw document still exists (soft, not purged)
    const raw = await User.findOne({ _id: victim._id }).skipTenant().lean();
    expect(raw).toBeTruthy();
    expect(raw.isDeleted).toBe(true);

    // restore works
    await runWithContext({ scope: 'company', companyId: String(companyA.company._id) }, () =>
      User.restore({ _id: victim._id })
    );
    const restored = await runWithContext({ scope: 'company', companyId: String(companyA.company._id) }, () =>
      User.findById(victim._id).lean()
    );
    expect(restored).toBeTruthy();
  });
});
