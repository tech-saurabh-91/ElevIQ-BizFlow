import { boot, shutdown, clearDb } from './helpers.js';

/**
 * Moving average cost: purchases blend into the average, sales and transfers
 * leave at it, reversals undo at the original cost, and each invoice line
 * keeps what its goods cost when it was issued.
 */

let request;
const PASSWORD = 'Costing#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const api = {
  get: (url) => request.get(url).set(as(state.admin)),
  post: (url, body) => request.post(url).set(as(state.admin)).send(body),
  patch: (url, body) => request.patch(url).set(as(state.admin)).send(body),
};
let Product;
let StockBalance;
let StockMovement;
let runWithContext;

const inTenant = (fn) => runWithContext({ scope: 'company', companyId: state.companyId }, fn);
const productDoc = () => inTenant(() => Product.findById(state.productId).lean());

const receive = async (qty, unitCost) => {
  const grn = await api.post('/api/v1/goods-receipts', {
    supplierId: state.supplierId,
    warehouse: state.warehouseId,
    post: true,
    items: [{ product: state.productId, receivedQty: qty, unitCost }],
  });
  expect(grn.status).toBe(201);
  return grn.body.data;
};

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  const Company = (await import('../src/models/Company.js')).default;
  const Setting = (await import('../src/models/Setting.js')).default;
  const User = (await import('../src/models/User.js')).default;
  const Warehouse = (await import('../src/models/Warehouse.js')).default;
  Product = (await import('../src/models/Product.js')).default;
  StockBalance = (await import('../src/models/StockBalance.js')).default;
  StockMovement = (await import('../src/models/StockMovement.js')).default;
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  await clearDb();
  await (await import('../src/services/locationService.js')).seedLocations();

  const company = await Company.create({
    code: 'COST01',
    slug: 'cost01',
    businessName: 'Costing Co',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  state.companyId = String(company._id);
  await inTenant(async () => {
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
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@cost.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
  });
  state.admin = (await request.post('/api/auth/login').send({ identifier: 'admin@cost.test', password: PASSWORD })).body.data.accessToken;

  const food = await api.post('/api/v1/product-categories', { level: 'CLASSIFICATION', name: 'Food' });
  const snacks = await api.post('/api/v1/product-categories', { level: 'CATEGORY', name: 'Snacks', parent: food.body.data.id });
  const chips = await api.post('/api/v1/product-categories', { level: 'SUBCATEGORY', name: 'Chips', parent: snacks.body.data.id });
  const product = await api.post('/api/v1/products', {
    name: 'Masala Chips 50g',
    classificationId: food.body.data.id,
    categoryId: snacks.body.data.id,
    subCategoryId: chips.body.data.id,
    unit: 'PCS',
    packUnits: [{ unit: 'BOX', factor: 10 }],
    hsnCode: '2005',
    gstRate: 0,
    mrp: 20,
    sellingPrice: 15,
    purchasePrice: 0,
    openingStock: 0,
  });
  expect(product.status).toBe(201);
  state.productId = product.body.data.id;

  const supplier = await api.post('/api/v1/suppliers', { name: 'Chips Mills', phone: '+91 90000 33333' });
  state.supplierId = supplier.body.data.id;
  const customer = await api.post('/api/v1/customers', {
    name: 'Cost Buyer',
    phone: '+91 90000 44444',
    address: { country: 'India', state: 'Maharashtra', city: 'Pune' },
  });
  state.customerId = customer.body.data.id;
});

afterAll(async () => {
  await shutdown();
});

