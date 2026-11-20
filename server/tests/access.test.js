import { boot, shutdown, clearDb } from './helpers.js';

/**
 * Per-user access: a company admin gives one user a permission their role does
 * not have (Allow), takes one away (Deny), or does so until a date. Print is
 * split per document type. Only an admin can change access, nobody their own,
 * and a non-admin who manages users can never reach the admin role.
 */

let request;
const PASSWORD = 'Access#Pass123';
const state = {};
const FAKE_ID = '0123456789abcdef01234567';
let User;
let Setting;
let runWithContext;

const as = (token) => ({ Authorization: `Bearer ${token}` });
const login = async (email) => (await request.post('/api/auth/login').send({ identifier: email, password: PASSWORD })).body.data.accessToken;
const inTenant = (fn) => runWithContext({ scope: 'company', companyId: state.companyId }, fn);
const admin = {
  get: (url) => request.get(url).set(as(state.admin)),
  put: (url, body) => request.put(url).set(as(state.admin)).send(body),
};
const setAccess = (userId, overrides) => admin.put(`/api/v1/users/${userId}/access`, { overrides });
/** 404 = got past the permission checks to the (missing) document; 403 = refused. */
const printInvoice = (token) => request.get(`/api/v1/invoices/${FAKE_ID}/pdf`).set(as(token));
const me = async (token) => (await request.get('/api/v1/auth/me').set(as(token))).body.data;

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  const Company = (await import('../src/models/Company.js')).default;
  User = (await import('../src/models/User.js')).default;
  Setting = (await import('../src/models/Setting.js')).default;
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  await clearDb();

  const company = await Company.create({
    code: 'ACC01',
    slug: 'acc01',
    businessName: 'Access Co',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  state.companyId = String(company._id);
  const people = [
    ['admin', 'Admin', 'COMPANY_ADMIN'],
    ['manager', 'Manager', 'MANAGER'],
    ['presaleA', 'Presale A', 'SALESMAN', 'PRESALE'],
    ['presaleB', 'Presale B', 'SALESMAN', 'PRESALE'],
    ['presaleC', 'Presale C', 'SALESMAN', 'PRESALE'],
  ];
  await inTenant(async () => {
    await Setting.forCompany(company._id);
    for (const [key, name, role, salesType] of people) {
      const u = await User.create({ companyId: company._id, name, email: `${key.toLowerCase()}@acc.test`, password: PASSWORD, role, salesType });
      state[`${key}Id`] = String(u._id);
    }
  });
  for (const [key] of people) state[key] = await login(`${key.toLowerCase()}@acc.test`);
});

afterAll(async () => {
  await shutdown();
});

describe('Print per document type', () => {
  test('every role that printed before still prints each document', async () => {
    expect((await printInvoice(state.presaleA)).status).toBe(404);
    const perms = (await me(state.presaleA)).permissions;
    ['orders.print', 'invoices.print', 'creditnotes.print', 'payments.print', 'purchases.print'].forEach((k) => expect(perms[k]).toContain('SALESMAN'));
    expect(perms['documents.print.original']).not.toContain('SALESMAN');
  });

  test('a company that limited the old "print" keeps that limit on the new keys', async () => {
    await inTenant(async () => {
      const s = await Setting.forCompany(state.companyId);
      s.rolePermissions = { ...(s.rolePermissions || {}), 'documents.print': ['COMPANY_ADMIN', 'ACCOUNTANT'] };
      for (const k of ['orders.print', 'invoices.print', 'creditnotes.print', 'payments.print', 'purchases.print']) delete s.rolePermissions[k];
      s.markModified('rolePermissions');
      await s.save();
    });
    expect((await printInvoice(state.presaleA)).status).toBe(403);
    const settings = (await admin.get('/api/v1/settings')).body.data;
    expect(settings.rolePermissions['invoices.print']).toEqual(['COMPANY_ADMIN', 'ACCOUNTANT']);
    expect(settings.rolePermissions['documents.print']).toBeUndefined();

    // Saving the matrix writes the new keys, keeping the choice.
    expect((await admin.put('/api/v1/settings/permissions', { rolePermissions: {} })).status).toBe(200);
    const saved = await inTenant(() => Setting.forCompany(state.companyId));
    expect(saved.rolePermissions['payments.print']).toEqual(['COMPANY_ADMIN', 'ACCOUNTANT']);

    // Back to the defaults for the rest of the file.
    expect((await request.post('/api/v1/settings/permissions/reset').set(as(state.admin))).status).toBe(200);
    expect((await printInvoice(state.presaleA)).status).toBe(404);
  });
});

