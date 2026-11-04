import { boot, shutdown, clearDb } from './helpers.js';

let request;
let ExcelJS;
const PASSWORD = 'Catalog#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const api = {
  get: (url) => request.get(url).set(as(state.admin)),
  post: (url, body) => request.post(url).set(as(state.admin)).send(body),
  patch: (url, body) => request.patch(url).set(as(state.admin)).send(body),
};

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  ExcelJS = (await import('exceljs')).default;
  const Company = (await import('../src/models/Company.js')).default;
  const Setting = (await import('../src/models/Setting.js')).default;
  const User = (await import('../src/models/User.js')).default;
  const Warehouse = (await import('../src/models/Warehouse.js')).default;
  const { runWithContext } = await import('../src/middlewares/tenantContext.js');
  await clearDb();
  await (await import('../src/services/locationService.js')).seedLocations();

  const company = await Company.create({
    code: 'CATA01',
    slug: 'cata01',
    businessName: 'Catalog Co',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  await runWithContext({ scope: 'company', companyId: String(company._id) }, async () => {
    const settings = await Setting.forCompany(company._id);
    const wh = await Warehouse.create({ name: 'Main', code: 'MAIN', isDefault: true });
    settings.set({
      'inventory.defaultWarehouse': wh._id,
      'order.allowNegativeStock': false,
      'order.approvalThreshold': 0,
      'invoice.rounding': 'NONE',
    });
    await settings.save();
    state.warehouseId = String(wh._id);
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@cat.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
  });
  state.admin = (await request.post('/api/auth/login').send({ identifier: 'admin@cat.test', password: PASSWORD })).body.data.accessToken;
});

afterAll(async () => {
  await shutdown();
});

describe('Units and category masters', () => {
  test('default units are created on first use', async () => {
    const res = await api.get('/api/v1/units');
    expect(res.status).toBe(200);
    const codes = res.body.data.map((u) => u.code);
    expect(codes).toEqual(expect.arrayContaining(['PCS', 'PKT', 'BOX', 'CTN', 'KG']));
    expect(res.body.data.find((u) => u.code === 'KG').allowDecimals).toBe(true);
    expect(res.body.data.find((u) => u.code === 'PCS').allowDecimals).toBe(false);
  });

  test('units are unique and upper-cased', async () => {
    expect((await api.post('/api/v1/units', { code: 'tray', name: 'Tray' })).body.data.code).toBe('TRAY');
    expect((await api.post('/api/v1/units', { code: 'TRAY', name: 'Tray' })).status).toBe(409);
  });

  test('classification -> category -> sub-category are linked', async () => {
    const food = await api.post('/api/v1/product-categories', { level: 'CLASSIFICATION', name: 'Food' });
    const biscuits = await api.post('/api/v1/product-categories', { level: 'CATEGORY', name: 'Biscuits', parent: food.body.data.id });
    const glucose = await api.post('/api/v1/product-categories', { level: 'SUBCATEGORY', name: 'Glucose', parent: biscuits.body.data.id });
    expect(glucose.status).toBe(201);
    Object.assign(state, { food: food.body.data.id, biscuits: biscuits.body.data.id, glucose: glucose.body.data.id });

    // A sub-category needs a category parent, not a classification.
    const wrong = await api.post('/api/v1/product-categories', { level: 'SUBCATEGORY', name: 'X', parent: state.food });
    expect(wrong.status).toBe(400);
    const dup = await api.post('/api/v1/product-categories', { level: 'CATEGORY', name: 'biscuits', parent: state.food });
    expect(dup.status).toBe(409);
  });
});