describe('Moving average cost', () => {
  test('purchases blend into the average; the last rate becomes the purchase price', async () => {
    await receive(10, 8); // 10 @ 8
    let p = await productDoc();
    expect(p.avgCost).toBe(8);
    expect(p.purchasePrice).toBe(8);

    state.secondGrn = await receive(10, 10); // + 10 @ 10 -> avg 9
    p = await productDoc();
    expect(p.stock).toBe(20);
    expect(p.avgCost).toBe(9);
    expect(p.purchasePrice).toBe(10);
  });

  test('a sale leaves at the average cost, not the selling price, and the invoice keeps it', async () => {
    const inv = await api.post('/api/v1/invoices', {
      customerId: state.customerId,
      items: [{ product: state.productId, qty: 1, unit: 'BOX' }], // 10 pcs @ 15
      issue: true,
    });
    expect(inv.status).toBe(201);
    state.invoiceId = inv.body.data.id;
    expect(inv.body.data.items[0].costPrice).toBe(90); // 1 BOX = 10 x avg 9

    const out = await inTenant(() => StockMovement.findOne({ refType: 'INVOICE', refId: state.invoiceId }).lean());
    expect(out.qty).toBe(-10);
    expect(out.unitCost).toBe(9);
    expect(out.value).toBe(-90);

    const p = await productDoc();
    expect(p.stock).toBe(10);
    expect(p.avgCost).toBe(9); // a sale does not move the average
  });

  test('stock value is quantity x average cost', async () => {
    const res = await api.get('/api/v1/inventory/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.stockValue).toBe(90); // 10 pcs x avg 9
  });

  test('cancelling the invoice brings the goods back at what they cost', async () => {
    const res = await api.post(`/api/v1/invoices/${state.invoiceId}/cancel`, { reason: 'Wrong customer' });
    expect(res.status).toBe(200);
    const p = await productDoc();
    expect(p.stock).toBe(20);
    expect(p.avgCost).toBe(9);
  });

  test('cancelling a goods receipt takes it back out at its own cost', async () => {
    const res = await api.post(`/api/v1/goods-receipts/${state.secondGrn.id}/cancel`, { reason: 'Supplier sent wrong lot' });
    expect(res.status).toBe(200);
    const p = await productDoc();
    expect(p.stock).toBe(10);
    expect(p.avgCost).toBe(8); // back to the first receipt only
  });

  test('when allowed, a shortage shows as negative stock and the next purchase sets the average', async () => {
    const Setting = (await import('../src/models/Setting.js')).default;
    await inTenant(async () => {
      const s = await Setting.forCompany(state.companyId);
      s.set({ 'order.allowNegativeStock': true });
      await s.save();
    });

    const inv = await api.post('/api/v1/invoices', {
      customerId: state.customerId,
      items: [{ product: state.productId, qty: 15 }], // 10 on hand
      issue: true,
    });
    expect(inv.status).toBe(201);
    const bal = await inTenant(() => StockBalance.findOne({ product: state.productId, warehouse: state.warehouseId }).lean());
    expect(bal.qty).toBe(-5);
    expect((await productDoc()).stock).toBe(-5);

    await receive(20, 12); // first 5 fill the shortage; average restarts at 12
    const p = await productDoc();
    expect(p.stock).toBe(15);
    expect(p.avgCost).toBe(12);
  });
});

describe('costMovement', () => {
  test('averages, passes through and reverses', async () => {
    const { costMovement } = await import('../src/services/inventoryService.js');
    const product = { stock: 10, avgCost: 8 };
    expect(costMovement({ product, delta: 10, type: 'PURCHASE_RECEIPT', unitCost: 10 })).toEqual({ cost: 10, avg: 9 });
    expect(costMovement({ product, delta: -4, type: 'SALES_OUT', unitCost: 15 })).toEqual({ cost: 8, avg: 8 });
    expect(costMovement({ product, delta: 5, type: 'TRANSFER_IN', unitCost: 99 })).toEqual({ cost: 8, avg: 8 });
    // Undo 5 received @ 12 from 10 @ ~9.6 -> back to 10 x ...
    expect(costMovement({ product: { stock: 15, avgCost: 9.3333 }, delta: -5, type: 'PURCHASE_RECEIPT', unitCost: 8, reversal: true }).avg).toBeCloseTo(10, 2);
  });
});

describe('Cost visibility', () => {
  test('a salesman never receives purchase price or average cost', async () => {
    const User = (await import('../src/models/User.js')).default;
    await inTenant(() =>
      User.create({ companyId: state.companyId, name: 'Rep', email: 'rep@cost.test', password: PASSWORD, role: 'SALESMAN' })
    );
    const rep = (await request.post('/api/auth/login').send({ identifier: 'rep@cost.test', password: PASSWORD })).body.data.accessToken;

    const asRep = await request.get(`/api/v1/products/${state.productId}`).set(as(rep));
    expect(asRep.status).toBe(200);
    expect(asRep.body.data.sellingPrice).toBe(15);
    expect(asRep.body.data.purchasePrice).toBeUndefined();
    expect(asRep.body.data.avgCost).toBeUndefined();

    const lookups = await request.get('/api/v1/lookups').set(as(rep));
    expect(JSON.stringify(lookups.body)).not.toMatch(/purchasePrice|avgCost/);

    const asAdmin = await api.get(`/api/v1/products/${state.productId}`);
    expect(asAdmin.body.data.avgCost).toBe(12);
    expect((await request.get('/api/v1/products/price-review').set(as(rep))).status).toBe(403);
  });
});

describe('Price review', () => {
  test('a purchase that moves the cost puts the product up for review with a suggested price', async () => {
    const Setting = (await import('../src/models/Setting.js')).default;
    await inTenant(async () => {
      const s = await Setting.forCompany(state.companyId);
      s.set({ 'inventory.defaultMarkupPercent': 25 });
      await s.save();
    });
    const list = await api.get('/api/v1/products/price-review');
    expect(list.status).toBe(200);
    const row = list.body.data.find((r) => r.id === state.productId);
    expect(row).toMatchObject({ avgCost: 12, sellingPrice: 15, costChanged: true, suggestedPrice: 15 }); // 12 x 1.25
    expect(row.marginPercent).toBe(20);

    const save = await api.post('/api/v1/products/price-review', { items: [{ id: state.productId, sellingPrice: 16 }] });
    expect(save.status).toBe(200);
    const after = await api.get('/api/v1/products/price-review');
    expect(after.body.data.find((r) => r.id === state.productId)).toBeUndefined();
    expect((await productDoc()).sellingPrice).toBe(16);

    const overMrp = await api.post('/api/v1/products/price-review', { items: [{ id: state.productId, sellingPrice: 25 }] });
    expect(overMrp.status).toBe(422);
  });

  test('a product sold below its cost is always listed', async () => {
    await api.patch(`/api/v1/products/${state.productId}`, { sellingPrice: 10 });
    const list = await api.get('/api/v1/products/price-review');
    expect(list.body.data.find((r) => r.id === state.productId)).toMatchObject({ belowCost: true });
    await api.patch(`/api/v1/products/${state.productId}`, { sellingPrice: 16 });
  });
});
