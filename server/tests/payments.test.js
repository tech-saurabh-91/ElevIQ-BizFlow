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
let Invoice;
let Payment;
let runWithContext;

const state = {};
const PASSWORD = 'Payment#Pass123';

const as = (token) => ({ Authorization: `Bearer ${token}` });

const login = async (identifier, password = PASSWORD) => {
  const res = await request.post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${identifier} (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
};

const inTenant = (companyId, fn) => runWithContext({ scope: 'company', companyId }, fn);

const seedTenant = async ({ code, businessName, adminEmail, managerEmail, salesmanEmail, accountantEmail }) => {
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

  await inTenant(String(company._id), async () => {
    await Setting.forCompany(company._id);

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
    });
    accountant = await User.create({
      companyId: company._id,
      name: `${businessName} Accountant`,
      email: accountantEmail,
      password: PASSWORD,
      role: 'ACCOUNTANT',
      isActive: true,
    });
    await User.updateOne({ _id: manager._id }, { $set: { teamMembers: [salesman._id] } });
  });

  await Company.updateOne({ _id: company._id }, { $set: { adminUser: admin._id } }).skipTenant();

  return { company, admin, manager, salesman, accountant };
};

const createPayment = (payload, token = state.adminToken) =>
  request.post('/api/v1/payments').set(as(token)).send(payload);

const getPayment = (id, token = state.adminToken) => request.get(`/api/v1/payments/${id}`).set(as(token));

const getInvoice = (id, token = state.adminToken) => request.get(`/api/v1/invoices/${id}`).set(as(token));

const getCustomer = (id, token = state.adminToken) => request.get(`/api/v1/customers/${id}`).set(as(token));

const item = (sku, qty, extra = {}) => ({ product: state.products[sku].id, qty, ...extra });