describe('Allow and Deny for one user', () => {
  test('Deny takes invoice printing from one salesman only', async () => {
    const res = await setAccess(state.presaleAId, [{ permission: 'invoices.print', effect: 'DENY' }]);
    expect(res.status).toBe(200);
    expect(res.body.data.customCount).toBe(1);
    const row = res.body.data.permissions.find((p) => p.key === 'invoices.print');
    expect(row).toMatchObject({ roleAllowed: true, allowed: false, source: 'USER_DENY' });

    expect((await printInvoice(state.presaleA)).status).toBe(403);
    expect((await printInvoice(state.presaleB)).status).toBe(404);
    // Email carries the PDF, so it is refused too (a manager here: a salesman
    // needs an open field day before any POST).
    const mailAs = (token) => request.post(`/api/v1/invoices/${FAKE_ID}/email`).set(as(token)).send({ to: 'x@y.test' });
    expect((await mailAs(state.manager)).status).not.toBe(403); // 503 here: no email set up in tests
    await setAccess(state.managerId, [{ permission: 'invoices.print', effect: 'DENY' }]);
    expect((await mailAs(state.manager)).status).toBe(403);
    await setAccess(state.managerId, []);
    // The app hides the buttons: the user's own permission list says no.
    expect((await me(state.presaleA)).permissions['invoices.print']).not.toContain('SALESMAN');
    expect((await me(state.presaleB)).permissions['invoices.print']).toContain('SALESMAN');
    // Other documents are untouched.
    expect((await request.get(`/api/v1/payments/${FAKE_ID}/pdf`).set(as(state.presaleA))).status).toBe(404);
  });

  test('Allow gives one salesman more than the role (3 presales, the third gets more)', async () => {
    expect((await request.post('/api/v1/customers').set(as(state.presaleC)).send({})).status).toBe(403);
    const res = await setAccess(state.presaleCId, [{ permission: 'customers.create', effect: 'ALLOW', note: 'Senior presales' }]);
    expect(res.status).toBe(200);
    // Past the permission check (the empty body then fails validation).
    expect((await request.post('/api/v1/customers').set(as(state.presaleC)).send({})).status).toBe(422);
    expect((await request.post('/api/v1/customers').set(as(state.presaleB)).send({})).status).toBe(403);
    expect((await me(state.presaleC)).permissions['customers.create']).toContain('SALESMAN');
  });

  test('a change applies at once, without signing in again', async () => {
    await setAccess(state.presaleAId, []);
    expect((await printInvoice(state.presaleA)).status).toBe(404);
  });

  test('a temporary Allow ends on its date', async () => {
    const until = new Date(Date.now() + 7 * 86400000);
    expect((await setAccess(state.presaleBId, [{ permission: 'customers.create', effect: 'ALLOW', until }])).status).toBe(200);
    expect((await request.post('/api/v1/customers').set(as(state.presaleB)).send({})).status).toBe(422);
    // Seven days later...
    await inTenant(() => User.updateOne({ _id: state.presaleBId }, { $set: { 'accessOverrides.0.until': new Date(Date.now() - 1000) } }));
    expect((await request.post('/api/v1/customers').set(as(state.presaleB)).send({})).status).toBe(403);
    const view = (await admin.get(`/api/v1/users/${state.presaleBId}/access`)).body.data;
    expect(view.customCount).toBe(0);
    expect(view.permissions.find((p) => p.key === 'customers.create').override).toMatchObject({ lapsed: true });
    await setAccess(state.presaleBId, []);
  });

  test('sales type still wins: a presale salesman cannot be allowed van invoices', async () => {
    await setAccess(state.presaleAId, [{ permission: 'invoices.create', effect: 'ALLOW' }]);
    const view = (await admin.get(`/api/v1/users/${state.presaleAId}/access`)).body.data;
    expect(view.permissions.find((p) => p.key === 'invoices.create')).toMatchObject({ allowed: false, source: 'SALES_TYPE' });
    await setAccess(state.presaleAId, []);
  });

  test('notifications follow the user’s own access', async () => {
    const { usersWithPermission } = await import('../src/services/notifyService.js');
    await setAccess(state.managerId, [{ permission: 'orders.approve', effect: 'DENY' }]);
    await setAccess(state.presaleCId, [{ permission: 'orders.approve', effect: 'ALLOW' }]);
    const ids = await inTenant(() => usersWithPermission(state.companyId, 'orders.approve'));
    expect(ids).toEqual(expect.arrayContaining([state.adminId, state.presaleCId]));
    expect(ids).not.toContain(state.managerId);
    await setAccess(state.managerId, []);
    await setAccess(state.presaleCId, [{ permission: 'customers.create', effect: 'ALLOW', note: 'Senior presales' }]);
  });
});