describe('Product rules', () => {
  const product = (extra = {}) => ({
    name: 'Glucose Biscuit 100g',
    classificationId: state.food,
    categoryId: state.biscuits,
    subCategoryId: state.glucose,
    unit: 'PCS',
    packUnits: [{ unit: 'PKT', factor: 10 }, { unit: 'CTN', factor: 120, price: 1000 }],
    hsnCode: '1905',
    gstRate: 18,
    mrp: 10,
    sellingPrice: 9,
    purchasePrice: 7,
    openingStock: 500,
    openingWarehouse: state.warehouseId,
    customCode: 'GB-100',
    ...extra,
  });

  test('creates a product with an auto code, pack units and opening stock in the warehouse', async () => {
    const res = await api.post('/api/v1/products', { ...product(), sku: 'MINE' });
    expect(res.status).toBe(201);
    expect(res.body.data.sku).toBe('PRD-00001');
    expect(res.body.data.category).toBe('Biscuits');
    expect(res.body.data.classification).toBe('Food');
    expect(res.body.data.stock).toBe(500);
    state.productId = res.body.data.id;
  });

  test('rejects bad prices, HSN, GST rate, units and duplicates', async () => {
    const res = await api.post('/api/v1/products', product({
      name: 'Bad One',
      customCode: 'gb-100',
      sellingPrice: 12,
      hsnCode: '19',
      gstRate: 17,
      packUnits: [{ unit: 'PCS', factor: 10 }, { unit: 'PKT', factor: 2.5 }],
    }));
    expect(res.status).toBe(422);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'body.customCode',
        'body.sellingPrice',
        'body.hsnCode',
        'body.gstRate',
        'body.packUnits.0.unit',
        'body.packUnits.1.factor',
      ])
    );
  });

  test('a sub-category must belong to the chosen category', async () => {
    const other = await api.post('/api/v1/product-categories', { level: 'CATEGORY', name: 'Snacks', parent: state.food });
    const res = await api.post('/api/v1/products', product({ name: 'Mismatch', customCode: '', categoryId: other.body.data.id, openingStock: 0 }));
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.field)).toContain('body.subCategoryId');
  });

  test('code and stock cannot be edited; base unit is locked while in stock', async () => {
    const res = await api.patch(`/api/v1/products/${state.productId}`, { sku: 'HACK', stock: 1, sellingPrice: 8.5 });
    expect(res.status).toBe(200);
    expect(res.body.data.sku).toBe('PRD-00001');
    expect(res.body.data.stock).toBe(500);
    const unit = await api.patch(`/api/v1/products/${state.productId}`, { unit: 'KG' });
    expect(unit.status).toBe(422);
  });
});

