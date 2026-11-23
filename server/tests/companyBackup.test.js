import zlib from 'node:zlib';
import { boot, shutdown, clearDb } from './helpers.js';

/** Provider tools: back up a company, delete all its data, restore it from the file. */

let request;
const PASSWORD = 'Backup#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
let runWithContext;
let models;
const inTenant = (companyId, fn) => runWithContext({ scope: 'company', companyId }, fn);

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const companyLogin = async (email) => (await request.post('/api/auth/login').send({ identifier: email, password: PASSWORD })).body?.data?.accessToken;
const restore = (file, apply) =>
  request
    .post(`/api/platform/companies/restore${apply ? '?apply=true' : ''}`)
    .set(as(state.root))
    .attach('file', file, { filename: 'backup.json.gz', contentType: 'application/gzip' });

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  const load = async (n) => (await import(`../src/models/${n}.js`)).default;
  models = Object.fromEntries(await Promise.all(['Company', 'User', 'PlatformUser', 'Setting', 'Warehouse', 'Customer', 'Invoice', 'StockMovement'].map(async (n) => [n, await load(n)])));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  await clearDb();
  await (await import('../src/services/locationService.js')).seedLocations();

  await models.PlatformUser.create({ name: 'Root', email: 'root@backup.test', password: 'Root#Pass123', role: 'SUPER_ADMIN' });
  await models.PlatformUser.create({ name: 'Help', email: 'help@backup.test', password: 'Help#Pass123', role: 'PLATFORM_SUPPORT' });
  state.root = (await request.post('/api/platform/auth/login').send({ email: 'root@backup.test', password: 'Root#Pass123' })).body.data.accessToken;
  state.help = (await request.post('/api/platform/auth/login').send({ email: 'help@backup.test', password: 'Help#Pass123' })).body.data.accessToken;

  const mk = async (code, email) => {
    const company = await models.Company.create({
      code,
      slug: code.toLowerCase(),
      businessName: `${code} Traders`,
      status: 'ACTIVE',
      timezone: 'Asia/Kolkata',
      subscriptionEnd: new Date(Date.now() + 365 * 86400000),
      address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
    });
    await inTenant(String(company._id), async () => {
      const settings = await models.Setting.forCompany(company._id);
      const wh = await models.Warehouse.create({ name: 'Main', code: 'MAIN', isDefault: true });
      settings.set({ 'inventory.defaultWarehouse': wh._id, 'invoice.rounding': 'NONE' });
      await settings.save();
      await models.User.create({ companyId: company._id, name: 'Admin', email, password: PASSWORD, role: 'COMPANY_ADMIN' });
    });
    return String(company._id);
  };
  state.leaving = await mk('LEAVE', 'admin@leave.test');
  state.staying = await mk('STAY', 'admin@stay.test');

  // Some real records in the company that leaves: masters, an invoice, stock.
  const token = await companyLogin('admin@leave.test');
  const api = (url, body) => request.post(url).set(as(token)).send(body);
  const food = await api('/api/v1/product-categories', { level: 'CLASSIFICATION', name: 'Food' });
  const cat = await api('/api/v1/product-categories', { level: 'CATEGORY', name: 'Snacks', parent: food.body.data.id });
  const product = await api('/api/v1/products', { name: 'Cookies', classificationId: food.body.data.id, categoryId: cat.body.data.id, unit: 'PCS', hsnCode: '1905', gstRate: 18, mrp: 200, sellingPrice: 150, purchasePrice: 100, openingStock: 50 });
  const customer = await api('/api/v1/customers', { name: 'Corner Shop', phone: '+91 90000 77777', address: { country: 'India', state: 'Maharashtra', city: 'Pune' } });
  const inv = await api('/api/v1/invoices', { customerId: customer.body.data.id, items: [{ product: product.body.data.id, qty: 5 }], issue: true });
  expect(inv.status).toBe(201);
  state.invoiceNo = inv.body.data.invoiceNo;
});

afterAll(async () => {
  await shutdown();
});