describe('Guard rails', () => {
  test('only known permissions, once each, with a future end date', async () => {
    const bad = await setAccess(state.presaleAId, [
      { permission: 'nope.view', effect: 'ALLOW' },
      { permission: 'orders.view', effect: 'DENY' },
      { permission: 'orders.view', effect: 'ALLOW' },
      { permission: 'orders.create', effect: 'ALLOW', until: new Date(Date.now() - 86400000) },
      { permission: 'orders.update', effect: 'ALLOW', until: new Date(Date.now() + 400 * 86400000) },
    ]);
    expect(bad.status).toBe(422);
    expect(bad.body.errors.map((e) => e.message).join(' | ')).toMatch(/Unknown permission.*listed twice.*future.*366 days/);
    expect((await setAccess(state.presaleAId, [{ permission: 'orders.view', effect: 'MAYBE' }])).status).toBe(422);
  });

  test('managing users and settings is never given to one user', async () => {
    for (const permission of ['users.update', 'users.create', 'settings.update']) {
      expect((await setAccess(state.managerId, [{ permission, effect: 'ALLOW' }])).status).toBe(422);
    }
    // Taking it away is fine.
    expect((await setAccess(state.managerId, [{ permission: 'users.view', effect: 'DENY' }])).status).toBe(200);
    expect((await request.get('/api/v1/users').set(as(state.manager))).status).toBe(403);
    await setAccess(state.managerId, []);
  });

  test('only a company admin sees or changes access; nobody their own; admins are always full', async () => {
    expect((await request.get(`/api/v1/users/${state.presaleAId}/access`).set(as(state.manager))).status).toBe(403);
    expect((await request.put(`/api/v1/users/${state.presaleAId}/access`).set(as(state.manager)).send({ overrides: [] })).status).toBe(403);
    expect((await request.get('/api/v1/users/access/who?permission=orders.view').set(as(state.manager))).status).toBe(403);
    expect((await setAccess(state.adminId, [])).body.code).toBe('SELF_ACTION');
    await inTenant(() => User.create({ companyId: state.companyId, name: 'Admin 2', email: 'admin2@acc.test', password: PASSWORD, role: 'COMPANY_ADMIN' }).then((u) => (state.admin2Id = String(u._id))));
    expect((await setAccess(state.admin2Id, [{ permission: 'orders.view', effect: 'DENY' }])).body.code).toBe('ADMIN_FULL_ACCESS');
  });

  test('a manager who may edit users cannot reach the admin role', async () => {
    await inTenant(async () => {
      const s = await Setting.forCompany(state.companyId);
      s.rolePermissions = { ...(s.rolePermissions || {}), 'users.update': ['COMPANY_ADMIN', 'MANAGER'], 'users.create': ['COMPANY_ADMIN', 'MANAGER'], 'settings.update': ['COMPANY_ADMIN', 'MANAGER'] };
      s.markModified('rolePermissions');
      await s.save();
    });
    const mgr = (method, url, body) => request[method](url).set(as(state.manager)).send(body);
    expect((await mgr('patch', `/api/v1/users/${state.presaleAId}`, { role: 'COMPANY_ADMIN' })).status).toBe(403);
    expect((await mgr('patch', `/api/v1/users/${state.admin2Id}`, { name: 'Changed' })).status).toBe(403);
    expect((await mgr('post', `/api/v1/users/${state.admin2Id}/reset-password`, { newPassword: 'Another#Pass123' })).status).toBe(403);
    expect((await mgr('post', '/api/v1/users', { name: 'Sneaky', email: 'sneaky@acc.test', role: 'COMPANY_ADMIN' })).status).toBe(403);
    // Ordinary edits still work.
    expect((await mgr('patch', `/api/v1/users/${state.presaleAId}`, { title: 'Senior' })).status).toBe(200);
    // And the role matrix itself stays with admins.
    expect((await mgr('put', '/api/v1/settings/permissions', { rolePermissions: {} })).status).toBe(403);
    expect((await mgr('post', '/api/v1/settings/permissions/reset')).status).toBe(403);
    await request.post('/api/v1/settings/permissions/reset').set(as(state.admin));
  });

  test('users list shows the count to admins and hides the details from others', async () => {
    const asAdmin = (await admin.get('/api/v1/users?limit=50')).body.data.find((u) => u.id === state.presaleCId);
    expect(asAdmin.customAccess).toBe(1);
    expect(asAdmin.accessOverrides).toHaveLength(1);
    const asManager = (await request.get('/api/v1/users?limit=50').set(as(state.manager))).body.data.find((u) => u.id === state.presaleCId);
    expect(asManager.customAccess).toBe(1);
    expect(asManager.accessOverrides).toBeUndefined();
  });

  test('every change is in the audit log and the user is told', async () => {
    const AuditLog = (await import('../src/models/AuditLog.js')).default;
    const Notification = (await import('../src/models/Notification.js')).default;
    await new Promise((r) => setTimeout(r, 200));
    const logs = await inTenant(() => AuditLog.find({ entityId: state.presaleCId }).lean());
    expect(logs.some((l) => /Allow customers\.create/.test(l.description) && l.severity === 'WARN')).toBe(true);
    const notes = await inTenant(() => Notification.find({ recipients: state.presaleCId, title: 'Your access was updated' }).lean());
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe('Who can do what', () => {
  test('lists every active user with the reason', async () => {
    const res = await admin.get('/api/v1/users/access/who?permission=customers.create');
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.data.users.map((u) => [u.id, u]));
    expect(by[state.adminId]).toMatchObject({ allowed: true, source: 'ADMIN' });
    expect(by[state.managerId]).toMatchObject({ allowed: true, source: 'ROLE' });
    expect(by[state.presaleCId]).toMatchObject({ allowed: true, source: 'USER_ALLOW' });
    expect(by[state.presaleAId]).toMatchObject({ allowed: false, source: 'ROLE' });
    expect((await admin.get('/api/v1/users/access/who?permission=bogus.key')).status).toBe(400);
  });
});
