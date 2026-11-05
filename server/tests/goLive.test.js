import { boot, shutdown, clearDb } from './helpers.js';

/**
 * End-to-end business day, the way a distributor runs it after go-live:
 * buy stock (PO -> GRN), sell it (order -> approval -> invoice -> dispatch ->
 * delivery), collect (payment, cheque bounce), take returns (credit note).
 * Every step checks stock and the customer's outstanding.
 */

let request;
const PASSWORD = 'GoLive#Pass1234';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const call = (token) => ({
  get: (url, query) => request.get(url).query(query || {}).set(as(token)),
  post: (url, body = {}) => request.post(url).set(as(token)).send(body),
  put: (url, body = {}) => request.put(url).set(as(token)).send(body),
});
const admin = () => call(state.admin);
const stockOf = async (productId) => (await admin().get(`/api/v1/products/${productId}`)).body.data.stock;
const outstandingOf = async () => (await admin().get(`/api/v1/customers/${state.customer}`)).body.data.outstanding;

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
    code: 'GOLV01',
    slug: 'golv01',
    businessName: 'Go Live Distributors',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    timezone: 'Asia/Kolkata',
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  await runWithContext({ scope: 'company', companyId: String(company._id) }, async () => {
    const settings = await Setting.forCompany(company._id);
    settings.set({ 'order.approvalThreshold': 1000, 'invoice.rounding': 'NONE', 'order.allowNegativeStock': false });
    await settings.save();
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@gl.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    await User.create({ companyId: company._id, name: 'Sam', email: 'sam@gl.test', password: PASSWORD, role: 'SALESMAN' });
  });
  const login = async (id) => (await request.post('/api/auth/login').send({ identifier: id, password: PASSWORD })).body.data.accessToken;
  state.admin = await login('admin@gl.test');
  state.sam = await login('sam@gl.test');
  // The salesman starts the day before booking anything.
  await request.post('/api/v1/field-force/attendance/check-in').set(as(state.sam)).send({ location: { lat: 18.52, lng: 73.85 } });

  state.main = (await admin().post('/api/v1/warehouses', { name: 'Main Godown', code: 'MAIN', type: 'MAIN' })).body.data.id;
  state.oil = (await admin().post('/api/v1/products', { name: 'Sunflower Oil 1L', category: 'Grocery', unit: 'PCS', sellingPrice: 100, gstRate: 5 })).body.data.id;
  state.customer = (
    await admin().post('/api/v1/customers', {
      name: 'Shree Kirana',
      phone: '+91 90000 55555',
      address: { country: 'India', state: 'Maharashtra', city: 'Pune' },
      creditLimit: 100000,
    })
  ).body.data.id;
  state.supplier = (await admin().post('/api/v1/suppliers', { name: 'Oil Mills', phone: '+91 90000 66666' })).body.data.id;
});

afterAll(async () => {
  await shutdown();
});

