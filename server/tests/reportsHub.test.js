import { boot, shutdown, clearDb } from './helpers.js';

/** Reports hub: catalog by role, report figures, export, scoping. */

let request;
const PASSWORD = 'Reports#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const get = (url, token = state.admin) => request.get(url).set(as(token));
const post = (url, body, token = state.admin) => request.post(url).set(as(token)).send(body);
let runWithContext;
const inTenant = (fn) => runWithContext({ scope: 'company', companyId: state.companyId }, fn);
const today = new Date().toISOString().slice(0, 10);

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
    code: 'REPH01',
    slug: 'reph01',
    businessName: 'Reports Co',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  state.companyId = String(company._id);
  await inTenant(async () => {
    const settings = await Setting.forCompany(company._id);
    const wh = await Warehouse.create({ name: 'Main', code: 'MAIN', isDefault: true });
    settings.set({ 'inventory.defaultWarehouse': wh._id, 'invoice.rounding': 'NONE', 'order.approvalThreshold': 0 });
    await settings.save();
    state.warehouseId = String(wh._id);
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@reph.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    await User.create({ companyId: company._id, name: 'Wally', email: 'wh@reph.test', password: PASSWORD, role: 'WAREHOUSE' });
    await User.create({ companyId: company._id, name: 'Sam', email: 'sam@reph.test', password: PASSWORD, role: 'SALESMAN' });
  });
  const login = async (email) => (await request.post('/api/auth/login').send({ identifier: email, password: PASSWORD })).body.data.accessToken;
  state.admin = await login('admin@reph.test');
  state.wh = await login('wh@reph.test');
  state.sam = await login('sam@reph.test');

  const food = await post('/api/v1/product-categories', { level: 'CLASSIFICATION', name: 'Food' });
  const snacks = await post('/api/v1/product-categories', { level: 'CATEGORY', name: 'Snacks', parent: food.body.data.id });
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
  const supplier = await post('/api/v1/suppliers', { name: 'Cookie Mills', phone: '+91 90000 66666', address: { country: 'India', state: 'Maharashtra', city: 'Pune' } });
  state.supplierId = supplier.body.data.id;
  const customer = await post('/api/v1/customers', { name: 'Corner Shop', phone: '+91 90000 77777', address: { country: 'India', state: 'Maharashtra', city: 'Pune' } });
  state.customerId = customer.body.data.id;

  // Buy 10 @ 100, bill it; sell 5 @ 150.
  const grn = await post('/api/v1/goods-receipts', {
    supplierId: state.supplierId,
    warehouse: state.warehouseId,
    post: true,
    items: [{ product: state.productId, receivedQty: 10, unitCost: 100 }],
  });
  expect(grn.status).toBe(201);
  const bill = await post('/api/v1/purchase-bills', { supplierId: state.supplierId, supplierInvoiceNo: 'CM-1', supplierInvoiceDate: today, grnIds: [grn.body.data.id] });
  expect(bill.status).toBe(201);
  const inv = await post('/api/v1/invoices', { customerId: state.customerId, items: [{ product: state.productId, qty: 5 }], issue: true });
  expect(inv.status).toBe(201);
});

afterAll(async () => {
  await shutdown();
});

describe('Catalog', () => {
  test('admin sees all three groups', async () => {
    const res = await get('/api/v1/reports/hub/catalog');
    expect(res.status).toBe(200);
    const codes = res.body.data.reports.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['sales-register', 'purchase-register', 'gross-profit', 'gst-summary', 'customer-list']));
    expect(res.body.data.groups.map((g) => g.key)).toEqual(['REGISTER', 'MIS', 'LISTING']);
  });

  test('warehouse gets stock registers and listings, not sales money or MIS', async () => {
    const res = await get('/api/v1/reports/hub/catalog', state.wh);
    const codes = res.body.data.reports.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['grn-register', 'stock-register', 'low-stock-list']));
    expect(codes).not.toContain('gross-profit');
    expect(codes).not.toContain('purchase-register'); // no bills.view
    expect((await get('/api/v1/reports/hub/run/gross-profit', state.wh)).status).toBe(403);
  });

  test('a salesman has no report groups by default', async () => {
    expect((await get('/api/v1/reports/hub/catalog', state.sam)).status).toBe(403);
  });
});

describe('Figures', () => {
  test('sales register lists the invoice with GST split', async () => {
    const res = await get('/api/v1/reports/hub/run/sales-register');
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.rows[0]).toMatchObject({ taxable: 750, cgst: 67.5, sgst: 67.5, igst: 0, total: 885 });
    expect(res.body.data.totals.total).toBe(885);
  });

  test('gross profit = sales - cost of goods at average cost', async () => {
    const res = await get('/api/v1/reports/hub/run/gross-profit?groupBy=product');
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0]).toMatchObject({ name: 'Cookies 100g', qty: 5, sales: 750, cost: 500, grossProfit: 250, marginPercent: 33.33 });
  });

  test('GST summary nets output against input tax', async () => {
    const res = await get('/api/v1/reports/hub/run/gst-summary');
    expect(res.body.data.rows[0]).toMatchObject({ outTax: 135, inTaxable: 1000, inTax: 180, net: -45 });
  });

  test('purchase register and stock valuation agree with the purchase', async () => {
    const pr = await get('/api/v1/reports/hub/run/purchase-register');
    expect(pr.body.data.rows[0]).toMatchObject({ supplierInvoiceNo: 'CM-1', taxable: 1000, total: 1180 });
    const sv = await get('/api/v1/reports/hub/run/stock-valuation');
    expect(sv.body.data.rows[0]).toMatchObject({ qty: 5, avgCost: 100, value: 500 });
  });

  test('ageing lists what is owed both ways', async () => {
    const ar = await get('/api/v1/reports/hub/run/receivable-ageing');
    expect(ar.body.data.totals.total).toBe(885);
    const ap = await get('/api/v1/reports/hub/run/payable-ageing');
    expect(ap.body.data.totals.total).toBe(1180);
  });

  test('exports an Excel file', async () => {
    const res = await get('/api/v1/reports/hub/run/sales-register/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  });
});

describe('Business mode', () => {
  test('sales-only companies do not see purchase or stock reports', async () => {
    const Setting = (await import('../src/models/Setting.js')).default;
    await inTenant(async () => {
      const s = await Setting.forCompany(state.companyId);
      s.set({ 'inventory.mode': 'SALES_ONLY' });
      await s.save();
    });
    const codes = (await get('/api/v1/reports/hub/catalog')).body.data.reports.map((r) => r.code);
    expect(codes).not.toContain('purchase-register');
    expect(codes).not.toContain('stock-valuation');
    expect(codes).toContain('sales-register');
    expect((await get('/api/v1/reports/hub/run/purchase-register')).status).toBe(403);
  });
});
