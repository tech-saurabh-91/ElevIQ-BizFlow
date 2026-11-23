import { boot, shutdown, clearDb } from './helpers.js';

/** New financial year setup: copy targets, extend validity, next numbers. */

let request;
const PASSWORD = 'NewYear#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
let runWithContext;
let models;
const inTenant = (fn) => runWithContext({ scope: 'company', companyId: state.companyId }, fn);

// Current and previous Indian financial years.
const todayIn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const [ty, tm] = todayIn.split('-').map(Number);
const curStart = tm >= 4 ? ty : ty - 1;
const prevStart = curStart - 1;
const ist = (day) => new Date(`${day}T00:00:00+05:30`);

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  const load = async (n) => (await import(`../src/models/${n}.js`)).default;
  models = Object.fromEntries(
    await Promise.all(
      ['Company', 'User', 'Route', 'Target', 'Scheme', 'PriceList', 'DiscountRule'].map(
        async (n) => [n, await load(n)]
      )
    )
  );
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  await clearDb();

  const company = await models.Company.create({
    code: 'NYR',
    slug: 'nyr',
    businessName: 'New Year Traders',
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    financialYearStartMonth: 4,
    subscriptionEnd: new Date(Date.now() + 365 * 864e5),
  });
  state.companyId = String(company._id);
  await inTenant(async () => {
    const { User, Route, Target, Scheme, PriceList, DiscountRule } = models;
    await User.create({
      companyId: company._id,
      name: 'Admin',
      email: 'admin@ny.test',
      password: PASSWORD,
      role: 'COMPANY_ADMIN',
    });
    await User.create({
      companyId: company._id,
      name: 'Acc',
      email: 'acc@ny.test',
      password: PASSWORD,
      role: 'ACCOUNTANT',
    });
    const sam = await User.create({
      companyId: company._id,
      name: 'Sam',
      email: 'sam@ny.test',
      password: PASSWORD,
      role: 'SALESMAN',
    });
    const gone = await User.create({
      companyId: company._id,
      name: 'Gone',
      email: 'gone@ny.test',
      password: PASSWORD,
      role: 'SALESMAN',
      isActive: false,
    });
    const route = await Route.create({ companyId: company._id, name: 'East Beat', code: 'E1' });
    const month = (y, m, who, value) => ({
      companyId: company._id,
      periodType: 'MONTH',
      periodKey: `${y}-${String(m).padStart(2, '0')}`,
      periodLabel: `M ${y}-${m}`,
      startDate: new Date(y, m - 1, 1),
      endDate: new Date(y, m, 0, 23, 59, 59),
      targetValue: value,
      targetOrders: 10,
      ...who,
    });
    await Target.create([
      month(prevStart, 5, { salesman: sam._id, salesmanName: 'Sam' }, 100000),
      month(prevStart + 1, 2, { route: route._id, routeName: 'East Beat' }, 50000),
      month(prevStart, 6, { salesman: gone._id, salesmanName: 'Gone' }, 70000),
    ]);
    state.sam = String(sam._id);
    await Scheme.create({
      companyId: company._id,
      name: 'Year-end scheme',
      type: 'QTY_DISCOUNT',
      validFrom: ist(`${prevStart}-04-01`),
      validTo: ist(`${curStart}-03-25`),
      slabs: [{ from: 10, discountPercent: 5 }],
    });
    const pl = await PriceList.create({
      companyId: company._id,
      name: 'FY price list',
      validFrom: ist(`${prevStart}-04-01`),
      validTo: ist(`${curStart}-03-31`),
    });
    state.priceList = String(pl._id);
    await PriceList.create({ companyId: company._id, name: 'Open-ended list' });
    await DiscountRule.create({
      companyId: company._id,
      name: 'Old festival',
      discountPercent: 5,
      validTo: ist(`${prevStart}-11-01`),
    });
  });
  const login = async (email) =>
    (await request.post('/api/auth/login').send({ identifier: email, password: PASSWORD })).body
      .data.accessToken;
  state.admin = await login('admin@ny.test');
  state.acc = await login('acc@ny.test');
});

afterAll(async () => {
  await shutdown();
});

describe('New year setup', () => {
  test('lists last year targets to copy, validity ending around the year end and next numbers', async () => {
    const res = await request.get('/api/v1/financial-years/new-year').set(as(state.admin));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.targets).toMatchObject({ total: 3, toCopy: 3 });
    const names = d.validity.map((v) => v.name);
    expect(names).toEqual(expect.arrayContaining(['Year-end scheme', 'FY price list']));
    expect(names).not.toContain('Open-ended list');
    expect(names).not.toContain('Old festival'); // ended long before the year end
    expect(d.numbering.find((n) => n.key === 'invoice').next).toBe(
      `INV-${String(curStart).slice(-2)}${String(curStart + 1).slice(-2)}-000001`
    );
  });

  test('copies targets one year on with the change, skipping inactive salesmen and copies already made', async () => {
    const res = await request
      .post('/api/v1/financial-years/new-year/targets')
      .set(as(state.admin))
      .send({ percent: 10 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 2, skipped: { exists: 0, inactive: 1 } });
    const copied = await inTenant(() =>
      models.Target.findOne({ salesman: state.sam, periodKey: `${curStart}-05` }).lean()
    );
    expect(copied).toMatchObject({ periodType: 'MONTH', targetValue: 110000, targetOrders: 11 });
    const again = await request
      .post('/api/v1/financial-years/new-year/targets')
      .set(as(state.admin))
      .send({});
    expect(again.body.data).toMatchObject({ created: 0, skipped: { exists: 2 } });
  });

  test('extends validity to the end of this year, only with the right permission', async () => {
    const acc = await request
      .post('/api/v1/financial-years/new-year/extend')
      .set(as(state.acc))
      .send({ items: [{ kind: 'PRICE_LIST', id: state.priceList }] });
    expect(acc.status).toBe(403);
    const res = await request
      .post('/api/v1/financial-years/new-year/extend')
      .set(as(state.admin))
      .send({ items: [{ kind: 'PRICE_LIST', id: state.priceList }] });
    expect(res.status).toBe(200);
    expect(res.body.data.extended).toHaveLength(1);
    const pl = await inTenant(() => models.PriceList.findById(state.priceList).lean());
    const lastDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
      pl.validTo
    );
    expect(lastDay).toBe(`${curStart + 1}-03-31`);
    const past = await request
      .post('/api/v1/financial-years/new-year/extend')
      .set(as(state.admin))
      .send({ items: [{ kind: 'PRICE_LIST', id: state.priceList }], validTo: '2001-01-01' });
    expect(past.status).toBe(400);
  });
});
