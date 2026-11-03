import { boot, shutdown, clearDb } from './helpers.js';

let request;
let Company;
let Customer;
let ExcelJS;

const PASSWORD = 'Customer#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const ADDR = { country: 'India', state: 'Maharashtra', city: 'Pune', pincode: '411001' };

const create = (body) => request.post('/api/v1/customers').set(as(state.admin)).send(body);

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  Company = (await import('../src/models/Company.js')).default;
  Customer = (await import('../src/models/Customer.js')).default;
  const Setting = (await import('../src/models/Setting.js')).default;
  const User = (await import('../src/models/User.js')).default;
  const { runWithContext } = await import('../src/middlewares/tenantContext.js');
  ExcelJS = (await import('exceljs')).default;
  await clearDb();
  await (await import('../src/services/locationService.js')).seedLocations();

  const company = await Company.create({
    code: 'CUST01',
    slug: 'cust01',
    businessName: 'Customer Co',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    limits: { maxUsers: 10, maxCustomers: 500, maxInvoicesPerMonth: 500 },
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  state.companyId = String(company._id);
  await runWithContext({ scope: 'company', companyId: state.companyId }, async () => {
    const settings = await Setting.forCompany(company._id);
    settings.set('series.customer', { prefix: 'CU', pad: 4 });
    await settings.save();
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@cust.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
  });
  const login = await request.post('/api/auth/login').send({ identifier: 'admin@cust.test', password: PASSWORD });
  state.admin = login.body.data.accessToken;
});

afterAll(async () => {
  await shutdown();
});

describe('Customer master rules', () => {
  test('codes follow the company numbering settings and cannot be supplied', async () => {
    const res = await create({ name: 'Alpha Store', phone: '+91 98200 00001', address: ADDR, code: 'MINE-1' });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe('CU-0001');
  });

  test('phone and billing country/state/city are required', async () => {
    const res = await create({ name: 'No Contact Store' });
    expect(res.status).toBe(422);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['body.phone', 'body.address.country', 'body.address.state', 'body.address.city']));
  });

  test('alternate phone must differ and phones must be valid', async () => {
    const res = await create({ name: 'Phone Store', phone: '98200 00002', alternatePhone: '9820000002', address: ADDR });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('body.alternatePhone');
    const bad = await create({ name: 'Bad Phone', phone: 'call me', address: ADDR });
    expect(bad.body.errors[0].field).toBe('body.phone');
  });

  test('a state must belong to the chosen country', async () => {
    const res = await create({ name: 'Wrong State', phone: '+91 98200 00003', address: { ...ADDR, state: 'Texas' } });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('body.address.state');
  });

  test('GSTIN format, state code and PAN are checked; PAN is filled from GSTIN', async () => {
    const badFormat = await create({ name: 'Gst A', phone: '+91 98200 00004', address: ADDR, gstin: '27ABC' });
    expect(badFormat.body.errors[0].field).toBe('body.gstin');

    const wrongState = await create({ name: 'Gst B', phone: '+91 98200 00005', address: ADDR, gstin: '29AAAAA0000A1Z5' });
    expect(wrongState.body.errors[0].message).toMatch(/does not match Maharashtra/);

    const ok = await create({ name: 'Gst C', phone: '+91 98200 00006', address: ADDR, gstin: '27aaaaa0000a1z5' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.gstin).toBe('27AAAAA0000A1Z5');
    expect(ok.body.data.pan).toBe('AAAAA0000A');

    const dup = await create({ name: 'Gst D', phone: '+91 98200 00007', address: ADDR, gstin: '27AAAAA0000A1Z5' });
    expect(dup.body.errors[0].message).toMatch(/already has this tax registration/);
  });

  test('payment terms set the credit days and shipping copies billing by default', async () => {
    const res = await create({
      name: 'Terms Store',
      phone: '+91 98200 00008',
      address: { ...ADDR, line1: '1 MG Road' },
      paymentTerms: 'NET_30',
      creditDays: 5,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.creditDays).toBe(30);
    expect(res.body.data.shippingSameAsBilling).toBe(true);
    expect(res.body.data.shippingAddress.line1).toBe('1 MG Road');
  });

  test('opening balance is editable until the customer has transactions', async () => {
    const res = await create({ name: 'Balance Store', phone: '+91 98200 00009', address: ADDR, openingBalance: 1000 });
    const id = res.body.data.id;
    const fixed = await request.patch(`/api/v1/customers/${id}`).set(as(state.admin)).send({ openingBalance: 1500 });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.outstanding).toBe(1500);

    await Customer.updateOne({ _id: id }, { $set: { totalOrders: 1 } }).skipTenant();
    const locked = await request.patch(`/api/v1/customers/${id}`).set(as(state.admin)).send({ openingBalance: 2000 });
    expect(locked.status).toBe(422);
    expect(locked.body.errors[0].field).toBe('body.openingBalance');
  });
});

