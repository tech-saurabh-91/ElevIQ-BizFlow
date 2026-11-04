import { boot, shutdown, clearDb } from './helpers.js';

let request;
let ExcelJS;
let StockMovement;
const PASSWORD = 'Van#Pass1234';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const call = (token) => ({
  get: (url) => request.get(url).set(as(token)),
  post: (url, body = {}) => request.post(url).set(as(token)).send(body),
});

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  ExcelJS = (await import('exceljs')).default;
  StockMovement = (await import('../src/models/StockMovement.js')).default;
  const Company = (await import('../src/models/Company.js')).default;
  const Setting = (await import('../src/models/Setting.js')).default;
  const User = (await import('../src/models/User.js')).default;
  const { runWithContext } = await import('../src/middlewares/tenantContext.js');
  await clearDb();
  await (await import('../src/services/locationService.js')).seedLocations();

  const company = await Company.create({
    code: 'VANS01',
    slug: 'vans01',
    businessName: 'Van Traders',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    timezone: 'Asia/Kolkata',
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  await runWithContext({ scope: 'company', companyId: String(company._id) }, async () => {
    const settings = await Setting.forCompany(company._id);
    settings.set({ 'order.approvalThreshold': 0, 'invoice.rounding': 'NONE' });
    await settings.save();
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@van.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    const s = await User.create({ companyId: company._id, name: 'Sam Sales', email: 'sam@van.test', password: PASSWORD, role: 'SALESMAN' });
    state.salesmanId = String(s._id);
  });
  const login = async (identifier) => (await request.post('/api/auth/login').send({ identifier, password: PASSWORD })).body.data.accessToken;
  state.admin = await login('admin@van.test');
  state.sam = await login('sam@van.test');
  const admin = call(state.admin);

  state.main = (await admin.post('/api/v1/warehouses', { name: 'Main Godown', code: 'MAIN', type: 'MAIN' })).body.data.id;
  const van = await admin.post('/api/v1/warehouses', { name: 'Van 1', code: 'VAN1', type: 'VAN', parent: state.main, vehicleNumber: 'MH12 AB 1234' });
  state.van = van.body.data.id;
  const product = await admin.post('/api/v1/products', {
    name: 'Biscuit',
    category: 'Snacks',
    unit: 'PCS',
    packUnits: [{ unit: 'PKT', factor: 10 }],
    sellingPrice: 10,
    purchasePrice: 7,
    openingStock: 200,
    openingWarehouse: state.main,
  });
  state.product = product.body.data.id;
  const customer = await admin.post('/api/v1/customers', {
    name: 'Corner Shop',
    phone: '+91 90000 33333',
    address: { country: 'India', state: 'Maharashtra', city: 'Pune' },
    assignedTo: state.salesmanId,
  });
  state.customer = customer.body.data.id;
});

afterAll(async () => {
  await shutdown();
});

describe('Van rules', () => {
  test('a van needs a valid vehicle number', async () => {
    const res = await call(state.admin).post('/api/v1/warehouses', { name: 'Van X', code: 'VANX', type: 'VAN', parent: state.main });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Vehicle number is required/);
  });

  test('vans are assigned to field roles from today or earlier', async () => {
    const admin = call(state.admin);
    const future = new Date(Date.now() + 3 * 86400000).toISOString();
    expect((await admin.post(`/api/v1/warehouses/${state.van}/assignments`, { executive: state.salesmanId, fromDate: future })).status).toBe(400);
    const ok = await admin.post(`/api/v1/warehouses/${state.van}/assignments`, { executive: state.salesmanId, dayCloseMandatory: true });
    expect(ok.status).toBe(201);
  });
});