describe('Go-live business day', () => {
  test('1. purchase: PO then GRN brings stock into the main godown', async () => {
    const po = await admin().post('/api/v1/purchase-orders', {
      supplierId: state.supplier,
      warehouse: state.main,
      items: [{ product: state.oil, qty: 100, unitPrice: 80 }],
      send: true,
    });
    expect(po.status).toBe(201);
    const grn = await admin().post('/api/v1/goods-receipts', {
      purchaseOrder: po.body.data.id,
      warehouse: state.main,
      items: [{ product: state.oil, receivedQty: 100, unitCost: 80 }],
      post: true,
    });
    expect(grn.status).toBe(201);
    expect(await stockOf(state.oil)).toBe(100);
    expect((await admin().get(`/api/v1/purchase-orders/${po.body.data.id}`)).body.data.status).toBe('RECEIVED');
  });

  test('2. order above the approval limit waits for approval, then reserves stock', async () => {
    // The salesman books at the shop: check in first.
    const visit = await call(state.sam).post('/api/v1/beat-plans/check-in', { customerId: state.customer, location: { lat: 18.52, lng: 73.85 } });
    expect(visit.status).toBe(201);
    const order = await call(state.sam).post('/api/v1/orders', {
      customerId: state.customer,
      items: [{ product: state.oil, qty: 30 }],
      submit: true,
    });
    expect(order.status).toBe(201);
    expect(order.body.data.status).toBe('PENDING_APPROVAL');
    state.order = order.body.data.id;

    // The approver is told...
    const inbox = (await admin().get('/api/v1/notifications')).body.data;
    expect(inbox.some((n) => n.type === 'APPROVAL_REQUIRED' && n.link === `/app/orders/${state.order}`)).toBe(true);

    const approved = await admin().post(`/api/v1/orders/${state.order}/approve`, { note: 'OK' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('CONFIRMED');
    // ...and so is the salesman, once approved.
    const samInbox = (await call(state.sam).get('/api/v1/notifications')).body.data;
    expect(samInbox.some((n) => n.type === 'ORDER_APPROVED')).toBe(true);
    // Reserved, not yet out of stock.
    expect(await stockOf(state.oil)).toBe(100);
  });

  test('3. invoice from the order raises outstanding; dispatch moves the stock once', async () => {
    const inv = await admin().post('/api/v1/invoices', { orderId: state.order, issue: true });
    expect(inv.status).toBe(201);
    state.invoice = inv.body.data;
    expect(state.invoice.total).toBeCloseTo(3150, 2); // 30 x 100 + 5% GST
    expect(await outstandingOf()).toBeCloseTo(3150, 2);
    // Invoicing an order does not move stock - dispatch does.
    expect(await stockOf(state.oil)).toBe(100);

    // Dispatch moves godown stock: not the salesman's call.
    expect((await call(state.sam).post(`/api/v1/orders/${state.order}/dispatch`, {})).status).toBe(403);
    const dispatched = await admin().post(`/api/v1/orders/${state.order}/dispatch`, { note: 'Truck 1' });
    expect(dispatched.status).toBe(200);
    expect(await stockOf(state.oil)).toBe(70);
    const delivered = await admin().post(`/api/v1/orders/${state.order}/deliver`, {});
    expect(delivered.status).toBe(200);
    expect(await stockOf(state.oil)).toBe(70);
  });

  test('4. a partial cash payment settles part of the invoice', async () => {
    const pay = await admin().post('/api/v1/payments', {
      customerId: state.customer,
      amount: 1000,
      mode: 'CASH',
      allocations: [{ invoice: state.invoice.id, amount: 1000 }],
      receive: true,
    });
    expect(pay.status).toBe(201);
    expect(await outstandingOf()).toBeCloseTo(2150, 2);
    const inv = (await admin().get(`/api/v1/invoices/${state.invoice.id}`)).body.data;
    expect(inv.status).toBe('PARTIALLY_PAID');
    expect(inv.balanceDue).toBeCloseTo(2150, 2);
  });

  test('5. a sales return credit note restocks and reduces the balance', async () => {
    const line = state.invoice.items[0];
    const cn = await admin().post('/api/v1/credit-notes', {
      invoiceId: state.invoice.id,
      reason: 'SALES_RETURN',
      items: [{ invoiceItemId: line.id, qty: 2 }],
      issue: true,
    });
    expect(cn.status).toBe(201);
    expect(await stockOf(state.oil)).toBe(72);
    expect(await outstandingOf()).toBeCloseTo(1940, 2); // 2150 - 2 x 105
  });

  test('6. a bounced cheque puts the amount back on the customer', async () => {
    const cheque = await admin().post('/api/v1/payments', {
      customerId: state.customer,
      amount: 1940,
      mode: 'CHEQUE',
      reference: '000123',
      bankName: 'SBI',
      allocations: [{ invoice: state.invoice.id, amount: 1940 }],
      receive: true,
    });
    expect(cheque.status).toBe(201);
    expect(await outstandingOf()).toBeCloseTo(0, 2);
    expect((await admin().get(`/api/v1/invoices/${state.invoice.id}`)).body.data.status).toBe('PAID');

    const bounced = await admin().post(`/api/v1/payments/${cheque.body.data.id}/bounce`, { reason: 'Insufficient funds' });
    expect(bounced.status).toBe(200);
    expect(await outstandingOf()).toBeCloseTo(1940, 2);
    expect((await admin().get(`/api/v1/invoices/${state.invoice.id}`)).body.data.balanceDue).toBeCloseTo(1940, 2);
  });

  test('7. a counter sale (direct invoice) takes stock from the main godown', async () => {
    const inv = await admin().post('/api/v1/invoices', { customerId: state.customer, items: [{ product: state.oil, qty: 5 }], issue: true });
    expect(inv.status).toBe(201);
    expect(await stockOf(state.oil)).toBe(67);
    const tooMuch = await admin().post('/api/v1/invoices', { customerId: state.customer, items: [{ product: state.oil, qty: 500 }] });
    expect(tooMuch.status).toBe(422);
  });

  test('8. a cancelled order releases its reservation', async () => {
    const order = await admin().post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.oil, qty: 5 }], submit: true });
    expect(order.body.data.status).toBe('CONFIRMED'); // admin's own order under the limit
    const cancelled = await admin().post(`/api/v1/orders/${order.body.data.id}/cancel`, { reason: 'Customer changed mind' });
    expect(cancelled.status).toBe(200);
    const row = (await admin().get('/api/v1/inventory/stock', { warehouse: state.main })).body.data.find((r) => String(r.product?.id || r.product) === state.oil);
    expect(row.reservedQty || 0).toBe(0);
  });

  test('9. a salesman dashboard shows only their own orders', async () => {
    const mine = (await call(state.sam).get('/api/v1/dashboard/summary')).body.data;
    expect(mine.scope).toBe('MINE');
    expect(mine.recentOrders.map((o) => o.id)).toEqual([state.order]);
    expect(mine.salesToday).toBeGreaterThan(0);
    const all = (await admin().get('/api/v1/dashboard/summary')).body.data;
    expect(all.scope).toBe('COMPANY');
    expect(all.recentOrders.length).toBeGreaterThan(1);
  });
});
