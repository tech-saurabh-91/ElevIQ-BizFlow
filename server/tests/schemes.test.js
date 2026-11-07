import { boot, shutdown, clearDb } from './helpers.js';

/**
 * Discount master + trade schemes, applied by the server on orders and
 * direct invoices: trade discount rules (most specific wins), quantity /
 * value slab schemes on top, free goods as zero-priced lines, and the
 * pricing.override control on hand-typed prices.
 */

let request;
const PASSWORD = 'Schemes#Pass1234';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const call = (token) => ({
  get: (url, query) => request.get(url).query(query || {}).set(as(token)),
  post: (url, body = {}) => request.post(url).set(as(token)).send(body),
  patch: (url, body = {}) => request.patch(url).set(as(token)).send(body),
});
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const lineOf = (doc, productId, free = false) => doc.items.find((l) => String(l.product?.id || l.product?._id || l.product) === productId && Boolean(l.isFree) === free);

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  const Company = (await import('../src/models/Company.js')).default;
  const Setting = (await import('../src/models/Setting.js')).default;
  const User = (await import('../src/models/User.js')).default;
  const { runWithContext } = await import('../src/middlewares/tenantContext.js');
  await clearDb();
  await (await import('../src/services/locationService.js')).seedLocations();

  const company = await Company.create({
    code: 'SCHM01',
    slug: 'schm01',
    businessName: 'Scheme Co',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  state.companyId = String(company._id);
  await runWithContext({ scope: 'company', companyId: state.companyId }, async () => {
    const settings = await Setting.forCompany(company._id);
    settings.set({ 'order.approvalThreshold': 0, 'invoice.rounding': 'NONE', 'fieldForce.requireAttendance': false, 'tax.regime': 'NONE' });
    await settings.save();
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@sc.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    await User.create({ companyId: company._id, name: 'Sid', email: 'sid@sc.test', password: PASSWORD, role: 'SALESMAN', salesType: 'BOTH' });
  });
  const login = async (id) => (await request.post('/api/auth/login').send({ identifier: id, password: PASSWORD })).body.data.accessToken;
  state.admin = await login('admin@sc.test');
  state.sid = await login('sid@sc.test');
  const admin = call(state.admin);

  state.main = (await admin.post('/api/v1/warehouses', { name: 'Main', code: 'MAIN', type: 'MAIN', isDefault: true })).body.data.id;
  const product = async (name, category, brand, price) =>
    (await admin.post('/api/v1/products', { name, category, brand, unit: 'PCS', sellingPrice: price, openingStock: 500, openingWarehouse: state.main })).body.data.id;
  state.soap = await product('Soap', 'Home', 'Clean', 10);
  state.shampoo = await product('Shampoo', 'Home', 'Clean', 50);
  state.oil = await product('Oil', 'Food', 'Gold', 100);
  state.atta = await product('Atta', 'Food', 'Gold', 40);

  const customer = async (name, type) =>
    (await admin.post('/api/v1/customers', { name, type, phone: `+91 90000 ${String(Math.random()).slice(2, 7)}`, address: { country: 'India', state: 'Maharashtra', city: 'Pune' } })).body.data.id;
  state.retail = await customer('Retail Shop', 'RETAIL');
  state.dist = await customer('Big Distributor', 'DISTRIBUTOR');
});

afterAll(async () => {
  await shutdown();
});

describe('Masters and their permissions', () => {
  test('salesman may read schemes but not create them; discounts stay with managers', async () => {
    const sid = call(state.sid);
    expect((await sid.get('/api/v1/schemes')).status).toBe(200);
    expect((await sid.post('/api/v1/schemes', { name: 'X', type: 'FREE_GOODS', buyQty: 1, freeQty: 1, products: [state.soap], validFrom: today() })).status).toBe(403);
    expect((await sid.get('/api/v1/discounts')).status).toBe(403);
  });

  test('a scheme or rule must say who and what it covers', async () => {
    const admin = call(state.admin);
    const noProducts = await admin.post('/api/v1/schemes', { name: 'Empty', type: 'FREE_GOODS', buyQty: 10, freeQty: 1, productScope: 'PRODUCT', validFrom: today() });
    expect(noProducts.status).toBe(422);
    const noFree = await admin.post('/api/v1/schemes', { name: 'No free', type: 'FREE_GOODS', productScope: 'ALL', validFrom: today() });
    expect(noFree.status).toBe(422);
    const noSlabs = await admin.post('/api/v1/schemes', { name: 'No slabs', type: 'QTY_DISCOUNT', productScope: 'ALL', validFrom: today() });
    expect(noSlabs.status).toBe(422);
    const noCustomers = await admin.post('/api/v1/discounts', { name: 'For whom', discountPercent: 5, customerScope: 'CUSTOMER' });
    expect(noCustomers.status).toBe(422);
  });
});