describe('Company backup, purge and restore', () => {
  test('only the super admin may download a backup', async () => {
    expect((await request.get(`/api/platform/companies/${state.leaving}/backup`).set(as(state.help))).status).toBe(403);
  });

  test('the summary counts the records; purge needs a backup and an inactive company', async () => {
    const res = await request.get(`/api/platform/companies/${state.leaving}/data`).set(as(state.root));
    expect(res.status).toBe(200);
    expect(res.body.data.counts).toMatchObject({ User: 1, Invoice: 1, Customer: 1, Product: 1 });
    expect(res.body.data.records).toBeGreaterThan(5);
    expect(res.body.data.purgeBlocker).toMatch(/Suspend or cancel/);
    state.records = res.body.data.records;
  });

  test('a backup file holds every record, with a checksum', async () => {
    const res = await request.get(`/api/platform/companies/${state.leaving}/backup`).set(as(state.root)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/backup-LEAVE-.*\.json\.gz/);
    expect(Number(res.headers['x-backup-records'])).toBe(state.records);
    const parsed = JSON.parse(zlib.gunzipSync(res.body).toString('utf8'));
    expect(parsed.header).toMatchObject({ format: 'eleviq-company-backup', version: 1, company: { code: 'LEAVE' }, records: state.records });
    state.file = res.body;
  });

  test('purge: refused while active and with a wrong code, then deletes every record', async () => {
    const url = `/api/platform/companies/${state.leaving}/purge`;
    const body = { confirmCode: 'LEAVE', reason: 'Customer closed the account' };
    expect((await request.post(url).set(as(state.root)).send(body)).status).toBe(409); // still active

    await request.patch(`/api/platform/companies/${state.leaving}/status`).set(as(state.root)).send({ status: 'SUSPENDED', reason: 'Leaving us' });
    const wrong = await request.post(url).set(as(state.root)).send({ ...body, confirmCode: 'STAY' });
    expect(wrong.status).toBe(422);
    expect((await request.post(url).set(as(state.help)).send(body)).status).toBe(403);

    const res = await request.post(url).set(as(state.root)).send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.records).toBe(state.records);

    const after = await request.get(`/api/platform/companies/${state.leaving}/data`).set(as(state.root));
    expect(after.body.data).toMatchObject({ records: 0, counts: {} });
    expect(after.body.data.purgedAt).toBeTruthy();
    expect(await companyLogin('admin@leave.test')).toBeFalsy();

    // The other company is untouched.
    const other = await request.get(`/api/platform/companies/${state.staying}/data`).set(as(state.root));
    expect(other.body.data.counts.User).toBe(1);
  });

  test('restore: a check first, then every record comes back; running it again adds nothing', async () => {
    const check = await restore(state.file, false);
    expect(check.status).toBe(200);
    expect(check.body.data).toMatchObject({ conflicts: [], company: { code: 'LEAVE', exists: true } });

    const res = await restore(state.file, true);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ inserted: state.records, skipped: 0 });

    const after = await request.get(`/api/platform/companies/${state.leaving}/data`).set(as(state.root));
    expect(after.body.data.records).toBe(state.records);
    expect(after.body.data.purgedAt).toBeNull();
    const invoice = await inTenant(state.leaving, () => models.Invoice.findOne({ invoiceNo: state.invoiceNo }).lean());
    expect(invoice).toBeTruthy();

    // Restore does not touch a company that has its data: it says so.
    const again = await restore(state.file, false);
    expect(again.body.data.conflicts[0]).toMatch(/still has its data/);
    expect((await restore(state.file, true)).status).toBe(409);
  });

  test('a damaged or foreign file is refused', async () => {
    const damaged = Buffer.from(state.file);
    damaged[damaged.length - 20] ^= 0xff;
    expect((await restore(damaged, false)).status).toBe(400);
    const foreign = zlib.gzipSync(Buffer.from(JSON.stringify({ header: { format: 'something-else' }, data: {} })));
    const res = await restore(foreign, false);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not an ElevIQ company backup/);
  });
});
