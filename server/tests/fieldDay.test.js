import { boot, shutdown, clearDb } from './helpers.js';

/**
 * The field salesman's working day:
 *   mark in -> work (by sales type) -> van day cashout approved -> mark out.
 * Presale salesmen book orders only; van salesmen invoice from the van.
 */

let request;
const PASSWORD = 'FieldDay#Pass1234';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const call = (token) => ({
  get: (url, query) => request.get(url).query(query || {}).set(as(token)),
  post: (url, body = {}) => request.post(url).set(as(token)).send(body),
});
const SHOP = { lat: 18.5204, lng: 73.8567 };
const NEAR = { lat: 18.52045, lng: 73.85672 }; // ~6 m away
const FAR = { lat: 18.5304, lng: 73.8567 }; // ~1.1 km away
const markIn = (token) => call(token).post('/api/v1/field-force/attendance/check-in', { location: SHOP });
const markOut = (token) => call(token).post('/api/v1/field-force/attendance/check-out', { location: SHOP });
const TZ = 'Asia/Kolkata';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

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
    code: 'FDAY01',
    slug: 'fday01',
    businessName: 'Field Day Co',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    timezone: TZ,
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  state.companyId = String(company._id);
  await runWithContext({ scope: 'company', companyId: state.companyId }, async () => {
    const settings = await Setting.forCompany(company._id);
    settings.set({ 'order.approvalThreshold': 0, 'invoice.rounding': 'NONE', 'fieldForce.geofenceRadiusM': 50 });
    await settings.save();
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@fd.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    await User.create({ companyId: company._id, name: 'Mona', email: 'mona@fd.test', password: PASSWORD, role: 'MANAGER' });
    state.piaId = String((await User.create({ companyId: company._id, name: 'Pia Presale', email: 'pia@fd.test', password: PASSWORD, role: 'SALESMAN', salesType: 'PRESALE' }))._id);
    state.vikId = String((await User.create({ companyId: company._id, name: 'Vik Van', email: 'vik@fd.test', password: PASSWORD, role: 'SALESMAN', salesType: 'VAN_SALE' }))._id);
    state.raviId = String((await User.create({ companyId: company._id, name: 'Ravi', email: 'ravi@fd.test', password: PASSWORD, role: 'SALESMAN', salesType: 'BOTH' }))._id);
  });
  const login = async (id) => (await request.post('/api/auth/login').send({ identifier: id, password: PASSWORD })).body.data.accessToken;
  for (const who of ['admin', 'mona', 'pia', 'vik', 'ravi']) state[who] = await login(`${who}@fd.test`);
  const admin = call(state.admin);

  state.main = (await admin.post('/api/v1/warehouses', { name: 'Main', code: 'MAIN', type: 'MAIN' })).body.data.id;
  state.van = (await admin.post('/api/v1/warehouses', { name: 'Van 1', code: 'VAN1', type: 'VAN', parent: state.main, vehicleNumber: 'MH12AB0001' })).body.data.id;
  await admin.post(`/api/v1/warehouses/${state.van}/assignments`, { executive: state.vikId });
  state.soap = (await admin.post('/api/v1/products', { name: 'Soap', category: 'Home', unit: 'PCS', sellingPrice: 20, openingStock: 100, openingWarehouse: state.main })).body.data.id;
  await admin.post(`/api/v1/vans/${state.van}/load`, { items: [{ product: state.soap, qty: 30 }] });
  state.customer = (
    await admin.post('/api/v1/customers', {
      name: 'Corner Shop',
      phone: '+91 90000 77777',
      address: { country: 'India', state: 'Maharashtra', city: 'Pune', gps: SHOP },
    })
  ).body.data.id;
});

afterAll(async () => {
  await shutdown();
});

describe('Sales type decides the channel', () => {
  test('presale: orders only, after marking in', async () => {
    const pia = call(state.pia);
    const early = await pia.post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.soap, qty: 2 }] });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('ATTENDANCE_REQUIRED');

    const today1 = (await pia.get('/api/v1/field-force/attendance/today')).body.data;
    expect(today1.fieldDay.blocked.code).toBe('ATTENDANCE_REQUIRED');

    expect((await markIn(state.pia)).status).toBe(200);
    expect((await pia.post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.soap, qty: 2 }] })).status).toBe(201);
    // Not a van seller: no invoices, no stock requests.
    expect((await pia.post('/api/v1/invoices', { customerId: state.customer, items: [{ product: state.soap, qty: 1 }] })).status).toBe(403);
    expect((await pia.post('/api/v1/stock-requests', { items: [{ product: state.soap, qty: 1 }] })).status).toBe(403);
  });

  test('van sale: invoices from the van, no orders', async () => {
    const vik = call(state.vik);
    expect((await markIn(state.vik)).status).toBe(200);
    expect((await vik.post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.soap, qty: 1 }] })).status).toBe(403);
    const inv = await vik.post('/api/v1/invoices', { customerId: state.customer, items: [{ product: state.soap, qty: 5 }], issue: true });
    expect(inv.status).toBe(201);
    const onVan = (await vik.get(`/api/v1/vans/${state.van}/stock`)).body.data.find((r) => r.product === state.soap).qty;
    expect(onVan).toBe(25);
  });
});

