import { jest } from '@jest/globals';
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
    // Orders are booked inside a shop visit only.
    const noVisit = await pia.post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.soap, qty: 2 }] });
    expect(noVisit.status).toBe(409);
    expect(noVisit.body.code).toBe('VISIT_REQUIRED');
    const visit = await pia.post('/api/v1/beat-plans/check-in', { customerId: state.customer, location: NEAR });
    expect(visit.status).toBe(201);
    const other = await pia.post('/api/v1/orders', { customerId: '0123456789abcdef01234567', items: [{ product: state.soap, qty: 2 }] });
    expect(other.body.code).toBe('VISIT_CUSTOMER_MISMATCH');
    expect((await pia.post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.soap, qty: 2 }] })).status).toBe(201);
    // Not a van seller: no invoices, no stock requests.
    expect((await pia.post('/api/v1/invoices', { customerId: state.customer, items: [{ product: state.soap, qty: 1 }] })).status).toBe(403);
    expect((await pia.post('/api/v1/stock-requests', { items: [{ product: state.soap, qty: 1 }] })).status).toBe(403);
    // A shop still checked in blocks the mark out.
    const stillIn = await markOut(state.pia);
    expect(stillIn.status).toBe(409);
    expect(stillIn.body.code).toBe('VISIT_IN_PROGRESS');
    expect((await pia.post(`/api/v1/field-force/visits/${visit.body.data.id}/check-out`, { location: NEAR })).status).toBe(200);
  });

  test('van sale: invoices from the van, no orders', async () => {
    const vik = call(state.vik);
    expect((await markIn(state.vik)).status).toBe(200);
    expect((await vik.post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.soap, qty: 1 }] })).status).toBe(403);
    const visit = await vik.post('/api/v1/beat-plans/check-in', { customerId: state.customer, location: NEAR });
    expect(visit.status).toBe(201);
    const inv = await vik.post('/api/v1/invoices', { customerId: state.customer, items: [{ product: state.soap, qty: 5 }], issue: true });
    expect(inv.status).toBe(201);
    const out = await vik.post(`/api/v1/field-force/visits/${visit.body.data.id}/check-out`, { location: NEAR });
    expect(out.status).toBe(200);
    expect(out.body.data.outcome).toBe('INVOICED');
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

    // ...and a shop left checked in yesterday.
    const Visit = (await import('../src/models/Visit.js')).default;
    const stale = await runWithContext({ scope: 'company', companyId: state.companyId }, () =>
      Visit.create({
        visitNo: 'VIS-OLD-1',
        customerId: state.customer,
        customerName: 'Corner Shop',
        salesman: state.raviId,
        visitDay: yesterday,
        status: 'IN_PROGRESS',
        checkIn: { at: new Date(yesterday.getTime() + 10 * 3600000) },
      })
    );

    const blocked = await markIn(state.ravi);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('ATTENDANCE_OUT_PENDING');
    const order = await call(state.ravi).post('/api/v1/orders', { customerId: state.customer, items: [{ product: state.soap, qty: 1 }] });
    expect(order.body.code).toBe('ATTENDANCE_OUT_PENDING');

    // Sales visit shows yesterday's open shop, and it must be checked out first.
    const mine = (await call(state.ravi).get('/api/v1/beat-plans/mine')).body.data;
    expect(mine.openVisit.id).toBe(String(stale._id));
    expect(mine.openVisit.earlierDay).toBe(true);
    expect((await markOut(state.ravi)).body.code).toBe('VISIT_IN_PROGRESS');
    const closed = await call(state.ravi).post(`/api/v1/field-force/visits/${stale._id}/check-out`, { noOrderReason: 'SHOP_CLOSED' });
    expect(closed.status).toBe(200);

    // Mark out closes yesterday's open day; then today can start.
    const out = await markOut(state.ravi);
    expect(out.status).toBe(200);
    expect(new Date(out.body.data.day).getTime()).toBe(yesterday.getTime());
    expect((await markIn(state.ravi)).status).toBe(200);
  });
});

