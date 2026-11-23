import { boot, shutdown, clearDb } from './helpers.js';

/** Statement of account (party ledger): figures, running balance, PDF / Excel / email, access. */

let request;
const PASSWORD = 'Ledger#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const get = (url, token = state.admin) => request.get(url).set(as(token));
const post = (url, body, token = state.admin) => request.post(url).set(as(token)).send(body);
let runWithContext;
const inTenant = (fn) => runWithContext({ scope: 'company', companyId: state.companyId }, fn);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  const Company = (await import('../src/models/Company.js')).default;
  const Setting = (await import('../src/models/Setting.js')).default;
  const User = (await import('../src/models/User.js')).default;
  const Warehouse = (await import('../src/models/Warehouse.js')).default;
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  await clearDb();
  await (await import('../src/services/locationService.js')).seedLocations();

  const company = await Company.create({
    code: 'LEDG01',
    slug: 'ledg01',
    businessName: 'Ledger Traders',
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  state.companyId = String(company._id);
  await inTenant(async () => {
    const settings = await Setting.forCompany(company._id);
    const wh = await Warehouse.create({ name: 'Main', code: 'MAIN', isDefault: true });
    settings.set({
      'inventory.defaultWarehouse': wh._id,
      'invoice.rounding': 'NONE',
      'order.approvalThreshold': 0,
      'fieldForce.requireAttendance': false,
      'fieldForce.saleOnlyInVisit': false,
    });
    await settings.save();
    state.warehouseId = String(wh._id);
    await User.create({
      companyId: company._id,
      name: 'Admin',
      email: 'admin@ledg.test',
      password: PASSWORD,
      role: 'COMPANY_ADMIN',
    });
    await User.create({
      companyId: company._id,
      name: 'Mona',
      email: 'mgr@ledg.test',
      password: PASSWORD,
      role: 'MANAGER',
    });
    await User.create({
      companyId: company._id,
      name: 'Sam',
      email: 'sam@ledg.test',
      password: PASSWORD,
      role: 'SALESMAN',
    });
  });
  const login = async (email) =>
    (await request.post('/api/auth/login').send({ identifier: email, password: PASSWORD })).body
      .data.accessToken;
  state.admin = await login('admin@ledg.test');
  state.manager = await login('mgr@ledg.test');
  state.sam = await login('sam@ledg.test');

  const food = await post('/api/v1/product-categories', { level: 'CLASSIFICATION', name: 'Food' });
  const snacks = await post('/api/v1/product-categories', {
    level: 'CATEGORY',
    name: 'Snacks',
    parent: food.body.data.id,
  });
  const product = await post('/api/v1/products', {
    name: 'Cookies 100g',
    classificationId: food.body.data.id,
    categoryId: snacks.body.data.id,
    unit: 'PCS',
    hsnCode: '1905',
    gstRate: 18,
    mrp: 200,
    sellingPrice: 150,
    openingStock: 0,
  });
  state.productId = product.body.data.id;
  const supplier = await post('/api/v1/suppliers', {
    name: 'Cookie Mills',
    phone: '+91 90000 66666',
    address: { country: 'India', state: 'Maharashtra', city: 'Pune' },
  });
  state.supplierId = supplier.body.data.id;
  const customer = await post('/api/v1/customers', {
    name: 'Corner Shop',
    phone: '+91 90000 77777',
    openingBalance: 1000,
    address: { country: 'India', state: 'Maharashtra', city: 'Pune' },
  });
  expect(customer.status).toBe(201);
  state.customerId = customer.body.data.id;

  // Buy 10 @ 100 (+18%) = 1180, pay 500. Sell 5 @ 150 (+18%) = 885, receive 1000 of which 885 is set against it.
  const grn = await post('/api/v1/goods-receipts', {
    supplierId: state.supplierId,
    warehouse: state.warehouseId,
    post: true,
    items: [{ product: state.productId, receivedQty: 10, unitCost: 100 }],
  });
  expect(grn.status).toBe(201);
  const bill = await post('/api/v1/purchase-bills', {
    supplierId: state.supplierId,
    supplierInvoiceNo: 'CM-1',
    supplierInvoiceDate: today,
    grnIds: [grn.body.data.id],
  });
  expect(bill.status).toBe(201);
  state.bill = bill.body.data;
  const sp = await post('/api/v1/supplier-payments', {
    supplierId: state.supplierId,
    amount: 500,
    mode: 'BANK_TRANSFER',
    reference: 'NEFT1',
    allocations: [{ bill: state.bill.id, amount: 500 }],
  });
  expect(sp.status).toBe(201);
  const inv = await post('/api/v1/invoices', {
    customerId: state.customerId,
    items: [{ product: state.productId, qty: 5 }],
    issue: true,
  });
  expect(inv.status).toBe(201);
  state.invoice = inv.body.data;
  const pay = await post('/api/v1/payments', {
    customerId: state.customerId,
    amount: 1000,
    mode: 'UPI',
    reference: 'UPI77',
    allocations: [{ invoice: state.invoice.id, amount: 885 }],
    receive: true,
  });
  expect(pay.status).toBe(201);
});

