import { boot, shutdown, clearDb } from './helpers.js';

/**
 * Bugs found while entering a real FMCG company by hand:
 *  - an inter-state direct invoice charged CGST/SGST (blank place of supply)
 *  - PO payment terms typed as "Net 30" were refused; PO priced tax-inclusive
 *    while its bill added the tax on top
 *  - a supplier on Net 30 got bills due the same day
 *  - a price list could be created already expired
 *  - damaged returns counted as sellable product stock
 *  - the stock shortage message named the warehouse "undefined"
 */

let request;
const PASSWORD = 'LiveFix#Pass123';
const state = {};
const as = (token) => ({ Authorization: `Bearer ${token}` });
const get = (url) => request.get(url).set(as(state.admin));
const post = (url, body) => request.post(url).set(as(state.admin)).send(body);
const patch = (url, body) => request.patch(url).set(as(state.admin)).send(body);
let runWithContext;
const inTenant = (fn) => runWithContext({ scope: 'company', companyId: state.companyId }, fn);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

beforeAll(async () => {
  const { app } = await boot();
  request = (await import('supertest')).default(app);
  const Company = (await import('../src/models/Company.js')).default;
  const Setting = (await import('../src/models/Setting.js')).default;
  const User = (await import('../src/models/User.js')).default;
  const Warehouse = (await import('../src/models/Warehouse.js')).default;
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));
  await clearDb();
  await (await import('../src/services/locationService.js')).seedLocations();

  const company = await Company.create({
    code: 'LIVE01',
    slug: 'live01',
    businessName: 'Noida FMCG',
    status: 'ACTIVE',
    timezone: 'Asia/Kolkata',
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    address: { city: 'Noida', state: 'Uttar Pradesh', country: 'India' },
  });
  state.companyId = String(company._id);
  await inTenant(async () => {
    const settings = await Setting.forCompany(company._id);
    const wh = await Warehouse.create({ name: 'Noida Main Godown', code: 'WH-NOIDA', type: 'MAIN', isDefault: true });
    await Warehouse.create({ name: 'Noida Damaged Stock', code: 'WH-DMG', type: 'DAMAGED', parent: wh._id });
    // Selling prices include tax, as in the company where the bugs showed up.
    settings.set({
      'inventory.defaultWarehouse': wh._id,
      'invoice.rounding': 'NONE',
      'order.approvalThreshold': 0,
      'tax.taxInclusive': true,
      'fieldForce.requireAttendance': false,
      'fieldForce.saleOnlyInVisit': false,
    });
    await settings.save();
    state.warehouseId = String(wh._id);
    await User.create({ companyId: company._id, name: 'Admin', email: 'admin@live.test', password: PASSWORD, role: 'COMPANY_ADMIN' });
  });
  state.admin = (await request.post('/api/auth/login').send({ identifier: 'admin@live.test', password: PASSWORD })).body.data.accessToken;

  const food = await post('/api/v1/product-categories', { level: 'CLASSIFICATION', name: 'Food' });
  const biscuits = await post('/api/v1/product-categories', { level: 'CATEGORY', name: 'Biscuits', parent: food.body.data.id });
  const product = await post('/api/v1/products', {
    name: 'Parle-G 100g',
    classificationId: food.body.data.id,
    categoryId: biscuits.body.data.id,
    unit: 'PCS',
    hsnCode: '1905',
    gstRate: 18,
    mrp: 10,
    sellingPrice: 9,
    purchasePrice: 8,
    openingStock: 100,
    openingWarehouse: state.warehouseId,
  });
  expect(product.status).toBe(201);
  state.productId = product.body.data.id;
  const delhi = await post('/api/v1/customers', {
    name: 'Mittal Super Mart',
    phone: '+91 98110 77882',
    gstin: '07AACFM3344J1ZK',
    address: { country: 'India', state: 'Delhi', city: 'East Delhi', pincode: '110092' },
  });
  expect(delhi.status).toBe(201);
  state.delhiId = delhi.body.data.id;
});

afterAll(async () => {
  await shutdown();
});

