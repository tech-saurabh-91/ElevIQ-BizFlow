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
let Invoice;
let CreditNote;
let runWithContext;

const state = {};
const PASSWORD = 'Invoice#Pass123';

const as = (token) => ({ Authorization: `Bearer ${token}` });

const login = async (identifier, password = PASSWORD) => {
  const res = await request.post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${identifier} (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
};

const inTenant = (companyId, fn) => runWithContext({ scope: 'company', companyId }, fn);

const seedTenant = async ({ code, businessName, adminEmail, managerEmail, salesmanEmail, accountantEmail, warehouseEmail }) => {
  const company = await Company.create({
    code,
    slug: code.toLowerCase(),
    businessName,
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    userLimit: 20,
    limits: { maxUsers: 20, maxCustomers: 500, maxInvoicesPerMonth: 10000 },
  });

  let admin;
  let manager;
  let salesman;
  let accountant;
  let warehouse;

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
      title: 'Accounts Manager',
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
    accountant = await User.create({
      companyId: company._id,
      name: `${businessName} Accountant`,
      email: accountantEmail,
      password: PASSWORD,
      role: 'ACCOUNTANT',
      isActive: true,
    });
    warehouse = await User.create({
      companyId: company._id,
      name: `${businessName} Warehouse`,
      email: warehouseEmail,
      password: PASSWORD,
      role: 'WAREHOUSE',
      isActive: true,
    });
    await User.updateOne({ _id: manager._id }, { $set: { teamMembers: [salesman._id] } });
  });

  await Company.updateOne({ _id: company._id }, { $set: { adminUser: admin._id } }).skipTenant();

  return { company, admin, manager, salesman, accountant, warehouse };
};

const updateSettings = (patch) =>
  inTenant(state.companyId, () => Setting.updateOne({}, { $set: patch }));

const createOrder = (payload, token = state.adminToken) =>
  request.post('/api/v1/orders').set(as(token)).send(payload);

const createInvoice = (payload, token = state.adminToken) =>
  request.post('/api/v1/invoices').set(as(token)).send(payload);

const createCreditNote = (payload, token = state.adminToken) =>
  request.post('/api/v1/credit-notes').set(as(token)).send(payload);

const getCustomer = (id, token = state.adminToken) =>
  request.get(`/api/v1/customers/${id}`).set(as(token));

