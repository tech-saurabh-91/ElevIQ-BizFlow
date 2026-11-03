import { boot, shutdown, clearDb } from './helpers.js';

let app;
let request;

let Company;
let Setting;
let User;
let Customer;
let Product;
let Invoice;
let Payment;
let Notification;
let runWithContext;

const state = {};
const PASSWORD = 'Reports#Pass123';

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
      companyId: company._id, name: `${businessName} Admin`, email: adminEmail, password: PASSWORD, role: 'COMPANY_ADMIN', isActive: true,
    });
    manager = await User.create({
      companyId: company._id, name: `${businessName} Manager`, email: managerEmail, password: PASSWORD, role: 'MANAGER', isActive: true,
    });
    salesman = await User.create({
      companyId: company._id, name: `${businessName} Salesman`, email: salesmanEmail, password: PASSWORD, role: 'SALESMAN', isActive: true, reportingManager: manager._id,
    });
    accountant = await User.create({
      companyId: company._id, name: `${businessName} Accountant`, email: accountantEmail, password: PASSWORD, role: 'ACCOUNTANT', isActive: true,
    });
    await User.updateOne({ _id: manager._id }, { $set: { teamMembers: [salesman._id] } });
  });

  await Company.updateOne({ _id: company._id }, { $set: { adminUser: admin._id } }).skipTenant();
  return { company, admin, manager, salesman, accountant };
};