describe('Selling and buying in packs', () => {
  beforeAll(async () => {
    const customer = await api.post('/api/v1/customers', {
      name: 'Pack Buyer',
      phone: '+91 90000 11111',
      address: { country: 'India', state: 'Maharashtra', city: 'Pune' },
    });
    state.customerId = customer.body.data.id;
  });

  test('an order in packets is priced per packet and books base units', async () => {
    const res = await api.post('/api/v1/orders', {
      customerId: state.customerId,
      items: [
        { product: state.productId, qty: 2, unit: 'PKT' },
        { product: state.productId, qty: 3 },
      ],
      submit: true,
    });
    expect(res.status).toBe(201);
    const [pkt, pcs] = res.body.data.items;
    expect(pkt).toMatchObject({ unit: 'PKT', unitFactor: 10, baseQty: 20, unitPrice: 85 }); // 8.5 x 10
    expect(pcs).toMatchObject({ unit: 'PCS', unitFactor: 1, baseQty: 3, unitPrice: 8.5 });

    const dispatched = await api.post(`/api/v1/orders/${res.body.data.id}/dispatch`, {});
    expect(dispatched.status).toBe(200);
    expect((await api.get(`/api/v1/products/${state.productId}`)).body.data.stock).toBe(477); // 500 - 23
  });

  test('a pack with its own price uses it; half packs are refused', async () => {
    const res = await api.post('/api/v1/orders', {
      customerId: state.customerId,
      items: [{ product: state.productId, qty: 1, unit: 'CTN' }],
    });
    expect(res.body.data.items[0]).toMatchObject({ unitPrice: 1000, baseQty: 120 });
    const half = await api.post('/api/v1/orders', {
      customerId: state.customerId,
      items: [{ product: state.productId, qty: 1.5, unit: 'PKT' }],
    });
    expect(half.status).toBe(400);
    const unknown = await api.post('/api/v1/orders', {
      customerId: state.customerId,
      items: [{ product: state.productId, qty: 1, unit: 'KG' }],
    });
    expect(unknown.status).toBe(400);
  });

  test('stock is checked in base units across packs', async () => {
    const res = await api.post('/api/v1/orders', {
      customerId: state.customerId,
      items: [{ product: state.productId, qty: 4, unit: 'CTN' }], // 480 > 477
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
  });

  test('buying in cartons adds base units to stock at the per-unit cost', async () => {
    const supplier = await api.post('/api/v1/suppliers', { name: 'Biscuit Mills', phone: '+91 90000 22222' });
    const po = await api.post('/api/v1/purchase-orders', {
      supplierId: supplier.body.data.id,
      warehouse: state.warehouseId,
      items: [{ product: state.productId, qty: 2, unit: 'CTN' }],
    });
    expect(po.status).toBe(201);
    expect(po.body.data.items[0]).toMatchObject({ unit: 'CTN', unitFactor: 120, unitPrice: 840 }); // 7 x 120

    const grn = await api.post('/api/v1/goods-receipts', {
      purchaseOrder: po.body.data.id,
      warehouse: state.warehouseId,
      post: true,
      items: [{ product: state.productId, receivedQty: 2, unitCost: 840 }],
    });
    expect(grn.status).toBe(201);
    expect((await api.get(`/api/v1/products/${state.productId}`)).body.data.stock).toBe(717); // 477 + 240
  });
});

describe('Product import', () => {
  const upload = async (rows, dryRun) => {
    const tpl = await request
      .get('/api/v1/products/import/template')
      .set(as(state.admin))
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body);
    const sheet = wb.getWorksheet('Products');
    const headers = sheet.getRow(1).values.slice(1).map((h) => String(h).replace(/\s*\*$/, ''));
    rows.forEach((row, i) => headers.forEach((h, c) => {
      if (row[h] !== undefined) sheet.getRow(i + 2).getCell(c + 1).value = row[h];
    }));
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return request
      .post(`/api/v1/products/import?dryRun=${dryRun}`)
      .set(as(state.admin))
      .attach('file', buffer, { filename: 'p.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };
  const row = (n, extra = {}) => ({
    'Product name': `Imported Biscuit ${n}`,
    Classification: 'Food',
    Category: 'biscuits',
    'Base unit': 'pcs',
    'Pack 1 unit': 'PKT',
    'Pack 1 contains': 12,
    'HSN/SAC code': '1905',
    'Tax rate %': 18,
    MRP: 20,
    'Selling price': 18,
    ...extra,
  });

  test('reports problems by row and imports nothing', async () => {
    const res = await upload([row(1), row(2, { Category: 'Toys', 'Selling price': 25 })], false);
    expect(res.body.data.imported).toBe(0);
    const errs = res.body.data.errors;
    expect(errs.some((e) => e.row === 3 && e.column === 'Category')).toBe(true);
    expect(errs.some((e) => e.row === 3 && e.column === 'Selling price')).toBe(true);
  });

  test('imports clean rows with generated codes and pack units', async () => {
    const res = await upload([row(1), row(2, { 'Opening stock': 24, 'Opening warehouse code': 'MAIN' })], false);
    expect(res.body.data).toMatchObject({ total: 2, imported: 2 });
    const list = await api.get('/api/v1/products?search=Imported Biscuit');
    expect(list.body.data).toHaveLength(2);
    const two = list.body.data.find((p) => p.name.endsWith('2'));
    expect(two.category).toBe('Biscuits');
    expect(two.unit).toBe('PCS');
    expect(two.packUnits[0]).toMatchObject({ unit: 'PKT', factor: 12 });
    expect(two.stock).toBe(24);
  });
});
