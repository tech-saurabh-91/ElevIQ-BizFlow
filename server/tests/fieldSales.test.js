import { boot, shutdown, clearDb } from './helpers.js';

let request;
const PASSWORD = 'Field#Pass1234';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const call = (token) => ({
  get: (url, query) => request.get(url).query(query || {}).set(as(token)),
  post: (url, body = {}) => request.post(url).set(as(token)).send(body),
  put: (url, body = {}) => request.put(url).set(as(token)).send(body),
});
const TZ = 'Asia/Kolkata';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const weekday = () => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date()).toUpperCase();
const stockOf = async (token, productId) => (await call(token).get(`/api/v1/products/${productId}`)).body.data.stock;

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
    code: 'FLDS01',
    slug: 'flds01',
    businessName: 'Field Sales Co',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    timezone: TZ,
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  await runWithContext({ scope: 'company', companyId: String(company._id) }, async () => {
    const settings = await Setting.forCompany(company._id);
    settings.set({ 'order.approvalThreshold': 0, 'invoice.rounding': 'NONE', 'fieldForce.requireGps': false });
    await settings.save();
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@fs.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    await User.create({ companyId: company._id, name: 'Mona Manager', email: 'mona@fs.test', password: PASSWORD, role: 'MANAGER' });
    state.samId = String((await User.create({ companyId: company._id, name: 'Sam', email: 'sam@fs.test', password: PASSWORD, role: 'SALESMAN' }))._id);
    state.raviId = String((await User.create({ companyId: company._id, name: 'Ravi', email: 'ravi@fs.test', password: PASSWORD, role: 'SALESMAN' }))._id);
  });
  const login = async (id) => (await request.post('/api/auth/login').send({ identifier: id, password: PASSWORD })).body.data.accessToken;
  state.admin = await login('admin@fs.test');
  state.mona = await login('mona@fs.test');
  state.sam = await login('sam@fs.test');
  state.ravi = await login('ravi@fs.test');
  const admin = call(state.admin);

  state.main = (await admin.post('/api/v1/warehouses', { name: 'Main', code: 'MAIN', type: 'MAIN' })).body.data.id;
  state.van = (await admin.post('/api/v1/warehouses', { name: 'Van', code: 'VAN1', type: 'VAN', parent: state.main, vehicleNumber: 'MH12AB0001' })).body.data.id;
  await admin.post(`/api/v1/warehouses/${state.van}/assignments`, { executive: state.samId, dayCloseMandatory: false });
  const mk = async (name) =>
    (await admin.post('/api/v1/products', { name, category: 'Snacks', unit: 'PCS', sellingPrice: 10, openingStock: 100, openingWarehouse: state.main })).body.data.id;
  state.chips = await mk('Chips');
  state.soda = await mk('Soda');
  state.route = (await admin.post('/api/v1/routes', { name: 'Camp Beat', code: 'CAMP', assignedTo: state.samId, beatDays: [weekday()] })).body.data.id;
  const customer = await admin.post('/api/v1/customers', {
    name: 'Camp Store',
    phone: '+91 90000 44444',
    address: { country: 'India', state: 'Maharashtra', city: 'Pune' },
    assignedTo: state.samId,
  });
  state.customer = customer.body.data.id;
  await admin.put(`/api/v1/routes/${state.route}/customers`, { customerIds: [state.customer] });
});

afterAll(async () => {
  await shutdown();
});