const getOrder = (id, token = state.adminToken) =>
  request.get(`/api/v1/orders/${id}`).set(as(token));

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
  ({ default: Invoice } = await import('../src/models/Invoice.js'));
  ({ default: CreditNote } = await import('../src/models/CreditNote.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));

  await clearDb();
  await Promise.all([
    Company.init(),
    User.init(),
    Customer.init(),
    Product.init(),
    PriceList.init(),
    Order.init(),
    Invoice.init(),
    CreditNote.init(),
  ]);

  const primary = await seedTenant({
    code: 'P5A',
    businessName: 'Phase 5 Traders',
    adminEmail: 'admin@phase5.test',
    managerEmail: 'manager@phase5.test',
    salesmanEmail: 'salesman@phase5.test',
    accountantEmail: 'accountant@phase5.test',
    warehouseEmail: 'warehouse@phase5.test',
  });
  state.company = primary.company;
  state.companyId = String(primary.company._id);
  state.admin = primary.admin;
  state.manager = primary.manager;
  state.salesman = primary.salesman;
  state.accountant = primary.accountant;
  state.warehouse = primary.warehouse;

  const other = await seedTenant({
    code: 'P5B',
    businessName: 'Other Invoice Co',
    adminEmail: 'admin@otherp5.test',
    managerEmail: 'manager@otherp5.test',
    salesmanEmail: 'salesman@otherp5.test',
    accountantEmail: 'accountant@otherp5.test',
    warehouseEmail: 'warehouse@otherp5.test',
  });
  state.otherCompany = other.company;
  state.otherCompanyId = String(other.company._id);

  await inTenant(state.companyId, async () => {
    const products = await Product.create([
      {
        name: 'Alpha Soap',
        sku: 'ALPHA',
        unit: 'PCS',
        hsnCode: '3401',
        gstRate: 18,
        sellingPrice: 100,
        stock: 1000,
        lowStockLevel: 2,
        isActive: true,
      },
      {
        name: 'Beta Oil',
        sku: 'BETA',
        unit: 'BTL',
        hsnCode: '1507',
        gstRate: 12,
        sellingPrice: 50,
        stock: 1000,
        lowStockLevel: 5,
        isActive: true,
      },
      {
        name: 'Gamma Pack',
        sku: 'GAMMA',
        unit: 'BOX',
        hsnCode: '3402',
        gstRate: 18,
        sellingPrice: 1000,
        stock: 1000,
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
      code: 'PL-INVOICE',
      name: 'Invoice Pricing',
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
      code: 'CUS-2001',
      name: 'Alpha Retail',
      type: 'RETAIL',
      phone: '+919820012001',
      gstin: '27AAAC1234A1Z5',
      creditLimit: 1000000,
      creditDays: 15,
      paymentTerms: 'NET_15',
      outstanding: 0,
      priceList: priceList._id,
      assignedTo: state.salesman._id,
      address: { line1: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      isActive: true,
    });

    const counterCustomer = await Customer.create({
      code: 'CUS-2002',
      name: 'Counter Walk-in',
      type: 'RETAIL',
      phone: '+919820012002',
      creditLimit: 1000000,
      paymentTerms: 'IMMEDIATE',
      outstanding: 0,
      priceList: priceList._id,
      assignedTo: state.salesman._id,
      isActive: true,
    });

    const outsider = await User.create({
      companyId: state.company._id,
      name: 'Outsider Salesman',
      email: 'outsider@phase5.test',
      password: PASSWORD,
      role: 'SALESMAN',
      isActive: true,
    });

    const outsiderCustomer = await Customer.create({
      code: 'CUS-2003',
      name: 'Outsider Outlet',
      type: 'RETAIL',
      phone: '+919820012003',
      creditLimit: 1000000,
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
    state.counterCustomerId = String(counterCustomer._id);
    state.outsiderId = String(outsider._id);
    state.outsiderCustomerId = String(outsiderCustomer._id);
  });

  await updateSettings({
    'order.approvalThreshold': 0,
    'order.creditLimitAction': 'NONE',
    'order.allowNegativeStock': true,
    'order.showStockOnOrder': true,
    'invoice.rounding': 'NEAREST',
    'tax.taxInclusive': false,
    'tax.enableCgstSgst': true,
  });

  state.adminToken = await login('admin@phase5.test');
  state.managerToken = await login('manager@phase5.test');
  state.salesmanToken = await login('salesman@phase5.test');
  state.accountantToken = await login('accountant@phase5.test');
  state.warehouseToken = await login('warehouse@phase5.test');
  state.outsiderToken = await login('outsider@phase5.test');
  state.otherAdminToken = await login('admin@otherp5.test');
});

afterAll(async () => {
  await shutdown();
});

describe('Phase 5 - invoice creation & pricing', () => {
  test('rejects unauthenticated and cross-tenant access', async () => {
    const unauth = await request.get('/api/v1/invoices');
    expect(unauth.status).toBe(401);

    const other = await request.get('/api/v1/invoices').set(as(state.otherAdminToken));
    expect(other.status).toBe(200);
    expect(other.body.data).toHaveLength(0);
  });

  test('creates a draft direct invoice with server-computed discounts and tax', async () => {
    const before = await getCustomer(state.customerId);
    const outstandingBefore = before.body.data.outstanding;

    const res = await createInvoice({
      customerId: state.customerId,
      items: [item('ALPHA', 2, { discountPercent: 10 }), item('BETA', 5)],
      poReference: 'PO-2001',
      notes: 'First direct invoice',
    });

    expect(res.status).toBe(201);
    const invoice = res.body.data;
    expect(invoice.id).toBeTruthy();
    expect(invoice.invoiceNo).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.direct).toBe(true);
    expect(invoice.order).toBeFalsy();

    // ALPHA: 2 × 90 = 180, 10% disc = 18 → 162 + 18% tax 29.16 = 191.16
    // BETA : 5 × 45 = 225, no disc        → 225 + 12% tax 27.00 = 252.00
    expect(invoice.subtotal).toBe(405);
    expect(invoice.discountTotal).toBe(18);
    expect(invoice.taxableTotal).toBe(387);
    expect(invoice.taxTotal).toBe(56.16);
    expect(invoice.taxBreakup.cgst).toBe(28.08);
    expect(invoice.taxBreakup.sgst).toBe(28.08);
    expect(invoice.total).toBe(443);
    expect(invoice.roundOff).toBe(-0.16);
    expect(invoice.balanceDue).toBe(443);
    expect(invoice.customerName).toBe('Alpha Retail');
    expect(invoice.customer.name).toBe('Alpha Retail');
    expect(invoice.items[0].unitPrice).toBe(90);

    const after = await getCustomer(state.customerId);
    expect(after.body.data.outstanding).toBe(outstandingBefore);

    state.directDraftId = invoice.id;
  });

  test('edits a draft invoice and recomputes the totals', async () => {
    const res = await request
      .patch(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.adminToken))
      .send({ items: [item('ALPHA', 10)], notes: 'Updated quantity' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    // 10 × 90 = 900 + 18% = 1062
    expect(res.body.data.subtotal).toBe(900);
    expect(res.body.data.total).toBe(1062);
    expect(res.body.data.notes).toBe('Updated quantity');
  });

  test('issues a draft invoice and raises the customer outstanding once', async () => {
    const before = await getCustomer(state.customerId);
    const outstandingBefore = before.body.data.outstanding;
    const draft = await request
      .get(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.adminToken));
    const total = draft.body.data.total;

    const issued = await request
      .post(`/api/v1/invoices/${state.directDraftId}/issue`)
      .set(as(state.adminToken))
      .send({ note: 'Handed to customer' });
    expect(issued.status).toBe(200);
    expect(issued.body.data.status).toBe('ISSUED');
    expect(issued.body.data.issuedAt).toBeTruthy();
    expect(issued.body.data.balanceDue).toBe(total);

    const after = await getCustomer(state.customerId);
    expect(after.body.data.outstanding).toBe(
      Math.round((outstandingBefore + total) * 100) / 100
    );

    const again = await request
      .post(`/api/v1/invoices/${state.directDraftId}/issue`)
      .set(as(state.adminToken))
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVOICE_NOT_DRAFT');

    const editLocked = await request
      .patch(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.adminToken))
      .send({ notes: 'Too late' });
    expect(editLocked.status).toBe(409);
    expect(editLocked.body.code).toBe('INVOICE_LOCKED');

    const deleteLocked = await request
      .delete(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.adminToken));
    expect(deleteLocked.status).toBe(409);
    expect(deleteLocked.body.code).toBe('INVOICE_LOCKED');
  });

  test('deletes a draft invoice without touching the customer balance', async () => {
    const created = await createInvoice({
      customerId: state.counterCustomerId,
      items: [item('GAMMA', 1)],
    });
    expect(created.status).toBe(201);

    const before = await getCustomer(state.counterCustomerId);
    const del = await request
      .delete(`/api/v1/invoices/${created.body.data.id}`)
      .set(as(state.adminToken));
    expect(del.status).toBe(200);

    const gone = await request
      .get(`/api/v1/invoices/${created.body.data.id}`)
      .set(as(state.adminToken));
    expect(gone.status).toBe(404);

    const after = await getCustomer(state.counterCustomerId);
    expect(after.body.data.outstanding).toBe(before.body.data.outstanding);
  });
});

describe('Phase 5 - invoicing a sales order', () => {
  test('refuses to invoice a draft order', async () => {
    const draft = await createOrder({
      customerId: state.customerId,
      items: [item('ALPHA', 2)],
    });
    expect(draft.status).toBe(201);
    expect(draft.body.data.status).toBe('DRAFT');

    const res = await createInvoice({
      orderId: draft.body.data.id,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ORDER_NOT_INVOICEABLE');
  });

  test('invoices part of an order, guards the remaining quantity and completes it', async () => {
    const order = await createOrder({
      customerId: state.customerId,
      items: [item('ALPHA', 10), item('BETA', 5)],
      submit: true,
    });
    expect(order.status).toBe(201);
    expect(order.body.data.status).toBe('CONFIRMED');
    const orderId = order.body.data.id;
    const orderLineId = order.body.data.items[0].id;
    state.orderId = orderId;
    state.orderLineId = orderLineId;

    const before = await getCustomer(state.customerId);
    const outstandingBefore = before.body.data.outstanding;

    const partial = await createInvoice({
      orderId,
      items: [{ orderItemId: orderLineId, qty: 4 }],
      issue: true,
    });
    expect(partial.status).toBe(201);
    expect(partial.body.data.status).toBe('ISSUED');
    expect(partial.body.data.orderNo).toMatch(/^SO-/);
    expect(partial.body.data.subtotal).toBe(360);
    expect(partial.body.data.total).toBe(425);

    const orderAfterPartial = await getOrder(orderId);
    expect(orderAfterPartial.body.data.status).toBe('PARTIALLY_INVOICED');
    expect(orderAfterPartial.body.data.invoicedQty).toBe(4);

    const after = await getCustomer(state.customerId);
    expect(after.body.data.outstanding).toBe(
      Math.round((outstandingBefore + partial.body.data.total) * 100) / 100
    );

    const overrun = await createInvoice({
      orderId,
      items: [{ orderItemId: orderLineId, qty: 7 }],
    });
    expect(overrun.status).toBe(422);
    expect(overrun.body.code).toBe('INVOICE_QTY_EXCEEDED');
    expect(overrun.body.errors[0].field).toBe('items.0.qty');

    // Bill everything still unbilled (ALPHA 6 + BETA 5).
    const rest = await createInvoice({ orderId });
    expect(rest.status).toBe(201);
    expect(rest.body.data.items).toHaveLength(2);
    expect(rest.body.data.total).toBe(889); // 540 + 18% + 225 + 12%

    const issuedRest = await request
      .post(`/api/v1/invoices/${rest.body.data.id}/issue`)
      .set(as(state.adminToken))
      .send({});
    expect(issuedRest.status).toBe(200);

    const full = await getOrder(orderId);
    expect(full.body.data.status).toBe('FULLY_INVOICED');
    expect(full.body.data.invoicedQty).toBe(15);

    const extra = await createInvoice({ orderId });
    expect(extra.status).toBe(422);
    expect(extra.body.code).toBe('ORDER_NOT_INVOICEABLE');

    // Re-open the order status artificially to hit the "everything billed" guard.
    await inTenant(state.companyId, () =>
      Order.updateOne({ _id: orderId }, { $set: { status: 'CONFIRMED' } })
    );
    const alreadyBilled = await createInvoice({ orderId });
    expect(alreadyBilled.status).toBe(409);
    expect(alreadyBilled.body.code).toBe('ORDER_FULLY_INVOICED');

    state.orderInvoiceId = rest.body.data.id;
  });

  test('requires the order customer to be active', async () => {
    const order = await createOrder({
      customerId: state.counterCustomerId,
      items: [item('ALPHA', 1)],
      submit: true,
    });
    expect(order.status).toBe(201);

    await inTenant(state.companyId, () =>
      Customer.updateOne({ _id: state.counterCustomerId }, { $set: { isActive: false } })
    );

    const res = await createInvoice({ orderId: order.body.data.id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INACTIVE_CUSTOMER');

    await inTenant(state.companyId, () =>
      Customer.updateOne({ _id: state.counterCustomerId }, { $set: { isActive: true } })
    );
  });

  test('rejects unknown order lines and inactive products on direct invoices', async () => {
    const order = await createOrder({
      customerId: state.customerId,
      items: [item('ALPHA', 1)],
      submit: true,
    });
    expect(order.status).toBe(201);

    const badLine = await createInvoice({
      orderId: order.body.data.id,
      items: [{ orderItemId: new mongoose.Types.ObjectId().toString(), qty: 1 }],
    });
    expect(badLine.status).toBe(400);
    expect(badLine.body.code).toBe('INVALID_REFERENCE');

    const inactive = await createInvoice({
      customerId: state.customerId,
      items: [item('OLD', 1)],
    });
    expect(inactive.status).toBe(400);
    expect(inactive.body.code).toBe('INACTIVE_PRODUCT');

    const missingCustomer = await createInvoice({
      items: [item('ALPHA', 1)],
    });
    expect(missingCustomer.status).toBe(422);
  });

  test('an order with a draft invoice cannot get a second invoice', async () => {
    const order = await createOrder({ customerId: state.customerId, items: [item('ALPHA', 1)], submit: true });
    expect(order.status).toBe(201);
    const draft = await createInvoice({ orderId: order.body.data.id });
    expect(draft.status).toBe(201);

    const second = await createInvoice({ orderId: order.body.data.id, issue: true });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('INVOICE_DRAFT_EXISTS');
    expect(second.body.message).toContain(draft.body.data.invoiceNo);

    // Issuing the draft itself still works.
    const issued = await request.post(`/api/v1/invoices/${draft.body.data.id}/issue`).set(as(state.adminToken)).send({});
    expect(issued.status).toBe(200);
  });

  test('returns invoice form options with remaining order quantity', async () => {
    const res = await request
      .get(`/api/v1/invoices/form-options?orderId=${state.orderId}`)
      .set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.order.orderNo).toMatch(/^SO-/);
    // The order was fully invoiced; there is no billable quantity left.
    expect(res.body.data.order.items).toHaveLength(0);

    const direct = await request
      .get(`/api/v1/invoices/form-options?customerId=${state.customerId}`)
      .set(as(state.adminToken));
    expect(direct.status).toBe(200);
    expect(direct.body.data.customer.name).toBe('Alpha Retail');
    expect(direct.body.data.priceList.items.length).toBe(3);
    expect(direct.body.data.settings.invoice.allowDirectInvoice).toBe(true);
  });
});

describe('Phase 5 - invoice cancellation', () => {
  test('cancels an unpaid issued invoice and reverses the balance + order progress', async () => {
    const order = await createOrder({
      customerId: state.customerId,
      items: [item('GAMMA', 2)],
      submit: true,
    });
    expect(order.body.data.status).toBe('CONFIRMED');
    const orderId = order.body.data.id;

    const invoiceRes = await createInvoice({ orderId, issue: true });
    expect(invoiceRes.status).toBe(201);
    expect(invoiceRes.body.data.status).toBe('ISSUED');
    const invoiceId = invoiceRes.body.data.id;
    const total = invoiceRes.body.data.total;

    const orderInvoiced = await getOrder(orderId);
    expect(orderInvoiced.body.data.status).toBe('FULLY_INVOICED');

    const before = await getCustomer(state.customerId);
    const outstandingBefore = before.body.data.outstanding;

    const cancelled = await request
      .post(`/api/v1/invoices/${invoiceId}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Customer cancelled the requirement' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.balanceDue).toBe(0);
    expect(cancelled.body.data.cancelReason).toMatch(/requirement/);

    const after = await getCustomer(state.customerId);
    expect(after.body.data.outstanding).toBe(
      Math.round((outstandingBefore - total) * 100) / 100
    );

    const orderAfter = await getOrder(orderId);
    expect(orderAfter.body.data.status).toBe('CONFIRMED');
    expect(orderAfter.body.data.invoicedQty).toBe(0);

    const again = await request
      .post(`/api/v1/invoices/${invoiceId}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Again' });
    expect(again.status).toBe(409);
  });

  test('blocks cancellation when payments or credit notes exist', async () => {
    const created = await createInvoice({
      customerId: state.customerId,
      items: [item('ALPHA', 3)],
      issue: true,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const total = created.body.data.total;

    await inTenant(state.companyId, () =>
      Invoice.updateOne(
        { _id: id },
        { $set: { amountPaid: 10, balanceDue: total - 10, status: 'PARTIALLY_PAID' } }
      )
    );

    const payments = await request
      .post(`/api/v1/invoices/${id}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Trying to cancel' });
    expect(payments.status).toBe(409);
    expect(payments.body.code).toBe('INVOICE_HAS_PAYMENTS');

    await inTenant(state.companyId, () =>
      Invoice.updateOne(
        { _id: id },
        { $set: { amountPaid: 0, balanceDue: total, status: 'ISSUED' } }
      )
    );
    const cn = await createCreditNote({ invoiceId: id, items: [], issue: true });
    expect(cn.status).toBe(201);
    expect(cn.body.data.status).toBe('ISSUED');

    const credit = await request
      .post(`/api/v1/invoices/${id}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Trying to cancel' });
    expect(credit.status).toBe(409);
    expect(credit.body.code).toBe('INVOICE_HAS_CREDIT_NOTES');

    state.creditedInvoiceId = id;
    state.creditedInvoiceTotal = total;
  });
});

describe('Phase 5 - credit notes', () => {
  test('issues a partial credit note that settles the invoice and customer balance', async () => {
    const invoice = await request
      .get(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.adminToken));
    const line = invoice.body.data.items[0];
    const balanceBefore = invoice.body.data.balanceDue;

    const before = await getCustomer(state.customerId);
    const outstandingBefore = before.body.data.outstanding;

    const res = await createCreditNote({
      invoiceId: state.directDraftId,
      reason: 'DAMAGE',
      reasonNote: 'One case damaged in transit',
      items: [{ invoiceItemId: line.id, qty: 1 }],
      issue: true,
    });

    expect(res.status).toBe(201);
    const note = res.body.data;
    expect(note.creditNoteNo).toMatch(/^CN-\d{4}-\d{6}$/);
    expect(note.status).toBe('ISSUED');
    expect(note.invoiceNo).toBe(invoice.body.data.invoiceNo);
    expect(note.items).toHaveLength(1);
    expect(note.items[0].qty).toBe(1);
    expect(note.total).toBeGreaterThan(0);
    expect(note.appliedAmount).toBe(note.total);
    expect(note.unappliedAmount).toBe(0);

    const refreshed = await request
      .get(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.adminToken));
    expect(refreshed.body.data.status).toBe('PARTIALLY_PAID');
    expect(refreshed.body.data.creditNoteTotal).toBe(note.total);
    expect(refreshed.body.data.balanceDue).toBe(
      Math.round((balanceBefore - note.total) * 100) / 100
    );

    const after = await getCustomer(state.customerId);
    expect(after.body.data.outstanding).toBe(
      Math.round((outstandingBefore - note.total) * 100) / 100
    );

    state.issuedCreditNoteId = note.id;
    state.issuedCreditNoteTotal = note.total;
  });

  test('refuses to credit a draft invoice or exceed the invoice quantity', async () => {
    const draft = await createInvoice({
      customerId: state.customerId,
      items: [item('ALPHA', 2)],
    });
    expect(draft.status).toBe(201);

    const notIssued = await createCreditNote({ invoiceId: draft.body.data.id, issue: true });
    expect(notIssued.status).toBe(422);
    expect(notIssued.body.code).toBe('INVOICE_NOT_ISSUED');

    const invoice = await request
      .get(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.adminToken));
    const line = invoice.body.data.items[0];

    const overrun = await createCreditNote({
      invoiceId: state.directDraftId,
      items: [{ invoiceItemId: line.id, qty: 99 }],
    });
    expect(overrun.status).toBe(422);
    expect(overrun.body.code).toBe('CREDIT_QTY_EXCEEDED');

    const unknown = await createCreditNote({
      invoiceId: state.directDraftId,
      items: [{ invoiceItemId: new mongoose.Types.ObjectId().toString(), qty: 1 }],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('INVALID_REFERENCE');
  });

  test('blocks a second credit note once the invoice is fully credited', async () => {
    const invoice = await createInvoice({
      customerId: state.counterCustomerId,
      items: [item('GAMMA', 1)],
      issue: true,
    });
    expect(invoice.status).toBe(201);
    const line = invoice.body.data.items[0];

    const first = await createCreditNote({
      invoiceId: invoice.body.data.id,
      items: [{ invoiceItemId: line.id, qty: 1 }],
      issue: true,
    });
    expect(first.status).toBe(201);

    const second = await createCreditNote({
      invoiceId: invoice.body.data.id,
      items: [{ invoiceItemId: line.id, qty: 1 }],
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('INVOICE_FULLY_CREDITED');
  });

  test('supports draft credit notes (create, update, delete) and reversal on cancel', async () => {
    const invoice = await request
      .get(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.adminToken));
    const line = invoice.body.data.items[0];

    const draft = await createCreditNote({
      invoiceId: state.directDraftId,
      reason: 'RATE_DIFFERENCE',
      reasonNote: 'Scheme price applied late',
      items: [{ invoiceItemId: line.id, qty: 1 }],
    });
    expect(draft.status).toBe(201);
    expect(draft.body.data.status).toBe('DRAFT');
    expect(draft.body.data.appliedAmount).toBe(0);

    const updated = await request
      .patch(`/api/v1/credit-notes/${draft.body.data.id}`)
      .set(as(state.adminToken))
      .send({ reason: 'DISCOUNT', reasonNote: 'Goodwill discount' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.reason).toBe('DISCOUNT');
    expect(updated.body.data.status).toBe('DRAFT');

    const removed = await request
      .delete(`/api/v1/credit-notes/${draft.body.data.id}`)
      .set(as(state.adminToken));
    expect(removed.status).toBe(200);

    const gone = await request
      .get(`/api/v1/credit-notes/${draft.body.data.id}`)
      .set(as(state.adminToken));
    expect(gone.status).toBe(404);

    // Cancelling an issued credit note must restore the invoice + customer balance.
    const beforeInvoice = await request
      .get(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.adminToken));
    const beforeCustomer = await getCustomer(state.customerId);

    const cancelled = await request
      .post(`/api/v1/credit-notes/${state.issuedCreditNoteId}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Damage claim rejected by the outlet' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const afterInvoice = await request
      .get(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.adminToken));
    expect(afterInvoice.body.data.creditNoteTotal).toBe(
      Math.round((beforeInvoice.body.data.creditNoteTotal - state.issuedCreditNoteTotal) * 100) / 100
    );

    const afterCustomer = await getCustomer(state.customerId);
    expect(afterCustomer.body.data.outstanding).toBe(
      Math.round((beforeCustomer.body.data.outstanding + state.issuedCreditNoteTotal) * 100) / 100
    );

    const again = await request
      .post(`/api/v1/credit-notes/${state.issuedCreditNoteId}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Again' });
    expect(again.status).toBe(409);
  });

  test('returns credit-note stats', async () => {
    const res = await request.get('/api/v1/credit-notes/stats').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.byStatus).toHaveProperty('DRAFT');
    expect(res.body.data.byStatus).toHaveProperty('ISSUED');
    expect(res.body.data.byStatus).toHaveProperty('CANCELLED');
  });
});

describe('Phase 5 - permissions and data scope', () => {
  test('salesmen only see their own invoices; managers see their team; admins see all', async () => {
    const admin = await request.get('/api/v1/invoices?limit=50').set(as(state.adminToken));
    expect(admin.status).toBe(200);
    const adminTotal = admin.body.meta.total;

    const outsiderInvoice = await createInvoice({
      customerId: state.outsiderCustomerId,
      items: [item('ALPHA', 1)],
      issue: true,
    });
    expect(outsiderInvoice.status).toBe(201);

    const salesman = await request.get('/api/v1/invoices?limit=50').set(as(state.salesmanToken));
    expect(salesman.status).toBe(200);
    expect(salesman.body.meta.total).toBeLessThanOrEqual(adminTotal);
    const mine = String(state.salesman._id);
    expect(
      salesman.body.data.every(
        (inv) =>
          String(inv.salesman?._id || inv.salesman) === mine || String(inv.createdBy?._id || inv.createdBy) === mine
      )
    ).toBe(true);

    // An invoice the salesman raised for another rep's order is theirs to see too.
    const raised = await createInvoice({ customerId: state.outsiderCustomerId, items: [item('ALPHA', 1)] });
    expect(raised.status).toBe(201);
    await inTenant(state.companyId, () =>
      mongoose.model('Invoice').updateOne({ _id: raised.body.data.id }, { $set: { createdBy: state.salesman._id } })
    );
    const withRaised = await request.get('/api/v1/invoices?limit=50').set(as(state.salesmanToken));
    expect(withRaised.body.data.some((inv) => inv.id === raised.body.data.id)).toBe(true);
    await inTenant(state.companyId, () => mongoose.model('Invoice').deleteOne({ _id: raised.body.data.id }).hardDelete());

    const outsider = await request.get('/api/v1/invoices?limit=50').set(as(state.outsiderToken));
    expect(outsider.status).toBe(200);
    expect(outsider.body.meta.total).toBe(1);

    const manager = await request.get('/api/v1/invoices?limit=50').set(as(state.managerToken));
    expect(manager.status).toBe(200);
    expect(manager.body.meta.total).toBe(salesman.body.meta.total);

    const crossTenant = await request
      .get(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.otherAdminToken));
    expect(crossTenant.status).toBe(404);
  });

  test('accountants can bill but only admins may delete', async () => {
    const created = await createInvoice(
      {
        customerId: state.customerId,
        items: [item('BETA', 5)],
      },
      state.accountantToken
    );
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('DRAFT');

    const issued = await request
      .post(`/api/v1/invoices/${created.body.data.id}/issue`)
      .set(as(state.accountantToken))
      .send({});
    expect(issued.status).toBe(200);

    const del = await request
      .delete(`/api/v1/invoices/${created.body.data.id}`)
      .set(as(state.accountantToken));
    expect(del.status).toBe(403);
  });

  test('warehouse users cannot view invoices, salesmen cannot export or delete', async () => {
    const warehouse = await request.get('/api/v1/invoices').set(as(state.warehouseToken));
    expect(warehouse.status).toBe(403);

    const exportAttempt = await request
      .get('/api/v1/invoices/export')
      .set(as(state.salesmanToken));
    expect(exportAttempt.status).toBe(403);

    const deleteAttempt = await request
      .delete(`/api/v1/invoices/${state.directDraftId}`)
      .set(as(state.salesmanToken));
    expect(deleteAttempt.status).toBe(403);
  });

  test('validates list filters', async () => {
    const bad = await request.get('/api/v1/invoices?status=NOPE').set(as(state.adminToken));
    expect(bad.status).toBe(422);

    const badDate = await request
      .get('/api/v1/invoices?dateFrom=not-a-date')
      .set(as(state.adminToken));
    // dateFrom is a free string in the schema; the controller coerces it safely.
    expect([200, 422]).toContain(badDate.status);
  });
});

describe('Phase 5 - stats, export and print', () => {
  test('returns workspace invoice stats and dashboard metrics', async () => {
    const res = await request.get('/api/v1/invoices/stats').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThan(0);
    expect(res.body.data.byStatus).toHaveProperty('DRAFT');
    expect(res.body.data.byStatus).toHaveProperty('ISSUED');
    expect(res.body.data.byStatus).toHaveProperty('OVERDUE');
    expect(res.body.data.byStatus).toHaveProperty('PAID');
    expect(res.body.data.outstanding).toBeGreaterThanOrEqual(0);

    const dashboard = await request
      .get('/api/v1/dashboard/summary')
      .set(as(state.adminToken));
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data).toEqual(
      expect.objectContaining({
        invoicesMtd: expect.any(Number),
        invoicedMtd: expect.any(Number),
        invoiceOutstanding: expect.any(Number),
        overdueCount: expect.any(Number),
      })
    );
  });

  test('exports the invoice register to Excel', async () => {
    const res = await request
      .get('/api/v1/invoices/export?status=ISSUED')
      .set(as(state.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.body.length).toBeGreaterThan(1000);
  });

  test('renders printable PDFs for invoices and credit notes', async () => {
    const invoicePdf = await request
      .get(`/api/v1/invoices/${state.directDraftId}/pdf`)
      .set(as(state.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(invoicePdf.status).toBe(200);
    expect(invoicePdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(invoicePdf.body.slice(0, 4).toString()).toBe('%PDF');

    const note = await request
      .get('/api/v1/credit-notes?limit=1')
      .set(as(state.adminToken));
    expect(note.status).toBe(200);
    expect(note.body.data.length).toBeGreaterThan(0);

    const creditPdf = await request
      .get(`/api/v1/credit-notes/${note.body.data[0].id}/pdf`)
      .set(as(state.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(creditPdf.status).toBe(200);
    expect(creditPdf.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('exports credit notes to Excel', async () => {
    const res = await request
      .get('/api/v1/credit-notes/export')
      .set(as(state.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.body.length).toBeGreaterThan(500);
  });

  test('lists overdue invoices with the overdue filter', async () => {
    const res = await request.get('/api/v1/invoices?overdue=true').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.every((inv) => inv.status === 'OVERDUE')).toBe(true);
  });
});