describe('Discount rules', () => {
  test('the most specific rule wins: customer + product beats customer type + category', async () => {
    const admin = call(state.admin);
    expect((await admin.post('/api/v1/discounts', { name: 'Distributors on Home', discountPercent: 5, customerScope: 'CUSTOMER_TYPE', customerTypes: ['DISTRIBUTOR'], productScope: 'CATEGORY', categories: ['Home'] })).status).toBe(201);
    expect((await admin.post('/api/v1/discounts', { name: 'Big Distributor soap', discountPercent: 8, customerScope: 'CUSTOMER', customers: [state.dist], productScope: 'PRODUCT', products: [state.soap] })).status).toBe(201);

    const order = await admin.post('/api/v1/orders', { customerId: state.dist, items: [{ product: state.soap, qty: 1 }, { product: state.shampoo, qty: 1 }, { product: state.oil, qty: 1 }] });
    expect(order.status).toBe(201);
    expect(lineOf(order.body.data, state.soap).discountPercent).toBe(8);
    expect(lineOf(order.body.data, state.soap).discountRuleName).toBe('Big Distributor soap');
    expect(lineOf(order.body.data, state.shampoo).discountPercent).toBe(5);
    expect(lineOf(order.body.data, state.oil).discountPercent).toBe(0);

    // A retail shop gets none of it.
    const retail = await admin.post('/api/v1/orders', { customerId: state.retail, items: [{ product: state.soap, qty: 1 }] });
    expect(lineOf(retail.body.data, state.soap).discountPercent).toBe(0);
  });
});

