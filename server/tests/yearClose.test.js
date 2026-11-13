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
    const customer = await Customer.create({ companyId: company._id, name: 'March Kirana', code: 'CUS-1', phone: '9876543210', createdAt: new Date(`${prevStart}-12-01`) });
    const product = await Product.create({ companyId: company._id, name: 'Year Soap', sku: 'YSOAP', unit: 'PCS', gstRate: 18, sellingPrice: 100, mrp: 120, isActive: true });
    const godown = await Warehouse.create({ companyId: company._id, name: 'Main Godown', code: 'MAIN', type: 'MAIN', isDefault: true });
    state.warehouseId = String(godown._id);
    state.customerId = String(customer._id);
    state.productId = String(product._id);
  });
  state.admin = await login('admin@yearend.test');
  state.accountant = await login('acc@yearend.test');

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

  test('closing records totals and closing balances', async () => {
    const res = await request.post(`/api/v1/financial-years/${PREV}/close`).set(as(state.admin)).send({ notes: 'Audited' });
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

    const close = await request.post(`/api/v1/financial-years/${PREV}/close`).set(as(state.admin)).send({});
    expect(close.status).toBe(200);
    const list = await request.get('/api/v1/financial-years').set(as(state.admin));
    const prev = list.body.data.years.find((y) => y.tag === PREV);
    expect(prev.status).toBe('CLOSED');
    expect(prev.history.map((h) => h.action)).toEqual(['CLOSED', 'REOPENED', 'CLOSED']);
  });
});