/** Create + issue a direct invoice so it becomes payable. */
const issueInvoice = async (customerId, items, token = state.adminToken) => {
  const res = await request
    .post('/api/v1/invoices')
    .set(as(token))
    .send({ customerId, items, issue: true });
  if (res.status !== 201) {
    throw new Error(`invoice create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
};

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
  ({ default: Invoice } = await import('../src/models/Invoice.js'));
  ({ default: Payment } = await import('../src/models/Payment.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));

  await clearDb();
  await Promise.all([
    Company.init(),
    User.init(),
    Customer.init(),
    Product.init(),
    PriceList.init(),
    Invoice.init(),
    Payment.init(),
  ]);

  const primary = await seedTenant({
    code: 'P6A',
    businessName: 'Phase 6 Traders',
    adminEmail: 'admin@phase6.test',
    managerEmail: 'manager@phase6.test',
    salesmanEmail: 'salesman@phase6.test',
    accountantEmail: 'accountant@phase6.test',
  });
  state.company = primary.company;
  state.companyId = String(primary.company._id);
  state.admin = primary.admin;
  state.manager = primary.manager;
  state.salesman = primary.salesman;
  state.accountant = primary.accountant;

  const other = await seedTenant({
    code: 'P6B',
    businessName: 'Other Payment Co',
    adminEmail: 'admin@otherp6.test',
    managerEmail: 'manager@otherp6.test',
    salesmanEmail: 'salesman@otherp6.test',
    accountantEmail: 'accountant@otherp6.test',
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
    ]);
    state.products = Object.fromEntries(products.map((p) => [p.sku, { id: String(p._id), doc: p }]));

    await PriceList.create({
      code: 'PL-PAYMENT',
      name: 'Payment Pricing',
      type: 'RETAIL',
      isDefault: true,
      isActive: true,
      items: [
        { product: products[0]._id, price: 100, discountPercent: 0, minQty: 1 },
        { product: products[1]._id, price: 50, discountPercent: 0, minQty: 1 },
      ],
    });

    const customer = await Customer.create({
      code: 'CUS-3001',
      name: 'Alpha Retail',
      type: 'RETAIL',
      phone: '+919820013001',
      gstin: '27AAAC1234A1Z5',
      address: { line1: '1 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      paymentTerms: 'IMMEDIATE',
      creditLimit: 100000,
      assignedTo: state.salesman._id,
      isActive: true,
    });
    const customer2 = await Customer.create({
      code: 'CUS-3002',
      name: 'Beta Retail',
      type: 'RETAIL',
      phone: '+919820013002',
      gstin: '27AAAC1234A1Z6',
      address: { line1: '2 FC Road', city: 'Pune', state: 'Maharashtra', pincode: '411002' },
      paymentTerms: 'IMMEDIATE',
      creditLimit: 100000,
      isActive: true,
    });
    state.customer = customer;
    state.customer2 = customer2;
  });

  state.adminToken = await login('admin@phase6.test');
  state.managerToken = await login('manager@phase6.test');
  state.salesmanToken = await login('salesman@phase6.test');
  state.accountantToken = await login('accountant@phase6.test');
  state.otherAdminToken = await login('admin@otherp6.test');
});

afterAll(async () => {
  await shutdown();
});

// ---------------------------------------------------------------------------

describe('Phase 6 - payment creation & draft lifecycle', () => {
  test('creates a draft payment with an RCPT-<FY>- number', async () => {
    const res = await createPayment({
      customerId: String(state.customer._id),
      amount: 500,
      mode: 'CASH',
      reason: 'ADVANCE',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.paymentNo).toMatch(/^RCPT-\d{4}-\d{6}$/);
    expect(res.body.data.amount).toBe(500);
    expect(res.body.data.unappliedAmount).toBe(500);
    expect(res.body.data.allocationStatus).toBe('UNAPPLIED');

    state.draftPaymentId = res.body.data.id;
  });

  test('rejects a payment with a non-positive amount', async () => {
    const res = await createPayment({ customerId: String(state.customer._id), amount: 0 });
    expect(res.status).toBe(422);
  });

  test('rejects a payment referencing an unknown customer', async () => {
    const res = await createPayment({
      customerId: '64b000000000000000000000',
      amount: 100,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REFERENCE');
  });

  test('rejects allocating more than the payment amount', async () => {
    const invoice = await issueInvoice(String(state.customer._id), [item('ALPHA', 2)]); // 200 + GST
    const res = await createPayment({
      customerId: String(state.customer._id),
      amount: 100,
      allocations: [{ invoice: invoice.id, amount: 500 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ALLOCATION_EXCEEDS_AMOUNT');
  });

  test('updates a draft payment and deletes it', async () => {
    const created = await createPayment({
      customerId: String(state.customer2._id),
      amount: 300,
      mode: 'CASH',
    });
    const id = created.body.data.id;

    const updated = await request
      .patch(`/api/v1/payments/${id}`)
      .set(as(state.adminToken))
      .send({ amount: 450, mode: 'UPI', reference: 'UPI-EDIT-1' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.amount).toBe(450);
    expect(updated.body.data.mode).toBe('UPI');
    expect(updated.body.data.reference).toBe('UPI-EDIT-1');

    const removed = await request.delete(`/api/v1/payments/${id}`).set(as(state.adminToken));
    expect(removed.status).toBe(200);

    const gone = await getPayment(id);
    expect(gone.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe('Phase 6 - receiving payments settles invoices', () => {
  test('receives a part payment and flips the invoice to PARTIALLY_PAID', async () => {
    const invoice = await issueInvoice(String(state.customer._id), [item('ALPHA', 10)]); // 1000 + 18% GST
    const total = Number(invoice.total);
    expect(total).toBeGreaterThan(0);

    const before = await getCustomer(String(state.customer._id));
    const outstandingBefore = Number(before.body.data.outstanding || 0);

    const created = await createPayment({
      customerId: String(state.customer._id),
      amount: 500,
      mode: 'CASH',
      allocations: [{ invoice: invoice.id, amount: 500 }],
      receive: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('RECEIVED');
    expect(created.body.data.amountApplied).toBe(500);
    expect(created.body.data.unappliedAmount).toBe(0);
    expect(created.body.data.allocationStatus).toBe('FULLY_APPLIED');

    const after = await getInvoice(invoice.id);
    expect(after.body.data.status).toBe('PARTIALLY_PAID');
    expect(after.body.data.amountPaid).toBe(500);
    expect(after.body.data.balanceDue).toBeCloseTo(total - 500, 2);

    const cust = await getCustomer(String(state.customer._id));
    expect(Number(cust.body.data.outstanding)).toBeCloseTo(outstandingBefore - 500, 2);

    state.partialInvoiceId = invoice.id;
    state.partialTotal = total;
  });

  test('receives a full settlement and flips the invoice to PAID', async () => {
    const invoice = await issueInvoice(String(state.customer2._id), [item('BETA', 4)]); // 200 + 12% GST
    const total = Number(invoice.total);

    const created = await createPayment({
      customerId: String(state.customer2._id),
      amount: total,
      mode: 'UPI',
      reference: 'UPI-FULL-1',
      allocations: [{ invoice: invoice.id, amount: total }],
      receive: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('RECEIVED');

    const after = await getInvoice(invoice.id);
    expect(after.body.data.status).toBe('PAID');
    expect(after.body.data.balanceDue).toBeCloseTo(0, 2);
  });

  test('caps an over-allocation at the invoice balance and keeps the rest as advance', async () => {
    const invoice = await issueInvoice(String(state.customer2._id), [item('ALPHA', 1)]); // 100 + GST = 118
    const total = Number(invoice.total);

    const created = await createPayment({
      customerId: String(state.customer2._id),
      amount: total + 250,
      mode: 'CASH',
      allocations: [{ invoice: invoice.id, amount: total + 250 }],
      receive: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.amountApplied).toBeCloseTo(total, 2);
    expect(created.body.data.unappliedAmount).toBeCloseTo(250, 2);
    expect(created.body.data.allocationStatus).toBe('PARTIALLY_APPLIED');

    const after = await getInvoice(invoice.id);
    expect(after.body.data.status).toBe('PAID');
    expect(after.body.data.balanceDue).toBeCloseTo(0, 2);
  });

  test('an advance payment (no allocations) is stored fully unapplied', async () => {
    const created = await createPayment({
      customerId: String(state.customer._id),
      amount: 2000,
      mode: 'BANK_TRANSFER',
      reference: 'NEFT-9911',
      reason: 'ADVANCE',
      receive: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('RECEIVED');
    expect(created.body.data.amountApplied).toBe(0);
    expect(created.body.data.unappliedAmount).toBe(2000);
    expect(created.body.data.allocationStatus).toBe('UNAPPLIED');
  });

  test('a draft can be received later via the workflow endpoint', async () => {
    const invoice = await issueInvoice(String(state.customer._id), [item('BETA', 2)]); // 100 + GST
    const total = Number(invoice.total);

    const draft = await createPayment({
      customerId: String(state.customer._id),
      amount: total,
      allocations: [{ invoice: invoice.id, amount: total }],
    });
    expect(draft.body.data.status).toBe('DRAFT');
    const id = draft.body.data.id;

    const received = await request
      .post(`/api/v1/payments/${id}/receive`)
      .set(as(state.adminToken))
      .send({ note: 'Confirmed at the counter' });
    expect(received.status).toBe(200);
    expect(received.body.data.status).toBe('RECEIVED');

    const after = await getInvoice(invoice.id);
    expect(after.body.data.status).toBe('PAID');
  });

  test('rejects receiving a payment twice', async () => {
    const created = await createPayment({
      customerId: String(state.customer._id),
      amount: 100,
      receive: true,
    });
    const again = await request
      .post(`/api/v1/payments/${created.body.data.id}/receive`)
      .set(as(state.adminToken))
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PAYMENT_NOT_DRAFT');
  });
});

// ---------------------------------------------------------------------------

describe('Phase 6 - cancel & bounce reverse allocations', () => {
  test('cancelling a received payment restores the invoice balance + customer outstanding', async () => {
    const invoice = await issueInvoice(String(state.customer._id), [item('ALPHA', 3)]); // 300 + GST
    const total = Number(invoice.total);

    const beforeCust = await getCustomer(String(state.customer._id));
    const outstandingBefore = Number(beforeCust.body.data.outstanding || 0);

    const created = await createPayment({
      customerId: String(state.customer._id),
      amount: total,
      allocations: [{ invoice: invoice.id, amount: total }],
      receive: true,
    });
    const id = created.body.data.id;

    const midCust = await getCustomer(String(state.customer._id));
    expect(Number(midCust.body.data.outstanding)).toBeCloseTo(outstandingBefore - total, 2);

    const cancelled = await request
      .post(`/api/v1/payments/${id}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Entered against the wrong customer' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.cancelReason).toMatch(/wrong customer/);

    const afterInvoice = await getInvoice(invoice.id);
    expect(afterInvoice.body.data.status).toBe('ISSUED');
    expect(afterInvoice.body.data.amountPaid).toBe(0);
    expect(afterInvoice.body.data.balanceDue).toBeCloseTo(total, 2);

    const afterCust = await getCustomer(String(state.customer._id));
    expect(Number(afterCust.body.data.outstanding)).toBeCloseTo(outstandingBefore, 2);
  });

  test('bounces a received cheque and reverses the allocation', async () => {
    const invoice = await issueInvoice(String(state.customer2._id), [item('BETA', 6)]); // 300 + GST
    const total = Number(invoice.total);

    const created = await createPayment({
      customerId: String(state.customer2._id),
      amount: total,
      mode: 'CHEQUE',
      reference: 'CHQ-771122',
      allocations: [{ invoice: invoice.id, amount: total }],
      receive: true,
    });
    const id = created.body.data.id;

    const bounced = await request
      .post(`/api/v1/payments/${id}/bounce`)
      .set(as(state.adminToken))
      .send({ reason: 'Cheque returned: insufficient funds' });
    expect(bounced.status).toBe(200);
    expect(bounced.body.data.status).toBe('BOUNCED');
    expect(bounced.body.data.bounceReason).toMatch(/insufficient funds/);

    const afterInvoice = await getInvoice(invoice.id);
    expect(afterInvoice.body.data.status).toBe('ISSUED');
    expect(afterInvoice.body.data.amountPaid).toBe(0);
    expect(afterInvoice.body.data.balanceDue).toBeCloseTo(total, 2);
  });

  test('a draft payment cannot be bounced', async () => {
    const created = await createPayment({
      customerId: String(state.customer._id),
      amount: 120,
    });
    const bounced = await request
      .post(`/api/v1/payments/${created.body.data.id}/bounce`)
      .set(as(state.adminToken))
      .send({ reason: 'Not applicable' });
    expect(bounced.status).toBe(409);
  });

  test('a received payment cannot be edited or deleted; drafts can', async () => {
    const created = await createPayment({
      customerId: String(state.customer._id),
      amount: 640,
      receive: true,
    });
    const id = created.body.data.id;

    const edit = await request.patch(`/api/v1/payments/${id}`).set(as(state.adminToken)).send({ amount: 1 });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('PAYMENT_LOCKED');

    const del = await request.delete(`/api/v1/payments/${id}`).set(as(state.adminToken));
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('PAYMENT_LOCKED');
  });
});