describe("Today's cashout needs an open working day", () => {
  test('not marked in, or an earlier cashout waiting approval -> refused; settled and marked in -> accepted', async () => {
    const admin = call(state.admin);
    const User = (await import('../src/models/User.js')).default;
    const VanDayClose = (await import('../src/models/VanDayClose.js')).default;
    const { runWithContext } = await import('../src/middlewares/tenantContext.js');
    const kiranId = await runWithContext({ scope: 'company', companyId: state.companyId }, async () =>
      String((await User.create({ companyId: state.companyId, name: 'Kiran Van', email: 'kiran@fd.test', password: PASSWORD, role: 'SALESMAN', salesType: 'VAN_SALE' }))._id)
    );
    const token = (await request.post('/api/auth/login').send({ identifier: 'kiran@fd.test', password: PASSWORD })).body.data.accessToken;
    const van2 = (await admin.post('/api/v1/warehouses', { name: 'Van 2', code: 'VAN2', type: 'VAN', parent: state.main, vehicleNumber: 'MH12AB0002' })).body.data.id;
    await admin.post(`/api/v1/warehouses/${van2}/assignments`, { executive: kiranId });
    const kiran = call(token);

    // Not marked in today.
    const early = await kiran.post(`/api/v1/vans/${van2}/day-close`, { date: today(), cashDeposited: 0 });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('ATTENDANCE_REQUIRED');

    // Yesterday's cashout is still waiting for the manager.
    const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() - 86400000));
    const old = await runWithContext({ scope: 'company', companyId: state.companyId }, () =>
      VanDayClose.create({ warehouse: van2, day: yesterday, status: 'SUBMITTED' })
    );
    const waiting = await kiran.post(`/api/v1/vans/${van2}/day-close`, { date: today(), cashDeposited: 0 });
    expect(waiting.status).toBe(409);
    expect(waiting.body.code).toBe('DAY_CASHOUT_PENDING');

    // Approved -> mark in -> today's cashout goes through.
    expect((await call(state.mona).post(`/api/v1/vans/day-closes/${old._id}/approve`)).status).toBe(200);
    expect((await markIn(token)).status).toBe(200);
    const ok = await kiran.post(`/api/v1/vans/${van2}/day-close`, { date: today(), cashDeposited: 0 });
    expect(ok.status).toBe(201);
  });
});

describe('The working day is the company day, not the server day', () => {
  // Only Date is faked: the database driver and supertest keep real timers.
  const KEEP_REAL = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'];
  const realTZ = process.env.TZ;
  afterEach(() => {
    jest.useRealTimers();
    if (realTZ === undefined) delete process.env.TZ;
    else process.env.TZ = realTZ;
  });

  // Both moments fall on the next calendar day in India but not on the server:
  // a UTC server (Vercel) at 01:30 IST, and a dev machine in Nairobi at 22:00 (00:30 IST).
  test.each([
    ['UTC', 20, 'neha'],
    ['Africa/Nairobi', 19, 'omar'],
  ])('server in %s near the IST midnight: mark in, cashout and mark out all use the IST day', async (serverTz, utcHour, who) => {
    process.env.TZ = serverTz;
    const at = new Date();
    at.setUTCHours(utcHour, 0, 0, 0);
    jest.useFakeTimers({ now: at, advanceTimers: true, doNotFake: KEEP_REAL });
    const istDay = today();
    expect(istDay).not.toBe(at.toISOString().slice(0, 10)); // the boundary really is crossed

    const admin = call((await request.post('/api/auth/login').send({ identifier: 'admin@fd.test', password: PASSWORD })).body.data.accessToken);
    const User = (await import('../src/models/User.js')).default;
    const { runWithContext } = await import('../src/middlewares/tenantContext.js');
    const userId = await runWithContext({ scope: 'company', companyId: state.companyId }, async () =>
      String((await User.create({ companyId: state.companyId, name: who, email: `${who}@fd.test`, password: PASSWORD, role: 'SALESMAN', salesType: 'VAN_SALE' }))._id)
    );
    const van = (await admin.post('/api/v1/warehouses', { name: `Van ${who}`, code: `VAN${who.toUpperCase()}`, type: 'VAN', parent: state.main, vehicleNumber: `MH12${who.toUpperCase()}01` })).body.data.id;
    expect((await admin.post(`/api/v1/warehouses/${van}/assignments`, { executive: userId })).status).toBeLessThan(300);
    const token = (await request.post('/api/auth/login').send({ identifier: `${who}@fd.test`, password: PASSWORD })).body.data.accessToken;
    const me = call(token);
    const mona = call((await request.post('/api/auth/login').send({ identifier: 'mona@fd.test', password: PASSWORD })).body.data.accessToken);

    const markedIn = await markIn(token);
    expect(markedIn.status).toBe(200);
    const day = new Date(markedIn.body.data.day);
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(day)).toBe(istDay);

    const state1 = (await me.get('/api/v1/field-force/attendance/today')).body.data;
    expect(state1.attendance.id).toBe(markedIn.body.data.id);
    expect(state1.fieldDay.blocked).toBeNull();
    expect(state1.fieldDay.cashout.day).toBe(istDay);

    const noCash = await markOut(token);
    expect(noCash.body.code).toBe('DAY_CASHOUT_REQUIRED');
    expect(noCash.body.message).toContain(istDay);

    const cash = await me.post(`/api/v1/vans/${van}/day-close`, { date: istDay, cashDeposited: 0 });
    expect(cash.status).toBe(201);
    const waiting = await markOut(token);
    expect(waiting.status).toBe(409);
    expect(waiting.body.code).toBe('DAY_CASHOUT_PENDING');

    expect((await mona.post(`/api/v1/vans/day-closes/${cash.body.data.id}/approve`)).status).toBe(200);
    const out = await markOut(token);
    expect(out.status).toBe(200);
    expect(new Date(out.body.data.day).getTime()).toBe(day.getTime());
  });
});
