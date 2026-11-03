import { boot, shutdown, clearDb } from './helpers.js';

let request;
let Company;
let Setting;
let User;
let runWithContext;

const PASSWORD = 'Settings#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });

const login = async (identifier) => {
  const res = await request.post('/api/auth/login').send({ identifier, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
};

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  Company = (await import('../src/models/Company.js')).default;
  Setting = (await import('../src/models/Setting.js')).default;
  User = (await import('../src/models/User.js')).default;
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  await clearDb();

  // Countries/states/cities, as `npm run seed` does.
  const { seedLocations } = await import('../src/services/locationService.js');
  await seedLocations();

  const company = await Company.create({
    code: 'LOCA01',
    slug: 'loca01',
    businessName: 'Locale Traders',
    legalName: 'Locale Traders Pvt Ltd',
    gstin: '27AAAAA0000A1Z5',
    email: 'hello@locale.test',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    address: { line1: '1 Main Rd', city: 'Pune', state: 'Maharashtra', country: 'India', pincode: '411001' },
  });
  state.companyId = String(company._id);

  await runWithContext({ scope: 'company', companyId: state.companyId }, async () => {
    await Setting.forCompany(company._id);
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@locale.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    await User.create({ companyId: company._id, name: 'Sam', email: 'sam@locale.test', password: PASSWORD, role: 'SALESMAN' });
  });

  state.admin = await login('admin@locale.test');
});

afterAll(async () => {
  await shutdown();
});

describe('Location master', () => {
  test('countries carry currency, tax and postal defaults', async () => {
    const res = await request.get('/api/locations/countries/IN').set(as(state.admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      currency: 'INR',
      tax: { regime: 'GST', label: 'GST', taxIdLabel: 'GSTIN', splitIntraState: true },
      postalCode: { numeric: true, length: 6 },
    });
  });

  test('states are linked to their country and cities to their state', async () => {
    const states = await request.get('/api/locations/countries/IN/states').set(as(state.admin));
    const mh = states.body.data.find((s) => s.name === 'Maharashtra');
    expect(mh).toBeTruthy();
    const cities = await request.get(`/api/locations/countries/IN/states/${mh.code}/cities`).set(as(state.admin));
    expect(cities.body.data.map((c) => c.name)).toContain('Pune');
  });
});

describe('Address postal code validation', () => {
  test('an Indian PIN with letters is rejected on the field', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set(as(state.admin))
      .send({ name: 'Bad Pin Store', address: { country: 'India', state: 'Maharashtra', city: 'Pune', pincode: '41A001' } });
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ field: 'body.address.pincode' });
  });

  test('a 5-digit Indian PIN is rejected, a 6-digit one accepted', async () => {
    const short = await request
      .post('/api/v1/customers')
      .set(as(state.admin))
      .send({ name: 'Short Pin', address: { country: 'India', pincode: '41100' } });
    expect(short.status).toBe(422);

    const ok = await request
      .post('/api/v1/customers')
      .set(as(state.admin))
      .send({ name: 'Good Pin', address: { country: 'India', state: 'Maharashtra', pincode: '411002' } });
    expect(ok.status).toBe(201);
  });
});