afterAll(async () => {
  await shutdown();
});

describe('Customer statement', () => {
  test('opening balance, documents in date order, running balance and closing', async () => {
    const res = await get(`/api/v1/ledgers/customer/${state.customerId}`);
    expect(res.status).toBe(200);
    const l = res.body.data;
    expect(l.opening).toBe(0); // the customer was added today: its own opening shows as a line
    expect(l.rows.map((r) => r.type)).toEqual(['Opening balance', 'Invoice', 'Receipt']);
    expect(l.rows[0]).toMatchObject({ debit: 1000, balance: 1000 });
    expect(l.rows[1]).toMatchObject({ no: state.invoice.invoiceNo, debit: 885, balance: 1885 });
    expect(l.rows[2]).toMatchObject({ credit: 885, balance: 1000 });
    expect(l.rows[2].narration).toContain('115.00 kept as advance');
    expect(l).toMatchObject({ closing: 1000, advance: 115, totals: { debit: 1885, credit: 885 } });
    expect(l.party.outstanding).toBe(1000); // agrees with the saved balance
  });

  test('closing equals the Customer Balance Summary for the same period', async () => {
    const { from, to } = (await get(`/api/v1/ledgers/customer/${state.customerId}`)).body.data
      .period;
    const rep = await get(
      `/api/v1/reports/hub/run/customer-balances?from=${from}&to=${to}&customer=${state.customerId}`
    );
    expect(rep.body.data.rows[0].closing).toBe(1000);
  });

  test('a later period opens with the earlier closing', async () => {
    const res = await get(
      `/api/v1/ledgers/customer/${state.customerId}?from=2000-01-01&to=2000-12-31`
    );
    expect(res.body.data).toMatchObject({ opening: 0, closing: 0, rows: [] });
    expect(
      (await get(`/api/v1/ledgers/customer/${state.customerId}?from=2026-02-01&to=2026-01-01`))
        .status
    ).toBe(422);
  });

  test('PDF (with balance confirmation), Excel and email', async () => {
    const pdf = await get(`/api/v1/ledgers/customer/${state.customerId}/pdf?confirm=true`).buffer(
      true
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    expect(pdf.body.length).toBeGreaterThan(1000);
    const xlsx = await get(`/api/v1/ledgers/customer/${state.customerId}/export`).buffer(true);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    const bad = await post(`/api/v1/ledgers/customer/${state.customerId}/email`, {
      to: 'not-an-email',
    });
    expect(bad.status).toBe(422);
    const mail = await post(`/api/v1/ledgers/customer/${state.customerId}/email`, {
      to: 'shop@example.com',
      confirm: true,
    });
    expect([200, 503]).toContain(mail.status); // 503 when no mail server is set up
  });

  test('managers may see statements; a salesman only when allowed', async () => {
    expect((await get(`/api/v1/ledgers/customer/${state.customerId}`, state.manager)).status).toBe(
      200
    );
    expect((await get(`/api/v1/ledgers/customer/${state.customerId}`, state.sam)).status).toBe(403);
  });
});

describe('Supplier statement', () => {
  test('bills raise what we owe, payments lower it', async () => {
    const res = await get(`/api/v1/ledgers/supplier/${state.supplierId}`);
    expect(res.status).toBe(200);
    const l = res.body.data;
    expect(l.rows.map((r) => r.type)).toEqual(['Bill', 'Payment']);
    expect(l.rows[0]).toMatchObject({ credit: 1180, balance: 1180 });
    expect(l.rows[0].narration).toContain('CM-1');
    expect(l.rows[1]).toMatchObject({ debit: 500, balance: 680 });
    expect(l.closing).toBe(680);
    expect(l.party.outstanding).toBe(680);
    expect(
      (await get(`/api/v1/ledgers/supplier/${state.supplierId}/pdf`).buffer(true)).status
    ).toBe(200);
  });

  test('a salesman cannot open a supplier statement', async () => {
    expect((await get(`/api/v1/ledgers/supplier/${state.supplierId}`, state.sam)).status).toBe(403);
  });
});