describe('Loading and selling from a van', () => {
  test('loading moves stock from the parent warehouse to the van', async () => {
    const res = await call(state.admin).post(`/api/v1/vans/${state.van}/load`, { items: [{ product: state.product, qty: 50 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.stock[0]).toMatchObject({ product: state.product, qty: 50 });
    const tooMuch = await call(state.admin).post(`/api/v1/vans/${state.van}/load`, { items: [{ product: state.product, qty: 1000 }] });
    expect(tooMuch.status).toBe(422);
  });

  test('the salesman sees their van and sells from it automatically', async () => {
    const mine = await call(state.sam).get('/api/v1/vans/mine');
    expect(mine.body.data.van.code).toBe('VAN1');
    expect(mine.body.data.stock[0].qty).toBe(50);

    const order = await call(state.sam).post('/api/v1/orders', {
      customerId: state.customer,
      items: [{ product: state.product, qty: 2, unit: 'PKT' }],
      submit: true,
    });
    expect(order.status).toBe(201);
    expect(order.body.data.warehouse?.id || order.body.data.warehouse).toBe(state.van);
    state.order = order.body.data.id;

    const tooBig = await call(state.sam).post('/api/v1/orders', {
      customerId: state.customer,
      items: [{ product: state.product, qty: 6, unit: 'PKT' }], // 60 > 50 on van
    });
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.message).toMatch(/on van VAN1/);
  });

  test('dispatch takes stock from the van', async () => {
    expect((await call(state.admin).post(`/api/v1/orders/${state.order}/dispatch`)).status).toBe(200);
    const stock = await call(state.sam).get(`/api/v1/vans/${state.van}/stock`);
    expect(stock.body.data[0].qty).toBe(30);
  });
});

describe('Day close', () => {
  test('today shows opening, loaded, sold and expected stock', async () => {
    const res = await call(state.sam).get(`/api/v1/vans/${state.van}/day-close`);
    expect(res.status).toBe(200);
    expect(res.body.data.lines[0]).toMatchObject({ opening: 0, loaded: 50, sold: 20, expected: 30 });
  });

  test('an unclosed earlier day blocks new orders until it is settled', async () => {
    // Pretend today's van activity happened yesterday.
    const yesterday = new Date(Date.now() - 86400000);
    await StockMovement.updateMany({ warehouse: state.van }, { $set: { movedAt: yesterday } }).skipTenant();
    const VanAssignment = (await import('../src/models/VanAssignment.js')).default;
    await VanAssignment.updateMany({ warehouse: state.van }, { $set: { fromDate: new Date(Date.now() - 2 * 86400000) } }).skipTenant();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(yesterday);

    const blocked = await call(state.sam).post('/api/v1/orders', {
      customerId: state.customer,
      items: [{ product: state.product, qty: 1 }],
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('DAY_CLOSE_PENDING');

    // A count difference needs an explanation, then is booked into the van.
    const noNote = await call(state.sam).post(`/api/v1/vans/${state.van}/day-close`, {
      date: day,
      counts: [{ product: state.product, counted: 28 }],
      cashDeposited: 0,
    });
    expect(noNote.status).toBe(422);
    const closed = await call(state.sam).post(`/api/v1/vans/${state.van}/day-close`, {
      date: day,
      counts: [{ product: state.product, counted: 28 }],
      cashDeposited: 0,
      notes: '2 packets damaged',
    });
    expect(closed.status).toBe(201);
    expect(closed.body.data).toMatchObject({ stockVarianceQty: -2, cashVariance: 0 });
    expect((await call(state.sam).get(`/api/v1/vans/${state.van}/stock`)).body.data[0].qty).toBe(28);

    const again = await call(state.sam).post(`/api/v1/vans/${state.van}/day-close`, { date: day, notes: 'x' });
    expect(again.status).toBe(409);

    const allowed = await call(state.sam).post('/api/v1/orders', {
      customerId: state.customer,
      items: [{ product: state.product, qty: 1 }],
    });
    expect(allowed.status).toBe(201);
  });

  test('unloading returns stock to the parent warehouse', async () => {
    const res = await call(state.admin).post(`/api/v1/vans/${state.van}/unload`, { items: [{ product: state.product, qty: 28 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.stock).toHaveLength(0);
  });
});

describe('Opening stock import', () => {
  test('a new warehouse gets its opening stock from the pre-filled template', async () => {
    const admin = call(state.admin);
    const sub = (await admin.post('/api/v1/warehouses', { name: 'City Branch', code: 'CITY', type: 'SUB', parent: state.main })).body.data.id;
    const tpl = await request
      .get(`/api/v1/inventory/opening-stock/import/template?warehouse=${sub}`)
      .set(as(state.admin))
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(tpl.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    const sheet = wb.getWorksheet('Opening stock');
    expect(sheet.getRow(2).getCell(2).value).toBe('Biscuit');
    sheet.getRow(2).getCell(4).value = 40;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const upload = (dryRun) =>
      request
        .post(`/api/v1/inventory/opening-stock/import?warehouse=${sub}&dryRun=${dryRun}`)
        .set(as(state.admin))
        .attach('file', buffer, { filename: 'o.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    expect((await upload(true)).body.data).toMatchObject({ total: 1, valid: 1, imported: 0 });
    expect((await upload(false)).body.data.imported).toBe(1);
    // A second opening for the same product and warehouse is refused.
    const twice = await upload(false);
    expect(twice.body.data.imported).toBe(0);
    expect(twice.body.data.errors[0].message).toMatch(/already has stock history/);

    const van = await request
      .get(`/api/v1/inventory/opening-stock/import/template?warehouse=${state.van}`)
      .set(as(state.admin));
    expect(van.status).toBe(400);
  });
});