describe('Schemes', () => {
  test('buy 10 get 1 free (repeating) adds a free line that is rebuilt on edit', async () => {
    const admin = call(state.admin);
    const scheme = await admin.post('/api/v1/schemes', { name: 'Soap 10+1', type: 'FREE_GOODS', buyQty: 10, freeQty: 1, repeat: true, productScope: 'PRODUCT', products: [state.soap], validFrom: today() });
    expect(scheme.status).toBe(201);
    expect(scheme.body.data.summary).toMatch(/Buy 10 get 1/);

    const order = await admin.post('/api/v1/orders', { customerId: state.retail, items: [{ product: state.soap, qty: 25 }] });
    const free = lineOf(order.body.data, state.soap, true);
    expect(free.qty).toBe(2);
    expect(free.lineTotal).toBe(0);
    expect(free.schemeName).toBe('Soap 10+1');
    expect(order.body.data.total).toBe(250);

    // Lower the quantity: the free goods follow.
    const edited = await admin.patch(`/api/v1/orders/${order.body.data.id}`, { items: [{ product: state.soap, qty: 9 }] });
    expect(edited.status).toBe(200);
    expect(lineOf(edited.body.data, state.soap, true)).toBeUndefined();
    // Saving without items keeps the lines and rebuilds the free goods.
    await admin.patch(`/api/v1/orders/${order.body.data.id}`, { items: [{ product: state.soap, qty: 30 }] });
    const again = await admin.patch(`/api/v1/orders/${order.body.data.id}`, { notes: 'call before delivery' });
    expect(again.body.data.items.filter((l) => l.isFree)).toHaveLength(1);
    expect(lineOf(again.body.data, state.soap, true).qty).toBe(3);
  });

  test('buy 5 Atta get 1 Oil free; the free item is billed and moves stock from an order invoice', async () => {
    const admin = call(state.admin);
    await admin.post('/api/v1/schemes', { name: 'Atta gets Oil', type: 'FREE_GOODS', buyQty: 5, freeQty: 1, repeat: false, freeProduct: state.oil, productScope: 'PRODUCT', products: [state.atta], validFrom: today() });
    const order = await admin.post('/api/v1/orders', { customerId: state.retail, items: [{ product: state.atta, qty: 12 }], submit: true });
    expect(order.status).toBe(201);
    const freeOil = lineOf(order.body.data, state.oil, true);
    expect(freeOil.qty).toBe(1); // no repeat

    const inv = await admin.post('/api/v1/invoices', { orderId: order.body.data.id, issue: true });
    expect(inv.status).toBe(201);
    const billedOil = lineOf(inv.body.data, state.oil, true);
    expect(billedOil.qty).toBe(1);
    expect(billedOil.lineTotal).toBe(0);
    expect(billedOil.schemeName).toBe('Atta gets Oil');
  });

  test('quantity slabs add a scheme discount on top of the trade discount', async () => {
    const admin = call(state.admin);
    await admin.post('/api/v1/schemes', { name: 'Shampoo slabs', type: 'QTY_DISCOUNT', productScope: 'PRODUCT', products: [state.shampoo], slabs: [{ from: 10, discountPercent: 2 }, { from: 20, discountPercent: 4 }], validFrom: today() });
    const order = await admin.post('/api/v1/orders', { customerId: state.dist, items: [{ product: state.shampoo, qty: 20 }] });
    const line = lineOf(order.body.data, state.shampoo);
    expect(line.tradeDiscountPercent).toBe(5); // distributors on Home
    expect(line.schemeDiscountPercent).toBe(4);
    expect(line.discountPercent).toBe(9);
    const small = await admin.post('/api/v1/orders', { customerId: state.dist, items: [{ product: state.shampoo, qty: 5 }] });
    expect(lineOf(small.body.data, state.shampoo).schemeDiscountPercent).toBe(0);
  });

  test('value slabs count the covered lines together; an expired scheme does nothing', async () => {
    const admin = call(state.admin);
    await admin.post('/api/v1/schemes', { name: 'Food 1000+', type: 'VALUE_DISCOUNT', productScope: 'CATEGORY', categories: ['Food'], slabs: [{ from: 1000, discountPercent: 3 }], validFrom: today() });
    await admin.post('/api/v1/schemes', { name: 'Old oil deal', type: 'QTY_DISCOUNT', productScope: 'PRODUCT', products: [state.oil], slabs: [{ from: 1, discountPercent: 50 }], validFrom: daysAgo(30), validTo: daysAgo(1) });
    // Oil 6 x 100 + Atta 4 x 40 = 760: below the slab.
    const below = await admin.post('/api/v1/orders', { customerId: state.retail, items: [{ product: state.oil, qty: 6 }, { product: state.atta, qty: 4 }] });
    expect(lineOf(below.body.data, state.oil).schemeDiscountPercent).toBe(0);
    // Oil 8 x 100 + Atta 5 x 40 = 1000: both lines get 3%.
    const above = await admin.post('/api/v1/orders', { customerId: state.retail, items: [{ product: state.oil, qty: 8 }, { product: state.atta, qty: 5 }] });
    expect(lineOf(above.body.data, state.oil).schemeDiscountPercent).toBe(3);
    expect(lineOf(above.body.data, state.atta).schemeDiscountPercent).toBe(3);
    expect(lineOf(above.body.data, state.oil).schemeName).toBe('Food 1000+');
  });

  test('a direct invoice gets the same schemes, and the preview shows them before saving', async () => {
    const admin = call(state.admin);
    const preview = await admin.post('/api/v1/pricing/preview', { customerId: state.retail, items: [{ product: state.soap, qty: 10 }] });
    expect(preview.status).toBe(200);
    expect(preview.body.data.lines.filter((l) => l.isFree)).toHaveLength(1);
    expect(preview.body.data.applied.some((a) => a.name === 'Soap 10+1')).toBe(true);
    expect(preview.body.data.offers.length).toBeGreaterThan(0);

    const inv = await admin.post('/api/v1/invoices', { customerId: state.retail, items: [{ product: state.soap, qty: 10 }] });
    expect(inv.status).toBe(201);
    expect(lineOf(inv.body.data, state.soap, true).qty).toBe(1);
  });
});

describe('Hand-typed prices need pricing.override', () => {
  test('a salesman cannot type a price or discount; an admin can', async () => {
    const sid = call(state.sid);
    const own = await sid.post('/api/v1/orders', { customerId: state.retail, items: [{ product: state.oil, qty: 1, unitPrice: 1, discountPercent: 90 }] });
    expect(own.status).toBe(201);
    const line = lineOf(own.body.data, state.oil);
    expect(line.unitPrice).toBe(100);
    expect(line.discountPercent).toBe(0);
    expect(line.manualPrice).toBe(false);

    const admin = call(state.admin);
    const typed = await admin.post('/api/v1/orders', { customerId: state.retail, items: [{ product: state.oil, qty: 1, unitPrice: 90, discountPercent: 10 }] });
    const adminLine = lineOf(typed.body.data, state.oil);
    expect(adminLine.unitPrice).toBe(90);
    expect(adminLine.discountPercent).toBe(10);
    expect(adminLine.manualDiscount).toBe(true);
  });
});