// ---------------------------------------------------------------------------

describe('Phase 6 - invoice guard rails', () => {
  test('rejects paying a draft invoice', async () => {
    const draft = await request
      .post('/api/v1/invoices')
      .set(as(state.adminToken))
      .send({ customerId: String(state.customer._id), items: [item('ALPHA', 1)] });
    expect(draft.status).toBe(201);

    const res = await createPayment({
      customerId: String(state.customer._id),
      amount: 100,
      allocations: [{ invoice: draft.body.data.id, amount: 100 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVOICE_NOT_PAYABLE');
  });

  test('rejects paying an already fully settled invoice', async () => {
    const invoice = await issueInvoice(String(state.customer2._id), [item('ALPHA', 1)]);
    const total = Number(invoice.total);
    await createPayment({
      customerId: String(state.customer2._id),
      amount: total,
      allocations: [{ invoice: invoice.id, amount: total }],
      receive: true,
    });

    const res = await createPayment({
      customerId: String(state.customer2._id),
      amount: 100,
      allocations: [{ invoice: invoice.id, amount: 100 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVOICE_NOT_PAYABLE');
    expect(JSON.stringify(res.body.errors)).toMatch(/fully settled/);
  });

  test('form-options returns only payable invoices and honours customerId', async () => {
    const all = await request.get('/api/v1/payments/form-options').set(as(state.adminToken));
    expect(all.status).toBe(200);
    expect(Array.isArray(all.body.data.invoices)).toBe(true);
    expect(all.body.data.modes).toContain('CASH');

    const filtered = await request
      .get(`/api/v1/payments/form-options?customerId=${String(state.customer._id)}`)
      .set(as(state.adminToken));
    expect(filtered.status).toBe(200);
    filtered.body.data.invoices.forEach((inv) => {
      expect(String(inv.customerId)).toBe(String(state.customer._id));
    });
  });
});

// ---------------------------------------------------------------------------

describe('Phase 6 - stats, list, export & RBAC', () => {
  test('stats aggregates received value, outstanding and per-status counts', async () => {
    const res = await request.get('/api/v1/payments/stats').set(as(state.adminToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.total).toBeGreaterThan(0);
    expect(d.byStatus.RECEIVED).toBeGreaterThan(0);
    expect(d.receivedValue).toBeGreaterThan(0);
    expect(typeof d.outstanding).toBe('number');
    expect(d.month).toHaveProperty('count');
    expect(d.today).toHaveProperty('value');
  });

  test('lists payments with pagination and search', async () => {
    const res = await request.get('/api/v1/payments?page=1&limit=5').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('page');

    const searched = await request.get('/api/v1/payments?search=RCPT').set(as(state.adminToken));
    expect(searched.status).toBe(200);
  });

  test('filters payments by status', async () => {
    const res = await request.get('/api/v1/payments?status=RECEIVED').set(as(state.adminToken));
    expect(res.status).toBe(200);
    res.body.data.forEach((p) => expect(p.status).toBe('RECEIVED'));
  });

  test('exports payments to Excel', async () => {
    const res = await request
      .get('/api/v1/payments/export')
      .set(as(state.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('generates a PDF receipt', async () => {
    const list = await request.get('/api/v1/payments?limit=1&status=RECEIVED').set(as(state.adminToken));
    const id = list.body.data[0]?.id;
    expect(id).toBeTruthy();

    const res = await request
      .get(`/api/v1/payments/${id}/pdf`)
      .set(as(state.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('pdf');
  });

  test('ACCOUNTANT can view and collect but not delete; SALESMAN can collect but not view all', async () => {
    const accountantView = await request.get('/api/v1/payments').set(as(state.accountantToken));
    expect(accountantView.status).toBe(200);

    const anyId = accountantView.body.data[0]?.id;
    if (anyId) {
      const accountantDel = await request.delete(`/api/v1/payments/${anyId}`).set(as(state.accountantToken));
      expect(accountantDel.status).toBe(403);
    }

    // SALESMAN collects, and sees only his own collections.
    const salesmanCreate = await createPayment(
      { customerId: String(state.customer._id), amount: 55 },
      state.salesmanToken
    );
    expect(salesmanCreate.status).toBe(201);
    const salesmanView = await request.get('/api/v1/payments').set(as(state.salesmanToken)).query({ limit: 100 });
    expect(salesmanView.status).toBe(200);
    expect(salesmanView.body.data.length).toBeGreaterThan(0);
    expect(salesmanView.body.data.every((p) => String(p.collectedBy?.id || p.collectedBy) === String(salesmanCreate.body.data.collectedBy?.id || salesmanCreate.body.data.collectedBy))).toBe(true);
  });

  test('MANAGER can view the collection register', async () => {
    const res = await request.get('/api/v1/payments').set(as(state.managerToken));
    expect(res.status).toBe(200);
  });

  test('tenant isolation: another company cannot read these payments', async () => {
    const list = await request.get('/api/v1/payments').set(as(state.adminToken));
    const id = list.body.data[0]?.id;
    expect(id).toBeTruthy();

    const res = await getPayment(id, state.otherAdminToken);
    expect(res.status).toBe(404);
  });

  test('dashboard summary now reports collections', async () => {
    const res = await request.get('/api/v1/dashboard/summary').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(typeof res.body.data.collectionsMtd).toBe('number');
    expect(typeof res.body.data.paymentsMtd).toBe('number');
    expect(res.body.data.paymentsMtd).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('Phase 6 - soft delete policy', () => {
  test('raw deleteOne on the Payment model is blocked', async () => {
    await expect(Payment.deleteOne({})).rejects.toThrow(/HARD_DELETE_BLOCKED|hard delete/i);
  });
});