describe('Fixes from the live FMCG entry', () => {
  test('a direct invoice to another state charges IGST even when the form sends a blank place of supply', async () => {
    const res = await post('/api/v1/invoices', { customerId: state.delhiId, placeOfSupply: '', items: [{ product: state.productId, qty: 10 }], issue: true });
    expect(res.status).toBe(201);
    expect(res.body.data.placeOfSupply).toBe('Delhi');
    expect(res.body.data.taxBreakup).toMatchObject({ cgst: 0, sgst: 0 });
    expect(res.body.data.taxBreakup.igst).toBeGreaterThan(0);
  });

  test('a supplier on Net 30 gets 30 credit days, and bills fall due 30 days later', async () => {
    const sup = await post('/api/v1/suppliers', {
      name: 'Agarwal FMCG',
      phone: '+91 98111 23456',
      paymentTerms: 'NET_30',
      address: { country: 'India', state: 'Uttar Pradesh', city: 'Ghaziabad' },
    });
    expect(sup.status).toBe(201);
    expect(sup.body.data.creditDays).toBe(30);
    state.supplierId = sup.body.data.id;
    const terms = await patch(`/api/v1/suppliers/${state.supplierId}`, { paymentTerms: 'NET_45' });
    expect(terms.body.data.creditDays).toBe(45);
    await patch(`/api/v1/suppliers/${state.supplierId}`, { paymentTerms: 'NET_30' });
  });

  test('PO payment terms may be typed as "Net 30"; a PO is priced before tax, like its bill', async () => {
    const bad = await post('/api/v1/purchase-orders', { supplierId: state.supplierId, paymentTerms: 'Monthly', items: [{ product: state.productId, qty: 100, unitPrice: 8 }] });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].message).toMatch(/Net 30/);

    const po = await post('/api/v1/purchase-orders', { supplierId: state.supplierId, paymentTerms: 'Net 30', send: true, items: [{ product: state.productId, qty: 100, unitPrice: 8 }] });
    expect(po.status).toBe(201);
    expect(po.body.data.paymentTerms).toBe('NET_30');
    // 100 x 8 = 800 before tax + 18% = 944 (not 800 with the tax inside).
    expect(po.body.data).toMatchObject({ taxableTotal: 800, total: 944 });

    const grn = await post('/api/v1/goods-receipts', { purchaseOrder: po.body.data.id, supplierId: state.supplierId, warehouse: state.warehouseId, post: true, items: [{ product: state.productId, receivedQty: 100, unitCost: 8 }] });
    expect(grn.status).toBe(201);
    const bill = await post('/api/v1/purchase-bills', { supplierId: state.supplierId, supplierInvoiceNo: 'AGF-1', supplierInvoiceDate: today, grnIds: [grn.body.data.id] });
    expect(bill.status).toBe(201);
    expect(bill.body.data.total).toBe(944); // the PO and the bill agree
    const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
    const expected = new Date(`${today}T00:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() + 30);
    expect(day(bill.body.data.dueDate)).toBe(expected.toISOString().slice(0, 10));
  });

  test('a new price list cannot already be expired, but an old one can still be edited', async () => {
    const past = await post('/api/v1/price-lists', { name: 'Old wholesale', validTo: '2020-01-15' });
    expect(past.status).toBe(422);
    expect(past.body.errors.some((e) => /already passed/.test(e.message))).toBe(true);
    const ok = await post('/api/v1/price-lists', { name: 'Wholesale', validTo: '2099-12-31' });
    expect(ok.status).toBe(201);
    const PriceList = (await import('../src/models/PriceList.js')).default;
    await inTenant(() => PriceList.updateOne({ _id: ok.body.data.id }, { $set: { validTo: new Date('2020-01-15') } }));
    const edit = await patch(`/api/v1/price-lists/${ok.body.data.id}`, { description: 'For mandi traders', validTo: '2020-01-15' });
    expect(edit.status).toBe(200);
  });

  test('damaged returns are not counted as sellable stock', async () => {
    const before = (await get(`/api/v1/products/${state.productId}`)).body.data.stock;
    const inv = await post('/api/v1/invoices', { customerId: state.delhiId, items: [{ product: state.productId, qty: 5 }], issue: true });
    expect(inv.status).toBe(201);
    const cn = await post('/api/v1/credit-notes', {
      invoiceId: inv.body.data.id,
      reason: 'DAMAGE',
      items: [{ invoiceItemId: inv.body.data.items[0]._id || inv.body.data.items[0].id, qty: 2 }],
      issue: true,
    });
    expect(cn.status).toBe(201);
    const after = (await get(`/api/v1/products/${state.productId}`)).body.data.stock;
    expect(after).toBe(before - 5); // the 2 damaged packs sit in WH-DMG, not in sellable stock
  });

  test('a stock shortage names the warehouse', async () => {
    const res = await post('/api/v1/invoices', { customerId: state.delhiId, items: [{ product: state.productId, qty: 100000 }], issue: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/undefined/);
  });
});
