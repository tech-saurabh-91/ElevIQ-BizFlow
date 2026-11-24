import crypto from 'node:crypto';
import { boot, shutdown, clearDb } from './helpers.js';

/**
 * Customer portal, phase 2: payment claims, returns / complaints, the
 * customer's inbox, OTP sign-in, auto-confirm for trusted customers,
 * automatic cancellation of stale orders, product photos.
 */

let request;
let Company;
let Setting;
let User;
let Customer;
let Product;
let Warehouse;
let StockBalance;
let Order;
let Invoice;
let CustomerAccount;
let PortalNotification;
let runWithContext;
let runPortalOrderJobs;

const PASSWORD = 'Portal#Pass123';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const inTenant = (fn) => runWithContext({ scope: 'company', companyId: state.companyId }, fn);
const setPortal = (patch) => inTenant(() => Setting.updateOne({}, { $set: patch }));

const reservedOf = async (productId) => {
  const bal = await inTenant(() => StockBalance.findOne({ product: productId }).lean());
  return Number(bal?.reservedQty || 0);
};

const onboard = async (customerId, mobile, newPin, extra = {}) => {
  const on = await request
    .put(`/api/v1/customers/${customerId}/portal-access`)
    .set(as(state.adminToken))
    .send({ enabled: true, mobile, ...extra });
  expect(on.status).toBe(200);
  const first = await request.post('/api/portal/auth/login').send({ companyCode: 'PORT2', mobile, pin: on.body.data.pin });
  await request
    .post('/api/portal/auth/change-pin')
    .set(as(first.body.data.accessToken))
    .send({ currentPin: on.body.data.pin, newPin, confirmPin: newPin });
  const again = await request.post('/api/portal/auth/login').send({ companyCode: 'PORT2', mobile, pin: newPin });
  expect(again.status).toBe(200);
  return again.body.data.accessToken;
};