beforeAll(async () => {
  ({ app } = await boot());
  const st = (await import('supertest')).default;
  request = st(app);

  ({ default: Company } = await import('../src/models/Company.js'));
  ({ default: Setting } = await import('../src/models/Setting.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ default: Customer } = await import('../src/models/Customer.js'));
  ({ default: Product } = await import('../src/models/Product.js'));
  ({ default: Invoice } = await import('../src/models/Invoice.js'));
  ({ default: Payment } = await import('../src/models/Payment.js'));
  ({ default: Notification } = await import('../src/models/Notification.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));

  await clearDb();
  await Promise.all([
    Company.init(), User.init(), Customer.init(), Product.init(), Invoice.init(), Payment.init(), Notification.init(),
  ]);

  const primary = await seedTenant({
    code: 'RPTA',
    businessName: 'Report Traders',
    adminEmail: 'admin@report.test',
    managerEmail: 'manager@report.test',
    salesmanEmail: 'salesman@report.test',
    accountantEmail: 'accountant@report.test',
  });
  state.company = primary.company;
  state.companyId = String(primary.company._id);
  state.admin = primary.admin;
  state.manager = primary.manager;
  state.salesman = primary.salesman;
  state.accountant = primary.accountant;

  const other = await seedTenant({
    code: 'RPTB',
    businessName: 'Other Report Co',
    adminEmail: 'admin@otherreport.test',
    managerEmail: 'manager@otherreport.test',
    salesmanEmail: 'salesman@otherreport.test',
    accountantEmail: 'accountant@otherreport.test',
  });
  state.otherCompany = other.company;
  state.otherCompanyId = String(other.company._id);

  // Seed customers + invoices + payments inside both tenants.
  await inTenant(state.companyId, async () => {
    const cust = await Customer.create({ code: 'CUS-R001', name: 'Alpha Traders', phone: '9000000001', isActive: true });
    const cust2 = await Customer.create({ code: 'CUS-R002', name: 'Beta Stores', phone: '9000000002', isActive: true });
    state.customer = cust;
    state.customer2 = cust2;

    const prod = await Product.create({ sku: 'PRD-R001', name: 'Report Widget', unit: 'PCS', sellingPrice: 100, purchasePrice: 60, gstRate: 18, isActive: true });
    state.product = prod;

    const mk = (over) => ({
      companyId: undefined,
      invoiceNo: over.invoiceNo,
      invoiceDate: over.invoiceDate,
      dueDate: over.dueDate,
      customerId: over.customerId || cust._id,
      customerName: over.customerName || 'Alpha Traders',
      customerCode: 'CUS-R001',
      salesman: over.salesman === null ? null : (over.salesman || state.salesman._id),
      items: [{ product: prod._id, name: 'Report Widget', sku: 'PRD-R001', unit: 'PCS', qty: over.qty || 1, unitPrice: over.unitPrice || 100, taxableAmount: over.taxableAmount || 100, taxAmount: over.taxAmount || 18, lineTotal: over.lineTotal || 118 }],
      subtotal: over.subtotal ?? 100,
      taxTotal: over.taxTotal ?? 18,
      total: over.total ?? 118,
      amountPaid: over.amountPaid ?? 0,
      balanceDue: over.balanceDue ?? (over.total ?? 118),
      status: over.status || 'ISSUED',
      paymentMode: over.paymentMode || 'CREDIT',
    });

    // Three invoices: one fully paid, one partially, one unpaid+overdue.
    const i1 = await Invoice.create(mk({ invoiceNo: 'INV-T-0001', invoiceDate: daysAgo(5), dueDate: daysAgo(1), total: 118, amountPaid: 118, balanceDue: 0, status: 'PAID' }));
    const i2 = await Invoice.create(mk({ invoiceNo: 'INV-T-0002', invoiceDate: daysAgo(10), dueDate: daysAgo(2), customerId: cust2._id, customerName: 'Beta Stores', total: 236, amountPaid: 118, balanceDue: 118, status: 'PARTIALLY_PAID' }));
    const i3 = await Invoice.create(mk({ invoiceNo: 'INV-T-0003', invoiceDate: daysAgo(25), dueDate: daysAgo(20), total: 590, amountPaid: 0, balanceDue: 590, status: 'OVERDUE' }));
    // A draft + cancelled invoice must be excluded from every sales total.
    await Invoice.create(mk({ invoiceNo: 'INV-T-0004', invoiceDate: daysAgo(3), status: 'DRAFT', total: 999, amountPaid: 0, balanceDue: 999 }));
    await Invoice.create(mk({ invoiceNo: 'INV-T-0005', invoiceDate: daysAgo(3), status: 'CANCELLED', total: 888, amountPaid: 0, balanceDue: 0 }));
    // A SALESMAN-owned invoice. `dueDate` is in the future so it counts as
    // current (not overdue) in the receivables aging.
    await Invoice.create(mk({ invoiceNo: 'INV-T-0006', invoiceDate: daysAgo(2), dueDate: daysFromNow(10), salesman: state.salesman._id, total: 118, amountPaid: 0, balanceDue: 118, status: 'ISSUED' }));

    state.invoice1 = i1;
    state.invoice2 = i2;
    state.invoice3 = i3;

    await Payment.create({
      paymentNo: 'RCPT-T-0001', paymentDate: daysAgo(5), customerId: cust._id, customerName: 'Alpha Traders',
      amount: 118, mode: 'CASH', status: 'RECEIVED', collectedBy: state.salesman._id, amountApplied: 118, unappliedAmount: 0,
    });
    await Payment.create({
      paymentNo: 'RCPT-T-0002', paymentDate: daysAgo(9), customerId: cust2._id, customerName: 'Beta Stores',
      amount: 118, mode: 'UPI', status: 'RECEIVED', collectedBy: state.salesman._id, amountApplied: 118, unappliedAmount: 0,
    });
    // Draft + bounced payments must be excluded from collections.
    await Payment.create({ paymentNo: 'RCPT-T-0003', paymentDate: daysAgo(2), customerId: cust._id, amount: 50, mode: 'CASH', status: 'DRAFT', amountApplied: 0, unappliedAmount: 0 });
    await Payment.create({ paymentNo: 'RCPT-T-0004', paymentDate: daysAgo(2), customerId: cust._id, amount: 75, mode: 'CHEQUE', status: 'BOUNCED', amountApplied: 0, unappliedAmount: 0 });
  });

  // Other tenant's data must never leak into the primary's reports.
  await inTenant(state.otherCompanyId, async () => {
    const oc = await Customer.create({ code: 'CUS-X001', name: 'Foreign Customer', phone: '9111111111', isActive: true });
    const prod = await Product.create({ sku: 'PRD-X001', name: 'Foreign Widget', unit: 'PCS', sellingPrice: 50, isActive: true });
    await Invoice.create({
      invoiceNo: 'INV-X-0001', invoiceDate: daysAgo(4), dueDate: daysAgo(1), customerId: oc._id, customerName: 'Foreign Customer',
      items: [{ product: prod._id, name: 'Foreign Widget', sku: 'PRD-X001', unit: 'PCS', qty: 1, unitPrice: 50, lineTotal: 50 }],
      subtotal: 50, taxTotal: 0, total: 50, amountPaid: 0, balanceDue: 50, status: 'ISSUED',
    });
    await Notification.create({ companyId: state.otherCompanyId, broadcast: true, type: 'SYSTEM', title: 'Other tenant note', body: 'x' });
  });
});

afterAll(async () => {
  await shutdown();
});

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
describe('Phase 8 - reports overview', () => {
  it('returns windowed sales + collections + live receivables', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/reports/overview').set(as(token));
    expect(res.status).toBe(200);

    const d = res.body.data;
    expect(d).toHaveProperty('window');
    // Issued invoices only: 118 + 236 + 590 + 118 = 1062 (draft/cancelled excluded).
    expect(d.sales.total).toBeCloseTo(1062, 2);
    expect(d.sales.count).toBe(4);
    // Received payments only: 118 + 118 = 236 (draft + bounced excluded).
    expect(d.collections.total).toBeCloseTo(236, 2);
    // Receivables are live: 118 + 590 + 118 = 826 outstanding.
    expect(d.receivables.total).toBeCloseTo(826, 2);
  });

  it('honours an explicit date window', async () => {
    const token = await login('admin@report.test');
    const from = daysAgo(6);
    const to = new Date().toISOString();
    const res = await request
      .get(`/api/v1/reports/overview?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`)
      .set(as(token));
    expect(res.status).toBe(200);
    // Window = last 6 days: INV-T-0001 (5d, 118) + INV-T-0006 (2d, 118).
    // INV-T-0002 (10d) and INV-T-0003 (25d) fall outside; drafts/cancelled
    // are excluded regardless of date.
    expect(res.body.data.sales.total).toBeCloseTo(236, 2);
    expect(res.body.data.sales.count).toBe(2);
  });
});

describe('Phase 8 - sales report', () => {
  it('buckets by day and breaks down by customer, salesman and product', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/reports/sales?granularity=day&top=10').set(as(token));
    expect(res.status).toBe(200);

    const d = res.body.data;
    expect(d.summary.total).toBeCloseTo(1062, 2);
    expect(Array.isArray(d.series)).toBe(true);
    expect(d.series.length).toBeGreaterThan(0);

    const alpha = d.byCustomer.find((c) => c.name === 'Alpha Traders');
    const beta = d.byCustomer.find((c) => c.name === 'Beta Stores');
    expect(alpha).toBeTruthy();
    expect(beta).toBeTruthy();

    // Alpha: 118 (paid) + 590 (overdue) + 118 (salesman) = 826.
    expect(alpha.value).toBeCloseTo(826, 2);
    expect(beta.value).toBeCloseTo(236, 2);

    // Product breakdown comes from unwound invoice lines.
    const widget = d.byProduct.find((p) => p.sku === 'PRD-R001');
    expect(widget).toBeTruthy();
    expect(widget.value).toBeGreaterThan(0);

    // Payment mode breakdown present.
    expect(d.byPaymentMode.length).toBeGreaterThan(0);
  });

  it('lets a manager view reports (reports.view includes MANAGER)', async () => {
    const token = await login('manager@report.test');
    const res = await request.get('/api/v1/reports/sales').set(as(token));
    expect(res.status).toBe(200);
    // The manager sees the whole company, not just their team.
    expect(res.body.data.summary.total).toBeCloseTo(1062, 2);
  });

  it('a salesman has no reports.view and gets 403', async () => {
    const token = await login('salesman@report.test');
    const res = await request.get('/api/v1/reports/sales').set(as(token));
    expect(res.status).toBe(403);
  });
});

describe('Phase 8 - receivables report', () => {
  it('buckets open invoices by overdue age and excludes settled/draft', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/reports/receivables?buckets=30').set(as(token));
    expect(res.status).toBe(200);

    const d = res.body.data;
    // Open: 118 (2d overdue) + 590 (20d overdue) + 118 (not yet due) = 826.
    expect(d.summary.total).toBeCloseTo(826, 2);
    expect(d.summary.invoiceCount).toBe(3);
    // Paid invoice (0 balance) and drafts/cancelled are excluded.
    const nos = d.invoices.map((i) => i.invoiceNo);
    expect(nos).not.toContain('INV-T-0001'); // fully paid
    expect(nos).not.toContain('INV-T-0004'); // draft
    expect(nos).not.toContain('INV-T-0005'); // cancelled
    // Overdue: 118 + 590 = 708.
    expect(d.summary.overdueValue).toBeCloseTo(708, 2);
    expect(d.buckets.length).toBe(4);
  });

  it('never leaks another tenant receivables', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/reports/receivables').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.data.summary.total).toBeCloseTo(826, 2);
    expect(res.body.data.invoices.some((i) => i.customerName === 'Foreign Customer')).toBe(false);
  });
});

