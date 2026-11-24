import { boot, shutdown, clearDb } from './helpers.js';

/**
 * Customer portal (Phase 1): mobile + PIN login on the company's link, the
 * customer's own catalogue prices, order requests that reserve nothing until
 * staff accept them, own-records-only reads, and the daily housekeeping job.
 */

let request;
let Company;
let Setting;
let User;
let Customer;
let Product;
let PriceList;
let Warehouse;
let StockBalance;
let Order;
let Invoice;
let Notification;
let runWithContext;
let runPortalOrderJobs;

const PASSWORD = 'Portal#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const inTenant = (companyId, fn) => runWithContext({ scope: 'company', companyId: String(companyId) }, fn);

const staffLogin = async (identifier) => {
  const res = await request.post('/api/auth/login').send({ identifier, password: PASSWORD });
  if (res.status !== 200) throw new Error(`staff login failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
};

const portalLogin = (mobile, pin, companyCode = 'PORT1') =>
  request.post('/api/portal/auth/login').send({ companyCode, mobile, pin });

const reservedOf = async (productId) => {
  const bal = await inTenant(state.companyId, () =>
    StockBalance.findOne({ product: productId, warehouse: state.warehouse._id }).lean()
  );
  return Number(bal?.reservedQty || 0);
};

/** Give a customer a login and set its own PIN; returns a ready access token. */
const onboard = async (customerId, mobile, newPin) => {
  const on = await request
    .put(`/api/v1/customers/${customerId}/portal-access`)
    .set(as(state.adminToken))
    .send({ enabled: true, mobile });
  expect(on.status).toBe(200);
  expect(on.body.data.pin).toMatch(/^\d{4}$/);
  const first = await portalLogin(mobile, on.body.data.pin);
  expect(first.status).toBe(200);
  expect(first.body.data.account.mustChangePin).toBe(true);
  const changed = await request
    .post('/api/portal/auth/change-pin')
    .set(as(first.body.data.accessToken))
    .send({ currentPin: on.body.data.pin, newPin, confirmPin: newPin });
  expect(changed.status).toBe(200);
  const again = await portalLogin(mobile, newPin);
  expect(again.status).toBe(200);
  expect(again.body.data.account.mustChangePin).toBe(false);
  return again.body.data.accessToken;
};

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);

  ({ default: Company } = await import('../src/models/Company.js'));
  ({ default: Setting } = await import('../src/models/Setting.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ default: Customer } = await import('../src/models/Customer.js'));
  ({ default: Product } = await import('../src/models/Product.js'));
  ({ default: PriceList } = await import('../src/models/PriceList.js'));
  ({ default: Warehouse } = await import('../src/models/Warehouse.js'));
  ({ default: StockBalance } = await import('../src/models/StockBalance.js'));
  ({ default: Order } = await import('../src/models/Order.js'));
  ({ default: Invoice } = await import('../src/models/Invoice.js'));
  ({ default: Notification } = await import('../src/models/Notification.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  ({ runPortalOrderJobs } = await import('../src/jobs/portalOrders.js'));
  await import('../src/models/CustomerAccount.js').then((m) => m.default.init());

  await clearDb();

  const company = await Company.create({
    code: 'PORT1',
    slug: 'port1',
    businessName: 'Portal Traders',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    userLimit: 20,
    limits: { maxUsers: 20, maxCustomers: 500, maxInvoicesPerMonth: 1000 },
    featureFlags: { customerPortal: true },
  });
  state.companyId = String(company._id);

  await inTenant(state.companyId, async () => {
    const settings = await Setting.forCompany(company._id);
    settings.set({
      'fieldForce.requireAttendance': false,
      'order.approvalThreshold': 0,
      'order.creditLimitAction': 'WARN',
      'order.reserveStockOnConfirm': true,
      'tax.taxInclusive': false,
      portal: { enabled: true, requestExpiryDays: 3, minOrderValue: 0, showStockStatus: true, showOutstanding: true },
    });

    const admin = await User.create({ name: 'Admin', email: 'admin@portal.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    const salesman = await User.create({ name: 'Ravi Sales', email: 'ravi@portal.test', password: PASSWORD, role: 'SALESMAN' });
    state.salesman = salesman;

    const warehouse = await Warehouse.create({ name: 'Main', code: 'MAIN', type: 'MAIN', isDefault: true, isActive: true });
    state.warehouse = warehouse;
    settings.set({ 'inventory.defaultWarehouse': warehouse._id });
    await settings.save();

    const [soap, oil, rare] = await Product.create([
      { name: 'Alpha Soap', sku: 'ALPHA', unit: 'PCS', gstRate: 18, sellingPrice: 100, purchasePrice: 60, stock: 100, lowStockLevel: 5, isActive: true },
      { name: 'Beta Oil', sku: 'BETA', unit: 'BTL', gstRate: 12, sellingPrice: 50, purchasePrice: 30, stock: 3, lowStockLevel: 10, isActive: true },
      { name: 'Gamma Rare', sku: 'GAMMA', unit: 'PCS', gstRate: 18, sellingPrice: 10, purchasePrice: 5, stock: 0, lowStockLevel: 1, isActive: true },
    ]);
    state.products = { soap, oil, rare };
    await StockBalance.create([
      { product: soap._id, warehouse: warehouse._id, qty: 100, reservedQty: 0 },
      { product: oil._id, warehouse: warehouse._id, qty: 3, reservedQty: 0 },
    ]);

    // A special price list for shop A only: soap at 90 instead of 100.
    const special = await PriceList.create({
      code: 'SHOPA',
      name: 'Shop A rates',
      type: 'RETAIL',
      isActive: true,
      items: [{ product: soap._id, price: 90, discountPercent: 0, minQty: 1 }],
    });

    state.shopA = await Customer.create({ code: 'CA', name: 'Shop A', phone: '9876500001', assignedTo: salesman._id, priceList: special._id, isActive: true });
    state.shopB = await Customer.create({ code: 'CB', name: 'Shop B', phone: '9876500002', isActive: true });

    state.invoiceB = await Invoice.create({
      invoiceNo: 'INV-B-1',
      status: 'ISSUED',
      customerId: state.shopB._id,
      customerName: 'Shop B',
      items: [{ product: soap._id, name: 'Alpha Soap', qty: 1, unitPrice: 100, lineTotal: 100 }],
      total: 100,
      balanceDue: 100,
    });
    void admin;
  });

  state.adminToken = await staffLogin('admin@portal.test');
  state.tokenA = await onboard(state.shopA._id, '+91 98765-00001', '2468');
  state.tokenB = await onboard(state.shopB._id, '9876500002', '1357');
});

afterAll(async () => {
  await shutdown();
});

describe('portal login and isolation', () => {
  test('company info is public; unknown company is 404', async () => {
    const ok = await request.get('/api/portal/company/port1');
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ code: 'PORT1', name: 'Portal Traders', open: true });
    expect((await request.get('/api/portal/company/NOPE')).status).toBe(404);
  });

  test('the same mobile cannot sign in for two customers', async () => {
    const res = await request
      .put(`/api/v1/customers/${state.shopB._id}/portal-access`)
      .set(as(state.adminToken))
      .send({ enabled: true, mobile: '9876500001' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MOBILE_IN_USE');
  });

  test('a portal token never opens staff APIs, and a staff token never opens the portal', async () => {
    expect((await request.get('/api/v1/orders').set(as(state.tokenA))).status).toBe(401);
    expect((await request.get('/api/v1/auth/me').set(as(state.tokenA))).status).toBe(401);
    expect((await request.get('/api/portal/me').set(as(state.adminToken))).status).toBe(401);
  });

  test('me shows the customer, its balance and the portal options', async () => {
    const res = await request.get('/api/portal/me').set(as(state.tokenA));
    expect(res.status).toBe(200);
    expect(res.body.data.customer).toMatchObject({ name: 'Shop A', code: 'CA' });
    expect(res.body.data.company.code).toBe('PORT1');
    expect(res.body.data.portal.showStockStatus).toBe(true);
  });
});

describe('catalogue', () => {
  test("shows the customer's own prices, stock as a status only, no costs", async () => {
    const res = await request.get('/api/portal/catalog').set(as(state.tokenA));
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.map((p) => [p.name, p]));
    expect(byName['Alpha Soap'].price).toBe(90);
    expect(byName['Alpha Soap'].stock).toBe('IN_STOCK');
    expect(byName['Beta Oil'].stock).toBe('LOW');
    expect(byName['Gamma Rare'].stock).toBe('OUT');
    const raw = JSON.stringify(res.body.data);
    expect(raw).not.toMatch(/purchasePrice|avgCost|"stock":\d/);

    const other = await request.get('/api/portal/catalog?search=alpha').set(as(state.tokenB));
    expect(other.body.data[0].price).toBe(100);
  });
});

describe('order requests', () => {
  test('placing an order makes a REQUESTED order and reserves nothing', async () => {
    const before = await reservedOf(state.products.soap._id);
    const statsBefore = (await request.get('/api/v1/orders/stats').set(as(state.adminToken))).body.data;

    const res = await request
      .post('/api/portal/orders')
      .set(as(state.tokenA))
      // A price sent by the customer is ignored.
      .send({ items: [{ product: String(state.products.soap._id), qty: 10, unitPrice: 1 }], note: 'Deliver by noon' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('REQUESTED');
    expect(res.body.data.items[0].unitPrice).toBe(90);
    state.requestId = res.body.data.id;

    expect(await reservedOf(state.products.soap._id)).toBe(before);

    const order = await inTenant(state.companyId, () => Order.findById(state.requestId).lean());
    expect(order.source).toBe('PORTAL');
    expect(String(order.salesman)).toBe(String(state.salesman._id));

    const notes = await inTenant(state.companyId, () => Notification.find({ type: 'PORTAL_ORDER' }).lean());
    expect(notes.some((n) => n.recipients.map(String).includes(String(state.salesman._id)))).toBe(true);

    const statsAfter = (await request.get('/api/v1/orders/stats').set(as(state.adminToken))).body.data;
    expect(statsAfter.month.count).toBe(statsBefore.month.count);
    expect(statsAfter.portalRequests).toBe(statsBefore.portalRequests + 1);
  });

  test('staff change the quantity and accept: confirmed and reserved; customer sees the change', async () => {
    const edited = await request
      .patch(`/api/v1/orders/${state.requestId}`)
      .set(as(state.adminToken))
      .send({ items: [{ product: String(state.products.soap._id), qty: 6 }] });
    expect(edited.status).toBe(200);
    expect(edited.body.data.status).toBe('REQUESTED');

    const before = await reservedOf(state.products.soap._id);
    const accepted = await request.post(`/api/v1/orders/${state.requestId}/submit`).set(as(state.adminToken)).send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe('CONFIRMED');
    expect(await reservedOf(state.products.soap._id)).toBe(before + 6);

    const seen = await request.get(`/api/portal/orders/${state.requestId}`).set(as(state.tokenA));
    expect(seen.status).toBe(200);
    expect(seen.body.data.status).toBe('CONFIRMED');
    expect(seen.body.data.changes).toEqual([expect.objectContaining({ name: 'Alpha Soap', asked: 10, now: 6 })]);
    expect(seen.body.data.canCancel).toBe(false);
  });

  test('a rejected or cancelled request reserves nothing', async () => {
    const before = await reservedOf(state.products.soap._id);
    const one = await request.post('/api/portal/orders').set(as(state.tokenA)).send({ items: [{ product: String(state.products.soap._id), qty: 2 }] });
    const rejected = await request.post(`/api/v1/orders/${one.body.data.id}/reject`).set(as(state.adminToken)).send({ reason: 'Out of route' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');

    const two = await request.post('/api/portal/orders').set(as(state.tokenA)).send({ items: [{ product: String(state.products.soap._id), qty: 2 }] });
    const cancelled = await request.post(`/api/portal/orders/${two.body.data.id}/cancel`).set(as(state.tokenA)).send({ reason: 'Ordered twice' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(await reservedOf(state.products.soap._id)).toBe(before);

    // Once accepted the customer cannot cancel any more.
    const locked = await request.post(`/api/portal/orders/${state.requestId}/cancel`).set(as(state.tokenA)).send({});
    expect(locked.status).toBe(409);
  });

  test('minimum order value is enforced', async () => {
    await inTenant(state.companyId, () => Setting.updateOne({}, { $set: { 'portal.minOrderValue': 5000 } }));
    const res = await request.post('/api/portal/orders').set(as(state.tokenA)).send({ items: [{ product: String(state.products.soap._id), qty: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BELOW_MINIMUM_ORDER');
    await inTenant(state.companyId, () => Setting.updateOne({}, { $set: { 'portal.minOrderValue': 0 } }));
  });
});

describe('own records only', () => {
  test("customer A cannot read customer B's order, invoice or statement", async () => {
    const bOrder = await request.post('/api/portal/orders').set(as(state.tokenB)).send({ items: [{ product: String(state.products.soap._id), qty: 1 }] });
    expect(bOrder.status).toBe(201);
    expect((await request.get(`/api/portal/orders/${bOrder.body.data.id}`).set(as(state.tokenA))).status).toBe(404);
    expect((await request.post(`/api/portal/orders/${bOrder.body.data.id}/cancel`).set(as(state.tokenA)).send({})).status).toBe(404);
    expect((await request.get(`/api/portal/invoices/${state.invoiceB._id}/pdf`).set(as(state.tokenA))).status).toBe(404);

    const listA = await request.get('/api/portal/orders').set(as(state.tokenA));
    expect(listA.body.data.every((o) => o.id !== bOrder.body.data.id)).toBe(true);
    const invA = await request.get('/api/portal/invoices').set(as(state.tokenA));
    expect(invA.body.data).toHaveLength(0);
    const invB = await request.get('/api/portal/invoices').set(as(state.tokenB));
    expect(invB.body.data.map((i) => i.invoiceNo)).toEqual(['INV-B-1']);

    const stA = await request.get('/api/portal/statement').set(as(state.tokenA));
    expect(stA.status).toBe(200);
    expect(stA.body.data.party.name).toBe('Shop A');
  });

  test('balance confirmation is saved; a dispute needs a note', async () => {
    const bad = await request.post('/api/portal/statement/confirm').set(as(state.tokenB)).send({ status: 'DISPUTED' });
    expect(bad.status).toBe(422);
    const ok = await request.post('/api/portal/statement/confirm').set(as(state.tokenB)).send({ status: 'CONFIRMED' });
    expect(ok.status).toBe(201);
    const st = await request.get('/api/portal/statement').set(as(state.tokenB));
    expect(st.body.data.confirmation.status).toBe('CONFIRMED');
  });
});

describe('switching things off', () => {
  test('access off for a customer ends its session and blocks login', async () => {
    const off = await request
      .put(`/api/v1/customers/${state.shopB._id}/portal-access`)
      .set(as(state.adminToken))
      .send({ enabled: false });
    expect(off.status).toBe(200);
    expect((await request.get('/api/portal/me').set(as(state.tokenB))).status).toBe(401);
    const login = await portalLogin('9876500002', '1357');
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('PORTAL_ACCESS_OFF');
  });

  test('portal off in settings, or module off in the plan, closes it', async () => {
    await inTenant(state.companyId, () => Setting.updateOne({}, { $set: { 'portal.enabled': false } }));
    let res = await request.get('/api/portal/me').set(as(state.tokenA));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PORTAL_DISABLED');
    await inTenant(state.companyId, () => Setting.updateOne({}, { $set: { 'portal.enabled': true } }));

    await Company.updateOne({ _id: state.companyId }, { $set: { 'featureFlags.customerPortal': false } }).skipTenant();
    res = await request.get('/api/portal/me').set(as(state.tokenA));
    expect(res.status).toBe(403);
    const staff = await request.get(`/api/v1/customers/${state.shopA._id}/portal-access`).set(as(state.adminToken));
    expect(staff.status).toBe(403);
    await Company.updateOne({ _id: state.companyId }, { $set: { 'featureFlags.customerPortal': true } }).skipTenant();
    expect((await request.get('/api/portal/me').set(as(state.tokenA))).status).toBe(200);
  });

  test('five wrong PINs lock the login', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await portalLogin('9876500001', '0000')).status).toBe(401);
    }
    const locked = await portalLogin('9876500001', '2468');
    expect(locked.status).toBe(423);
    // Staff reset the PIN: unlocked, customer must pick a new one.
    const reset = await request.post(`/api/v1/customers/${state.shopA._id}/portal-access/reset-pin`).set(as(state.adminToken));
    expect(reset.status).toBe(200);
    const again = await portalLogin('9876500001', reset.body.data.pin);
    expect(again.status).toBe(200);
    expect(again.body.data.account.mustChangePin).toBe(true);
    // Until then only "me" and change-pin work.
    expect((await request.get('/api/portal/catalog').set(as(again.body.data.accessToken))).status).toBe(403);
    state.tokenA = again.body.data.accessToken;
    const changed = await request
      .post('/api/portal/auth/change-pin')
      .set(as(state.tokenA))
      .send({ currentPin: reset.body.data.pin, newPin: '8642', confirmPin: '8642' });
    expect(changed.status).toBe(200);
  });
});

describe('daily housekeeping', () => {
  test('old requests expire; stale confirmed orders get one reminder a day', async () => {
    const tokenA = (await portalLogin('9876500001', '8642')).body.data.accessToken;
    const fresh = await request.post('/api/portal/orders').set(as(tokenA)).send({ items: [{ product: String(state.products.soap._id), qty: 1 }] });
    const old = await request.post('/api/portal/orders').set(as(tokenA)).send({ items: [{ product: String(state.products.soap._id), qty: 1 }] });
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    await inTenant(state.companyId, async () => {
      await Order.collection.updateOne({ _id: Order.castObject({ _id: old.body.data.id })._id }, { $set: { createdAt: tenDaysAgo } });
      // The order accepted earlier: confirmed long ago, never invoiced.
      await Order.collection.updateOne({ _id: Order.castObject({ _id: state.requestId })._id }, { $set: { orderDate: tenDaysAgo } });
    });

    const first = await runPortalOrderJobs();
    expect(first.expired).toBe(1);
    expect(first.stale).toBe(1);

    const states = await inTenant(state.companyId, () =>
      Order.find({ _id: { $in: [fresh.body.data.id, old.body.data.id] } }).select('status').lean()
    );
    const byId = Object.fromEntries(states.map((o) => [String(o._id), o.status]));
    expect(byId[old.body.data.id]).toBe('EXPIRED');
    expect(byId[fresh.body.data.id]).toBe('REQUESTED');

    const second = await runPortalOrderJobs();
    expect(second.stale).toBe(0);
    const reminders = await inTenant(state.companyId, () => Notification.countDocuments({ type: 'STALE_ORDER' }));
    expect(reminders).toBeGreaterThan(0);
    const reminderTotal = reminders;
    await runPortalOrderJobs();
    expect(await inTenant(state.companyId, () => Notification.countDocuments({ type: 'STALE_ORDER' }))).toBe(reminderTotal);
  });
});