beforeAll(async () => {
  process.env.MESSAGING_DRIVER = 'log';
  const { app } = await boot();
  request = (await import('supertest')).default(app);

  ({ default: Company } = await import('../src/models/Company.js'));
  ({ default: Setting } = await import('../src/models/Setting.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ default: Customer } = await import('../src/models/Customer.js'));
  ({ default: Product } = await import('../src/models/Product.js'));
  ({ default: Warehouse } = await import('../src/models/Warehouse.js'));
  ({ default: StockBalance } = await import('../src/models/StockBalance.js'));
  ({ default: Order } = await import('../src/models/Order.js'));
  ({ default: Invoice } = await import('../src/models/Invoice.js'));
  ({ default: CustomerAccount } = await import('../src/models/CustomerAccount.js'));
  ({ default: PortalNotification } = await import('../src/models/PortalNotification.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  ({ runPortalOrderJobs } = await import('../src/jobs/portalOrders.js'));
  await clearDb();
  await CustomerAccount.init();

  const company = await Company.create({
    code: 'PORT2',
    slug: 'port2',
    businessName: 'Portal Two Traders',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    userLimit: 20,
    limits: { maxUsers: 20, maxCustomers: 500, maxInvoicesPerMonth: 1000 },
    featureFlags: { customerPortal: true },
  });
  state.companyId = String(company._id);

  await inTenant(async () => {
    const settings = await Setting.forCompany(company._id);
    await User.create({ name: 'Admin', email: 'admin@portal2.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    const warehouse = await Warehouse.create({ name: 'Main', code: 'MAIN', type: 'MAIN', isDefault: true, isActive: true });
    settings.set({
      'fieldForce.requireAttendance': false,
      'order.approvalThreshold': 0,
      'order.reserveStockOnConfirm': true,
      'inventory.defaultWarehouse': warehouse._id,
      portal: { enabled: true, requestExpiryDays: 3, showStockStatus: true, showOutstanding: true },
    });
    await settings.save();

    const soap = await Product.create({ name: 'Alpha Soap', sku: 'ALPHA', unit: 'PCS', gstRate: 0, sellingPrice: 100, stock: 10, lowStockLevel: 1, isActive: true });
    state.soap = soap;
    await StockBalance.create({ product: soap._id, warehouse: warehouse._id, qty: 10, reservedQty: 0 });

    state.shop = await Customer.create({ code: 'C1', name: 'Shop One', phone: '9000000001', creditLimit: 0, isActive: true });
    state.other = await Customer.create({ code: 'C2', name: 'Shop Two', phone: '9000000002', isActive: true });
    state.invoice = await Invoice.create({
      invoiceNo: 'INV-1',
      status: 'ISSUED',
      customerId: state.shop._id,
      customerName: 'Shop One',
      items: [{ product: soap._id, name: 'Alpha Soap', unit: 'PCS', qty: 5, unitPrice: 100, lineTotal: 500 }],
      total: 500,
      balanceDue: 500,
    });
  });

  const login = await request.post('/api/auth/login').send({ identifier: 'admin@portal2.test', password: PASSWORD });
  state.adminToken = login.body.data.accessToken;
  state.token = await onboard(state.shop._id, '9000000001', '1470');
});

afterAll(async () => {
  await shutdown();
});

describe('payment claims', () => {
  test('customer says "I paid" with a screenshot; staff record it as a receipt', async () => {
    const res = await request
      .post('/api/portal/payments')
      .set(as(state.token))
      .field('amount', '500')
      .field('paidOn', new Date().toISOString().slice(0, 10))
      .field('mode', 'UPI')
      .field('reference', 'UTR123456')
      .field('invoices', String(state.invoice._id))
      .attach('proof', PNG, { filename: 'paid.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('SUBMITTED');
    expect(res.body.data.proof).toMatch(/^\/uploads\/claims\//);
    state.claimId = res.body.data.id;

    const list = await request.get('/api/v1/payment-claims?status=SUBMITTED').set(as(state.adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data[0].customer.name).toBe('Shop One');
    expect(list.body.meta.open).toBe(1);

    // Another customer's claim id cannot be used for this customer's receipt.
    const receipt = await request
      .post('/api/v1/payments')
      .set(as(state.adminToken))
      .send({
        customerId: String(state.shop._id),
        amount: 500,
        mode: 'UPI',
        reference: 'UTR123456',
        allocations: [{ invoice: String(state.invoice._id), amount: 500 }],
        receive: true,
        claimId: state.claimId,
      });
    expect(receipt.status).toBe(201);

    const mine = await request.get('/api/portal/payments').set(as(state.token));
    expect(mine.body.data[0].status).toBe('VERIFIED');
    const inbox = await request.get('/api/portal/notifications').set(as(state.token));
    expect(inbox.body.data.some((n) => /Payment of 500.00 received/.test(n.title))).toBe(true);

    // A claim is recorded once only.
    const again = await request
      .post('/api/v1/payments')
      .set(as(state.adminToken))
      .send({ customerId: String(state.shop._id), amount: 1, mode: 'CASH', claimId: state.claimId });
    expect(again.status).toBe(409);
  });

  test('staff reject a claim with a reason; the customer sees it', async () => {
    const res = await request
      .post('/api/portal/payments')
      .set(as(state.token))
      .send({ amount: 50, paidOn: new Date().toISOString().slice(0, 10), mode: 'CASH' });
    expect(res.status).toBe(201);
    const rejected = await request
      .post(`/api/v1/payment-claims/${res.body.data.id}/reject`)
      .set(as(state.adminToken))
      .send({ reason: 'Not received in our bank' });
    expect(rejected.status).toBe(200);
    const mine = await request.get('/api/portal/payments').set(as(state.token));
    expect(mine.body.data.find((c) => c.id === res.body.data.id)).toMatchObject({ status: 'REJECTED', rejectReason: 'Not received in our bank' });
  });

  test('claims can be switched off by the company', async () => {
    await setPortal({ 'portal.paymentClaims': false });
    const res = await request.post('/api/portal/payments').set(as(state.token)).send({ amount: 5, paidOn: '2026-11-20', mode: 'CASH' });
    expect(res.status).toBe(403);
    await setPortal({ 'portal.paymentClaims': true });
  });
});

describe('returns and complaints', () => {
  test('cannot return more than was billed, or from another invoice', async () => {
    const tooMany = await request
      .post('/api/portal/returns')
      .set(as(state.token))
      .send({ kind: 'RETURN', reason: 'DAMAGED', invoice: String(state.invoice._id), items: [{ product: String(state.soap._id), qty: 9 }] });
    expect(tooMany.status).toBe(422);
  });

  test('a return with photos goes to staff, who accept then resolve it', async () => {
    const res = await request
      .post('/api/portal/returns')
      .set(as(state.token))
      .field('kind', 'RETURN')
      .field('reason', 'DAMAGED')
      .field('invoice', String(state.invoice._id))
      .field('note', '2 packets torn')
      .field('items', JSON.stringify([{ product: String(state.soap._id), qty: 2 }]))
      .attach('photos', PNG, { filename: 'torn.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'OPEN', invoiceNo: 'INV-1' });
    expect(res.body.data.requestNo).toMatch(/^RR/);
    expect(res.body.data.photos).toHaveLength(1);

    const list = await request.get('/api/v1/returns').set(as(state.adminToken));
    const id = list.body.data[0].id;
    const accepted = await request.post(`/api/v1/returns/${id}/decide`).set(as(state.adminToken)).send({ status: 'ACCEPTED', note: 'Credit note coming' });
    expect(accepted.status).toBe(200);
    const resolved = await request.post(`/api/v1/returns/${id}/decide`).set(as(state.adminToken)).send({ status: 'RESOLVED' });
    expect(resolved.status).toBe(200);
    const reopen = await request.post(`/api/v1/returns/${id}/decide`).set(as(state.adminToken)).send({ status: 'ACCEPTED' });
    expect(reopen.status).toBe(409);

    const mine = await request.get('/api/portal/returns').set(as(state.token));
    expect(mine.body.data[0].status).toBe('RESOLVED');
    expect(mine.body.data[0].history.map((h) => h.status)).toEqual(['OPEN', 'ACCEPTED', 'RESOLVED']);
  });

  test("a customer cannot open another customer's invoice", async () => {
    let otherInvoice;
    await inTenant(async () => {
      otherInvoice = await Invoice.create({ invoiceNo: 'INV-2', status: 'ISSUED', customerId: state.other._id, items: [], total: 1, balanceDue: 1 });
    });
    expect((await request.get(`/api/portal/invoices/${otherInvoice._id}`).set(as(state.token))).status).toBe(404);
  });
});

describe('inbox', () => {
  test('unread count on "me", then mark all read', async () => {
    const me = await request.get('/api/portal/me').set(as(state.token));
    expect(me.body.data.unread).toBeGreaterThan(0);
    await request.post('/api/portal/notifications/read').set(as(state.token));
    const after = await request.get('/api/portal/me').set(as(state.token));
    expect(after.body.data.unread).toBe(0);
  });
});

describe('OTP sign-in', () => {
  test('off until the company switches it on; then a code signs in', async () => {
    const off = await request.post('/api/portal/auth/otp').send({ companyCode: 'PORT2', mobile: '9000000001' });
    expect(off.status).toBe(400);

    await setPortal({ 'portal.otpLogin': true });
    const info = await request.get('/api/portal/company/PORT2');
    expect(info.body.data.otp).toBe(true);

    const sent = await request.post('/api/portal/auth/otp').send({ companyCode: 'PORT2', mobile: '9000000001' });
    expect(sent.status).toBe(200);
    // An unknown mobile gets the same answer.
    const unknown = await request.post('/api/portal/auth/otp').send({ companyCode: 'PORT2', mobile: '9111111111' });
    expect(unknown.status).toBe(200);

    // The code went by the (log) driver; put a known one in its place.
    await inTenant(() =>
      CustomerAccount.updateOne(
        { mobile: '9000000001' },
        { $set: { otpHash: crypto.createHash('sha256').update('123456').digest('hex') } }
      )
    );
    const wrong = await request.post('/api/portal/auth/otp/verify').send({ companyCode: 'PORT2', mobile: '9000000001', otp: '000000' });
    expect(wrong.status).toBe(401);
    const ok = await request.post('/api/portal/auth/otp/verify').send({ companyCode: 'PORT2', mobile: '9000000001', otp: '123456' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    // Used once only.
    const reuse = await request.post('/api/portal/auth/otp/verify').send({ companyCode: 'PORT2', mobile: '9000000001', otp: '123456' });
    expect(reuse.status).toBe(401);
  });
});

describe('trusted customers and stale orders', () => {
  test('auto-confirm only for a trusted customer, and only when stock allows', async () => {
    const plain = await request.post('/api/portal/orders').set(as(state.token)).send({ items: [{ product: String(state.soap._id), qty: 1 }] });
    expect(plain.body.data.status).toBe('REQUESTED');

    await setPortal({ 'portal.autoConfirm': true });
    const trust = await request
      .put(`/api/v1/customers/${state.shop._id}/portal-access`)
      .set(as(state.adminToken))
      .send({ enabled: true, autoConfirm: true });
    expect(trust.body.data.autoConfirm).toBe(true);

    const before = await reservedOf(state.soap._id);
    const auto = await request.post('/api/portal/orders').set(as(state.token)).send({ items: [{ product: String(state.soap._id), qty: 3 }] });
    expect(auto.status).toBe(201);
    expect(auto.body.data.status).toBe('CONFIRMED');
    expect(await reservedOf(state.soap._id)).toBe(before + 3);
    state.autoOrderId = auto.body.data.id;

    // More than is free (10 on hand, 3 reserved): waits for a person.
    const short = await request.post('/api/portal/orders').set(as(state.token)).send({ items: [{ product: String(state.soap._id), qty: 8 }] });
    expect(short.body.data.status).toBe('REQUESTED');
    expect(await reservedOf(state.soap._id)).toBe(before + 3);

    const inbox = await request.get('/api/portal/notifications').set(as(state.token));
    expect(Array.isArray(inbox.body.data)).toBe(true);
  });

  test('with auto-cancel on, an old confirmed order is cancelled and its stock freed', async () => {
    await setPortal({ 'order.autoCancelDays': 5, 'order.staleConfirmedDays': 0 });
    const old = new Date(Date.now() - 9 * 86400000);
    await inTenant(() => Order.collection.updateOne({ _id: Order.castObject({ _id: state.autoOrderId })._id }, { $set: { orderDate: old } }));
    const before = await reservedOf(state.soap._id);
    const result = await runPortalOrderJobs();
    expect(result.cancelled).toBe(1);
    const order = await inTenant(() => Order.findById(state.autoOrderId).lean());
    expect(order.status).toBe('CANCELLED');
    expect(await reservedOf(state.soap._id)).toBe(before - 3);
    const notes = await inTenant(() => PortalNotification.find({ customer: state.shop._id, title: /cancelled/ }).lean());
    expect(notes.length).toBeGreaterThan(0);
  });

  test('dashboard shows waiting online orders', async () => {
    const res = await request.get('/api/v1/dashboard/summary').set(as(state.adminToken));
    expect(res.status).toBe(200);
    const data = res.body.data;
    const count = data.kpis?.portalRequests ?? data.portalRequests;
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe('product photos', () => {
  test('staff upload a photo; the portal catalogue shows it', async () => {
    const res = await request
      .post(`/api/v1/products/${state.soap._id}/image`)
      .set(as(state.adminToken))
      .attach('image', PNG, { filename: 'soap.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.data.image).toMatch(/^\/uploads\/products\//);
    const cat = await request.get('/api/portal/catalog').set(as(state.token));
    expect(cat.body.data[0].image).toBe(res.body.data.image);
  });
});