describe('Phase 8 - collections report', () => {
  it('totals received payments by mode and excludes draft/bounced', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/reports/collections').set(as(token));
    expect(res.status).toBe(200);

    const d = res.body.data;
    expect(d.summary.total).toBeCloseTo(236, 2);
    expect(d.summary.count).toBe(2);
    const cash = d.byMode.find((m) => m.mode === 'CASH');
    const upi = d.byMode.find((m) => m.mode === 'UPI');
    expect(cash.value).toBeCloseTo(118, 2);
    expect(upi.value).toBeCloseTo(118, 2);
    // Bounced (CHEQUE) + DRAFT excluded.
    expect(d.byMode.find((m) => m.mode === 'CHEQUE')).toBeFalsy();
  });
});

describe('Phase 8 - inventory report', () => {
  it('returns stock summary and low-stock list', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/reports/inventory').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('byWarehouse');
    expect(res.body.data).toHaveProperty('lowStock');
    expect(typeof res.body.data.summary.stockValue).toBe('number');
  });
});

describe('Phase 8 - field force report', () => {
  it('returns visits, attendance and expenses sections', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/reports/field-force').set(as(token));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toHaveProperty('visits');
    expect(d).toHaveProperty('attendance');
    expect(d).toHaveProperty('expenses');
    expect(d).toHaveProperty('targets');
    expect(Array.isArray(d.visits.series)).toBe(true);
  });
});

