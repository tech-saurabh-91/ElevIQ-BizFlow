import { boot, shutdown, clearDb } from './helpers.js';

let app;
let request;
let mongoose;

let Company;
let Setting;
let User;
let Customer;
let Product;
let PriceList;
let Order;
let runWithContext;

const state = {};
const PASSWORD = 'Order#Pass123';

const as = (token) => ({ Authorization: `Bearer ${token}` });

const login = async (identifier, password = PASSWORD) => {
  const res = await request.post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${identifier} (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
};

const inTenant = (companyId, fn) => runWithContext({ scope: 'company', companyId }, fn);

const seedTenant = async ({ code, businessName, adminEmail, managerEmail, salesmanEmail }) => {
  const company = await Company.create({
    code,
    slug: code.toLowerCase(),
    businessName,
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    userLimit: 20,
    limits: { maxUsers: 20, maxCustomers: 500, maxInvoicesPerMonth: 1000 },
  });

  let admin;
  let manager;
  let salesman;

  await inTenant(String(company._id), async () => {
    // Working-day (attendance) gate is covered in fieldDay.test.js.
    const daySettings = await Setting.forCompany(company._id);
    daySettings.set({ 'fieldForce.requireAttendance': false });
    await daySettings.save();

    admin = await User.create({
      companyId: company._id,
      name: `${businessName} Admin`,
      email: adminEmail,
      password: PASSWORD,
      role: 'COMPANY_ADMIN',
      isActive: true,
    });
    manager = await User.create({
      companyId: company._id,
      name: `${businessName} Manager`,
      email: managerEmail,
      password: PASSWORD,
      role: 'MANAGER',
      isActive: true,
      title: 'Sales Manager',
    });
    salesman = await User.create({
      companyId: company._id,
      name: `${businessName} Salesman`,
      email: salesmanEmail,
      password: PASSWORD,
      role: 'SALESMAN',
      isActive: true,
      reportingManager: manager._id,
      territory: 'Pune East',
    });
    await User.updateOne({ _id: manager._id }, { $set: { teamMembers: [salesman._id] } });
  });

  await Company.updateOne({ _id: company._id }, { $set: { adminUser: admin._id } }).skipTenant();

  return { company, admin, manager, salesman };
};

const updateSettings = (patch) =>
  inTenant(state.companyId, () => Setting.updateOne({}, { $set: patch }));

const resetOrderRules = () =>
  updateSettings({
    'order.approvalThreshold': 0,
    'order.creditLimitAction': 'WARN',
    'order.allowNegativeStock': false,
    'order.showStockOnOrder': true,
    'invoice.rounding': 'NEAREST',
    'tax.taxInclusive': false,
    'tax.enableCgstSgst': true,
  });

const createOrder = (payload, token = state.adminToken) =>
  request.post('/api/v1/orders').set(as(token)).send(payload);

const item = (sku, qty, extra = {}) => ({
  product: state.products[sku].id,
  qty,
  ...extra,
});

beforeAll(async () => {
  ({ app, mongoose } = await boot());
  const st = (await import('supertest')).default;
  request = st(app);

  ({ default: Company } = await import('../src/models/Company.js'));
  ({ default: Setting } = await import('../src/models/Setting.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ default: Customer } = await import('../src/models/Customer.js'));
  ({ default: Product } = await import('../src/models/Product.js'));
  ({ default: PriceList } = await import('../src/models/PriceList.js'));
  ({ default: Order } = await import('../src/models/Order.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));

  await clearDb();
  await Promise.all([
    Company.init(),
    User.init(),
    Customer.init(),
    Product.init(),
    PriceList.init(),
    Order.init(),
  ]);

  const primary = await seedTenant({
    code: 'P4A',
    businessName: 'Phase 4 Traders',
    adminEmail: 'admin@phase4.test',
    managerEmail: 'manager@phase4.test',
    salesmanEmail: 'salesman@phase4.test',
  });
  state.company = primary.company;
  state.companyId = String(primary.company._id);
  state.admin = primary.admin;
  state.manager = primary.manager;
  state.salesman = primary.salesman;

  const other = await seedTenant({
    code: 'P4B',
    businessName: 'Other Tenant Co',
    adminEmail: 'admin@otherp4.test',
    managerEmail: 'manager@otherp4.test',
    salesmanEmail: 'salesman@otherp4.test',
  });
  state.otherCompany = other.company;
  state.otherCompanyId = String(other.company._id);

  // Master fixtures inside the primary tenant.
  await inTenant(state.companyId, async () => {
    const products = await Product.create([
      {
        name: 'Alpha Soap',
        sku: 'ALPHA',
        unit: 'PCS',
        gstRate: 18,
        sellingPrice: 100,
        stock: 10,
        lowStockLevel: 2,
        isActive: true,
      },
      {
        name: 'Beta Oil',
        sku: 'BETA',
        unit: 'BTL',
        gstRate: 12,
        sellingPrice: 50,
        stock: 100,
        lowStockLevel: 5,
        isActive: true,
      },
      {
        name: 'Gamma Pack',
        sku: 'GAMMA',
        unit: 'BOX',
        gstRate: 18,
        sellingPrice: 1000,
        stock: 500,
        lowStockLevel: 10,
        isActive: true,
      },
      {
        name: 'Retired Item',
        sku: 'OLD',
        unit: 'PCS',
        gstRate: 18,
        sellingPrice: 20,
        stock: 5,
        isActive: false,
      },
    ]);

    const priceList = await PriceList.create({
      code: 'PL-ORDER',
      name: 'Order Pricing',
      type: 'RETAIL',
      isDefault: true,
      isActive: true,
      items: [
        { product: products[0]._id, price: 90, discountPercent: 0, minQty: 1 },
        { product: products[1]._id, price: 45, discountPercent: 0, minQty: 5 },
        { product: products[2]._id, price: 900, discountPercent: 0, minQty: 1 },
      ],
    });

    const customer = await Customer.create({
      code: 'CUS-1001',
      name: 'Alpha Retail',
      type: 'RETAIL',
      phone: '+919820011001',
      gstin: '27AAAC1234A1Z5',
      creditLimit: 10000,
      creditDays: 15,
      paymentTerms: 'NET_15',
      outstanding: 0,
      priceList: priceList._id,
      assignedTo: state.salesman._id,
      address: { line1: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      isActive: true,
    });

    const creditCustomer = await Customer.create({
      code: 'CUS-1002',
      name: 'Tight Credit Store',
      type: 'RETAIL',
      phone: '+919820011002',
      creditLimit: 500,
      outstanding: 0,
      priceList: priceList._id,
      assignedTo: state.salesman._id,
      isActive: true,
    });

    // A salesman outside the manager's team, used for data-scope tests.
    const outsider = await User.create({
      companyId: state.company._id,
      name: 'Outsider Salesman',
      email: 'outsider@phase4.test',
      password: PASSWORD,
      role: 'SALESMAN',
      isActive: true,
    });

    const outsiderCustomer = await Customer.create({
      code: 'CUS-1003',
      name: 'Outsider Outlet',
      type: 'RETAIL',
      phone: '+919820011003',
      creditLimit: 50000,
      outstanding: 0,
      priceList: priceList._id,
      assignedTo: outsider._id,
      isActive: true,
    });

    state.products = Object.fromEntries(
      products.map((p) => [p.sku, { id: String(p._id), name: p.name }])
    );
    state.priceListId = String(priceList._id);
    state.customerId = String(customer._id);
    state.creditCustomerId = String(creditCustomer._id);
    state.outsiderId = String(outsider._id);
    state.outsiderCustomerId = String(outsiderCustomer._id);
  });

  await resetOrderRules();

  state.adminToken = await login('admin@phase4.test');
  state.managerToken = await login('manager@phase4.test');
  state.salesmanToken = await login('salesman@phase4.test');
  state.outsiderToken = await login('outsider@phase4.test');
  state.otherAdminToken = await login('admin@otherp4.test');
});

afterAll(async () => {
  await shutdown();
});

describe('Phase 4 - order creation & pricing', () => {
  test('rejects unauthenticated and cross-tenant access', async () => {
    const unauth = await request.get('/api/v1/orders');
    expect(unauth.status).toBe(401);

    const other = await request.get('/api/v1/orders').set(as(state.otherAdminToken));
    expect(other.status).toBe(200);
    expect(other.body.data).toHaveLength(0);
  });

  test('creates a draft order with server-computed discounts, tax and rounding', async () => {
    const res = await createOrder({
      customerId: state.customerId,
      items: [item('ALPHA', 10, { discountPercent: 10 }), item('BETA', 5)],
      poReference: 'PO-1001',
      notes: 'First test order',
    });

    expect(res.status).toBe(201);
    const order = res.body.data;
    expect(order.id).toBeTruthy();
    expect(order.orderNo).toMatch(/^SO-\d{4}-\d{6}$/);
    expect(order.status).toBe('DRAFT');

    // ALPHA: 10 × 90 = 900, 10% disc = 90 → 810 + 18% tax 145.80 = 955.80
    // BETA :  5 × 45 = 225, no disc        → 225 + 12% tax  27.00 = 252.00
    expect(order.subtotal).toBe(1125);
    expect(order.discountTotal).toBe(90);
    expect(order.taxableTotal).toBe(1035);
    expect(order.taxTotal).toBe(172.8);
    expect(order.taxBreakup.cgst).toBe(86.4);
    expect(order.taxBreakup.sgst).toBe(86.4);
    expect(order.total).toBe(1208);
    expect(order.roundOff).toBe(0.2);
    expect(order.itemCount).toBe(15);
    expect(order.customerName).toBe('Alpha Retail');

    state.draftOrderId = order.id;

    const got = await request.get(`/api/v1/orders/${order.id}`).set(as(state.adminToken));
    expect(got.status).toBe(200);
    expect(got.body.data.items).toHaveLength(2);
    expect(got.body.data.items[0].unitPrice).toBe(90);
    expect(got.body.data.customer.name).toBe('Alpha Retail');
  });

  test('lists orders with search, status filter and pagination', async () => {
    const all = await request.get('/api/v1/orders').set(as(state.adminToken));
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(1);

    const search = await request
      .get('/api/v1/orders?search=PO-1001')
      .set(as(state.adminToken));
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);

    const draft = await request.get('/api/v1/orders?status=DRAFT').set(as(state.adminToken));
    expect(draft.status).toBe(200);
    expect(draft.body.data.every((o) => o.status === 'DRAFT')).toBe(true);

    const bad = await request.get('/api/v1/orders?status=NOPE').set(as(state.adminToken));
    expect(bad.status).toBe(422);
  });

  test('returns customer-aware form options with price-list pricing', async () => {
    const res = await request
      .get(`/api/v1/orders/form-options?customerId=${state.customerId}`)
      .set(as(state.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data.customer.name).toBe('Alpha Retail');
    expect(res.body.data.customer.creditLimit).toBe(10000);
    expect(res.body.data.priceList.id).toBe(state.priceListId);
    expect(res.body.data.priceList.items.length).toBe(3);
    expect(res.body.data.products.every((p) => p.id && p.name)).toBe(true);
    expect(res.body.data.settings.order.creditLimitAction).toBe('WARN');
  });
});

describe('Phase 4 - validation and business rules', () => {
  test('rejects invalid quantities, inactive products and bad references', async () => {
    const zero = await createOrder({
      customerId: state.customerId,
      items: [item('ALPHA', 0)],
    });
    expect(zero.status).toBe(422);

    const inactive = await createOrder({
      customerId: state.customerId,
      items: [item('OLD', 1)],
    });
    expect(inactive.status).toBe(400);
    expect(inactive.body.code).toBe('INACTIVE_PRODUCT');

    const badCustomer = await createOrder({
      customerId: new mongoose.Types.ObjectId().toString(),
      items: [item('ALPHA', 1)],
    });
    expect(badCustomer.status).toBe(400);
    expect(badCustomer.body.code).toBe('INVALID_REFERENCE');
  });

  test('blocks orders that exceed available stock', async () => {
    const res = await createOrder({
      customerId: state.customerId,
      items: [item('ALPHA', 20)],
    });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.errors?.[0]?.message).toMatch(/only 10/);
  });

  test('warns (and can block) when the credit limit would be exceeded', async () => {
    await request
      .patch(`/api/v1/customers/${state.creditCustomerId}`)
      .set(as(state.adminToken))
      .send({ creditLimit: 500 });

    const warn = await createOrder({
      customerId: state.creditCustomerId,
      items: [item('GAMMA', 2)],
    });
    expect(warn.status).toBe(201);
    expect(warn.body.meta.warnings.join(' ')).toMatch(/Credit limit exceeded/i);

    await updateSettings({ 'order.creditLimitAction': 'BLOCK' });
    const block = await createOrder({
      customerId: state.creditCustomerId,
      items: [item('GAMMA', 2)],
    });
    expect(block.status).toBe(422);
    expect(block.body.code).toBe('CREDIT_LIMIT_EXCEEDED');

    await updateSettings({ 'order.creditLimitAction': 'WARN' });
    await request
      .patch(`/api/v1/customers/${state.creditCustomerId}`)
      .set(as(state.adminToken))
      .send({ creditLimit: 50000 });
  });

  test('routes high-value orders to approval and lets a manager approve once', async () => {
    await updateSettings({ 'order.approvalThreshold': 1000 });

    const created = await createOrder({
      customerId: state.customerId,
      items: [item('GAMMA', 1)],
      submit: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('PENDING_APPROVAL');
    expect(created.body.data.approvalRequired).toBe(true);

    const before = await request
      .get(`/api/v1/customers/${state.customerId}`)
      .set(as(state.adminToken));
    const beforeCount = before.body.data.totalOrders;

    const approved = await request
      .post(`/api/v1/orders/${created.body.data.id}/approve`)
      .set(as(state.managerToken))
      .send({ note: 'Looks fine' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('CONFIRMED');
    expect(approved.body.data.approvedBy?.name).toMatch(/Manager/);
    expect(approved.body.data.approvalRequired).toBe(false);

    const after = await request
      .get(`/api/v1/customers/${state.customerId}`)
      .set(as(state.adminToken));
    expect(after.body.data.totalOrders).toBe(beforeCount + 1);

    const again = await request
      .post(`/api/v1/orders/${created.body.data.id}/approve`)
      .set(as(state.managerToken))
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVALID_STATUS_TRANSITION');
  });

  test('rejects a pending order with a required reason', async () => {
    const created = await createOrder({
      customerId: state.customerId,
      items: [item('GAMMA', 2)],
      submit: true,
    });
    expect(created.body.data.status).toBe('PENDING_APPROVAL');

    const noReason = await request
      .post(`/api/v1/orders/${created.body.data.id}/reject`)
      .set(as(state.managerToken))
      .send({});
    expect(noReason.status).toBe(422);

    const rejected = await request
      .post(`/api/v1/orders/${created.body.data.id}/reject`)
      .set(as(state.managerToken))
      .send({ reason: 'Credit exposure too high this month' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(rejected.body.data.rejectionReason).toMatch(/Credit exposure/);

    const approveRejected = await request
      .post(`/api/v1/orders/${created.body.data.id}/approve`)
      .set(as(state.managerToken))
      .send({});
    expect(approveRejected.status).toBe(409);
  });

  test('auto-confirms below the approval threshold', async () => {
    await updateSettings({ 'order.approvalThreshold': 5000 });

    const res = await createOrder({
      customerId: state.customerId,
      items: [item('GAMMA', 1)],
      submit: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('CONFIRMED');
    expect(res.body.data.approvalRequired).toBe(false);
    expect(res.body.data.statusHistory.length).toBeGreaterThanOrEqual(2);
  });

  test('runs the dispatch → deliver state machine', async () => {
    await updateSettings({ 'order.approvalThreshold': 0 });

    const created = await createOrder({
      customerId: state.customerId,
      items: [item('ALPHA', 2)],
      submit: true,
    });
    expect(created.body.data.status).toBe('CONFIRMED');
    const id = created.body.data.id;

    const dispatched = await request
      .post(`/api/v1/orders/${id}/dispatch`)
      .set(as(state.adminToken))
      .send({ note: 'Handed to courier' });
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.data.status).toBe('DISPATCHED');
    expect(dispatched.body.data.dispatchedAt).toBeTruthy();

    const delivered = await request
      .post(`/api/v1/orders/${id}/deliver`)
      .set(as(state.adminToken))
      .send({});
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.status).toBe('DELIVERED');
    expect(delivered.body.data.deliveredAt).toBeTruthy();

    const cancelled = await request
      .post(`/api/v1/orders/${id}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Too late' });
    expect(cancelled.status).toBe(409);
  });

  test('cancels a confirmed order and reverses the customer counters', async () => {
    const created = await createOrder({
      customerId: state.customerId,
      items: [item('GAMMA', 1)],
      submit: true,
    });
    expect(created.body.data.status).toBe('CONFIRMED');

    const before = await request
      .get(`/api/v1/customers/${state.customerId}`)
      .set(as(state.adminToken));

    const cancelled = await request
      .post(`/api/v1/orders/${created.body.data.id}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Customer changed their mind' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.cancelReason).toMatch(/changed their mind/);

    const after = await request
      .get(`/api/v1/customers/${state.customerId}`)
      .set(as(state.adminToken));
    expect(after.body.data.totalOrders).toBe(before.body.data.totalOrders - 1);
  });

  test('rejects an invalid direct approval of a draft', async () => {
    const draft = await createOrder({
      customerId: state.customerId,
      items: [item('ALPHA', 1)],
    });
    expect(draft.body.data.status).toBe('DRAFT');

    const approve = await request
      .post(`/api/v1/orders/${draft.body.data.id}/approve`)
      .set(as(state.adminToken))
      .send({});
    expect(approve.status).toBe(409);
  });
});

describe('Phase 4 - draft editing rules', () => {
  test('allows editing and recomputing a draft', async () => {
    const created = await createOrder({
      customerId: state.customerId,
      items: [item('GAMMA', 1)],
    });
    expect(created.body.data.total).toBe(1062);

    const patched = await request
      .patch(`/api/v1/orders/${created.body.data.id}`)
      .set(as(state.adminToken))
      .send({ items: [item('GAMMA', 2)], notes: 'Doubled the quantity' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.total).toBe(2124);
    expect(patched.body.data.notes).toBe('Doubled the quantity');
    expect(patched.body.data.items[0].qty).toBe(2);

    state.editableOrderId = created.body.data.id;
  });

  test('locks non-draft orders and only deletes drafts', async () => {
    const submitted = await request
      .post(`/api/v1/orders/${state.editableOrderId}/submit`)
      .set(as(state.adminToken))
      .send({});
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('CONFIRMED');

    const patch = await request
      .patch(`/api/v1/orders/${state.editableOrderId}`)
      .set(as(state.adminToken))
      .send({ notes: 'Should fail' });
    expect(patch.status).toBe(409);
    expect(patch.body.code).toBe('ORDER_LOCKED');

    const del = await request
      .delete(`/api/v1/orders/${state.editableOrderId}`)
      .set(as(state.adminToken));
    expect(del.status).toBe(409);

    const draft = await createOrder({
      customerId: state.customerId,
      items: [item('ALPHA', 1)],
    });
    const deleted = await request
      .delete(`/api/v1/orders/${draft.body.data.id}`)
      .set(as(state.adminToken));
    expect(deleted.status).toBe(200);

    const gone = await request
      .get(`/api/v1/orders/${draft.body.data.id}`)
      .set(as(state.adminToken));
    expect(gone.status).toBe(404);
  });
});

describe('Phase 4 - data scope and tenant isolation', () => {
  test('salesmen only see their own orders; managers see their team; admins see all', async () => {
    const created = await createOrder(
      {
        customerId: state.outsiderCustomerId,
        items: [item('GAMMA', 1)],
      },
      state.outsiderToken
    );
    expect(created.status).toBe(201);
    expect(created.body.data.salesman.id).toBe(state.outsiderId);
    state.outsiderOrderId = created.body.data.id;

    const own = await request.get('/api/v1/orders').set(as(state.outsiderToken));
    expect(own.body.data.some((o) => o.id === state.outsiderOrderId)).toBe(true);

    const salesman = await request.get('/api/v1/orders?limit=200').set(as(state.salesmanToken));
    expect(salesman.body.data.some((o) => o.id === state.outsiderOrderId)).toBe(false);
    expect(salesman.body.data.every((o) => o.salesman?.id === String(state.salesman._id))).toBe(
      true
    );

    const manager = await request.get('/api/v1/orders?limit=200').set(as(state.managerToken));
    expect(manager.body.data.some((o) => o.id === state.outsiderOrderId)).toBe(false);

    const admin = await request.get('/api/v1/orders?limit=200').set(as(state.adminToken));
    expect(admin.body.data.some((o) => o.id === state.outsiderOrderId)).toBe(true);

    const direct = await request
      .get(`/api/v1/orders/${state.outsiderOrderId}`)
      .set(as(state.salesmanToken));
    expect(direct.status).toBe(404);
  });

  test('another tenant cannot read the order by id', async () => {
    const res = await request
      .get(`/api/v1/orders/${state.outsiderOrderId}`)
      .set(as(state.otherAdminToken));
    expect(res.status).toBe(404);
  });
});

describe('Phase 4 - stats, export and print', () => {
  test('returns workspace order stats', async () => {
    const res = await request.get('/api/v1/orders/stats').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThan(0);
    expect(res.body.data.byStatus.CONFIRMED).toBeGreaterThan(0);
    expect(res.body.data).toHaveProperty('pendingApprovals');
    expect(res.body.data).toHaveProperty('today');
    expect(res.body.data).toHaveProperty('month');
  });

  test('exports the order register to Excel', async () => {
    const res = await request
      .get('/api/v1/orders/export')
      .set(as(state.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.body.slice(0, 2).toString()).toBe('PK');
  });

  test('renders a printable PDF for an order', async () => {
    const res = await request
      .get(`/api/v1/orders/${state.draftOrderId}/pdf`)
      .set(as(state.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('enforces export permission for salesmen', async () => {
    const res = await request.get('/api/v1/orders/export').set(as(state.salesmanToken));
    expect(res.status).toBe(403);
  });
});