describe('Business profile', () => {
  test('settings expose the registration data captured at signup', async () => {
    const res = await request.get('/api/v1/settings').set(as(state.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.company).toMatchObject({
      code: 'LOCA01',
      businessName: 'Locale Traders',
      legalName: 'Locale Traders Pvt Ltd',
      gstin: '27AAAAA0000A1Z5',
      email: 'hello@locale.test',
    });
    expect(res.body.data.address.city).toBe('Pune');
  });

  test('profile, address and localisation are saved on the company itself', async () => {
    const res = await request
      .patch('/api/v1/settings')
      .set(as(state.admin))
      .send({
        profile: { phone: '+91 98765 43210', website: 'https://locale.test' },
        address: { line1: '2 New Rd', city: 'Mumbai', state: 'Maharashtra', country: 'India', pincode: '400001' },
        currency: 'INR',
        timezone: 'Asia/Kolkata',
      });
    expect(res.status).toBe(200);

    const company = await Company.findById(state.companyId).lean();
    expect(company.phone).toBe('+91 98765 43210');
    expect(company.address.city).toBe('Mumbai');

    const me = await request.get('/api/v1/auth/me').set(as(state.admin));
    expect(me.body.data.company.country).toBe('India');
  });
});

describe('Tax: place of supply', () => {
  const orderFor = async (customerState) => {
    const customer = await request
      .post('/api/v1/customers')
      .set(as(state.admin))
      .send({ name: `Buyer ${customerState}`, address: { country: 'India', state: customerState } });
    const product = await request
      .post('/api/v1/products')
      .set(as(state.admin))
      .send({ name: `Item ${customerState}`, sellingPrice: 100, gstRate: 18 });
    const order = await request
      .post('/api/v1/orders')
      .set(as(state.admin))
      .send({ customerId: customer.body.data.id, items: [{ product: product.body.data.id, qty: 1 }] });
    if (order.status !== 201) throw new Error(JSON.stringify(order.body));
    return order.body.data;
  };

  beforeAll(async () => {
    await request
      .patch('/api/v1/settings')
      .set(as(state.admin))
      .send({ order: { allowNegativeStock: true }, invoice: { rounding: 'NONE' }, tax: { regime: 'GST', enableCgstSgst: true } });
  });

  test('same-state sale splits into CGST + SGST', async () => {
    const order = await orderFor('Maharashtra');
    expect(order.taxBreakup).toMatchObject({ cgst: 9, sgst: 9, igst: 0 });
  });

  test('other-state sale is IGST', async () => {
    const order = await orderFor('Karnataka');
    expect(order.taxBreakup).toMatchObject({ cgst: 0, sgst: 0, igst: 18 });
  });

  test('the "no tax" regime charges nothing whatever the product rate', async () => {
    // Its own company: the regime is chosen at registration and then locked.
    const company = await Company.create({
      code: 'NOTX01',
      slug: 'notx01',
      businessName: 'No Tax Co',
      status: 'ACTIVE',
      subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    });
    await runWithContext({ scope: 'company', companyId: String(company._id) }, async () => {
      const settings = await Setting.forCompany(company._id);
      settings.set({ 'tax.regime': 'NONE', 'order.allowNegativeStock': true, 'invoice.rounding': 'NONE' });
      await settings.save();
      await User.create({ companyId: company._id, name: 'NT Admin', email: 'admin@notax.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    });
    const token = await login('admin@notax.test');
    const customer = await request.post('/api/v1/customers').set(as(token)).send({ name: 'NT Buyer' });
    const product = await request.post('/api/v1/products').set(as(token)).send({ name: 'NT Item', sellingPrice: 100, gstRate: 18 });
    const order = await request
      .post('/api/v1/orders')
      .set(as(token))
      .send({ customerId: customer.body.data.id, items: [{ product: product.body.data.id, qty: 1 }] });
    expect(order.status).toBe(201);
    expect(order.body.data.taxTotal).toBe(0);
    expect(order.body.data.total).toBe(100);
  });
});

describe('Maintenance mode', () => {
  afterAll(async () => {
    await request.patch('/api/v1/settings').set(as(state.admin)).send({ maintenanceMode: false });
  });

  test('blocks non-admin sign-in and sessions with the configured message; admins keep working', async () => {
    const salesman = await login('sam@locale.test');
    const on = await request
      .patch('/api/v1/settings')
      .set(as(state.admin))
      .send({ maintenanceMode: true, maintenanceMessage: 'Back at 11:00' });
    expect(on.status).toBe(200);

    const session = await request.get('/api/v1/customers').set(as(salesman));
    expect(session.status).toBe(503);
    expect(session.body).toMatchObject({ code: 'MAINTENANCE', message: 'Back at 11:00' });

    const signIn = await request.post('/api/auth/login').send({ identifier: 'sam@locale.test', password: PASSWORD });
    expect(signIn.status).toBe(503);

    const admin = await request.get('/api/v1/customers').set(as(state.admin));
    expect(admin.status).toBe(200);
  });
});

describe('Settings locked by transactions', () => {
  // The tax tests above created orders, so this company now has transactions.
  test('settings report the lock', async () => {
    const res = await request.get('/api/v1/settings').set(as(state.admin));
    expect(res.body.data.locks).toMatchObject({ locked: true, canEditSupport: false });
    expect(res.body.data.locks.transactions).toBeGreaterThan(0);
    expect(res.body.data.locks.hard).toEqual(expect.arrayContaining(['currency', 'country', 'financialYearStartMonth', 'taxRegime']));
  });

  test('currency, financial year and tax regime cannot change any more', async () => {
    for (const body of [{ currency: 'USD' }, { financialYearStartMonth: 1 }, { tax: { regime: 'VAT' } }]) {
      const res = await request.patch('/api/v1/settings').set(as(state.admin)).send(body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SETTING_LOCKED');
    }
    const company = await Company.findById(state.companyId).lean();
    expect(company.currency).toBe('INR');
  });

  test('the company admin cannot change the tax registration number', async () => {
    const res = await request
      .patch('/api/v1/settings')
      .set(as(state.admin))
      .send({ profile: { gstin: '29BBBBB1111B1Z5' } });
    expect(res.status).toBe(409);
    expect(res.body.errors[0].field).toBe('body.profile.gstin');
  });

  test('saving the form with unchanged locked values still works', async () => {
    const current = (await request.get('/api/v1/settings').set(as(state.admin))).body.data;
    const res = await request
      .patch('/api/v1/settings')
      .set(as(state.admin))
      .send({
        currency: current.currency,
        financialYearStartMonth: current.financialYearStartMonth,
        tax: { regime: current.tax.regime },
        profile: { gstin: current.company.gstin, website: 'https://changed.test' },
      });
    expect(res.status).toBe(200);
  });

  test('a company without transactions can still fix its currency', async () => {
    const fresh = await Company.create({
      code: 'FRSH01',
      slug: 'frsh01',
      businessName: 'Fresh Co',
      status: 'ACTIVE',
      subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    });
    await runWithContext({ scope: 'company', companyId: String(fresh._id) }, async () => {
      await Setting.forCompany(fresh._id);
      await User.create({ companyId: fresh._id, name: 'Fresh Admin', email: 'admin@fresh.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    });
    const token = await login('admin@fresh.test');
    const res = await request.patch('/api/v1/settings').set(as(token)).send({ currency: 'AED', currencySymbol: 'AED' });
    expect(res.status).toBe(200);
    expect((await Company.findById(fresh._id).lean()).currency).toBe('AED');
  });
});

describe('Issued invoices keep the seller details of their day', () => {
  test('a later tax ID change does not rewrite an issued invoice', async () => {
    const customer = await request
      .post('/api/v1/customers')
      .set(as(state.admin))
      .send({ name: 'Snapshot Buyer', address: { country: 'India', state: 'Maharashtra' } });
    const product = await request
      .post('/api/v1/products')
      .set(as(state.admin))
      .send({ name: 'Snapshot Item', sellingPrice: 50, gstRate: 18 });
    const invoice = await request
      .post('/api/v1/invoices')
      .set(as(state.admin))
      .send({ customerId: customer.body.data.id, items: [{ product: product.body.data.id, qty: 1 }], issue: true });
    expect(invoice.status).toBe(201);

    // The service provider corrects the registration number afterwards.
    await Company.updateOne({ _id: state.companyId }, { $set: { gstin: '27ZZZZZ9999Z1Z9' } });

    const Invoice = (await import('../src/models/Invoice.js')).default;
    const saved = await Invoice.findById(invoice.body.data.id).skipTenant().lean();
    expect(saved.seller).toMatchObject({ businessName: 'Locale Traders', gstin: '27AAAAA0000A1Z5' });
  });
});