describe('Phase 8 - report permissions', () => {
  it('a salesman cannot run reports (no reports.view)', async () => {
    const token = await login('salesman@report.test');
    const res = await request.get('/api/v1/reports/sales').set(as(token));
    expect(res.status).toBe(403);
  });

  it('an accountant can view reports but the export requires reports.export', async () => {
    const token = await login('accountant@report.test');
    const view = await request.get('/api/v1/reports/overview').set(as(token));
    expect(view.status).toBe(200);
    const exp = await request.get('/api/v1/reports/export?type=sales').set(as(token));
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toContain('spreadsheet');
  });

  it('rejects an unknown export type', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/reports/export?type=nope').set(as(token));
    expect(res.status).toBe(422);
  });

  it('rejects an invalid granularity', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/reports/sales?granularity=hour').set(as(token));
    expect(res.status).toBe(422);
  });

  it('requires authentication', async () => {
    const res = await request.get('/api/v1/reports/overview');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
describe('Phase 8 - notifications', () => {
  it('lists broadcasts and addressed notifications, and counts unread', async () => {
    const token = await login('admin@report.test');
    await inTenant(state.companyId, async () => {
      await Notification.create({ companyId: state.companyId, broadcast: true, type: 'SYSTEM', title: 'Welcome aboard', body: 'Broadcast to everyone' });
      await Notification.create({
        companyId: state.companyId, broadcast: false, recipients: [state.admin._id], type: 'OVERDUE_INVOICE',
        title: '2 invoices overdue', body: 'Please chase', priority: 'HIGH',
      });
      // Addressed to someone else — must be invisible to the admin.
      await Notification.create({
        companyId: state.companyId, broadcast: false, recipients: [state.salesman._id], type: 'SYSTEM', title: 'Private for salesman', body: 'x',
      });
    });

    const res = await request.get('/api/v1/notifications').set(as(token));
    expect(res.status).toBe(200);
    const titles = res.body.data.map((n) => n.title);
    expect(titles).toContain('Welcome aboard');
    expect(titles).toContain('2 invoices overdue');
    expect(titles).not.toContain('Private for salesman');

    const count = await request.get('/api/v1/notifications/unread-count').set(as(token));
    expect(count.status).toBe(200);
    expect(count.body.data.unread).toBe(2);
  });

  it('marks a notification read and only once', async () => {
    const token = await login('admin@report.test');
    const list = await request.get('/api/v1/notifications').set(as(token));
    const target = list.body.data.find((n) => n.title === '2 invoices overdue');

    const res = await request.patch(`/api/v1/notifications/${target.id}/read`).set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.data.isRead).toBe(true);
    expect(res.body.data.readAt).toBeTruthy();

    const count = await request.get('/api/v1/notifications/unread-count').set(as(token));
    expect(count.body.data.unread).toBe(1);
  });

  it('marks all read', async () => {
    const token = await login('admin@report.test');
    const res = await request.post('/api/v1/notifications/read-all').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.data.modified).toBeGreaterThanOrEqual(1);

    const count = await request.get('/api/v1/notifications/unread-count').set(as(token));
    expect(count.body.data.unread).toBe(0);
  });

  it('filters to unread only', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/notifications?unreadOnly=true').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.data.every((n) => n.isRead === false)).toBe(true);
  });

  it('a salesman cannot read a notification addressed only to the admin', async () => {
    const adminToken = await login('admin@report.test');
    const list = await request.get('/api/v1/notifications').set(as(adminToken));
    const privateNote = list.body.data.find((n) => n.title === 'Welcome aboard');

    const salesmanToken = await login('salesman@report.test');
    // Broadcast is visible to the salesman…
    const visible = await request.get('/api/v1/notifications').set(as(salesmanToken));
    expect(visible.body.data.some((n) => n.title === 'Welcome aboard')).toBe(true);

    // …but the admin-addressed one is not in the salesman's inbox at all.
    expect(visible.body.data.some((n) => n.title === '2 invoices overdue')).toBe(false);
    // And marking it read 404s for the salesman.
    const overdue = list.body.data.find((n) => n.title === '2 invoices overdue');
    const mark = await request.patch(`/api/v1/notifications/${overdue.id}/read`).set(as(salesmanToken));
    expect(mark.status).toBe(404);
    expect(privateNote).toBeTruthy();
  });

  it('never leaks another tenant notifications', async () => {
    const token = await login('admin@report.test');
    const res = await request.get('/api/v1/notifications').set(as(token));
    expect(res.status).toBe(200);
    expect(res.body.data.some((n) => n.title === 'Other tenant note')).toBe(false);
  });

  it('deletes a notification', async () => {
    const token = await login('admin@report.test');
    const list = await request.get('/api/v1/notifications').set(as(token));
    const target = list.body.data.find((n) => n.title === 'Welcome aboard');
    const res = await request.delete(`/api/v1/notifications/${target.id}`).set(as(token));
    expect(res.status).toBe(200);

    const after = await request.get('/api/v1/notifications').set(as(token));
    expect(after.body.data.some((n) => n.title === 'Welcome aboard')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Overdue reminder job (the cron runs hourly, so it must self-throttle)
// ---------------------------------------------------------------------------
describe('Phase 8 - overdue reminder job', () => {
  const remindersFor = async (companyId) =>
    Notification.find({ companyId, type: 'OVERDUE_INVOICE' }).skipTenant();

  it('reminds each company once, addressing the people who can act', async () => {
    const { runOverdueReminders } = await import('../src/jobs/overdue.js');

    // Start from a clean slate so the counts below are exact.
    await Notification.deleteMany({ type: 'OVERDUE_INVOICE' }).hardDelete();
    // Remind from the first overdue day (the default waits 3 days).
    const { default: Setting } = await import('../src/models/Setting.js');
    await Setting.updateMany({}, { $set: { 'collections.overdueReminderDays': 0 } }).skipTenant();

    const first = await runOverdueReminders();
    expect(first.notifications).toBeGreaterThanOrEqual(2); // primary + other tenant

    const primary = await remindersFor(state.companyId);
    expect(primary).toHaveLength(1);
    // INV-T-0002 (118) and INV-T-0003 (590) are both past due.
    expect(primary[0].title).toBe('2 invoice(s) overdue');
    expect(primary[0].priority).toBe('HIGH');

    // Real recipients: admin, manager and accountant — never the salesman,
    // and never an empty list (which would be invisible to everybody).
    const ids = primary[0].recipients.map(String);
    expect(ids).toContain(String(state.admin._id));
    expect(ids).toContain(String(state.manager._id));
    expect(ids).toContain(String(state.accountant._id));
    expect(ids).not.toContain(String(state.salesman._id));

    // The other tenant gets its own reminder and never sees ours.
    const other = await remindersFor(state.otherCompanyId);
    expect(other).toHaveLength(1);
    expect(other[0].recipients.map(String)).not.toContain(String(state.admin._id));
  });

  it('does not duplicate the reminder when the hourly cron fires again', async () => {
    const { runOverdueReminders } = await import('../src/jobs/overdue.js');

    const second = await runOverdueReminders();
    expect(second.notifications).toBe(0);
    expect(await remindersFor(state.companyId)).toHaveLength(1);
    expect(await remindersFor(state.otherCompanyId)).toHaveLength(1);
  });

  it('still flags newly overdue invoices on every run', async () => {
    // INV-T-0002 was PARTIALLY_PAID with a due date in the past.
    const refreshed = await Invoice.findOne({ invoiceNo: 'INV-T-0002' }).skipTenant();
    expect(refreshed.status).toBe('OVERDUE');
  });
});

describe('Overdue reminder delay (Collections setting)', () => {
  it('waits until an invoice is overdue by the configured number of days', async () => {
    const { runOverdueReminders } = await import('../src/jobs/overdue.js');
    const { default: Setting } = await import('../src/models/Setting.js');
    await Notification.deleteMany({ type: 'OVERDUE_INVOICE' }).hardDelete();
    await Setting.updateMany({}, { $set: { 'collections.overdueReminderDays': 3650 } }).skipTenant();

    await runOverdueReminders();
    expect(await Notification.find({ companyId: state.companyId, type: 'OVERDUE_INVOICE' }).skipTenant()).toHaveLength(0);

    await Setting.updateMany({}, { $set: { 'collections.overdueReminderDays': 0 } }).skipTenant();
  });
});
