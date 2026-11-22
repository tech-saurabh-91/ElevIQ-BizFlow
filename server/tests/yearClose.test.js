/**
 * Financial year closing: closing order, the lock on closed-year documents,
 * closing balances and reopening.
 *
 * Runs on the real clock: the previous Indian financial year (April-March) has
 * always ended, so it is the one closed here.
 */
import { boot, shutdown, clearDb } from './helpers.js';

let request;
let Company;
let Setting;
let User;
let Customer;
let Product;
let Warehouse;
let runWithContext;

const PASSWORD = 'YearEnd#Pass123';
const as = (token) => ({ Authorization: `Bearer ${token}` });
const state = {};

// The previous and current financial years (Asia/Kolkata calendar).
const todayIn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const [ty, tm] = todayIn.split('-').map(Number);
const curStart = tm >= 4 ? ty : ty - 1;
const prevStart = curStart - 1;
const tag = (y) => `${String(y).slice(-2)}${String(y + 1).slice(-2)}`;
const PREV = tag(prevStart);
const CUR = tag(curStart);
const inPrev = (mmdd) => `${prevStart + 1}-${mmdd}`; // a day in Jan-Mar of the previous year
const firstOfCurrent = `${curStart}-04-02`;

const login = async (identifier) => {
  const res = await request.post('/api/auth/login').send({ identifier, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${identifier}: ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
};

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  ({ default: Company } = await import('../src/models/Company.js'));
  ({ default: Setting } = await import('../src/models/Setting.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ default: Customer } = await import('../src/models/Customer.js'));
  ({ default: Product } = await import('../src/models/Product.js'));
  ({ default: Warehouse } = await import('../src/models/Warehouse.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  await clearDb();

  const company = await Company.create({
    code: 'YRC',
    slug: 'yrc',
    businessName: 'Year End Traders',
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    financialYearStartMonth: 4,
    subscriptionEnd: new Date(Date.now() + 365 * 864e5),
    limits: { maxUsers: 20, maxCustomers: 500, maxInvoicesPerMonth: 10000 },
  });
  state.companyId = String(company._id);
  await runWithContext({ scope: 'company', companyId: state.companyId }, async () => {
    const settings = await Setting.forCompany(company._id);
    settings.set({ 'fieldForce.requireAttendance': false, 'fieldForce.saleOnlyInVisit': false });
    await settings.save();
    await User.create({ companyId: company._id, name: 'Year Admin', email: 'admin@yearend.test', password: PASSWORD, role: 'COMPANY_ADMIN', isActive: true });
    await User.create({ companyId: company._id, name: 'Year Accountant', email: 'acc@yearend.test', password: PASSWORD, role: 'ACCOUNTANT', isActive: true });
    await User.create({ companyId: company._id, name: 'Year Manager', email: 'mgr@yearend.test', password: PASSWORD, role: 'MANAGER', isActive: true });
    // A manager the admin allowed to finish last year's books.
    await User.create({
      companyId: company._id,
      name: 'Trusted Manager',
      email: 'mgr2@yearend.test',
      password: PASSWORD,
      role: 'MANAGER',
      isActive: true,
      accessOverrides: [{ permission: 'books.backdate', effect: 'ALLOW' }],
    });
    const customer = await Customer.create({ companyId: company._id, name: 'March Kirana', code: 'CUS-1', phone: '9876543210', createdAt: new Date(`${prevStart}-12-01`) });
    const product = await Product.create({ companyId: company._id, name: 'Year Soap', sku: 'YSOAP', unit: 'PCS', gstRate: 18, sellingPrice: 100, mrp: 120, isActive: true });
    const godown = await Warehouse.create({ companyId: company._id, name: 'Main Godown', code: 'MAIN', type: 'MAIN', isDefault: true });
    state.warehouseId = String(godown._id);
    state.customerId = String(customer._id);
    state.productId = String(product._id);
  });
  state.admin = await login('admin@yearend.test');
  state.accountant = await login('acc@yearend.test');
  state.manager = await login('mgr@yearend.test');
  state.trusted = await login('mgr2@yearend.test');

  // Stock counted in March but entered today: it belongs to last year's closing stock.
  const adj = await request.post('/api/v1/inventory/adjustments').set(as(state.admin)).send({
    warehouse: state.warehouseId, reason: 'COUNT', adjustmentDate: inPrev('03-15'), post: true, items: [{ product: state.productId, qty: 50, unitCost: 40 }],
  });
  expect(adj.status).toBe(201);

  // Last year: an issued invoice (part paid) and a forgotten draft.
  const inv = await request.post('/api/v1/invoices').set(as(state.admin)).send({ customerId: state.customerId, invoiceDate: inPrev('03-20'), items: [{ product: state.productId, qty: 10 }], issue: true });
  expect(inv.status).toBe(201);
  state.invoice = inv.body.data;
  const draft = await request.post('/api/v1/invoices').set(as(state.admin)).send({ customerId: state.customerId, invoiceDate: inPrev('03-25'), items: [{ product: state.productId, qty: 2 }] });
  expect(draft.status).toBe(201);
  state.draftId = draft.body.data.id;
  const pay = await request.post('/api/v1/payments').set(as(state.admin)).send({
    customerId: state.customerId, amount: 500, mode: 'CASH', paymentDate: inPrev('03-28'), allocations: [{ invoice: state.invoice.id, amount: 500 }], receive: true,
  });
  expect(pay.status).toBe(201);
  state.paymentId = pay.body.data.id;
});

afterAll(async () => {
  await shutdown();
});

describe('Financial year closing', () => {
  test('lists last year as closable and this year as current', async () => {
    const res = await request.get('/api/v1/financial-years').set(as(state.admin));
    expect(res.status).toBe(200);
    const prev = res.body.data.years.find((y) => y.tag === PREV);
    const cur = res.body.data.years.find((y) => y.tag === CUR);
    expect(prev).toMatchObject({ status: 'OPEN', ended: true, canClose: true });
    expect(cur.status).toBe('CURRENT');
  });

  test('the checklist reports the draft invoice', async () => {
    const res = await request.get(`/api/v1/financial-years/${PREV}/checklist`).set(as(state.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.items.find((i) => i.key === 'draftInvoices').count).toBe(1);
  });

  test('the current year cannot be closed, and only an admin can close', async () => {
    const cur = await request.post(`/api/v1/financial-years/${CUR}/close`).set(as(state.admin)).send({});
    expect(cur.status).toBe(409);
    expect(cur.body.code).toBe('YEAR_NOT_ENDED');
    const acc = await request.post(`/api/v1/financial-years/${PREV}/close`).set(as(state.accountant)).send({});
    expect(acc.status).toBe(403);
  });

  test('until it is closed, only allowed users can date documents in the ended year', async () => {
    const doc = { customerId: state.customerId, invoiceDate: inPrev('03-29'), items: [{ product: state.productId, qty: 1 }] };
    const manager = await request.post('/api/v1/invoices').set(as(state.manager)).send(doc);
    expect(manager.status).toBe(423);
    expect(manager.body.code).toBe('PREVIOUS_YEAR');
    // Nor change last year's issued invoice.
    const edit = await request.patch(`/api/v1/invoices/${state.invoice.id}`).set(as(state.manager)).send({ notes: 'changed' });
    expect(edit.status).toBe(423);
    // Today's date is fine for everyone.
    const today = await request.post('/api/v1/invoices').set(as(state.manager)).send({ ...doc, invoiceDate: todayIn });
    expect(today.status).toBe(201);
    // A user given "books.backdate" (admin and accountant by default) may.
    const trusted = await request.post('/api/v1/invoices').set(as(state.trusted)).send(doc);
    expect(trusted.status).toBe(201);
    for (const id of [today.body.data.id, trusted.body.data.id]) {
      expect((await request.delete(`/api/v1/invoices/${id}`).set(as(state.admin))).status).toBe(200);
    }
  });

  test('the year-end status names the ended year still to close', async () => {
    const res = await request.get('/api/v1/financial-years/status').set(as(state.accountant));
    expect(res.status).toBe(200);
    expect(res.body.data.ended).toMatchObject({ tag: PREV, endDay: `${prevStart + 1}-03-31` });
    expect(res.body.data).toMatchObject({ canBackdate: true, canClose: false });
    expect((await request.get('/api/v1/financial-years/status').set(as(state.manager))).status).toBe(403);
  });

  test('closing reminders go to the admin once per week, not twice', async () => {
    const { runYearEndReminders } = await import('../src/jobs/yearEnd.js');
    const Notification = (await import('../src/models/Notification.js')).default;
    const first = await runYearEndReminders();
    expect(first.sent).toBe(1);
    expect((await runYearEndReminders()).sent).toBe(0);
    const notes = await runWithContext({ scope: 'company', companyId: state.companyId }, () => Notification.find({ entityType: /^YEAR_END:/ }).lean());
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toContain('has ended');
  });

  test('the checklist checks expenses, cashouts, stock and saved balances', async () => {
    const res = await request.get(`/api/v1/financial-years/${PREV}/checklist`).set(as(state.admin));
    const keys = res.body.data.items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['pendingExpenses', 'pendingCashouts', 'openStockRequests', 'negativeStock', 'customerBalances', 'supplierBalances', 'stockLedger']));
    const by = (k) => res.body.data.items.find((i) => i.key === k);
    expect(by('customerBalances').count).toBe(0);
    expect(by('stockLedger').count).toBe(0);

    // A balance that drifted from its invoices is caught, with the name.
    await runWithContext({ scope: 'company', companyId: state.companyId }, () => Customer.updateOne({ _id: state.customerId }, { $inc: { outstanding: 75 } }));
    const drift = await request.get(`/api/v1/financial-years/${PREV}/checklist`).set(as(state.admin));
    const item = drift.body.data.items.find((i) => i.key === 'customerBalances');
    expect(item.count).toBe(1);
    expect(item.details[0]).toContain('March Kirana');
    await runWithContext({ scope: 'company', companyId: state.companyId }, () => Customer.updateOne({ _id: state.customerId }, { $inc: { outstanding: -75 } }));
  });

  test('a draft closing pack can be downloaded before closing', async () => {
    const res = await request.get(`/api/v1/financial-years/${PREV}/export`).set(as(state.accountant)).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toContain(`closing-pack-${PREV}-draft.xlsx`);
    expect((await request.get(`/api/v1/financial-years/${CUR}/export`).set(as(state.admin))).status).toBe(409);
  });

  test('closing records totals and closing balances', async () => {
    // The forgotten draft invoice blocks the close until the admin gives a reason.
    const blocked = await request.post(`/api/v1/financial-years/${PREV}/close`).set(as(state.admin)).send({ notes: 'Audited' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('CHECKLIST_OPEN');
    const shortReason = await request.post(`/api/v1/financial-years/${PREV}/close`).set(as(state.admin)).send({ notes: 'ok', force: true });
    expect(shortReason.status).toBe(422);
    const res = await request.post(`/api/v1/financial-years/${PREV}/close`).set(as(state.admin)).send({ notes: 'Audited; the draft moves to the new year', force: true });
    expect(res.status).toBe(200);
    const total = Number(state.invoice.total);
    expect(res.body.data.totals.sales).toBeCloseTo(total, 2);
    expect(res.body.data.totals.collections).toBeCloseTo(500, 2);
    expect(res.body.data.totals.receivables).toBeCloseTo(total - 500, 2);
    expect(res.body.data.openItems.some((i) => i.key === 'draftInvoices')).toBe(true);

    const company = await Company.findById(state.companyId).lean();
    expect(company.booksClosedThrough).toBe(`${prevStart + 1}-03-31`);

    const bal = await request.get(`/api/v1/financial-years/${PREV}/balances?kind=CUSTOMER`).set(as(state.accountant));
    expect(bal.status).toBe(200);
    expect(bal.body.data[0]).toMatchObject({ name: 'March Kirana' });
    expect(bal.body.data[0].amount).toBeCloseTo(total - 500, 2);

    const stock = await request.get(`/api/v1/financial-years/${PREV}/balances?kind=STOCK`).set(as(state.admin));
    // 50 counted in March (posted today, dated March) less the 10 sold on the March invoice
    expect(stock.body.data[0]).toMatchObject({ name: 'Year Soap', qty: 40 });
    expect(stock.body.data[0].amount).toBeCloseTo(1600, 2);

    const again = await request.post(`/api/v1/financial-years/${PREV}/close`).set(as(state.admin)).send({});
    expect(again.status).toBe(409);

    // The accountant hears about it; the pack is no longer a draft.
    const Notification = (await import('../src/models/Notification.js')).default;
    const accountant = await runWithContext({ scope: 'company', companyId: state.companyId }, () => User.findOne({ email: 'acc@yearend.test' }).lean());
    const told = await runWithContext({ scope: 'company', companyId: state.companyId }, () => Notification.findOne({ recipients: accountant._id, title: /is closed/ }).lean());
    expect(told).toBeTruthy();
    const pack = await request.get(`/api/v1/financial-years/${PREV}/export`).set(as(state.admin)).buffer(true);
    expect(pack.headers['content-disposition']).toContain(`closing-pack-${PREV}.xlsx`);

    // Closed now: no more reminders, and not even the accountant can use its dates.
    const { runYearEndReminders } = await import('../src/jobs/yearEnd.js');
    expect((await runYearEndReminders()).sent).toBe(0);
    const late = await request.post('/api/v1/invoices').set(as(state.accountant)).send({ customerId: state.customerId, invoiceDate: inPrev('03-30'), items: [{ product: state.productId, qty: 1 }] });
    expect(late.status).toBe(423);
    expect(late.body.code).toBe('BOOKS_CLOSED');
  });

  test("this year's opening balances equal last year's closing", async () => {
    const total = Number(state.invoice.total);
    const range = `from=${curStart}-04-01&to=${todayIn}`;
    const cust = await request.get(`/api/v1/reports/hub/run/customer-balances?${range}`).set(as(state.admin));
    expect(cust.status).toBe(200);
    const row = cust.body.data.rows.find((r) => r.name === 'March Kirana');
    expect(row.opening).toBeCloseTo(total - 500, 2);

    const lastYear = await request.get(`/api/v1/reports/hub/run/customer-balances?from=${prevStart}-04-01&to=${prevStart + 1}-03-31`).set(as(state.admin));
    const ly = lastYear.body.data.rows.find((r) => r.name === 'March Kirana');
    expect(ly).toMatchObject({ opening: 0, receipts: 500 });
    expect(ly.sales).toBeCloseTo(total, 2);
    expect(ly.closing).toBeCloseTo(total - 500, 2);

    const stock = await request.get(`/api/v1/reports/hub/run/stock-summary?${range}`).set(as(state.admin));
    expect(stock.status).toBe(200);
    expect(stock.body.data.rows[0]).toMatchObject({ name: 'Year Soap', openingQty: 40 });
    expect(stock.body.data.rows[0].openingValue).toBeCloseTo(1600, 2);
  });

  test('no new document can be dated in the closed year', async () => {
    const res = await request.post('/api/v1/invoices').set(as(state.admin)).send({ customerId: state.customerId, invoiceDate: inPrev('03-30'), items: [{ product: state.productId, qty: 1 }] });
    expect(res.status).toBe(423);
    expect(res.body.code).toBe('BOOKS_CLOSED');
  });

  test('issued documents of the closed year are frozen', async () => {
    const cancel = await request.post(`/api/v1/invoices/${state.invoice.id}/cancel`).set(as(state.admin)).send({ reason: 'Customer asked' });
    expect(cancel.status).toBe(423);
    const edit = await request.patch(`/api/v1/invoices/${state.invoice.id}`).set(as(state.admin)).send({ notes: 'changed' });
    expect(edit.status).toBe(423);
    const bounce = await request.post(`/api/v1/payments/${state.paymentId}/cancel`).set(as(state.admin)).send({ reason: 'Wrong entry' });
    expect(bounce.status).toBe(423);
  });

  test('a draft can move into the new year and then be issued', async () => {
    const issueOld = await request.post(`/api/v1/invoices/${state.draftId}/issue`).set(as(state.admin)).send({});
    expect(issueOld.status).toBe(423);
    const move = await request.patch(`/api/v1/invoices/${state.draftId}`).set(as(state.admin)).send({ invoiceDate: firstOfCurrent });
    expect(move.status).toBe(200);
    const issue = await request.post(`/api/v1/invoices/${state.draftId}/issue`).set(as(state.admin)).send({});
    expect(issue.status).toBe(200);
    expect(issue.body.data.invoiceNo).toContain(CUR);
  });

  test("last year's invoice can still be paid with a new-year receipt", async () => {
    const res = await request.post('/api/v1/payments').set(as(state.admin)).send({
      customerId: state.customerId, amount: 100, mode: 'UPI', reference: 'UPI123', allocations: [{ invoice: state.invoice.id, amount: 100 }], receive: true,
    });
    expect(res.status).toBe(201);
  });

  test('reopening needs a reason and unlocks the year', async () => {
    const noReason = await request.post(`/api/v1/financial-years/${PREV}/reopen`).set(as(state.admin)).send({ reason: 'x' });
    expect(noReason.status).toBe(422);
    const res = await request.post(`/api/v1/financial-years/${PREV}/reopen`).set(as(state.admin)).send({ reason: 'Auditor asked for a correction' });
    expect(res.status).toBe(200);
    const company = await Company.findById(state.companyId).lean();
    expect(company.booksClosedThrough).toBe('');
    const create = await request.post('/api/v1/invoices').set(as(state.admin)).send({ customerId: state.customerId, invoiceDate: inPrev('03-30'), items: [{ product: state.productId, qty: 1 }] });
    expect(create.status).toBe(201);

    // That new draft is open again: close anyway, with the reason.
    const close = await request.post(`/api/v1/financial-years/${PREV}/close`).set(as(state.admin)).send({ notes: 'Correction done, draft left for April', force: true });
    expect(close.status).toBe(200);
    const list = await request.get('/api/v1/financial-years').set(as(state.admin));
    const prev = list.body.data.years.find((y) => y.tag === PREV);
    expect(prev.status).toBe('CLOSED');
    expect(prev.history.map((h) => h.action)).toEqual(['CLOSED', 'REOPENED', 'CLOSED']);
  });
});
