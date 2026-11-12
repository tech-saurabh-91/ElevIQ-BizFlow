import { boot, shutdown, clearDb } from './helpers.js';

/**
 * Accounts payable: GRN -> supplier bill (input GST) -> payment, and
 * purchase returns before and after billing.
 */

let request;
const PASSWORD = 'Payables#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const api = {
  get: (url) => request.get(url).set(as(state.admin)),
  post: (url, body) => request.post(url).set(as(state.admin)).send(body),
};
let runWithContext;
let Supplier;
let Product;

const inTenant = (fn) => runWithContext({ scope: 'company', companyId: state.companyId }, fn);
const supplierDoc = () => inTenant(() => Supplier.findById(state.supplierId).lean());
const productDoc = () => inTenant(() => Product.findById(state.productId).lean());

const receive = async (qty, unitCost) => {
  const grn = await api.post('/api/v1/goods-receipts', {
    supplierId: state.supplierId,
    warehouse: state.warehouseId,
    post: true,
    invoiceNo: 'CH-1',
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
  Supplier = (await import('../src/models/Supplier.js')).default;
  Product = (await import('../src/models/Product.js')).default;
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  await clearDb();
  await (await import('../src/services/locationService.js')).seedLocations();

  const company = await Company.create({
    code: 'PAYB01',
    slug: 'payb01',
    businessName: 'Payables Co',
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  });
  state.companyId = String(company._id);
  await inTenant(async () => {
    const settings = await Setting.forCompany(company._id);
    const wh = await Warehouse.create({ name: 'Main', code: 'MAIN', isDefault: true });
    settings.set({ 'inventory.defaultWarehouse': wh._id, 'invoice.rounding': 'NONE', 'tax.regime': 'GST', 'tax.enableCgstSgst': true });
    await settings.save();
    state.warehouseId = String(wh._id);
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@payb.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
    await User.create({ companyId: company._id, name: 'Rep', email: 'rep@payb.test', password: PASSWORD, role: 'SALESMAN' });
  });
  state.admin = (await request.post('/api/auth/login').send({ identifier: 'admin@payb.test', password: PASSWORD })).body.data.accessToken;
  state.rep = (await request.post('/api/auth/login').send({ identifier: 'rep@payb.test', password: PASSWORD })).body.data.accessToken;

  const food = await api.post('/api/v1/product-categories', { level: 'CLASSIFICATION', name: 'Food' });
  const snacks = await api.post('/api/v1/product-categories', { level: 'CATEGORY', name: 'Snacks', parent: food.body.data.id });
  const product = await api.post('/api/v1/products', {
    name: 'Namkeen 200g',
    classificationId: food.body.data.id,
    categoryId: snacks.body.data.id,
    unit: 'PCS',
    hsnCode: '2106',
    gstRate: 18,
    mrp: 20,
    sellingPrice: 15,
    openingStock: 0,
  });
  expect(product.status).toBe(201);
  state.productId = product.body.data.id;
  const supplier = await api.post('/api/v1/suppliers', {
    name: 'Namkeen House',
    phone: '+91 90000 55555',
    creditDays: 15,
    address: { country: 'India', state: 'Maharashtra', city: 'Pune' },
  });
  expect(supplier.status).toBe(201);
  state.supplierId = supplier.body.data.id;
});

afterAll(async () => {
  await shutdown();
});

describe('Supplier bills', () => {
  test('a posted GRN shows up to bill, at its own rate and the product tax rate', async () => {
    state.grn1 = await receive(10, 100); // 1000 + 18%
    const opts = await api.get(`/api/v1/purchase-bills/form-options?supplierId=${state.supplierId}`);
    expect(opts.status).toBe(200);
    expect(opts.body.data.grns).toHaveLength(1);
    expect(opts.body.data.grns[0].lines[0]).toMatchObject({ billable: 10, unitPrice: 100, taxRate: 18 });
  });

  test('booking the bill splits input GST (same state) and adds to what we owe', async () => {
    const bill = await api.post('/api/v1/purchase-bills', {
      supplierId: state.supplierId,
      supplierInvoiceNo: 'NH/101',
      supplierInvoiceDate: '2026-11-10',
      grnIds: [state.grn1.id],
      items: [{ grnItemId: state.grn1.items[0].id || state.grn1.items[0]._id, qty: 8 }],
      otherCharges: 50,
    });
    expect(bill.status).toBe(201);
    const b = bill.body.data;
    expect(b).toMatchObject({ taxableTotal: 800, taxTotal: 144, total: 994, balanceDue: 994, status: 'POSTED' });
    expect(b.taxBreakup).toMatchObject({ cgst: 72, sgst: 72, igst: 0 });
    expect(b.billNo).toMatch(/^PB-/);
    expect(new Date(b.dueDate).toISOString().slice(0, 10)).toBe('2026-11-25'); // +15 credit days
    state.bill1 = b;
    expect((await supplierDoc()).outstanding).toBe(994);

    const again = await api.post('/api/v1/purchase-bills', {
      supplierId: state.supplierId,
      supplierInvoiceNo: 'NH/101',
      supplierInvoiceDate: '2026-11-10',
      grnIds: [state.grn1.id],
    });
    expect(again.status).toBe(409);

    const left = await api.get(`/api/v1/purchase-bills/form-options?supplierId=${state.supplierId}`);
    expect(left.body.data.grns[0].lines[0].billable).toBe(2);
  });

  test('a salesman cannot see supplier bills', async () => {
    expect((await request.get('/api/v1/purchase-bills').set(as(state.rep))).status).toBe(403);
  });
});

describe('Supplier payments', () => {
  test('a payment is set against the oldest bill; the rest is an advance', async () => {
    const pay = await api.post('/api/v1/supplier-payments', { supplierId: state.supplierId, amount: 1000, mode: 'UPI', reference: 'UTR123' });
    expect(pay.status).toBe(201);
    expect(pay.body.data).toMatchObject({ allocatedAmount: 994, advanceAmount: 6 });
    state.payment1 = pay.body.data;
    const bill = await api.get(`/api/v1/purchase-bills/${state.bill1.id}`);
    expect(bill.body.data).toMatchObject({ status: 'PAID', balanceDue: 0, amountPaid: 994 });
    expect((await supplierDoc()).outstanding).toBe(-6); // we paid 6 in advance
  });

  test('a paid bill cannot be cancelled until the payment is', async () => {
    expect((await api.post(`/api/v1/purchase-bills/${state.bill1.id}/cancel`, {})).status).toBe(409);
    const cancel = await api.post(`/api/v1/supplier-payments/${state.payment1.id}/cancel`, { reason: 'Wrong amount' });
    expect(cancel.status).toBe(200);
    expect((await api.get(`/api/v1/purchase-bills/${state.bill1.id}`)).body.data).toMatchObject({ status: 'POSTED', balanceDue: 994 });
    expect((await supplierDoc()).outstanding).toBe(994);

    const part = await api.post('/api/v1/supplier-payments', {
      supplierId: state.supplierId,
      amount: 500,
      allocations: [{ bill: state.bill1.id, amount: 500 }],
    });
    expect(part.status).toBe(201);
    expect((await api.get(`/api/v1/purchase-bills/${state.bill1.id}`)).body.data).toMatchObject({ status: 'PARTIALLY_PAID', balanceDue: 494 });
  });
});

describe('Purchase returns', () => {
  test('unbilled quantity goes back first and is simply not billed', async () => {
    const stockBefore = (await productDoc()).stock;
    const ret = await api.post('/api/v1/purchase-returns', {
      grnId: state.grn1.id,
      items: [{ grnItemId: state.grn1.items[0].id || state.grn1.items[0]._id, qty: 1 }],
      reason: 'Torn packs',
    });
    expect(ret.status).toBe(201);
    expect(ret.body.data.billedTotal).toBe(0);
    expect(ret.body.data.returnNo).toMatch(/^DN-/);
    expect((await productDoc()).stock).toBe(stockBefore - 1);
    expect((await supplierDoc()).outstanding).toBe(494); // nothing owed changes

    const opts = await api.get(`/api/v1/purchase-bills/form-options?supplierId=${state.supplierId}`);
    expect(opts.body.data.grns[0].lines[0].billable).toBe(1); // 10 - 8 billed - 1 returned
  });

  test('beyond that, it comes off the bill at the bill tax rate and cuts what we owe', async () => {
    const ret = await api.post('/api/v1/purchase-returns', {
      grnId: state.grn1.id,
      items: [{ grnItemId: state.grn1.items[0].id || state.grn1.items[0]._id, qty: 3 }], // 1 unbilled + 2 billed
    });
    expect(ret.status).toBe(201);
    expect(ret.body.data.items).toHaveLength(2);
    expect(ret.body.data.billedTotal).toBe(236); // 2 x 100 + 18%
    state.return2 = ret.body.data;
    expect((await api.get(`/api/v1/purchase-bills/${state.bill1.id}`)).body.data).toMatchObject({ returnTotal: 236, balanceDue: 258 });
    expect((await supplierDoc()).outstanding).toBe(258);
    const p = await productDoc();
    expect(p.stock).toBe(6);
    expect(p.avgCost).toBe(100); // returned at what it cost
  });

  test('cannot return more than was received; cancelling a return puts everything back', async () => {
    const tooMany = await api.post('/api/v1/purchase-returns', {
      grnId: state.grn1.id,
      items: [{ grnItemId: state.grn1.items[0].id || state.grn1.items[0]._id, qty: 7 }],
    });
    expect(tooMany.status).toBe(400);

    const cancel = await api.post(`/api/v1/purchase-returns/${state.return2.id}/cancel`, {});
    expect(cancel.status).toBe(200);
    expect((await api.get(`/api/v1/purchase-bills/${state.bill1.id}`)).body.data).toMatchObject({ returnTotal: 0, balanceDue: 494 });
    expect((await supplierDoc()).outstanding).toBe(494);
    expect((await productDoc()).stock).toBe(9);
  });

  test('payables summary adds it up', async () => {
    const s = await api.get('/api/v1/purchase-bills/summary');
    expect(s.status).toBe(200);
    expect(s.body.data).toMatchObject({ openBills: 1, payable: 494 });
  });
});

describe('Goods receipt on a bill', () => {
  test('cannot be cancelled while a bill uses it', async () => {
    const res = await api.post(`/api/v1/goods-receipts/${state.grn1.id}/cancel`, { reason: 'Mistake' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GRN_IN_USE');
  });
});