describe('Customer bulk import', () => {
  const workbookWith = async (rows) => {
    const template = await request.get('/api/v1/customers/import/template').set(as(state.admin)).buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(template.body);
    const sheet = wb.getWorksheet('Customers');
    const headers = sheet.getRow(1).values.slice(1).map((h) => String(h).replace(/\s*\*$/, ''));
    rows.forEach((row, i) => {
      headers.forEach((h, c) => {
        if (row[h] !== undefined) sheet.getRow(i + 2).getCell(c + 1).value = row[h];
      });
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  const upload = (buffer, dryRun) =>
    request
      .post(`/api/v1/customers/import?dryRun=${dryRun}`)
      .set(as(state.admin))
      .attach('file', buffer, {
        filename: 'customers.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

  const row = (n, extra = {}) => ({
    'Customer name': `Imported Store ${n}`,
    'Customer type': 'Retail',
    Phone: `+91 97000 0000${n}`,
    'Billing country': 'India',
    'Billing state': 'maharashtra',
    'Billing city': 'Pune',
    'Billing PIN / postal code': '411001',
    'Payment terms': 'Net 15',
    ...extra,
  });

  test('the template downloads as an Excel workbook', async () => {
    const res = await request.get('/api/v1/customers/import/template').set(as(state.admin));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  });

  test('a file with problems reports them by row and imports nothing', async () => {
    const buffer = await workbookWith([
      row(1),
      row(2, { Phone: 'abc', 'Customer type': 'Shop' }),
      row(3, { 'Customer name': 'Imported Store 1', Phone: '+91 97000 00001' }), // same as row 2 of the sheet
    ]);
    const res = await upload(buffer, false);
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(0);
    const errs = res.body.data.errors;
    expect(errs.some((e) => e.row === 3 && e.column === 'Phone')).toBe(true);
    expect(errs.some((e) => e.row === 3 && e.column === 'Customer type')).toBe(true);
    expect(errs.some((e) => e.row === 4 && /Same name and phone as row 2/.test(e.message))).toBe(true);
    expect(await Customer.countDocuments({ name: /^Imported Store/ }).skipTenant()).toBe(0);
  });

  test('a clean file validates, then imports with generated codes', async () => {
    const buffer = await workbookWith([row(1), row(2), row(3)]);
    const check = await upload(buffer, true);
    expect(check.body.data).toMatchObject({ total: 3, valid: 3, imported: 0, errors: [] });

    const done = await upload(buffer, false);
    expect(done.body.data.imported).toBe(3);
    const saved = await Customer.find({ name: /^Imported Store/ }).skipTenant().lean();
    expect(saved).toHaveLength(3);
    expect(saved.every((c) => /^CU-\d{4}$/.test(c.code))).toBe(true);
    expect(saved[0].address.state).toBe('Maharashtra'); // normalised from "maharashtra"
    expect(saved[0].creditDays).toBe(15);
  });

  test('only .xlsx files are accepted', async () => {
    const res = await request
      .post('/api/v1/customers/import?dryRun=true')
      .set(as(state.admin))
      .attach('file', Buffer.from('a,b'), { filename: 'customers.csv', contentType: 'text/csv' });
    expect(res.status).toBe(400);
  });
});