describe('Shop check-in geofence', () => {
  test('check-in is refused beyond 50 m of the pinned shop', async () => {
    const pia = call(state.pia);
    const far = await pia.post('/api/v1/beat-plans/check-in', { customerId: state.customer, location: FAR });
    expect(far.status).toBe(400);
    expect(far.body.code).toBe('OUTSIDE_GEOFENCE');
    const near = await pia.post('/api/v1/beat-plans/check-in', { customerId: state.customer, location: NEAR });
    expect(near.status).toBe(201);
    expect(near.body.data.checkInDistanceM).toBeLessThan(50);
    // An order was already booked here today -> no reason needed at check-out.
    await pia.post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.soap, qty: 1 }] });
    const out = await pia.post(`/api/v1/field-force/visits/${near.body.data.id}/check-out`, { location: NEAR });
    expect(out.status).toBe(200);
    expect(out.body.data.outcome).toBe('ORDER_TAKEN');
  });
});

describe('Van day cashout gates the mark out', () => {
  test('no cashout -> cannot mark out; pending approval -> cannot mark out; approved -> mark out ends the day', async () => {
    const vik = call(state.vik);
    const noCash = await markOut(state.vik);
    expect(noCash.status).toBe(409);
    expect(noCash.body.code).toBe('DAY_CASHOUT_REQUIRED');

    const preview = (await vik.get(`/api/v1/vans/${state.van}/day-close`)).body.data;
    const cash = await vik.post(`/api/v1/vans/${state.van}/day-close`, { date: today(), cashDeposited: preview.cashExpected });
    expect(cash.status).toBe(201);
    expect(cash.body.data.status).toBe('SUBMITTED');

    const waiting = await markOut(state.vik);
    expect(waiting.status).toBe(409);
    expect(waiting.body.code).toBe('DAY_CASHOUT_PENDING');

    // The manager is told, and approves.
    const inbox = (await call(state.mona).get('/api/v1/notifications')).body.data;
    expect(inbox.some((n) => n.link === '/app/day-cashouts')).toBe(true);
    expect((await call(state.mona).post(`/api/v1/vans/day-closes/${cash.body.data.id}/approve`)).status).toBe(200);

    expect((await markOut(state.vik)).status).toBe(200);
    const after = await vik.post('/api/v1/invoices', { customerId: state.customer, items: [{ product: state.soap, qty: 1 }] });
    expect(after.status).toBe(409);
    expect(after.body.code).toBe('DAY_ENDED');
  });
});

describe('A day left open blocks the next one', () => {
  test('yesterday not marked out -> mark it out first, then mark in', async () => {
    const Attendance = (await import('../src/models/Attendance.js')).default;
    const { runWithContext } = await import('../src/middlewares/tenantContext.js');
    const { startOfDay } = await import('../src/services/fieldForceService.js');
    const yesterday = startOfDay(new Date(Date.now() - 86400000));
    await runWithContext({ scope: 'company', companyId: state.companyId }, () =>
      Attendance.create({
        user: state.raviId,
        userName: 'Ravi',
        day: yesterday,
        checkIn: { at: new Date(yesterday.getTime() + 9 * 3600000) },
        isCheckedIn: true,
      })
    );

    const blocked = await markIn(state.ravi);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('ATTENDANCE_OUT_PENDING');
    const order = await call(state.ravi).post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.soap, qty: 1 }] });
    expect(order.body.code).toBe('ATTENDANCE_OUT_PENDING');

    // Mark out closes yesterday's open day; then today can start.
    const out = await markOut(state.ravi);
    expect(out.status).toBe(200);
    expect(new Date(out.body.data.day).getTime()).toBe(yesterday.getTime());
    expect((await markIn(state.ravi)).status).toBe(200);
  });
});