describe('Van stock request', () => {
  test('salesman requests, manager edits and approves, salesman receives', async () => {
    const req = await call(state.sam).post('/api/v1/stock-requests', { items: [{ product: state.chips, qty: 20 }], notes: 'Market day' });
    expect(req.status).toBe(201);
    expect(req.body.data.status).toBe('SUBMITTED');
    const id = req.body.data.id;

    // Salesmen cannot approve; a second open request is refused.
    expect((await call(state.sam).post(`/api/v1/stock-requests/${id}/approve`, { items: [{ product: state.chips, qty: 1 }] })).status).toBe(403);
    expect((await call(state.sam).post('/api/v1/stock-requests', { items: [{ product: state.soda, qty: 1 }] })).status).toBe(409);

    // Manager: chips 20 -> 15, adds soda 10.
    const approved = await call(state.mona).post(`/api/v1/stock-requests/${id}/approve`, {
      items: [{ product: state.chips, qty: 15 }, { product: state.soda, qty: 10 }],
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');
    const chips = approved.body.data.items.find((i) => i.product === state.chips);
    expect(chips).toMatchObject({ requestedQty: 20, approvedQty: 15 });
    expect(await stockOf(state.admin, state.chips)).toBe(85); // left the godown (in transit)

    // Short receipt needs a note; the shortfall goes back to the godown.
    const noNote = await call(state.sam).post(`/api/v1/stock-requests/${id}/receive`, { items: [{ product: state.soda, qty: 8 }] });
    expect(noNote.status).toBe(400);
    const got = await call(state.sam).post(`/api/v1/stock-requests/${id}/receive`, {
      items: [{ product: state.soda, qty: 8 }],
      notes: '2 bottles broken in loading',
    });
    expect(got.status).toBe(200);
    expect(got.body.data.status).toBe('RECEIVED');
    const vanStock = (await call(state.sam).get(`/api/v1/vans/${state.van}/stock`)).body.data;
    expect(vanStock.find((r) => r.product === state.chips).qty).toBe(15);
    expect(vanStock.find((r) => r.product === state.soda).qty).toBe(8);
    expect(await stockOf(state.admin, state.soda)).toBe(100); // 92 in godown + 8 on van
  });
});

describe('Van invoice', () => {
  test('a direct invoice by the van salesman takes stock off the van, cancel puts it back', async () => {
    // Salesmen need "Invoices - Create" for spot sales; here the manager bills for Sam.
    const inv = await call(state.mona).post('/api/v1/invoices', {
      customerId: state.customer,
      salesman: state.samId,
      items: [{ product: state.chips, qty: 5 }],
      issue: true,
    });
    expect(inv.status).toBe(201);
    const onVan = async () => (await call(state.sam).get(`/api/v1/vans/${state.van}/stock`)).body.data.find((r) => r.product === state.chips).qty;
    expect(await onVan()).toBe(10);

    const tooMuch = await call(state.mona).post('/api/v1/invoices', { customerId: state.customer, salesman: state.samId, items: [{ product: state.chips, qty: 50 }] });
    expect(tooMuch.status).toBe(422);

    expect((await call(state.admin).post(`/api/v1/invoices/${inv.body.data.id}/cancel`, { reason: 'Wrong customer' })).status).toBe(200);
    expect(await onVan()).toBe(15);
  });
});

describe('Beat plan and the salesman day', () => {
  test('the weekly plan puts the route in the salesman day; a day plan overrides it', async () => {
    const mine = await call(state.sam).get('/api/v1/beat-plans/mine');
    expect(mine.body.data.routes.map((r) => r.code)).toEqual(['CAMP']);
    expect(mine.body.data.routes[0].customers[0]).toMatchObject({ name: 'Camp Store', visit: null });

    const grid = await call(state.mona).get('/api/v1/beat-plans');
    expect(grid.body.data.cells.find((c) => c.day === today())).toMatchObject({ salesman: state.samId, source: 'WEEKLY' });

    // Ravi covers the beat today.
    await call(state.mona).put('/api/v1/beat-plans', { route: state.route, salesman: state.raviId, days: [today()] });
    expect((await call(state.sam).get('/api/v1/beat-plans/mine')).body.data.routes).toHaveLength(0);
    expect((await call(state.ravi).get('/api/v1/beat-plans/mine')).body.data.routes).toHaveLength(1);
    // Back to the weekly plan.
    await call(state.mona).put('/api/v1/beat-plans', { route: state.route, salesman: null, days: [today()] });
    expect((await call(state.sam).get('/api/v1/beat-plans/mine')).body.data.routes).toHaveLength(1);
  });

  test('check-out asks for a reason only when nothing was booked', async () => {
    const sam = call(state.sam);
    const first = await sam.post('/api/v1/beat-plans/check-in', { customerId: state.customer, route: state.route });
    expect(first.status).toBe(201);
    // One shop at a time.
    expect((await sam.post('/api/v1/beat-plans/check-in', { customerId: state.customer })).status).toBe(409);

    const noReason = await sam.post(`/api/v1/field-force/visits/${first.body.data.id}/check-out`, {});
    expect(noReason.status).toBe(422);
    expect(noReason.body.code).toBe('NO_ORDER_REASON_REQUIRED');
    const closed = await sam.post(`/api/v1/field-force/visits/${first.body.data.id}/check-out`, { noOrderReason: 'SHOP_CLOSED' });
    expect(closed.body.data.outcome).toBe('CUSTOMER_UNAVAILABLE');

    // Second visit: an order is booked, so check-out needs no reason.
    const second = await sam.post('/api/v1/beat-plans/check-in', { customerId: state.customer, route: state.route });
    const order = await sam.post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.chips, qty: 2 }] });
    expect(order.status).toBe(201);
    const done = await sam.post(`/api/v1/field-force/visits/${second.body.data.id}/check-out`, {});
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ outcome: 'ORDER_TAKEN', orderNo: order.body.data.orderNo });

    const day = await sam.get('/api/v1/beat-plans/mine');
    expect(day.body.data.routes[0].customers[0].visit.outcome).toBe('ORDER_TAKEN');
  });
});
