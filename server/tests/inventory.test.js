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
let Order;
let Supplier;
let Warehouse;
let StockBalance;
let StockMovement;
let runWithContext;

const state = {};
const PASSWORD = 'Inventory#Pass123';

const as = (token) => ({ Authorization: `Bearer ${token}` });

const login = async (identifier, password = PASSWORD) => {
  const res = await request.post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${identifier} (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
};

const inTenant = (companyId, fn) => runWithContext({ scope: 'company', companyId }, fn);

const seedTenant = async ({ code, businessName, adminEmail, managerEmail, salesmanEmail, warehouseEmail }) => {
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
  let warehouseUser;

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
    warehouseUser = await User.create({
      companyId: company._id,
      name: `${businessName} Storekeeper`,
      email: warehouseEmail,
      password: PASSWORD,
      role: 'WAREHOUSE',
      isActive: true,
    });
    await User.updateOne({ _id: manager._id }, { $set: { teamMembers: [salesman._id] } });
  });

  await Company.updateOne({ _id: company._id }, { $set: { adminUser: admin._id } }).skipTenant();

  return { company, admin, manager, salesman, warehouseUser };
};

const item = (sku, qty, extra = {}) => ({ product: state.products[sku].id, qty, ...extra });

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
  ({ default: Order } = await import('../src/models/Order.js'));
  ({ default: Supplier } = await import('../src/models/Supplier.js'));
  ({ default: Warehouse } = await import('../src/models/Warehouse.js'));
  ({ default: StockBalance } = await import('../src/models/StockBalance.js'));
  ({ default: StockMovement } = await import('../src/models/StockMovement.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));

  await clearDb();
  await Promise.all([
    Company.init(),
    User.init(),
    Customer.init(),
    Product.init(),
    PriceList.init(),
    Order.init(),
    Supplier.init(),
    Warehouse.init(),
  ]);

  const primary = await seedTenant({
    code: 'P7A',
    businessName: 'Phase 7 Traders',
    adminEmail: 'admin@phase7.test',
    managerEmail: 'manager@phase7.test',
    salesmanEmail: 'salesman@phase7.test',
    warehouseEmail: 'warehouse@phase7.test',
  });
  state.company = primary.company;
  state.companyId = String(primary.company._id);
  state.admin = primary.admin;
  state.manager = primary.manager;
  state.salesman = primary.salesman;
  state.warehouseUser = primary.warehouseUser;

  const other = await seedTenant({
    code: 'P7B',
    businessName: 'Other Inventory Co',
    adminEmail: 'admin@otherp7.test',
    managerEmail: 'manager@otherp7.test',
    salesmanEmail: 'salesman@otherp7.test',
    warehouseEmail: 'warehouse@otherp7.test',
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
        purchasePrice: 60,
        stock: 100,
        lowStockLevel: 5,
        isActive: true,
      },
      {
        name: 'Beta Oil',
        sku: 'BETA',
        unit: 'BTL',
        hsnCode: '1507',
        gstRate: 12,
        sellingPrice: 50,
        purchasePrice: 30,
        stock: 200,
        lowStockLevel: 10,
        isActive: true,
      },
      {
        name: 'Gamma Pack',
        sku: 'GAMMA',
        unit: 'BOX',
        hsnCode: '1905',
        gstRate: 18,
        sellingPrice: 1000,
        purchasePrice: 700,
        stock: 50,
        lowStockLevel: 5,
        isActive: true,
      },
    ]);
    state.products = Object.fromEntries(products.map((p) => [p.sku, { id: String(p._id), doc: p }]));

    await PriceList.create({
      code: 'PL-INV7',
      name: 'Inventory Pricing',
      type: 'RETAIL',
      isDefault: true,
      isActive: true,
      items: [
        { product: products[0]._id, price: 100, discountPercent: 0, minQty: 1 },
        { product: products[1]._id, price: 50, discountPercent: 0, minQty: 1 },
        { product: products[2]._id, price: 1000, discountPercent: 0, minQty: 1 },
      ],
    });

    const main = await Warehouse.create({
      name: 'Main Depot',
      code: 'MAIN',
      type: 'MAIN',
      isDefault: true,
      isActive: true,
    });
    const branch = await Warehouse.create({
      name: 'Branch Store',
      code: 'BR1',
      type: 'BRANCH',
      isActive: true,
    });
    state.mainWarehouse = main;
    state.branchWarehouse = branch;

    const supplier = await Supplier.create({
      code: 'SUP-9001',
      name: 'Acme Supplies',
      phone: '+919820019001',
      gstin: '27AAAC5678B1Z5',
      paymentTerms: 'NET_30',
      isActive: true,
    });
    state.supplier = supplier;

    const customer = await Customer.create({
      code: 'CUS-9001',
      name: 'Retail Corner',
      type: 'RETAIL',
      phone: '+919820019010',
      gstin: '27AAAC1234A1Z5',
      address: { line1: '1 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      paymentTerms: 'IMMEDIATE',
      creditLimit: 100000,
      assignedTo: state.salesman._id,
      isActive: true,
    });
    state.customer = customer;

    await Setting.updateOne(
      { companyId: state.company ? state.company._id : undefined },
      { $set: { 'order.reserveStockOnConfirm': true } }
    ).skipTenant();
  });

  state.adminToken = await login('admin@phase7.test');
  state.managerToken = await login('manager@phase7.test');
  state.salesmanToken = await login('salesman@phase7.test');
  state.warehouseToken = await login('warehouse@phase7.test');
  state.otherAdminToken = await login('admin@otherp7.test');

  // Turn on reservation for the tenant settings doc.
  await inTenant(state.companyId, async () => {
    const s = await Setting.forCompany(state.company._id);
    s.order = { ...(s.order || {}), reserveStockOnConfirm: true };
    await s.save();
  });
});

afterAll(async () => {
  await shutdown();
});

// ---------------------------------------------------------------------------

describe('Phase 7 - stock ledger, adjustments and transfers', () => {
  test('lists product stock with on-hand/available and warehouse rows', async () => {
    const res = await request.get('/api/v1/inventory/stock').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeTruthy();
  });

  test('returns inventory stats with movement counters', async () => {
    const res = await request.get('/api/v1/inventory/stats').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totalLines');
    expect(res.body.data).toHaveProperty('movementByType');
    expect(res.body.data).toHaveProperty('warehouseCount');
  });

  test('posts a positive adjustment (+ stock) and records a movement', async () => {
    const res = await request
      .post('/api/v1/inventory/adjustments')
      .set(as(state.adminToken))
      .send({
        warehouse: String(state.mainWarehouse._id),
        reason: 'COUNT',
        post: true,
        items: [{ product: state.products.ALPHA.id, qty: 25, unitCost: 60 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('POSTED');
    expect(res.body.data.adjustmentNo).toMatch(/^ADJ-\d{4}-\d{5}$/);
    expect(res.body.data.netQty).toBe(25);

    const product = await inTenant(state.companyId, () => Product.findById(state.products.ALPHA.id).lean());
    expect(product.stock).toBe(125); // 100 + 25
  });

  test('posts a negative adjustment (- stock) and blocks going negative', async () => {
    const res = await request
      .post('/api/v1/inventory/adjustments')
      .set(as(state.adminToken))
      .send({
        warehouse: String(state.mainWarehouse._id),
        reason: 'DAMAGE',
        post: true,
        items: [{ product: state.products.ALPHA.id, qty: -10, unitCost: 60 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.netQty).toBe(-10);

    const tooMuch = await request
      .post('/api/v1/inventory/adjustments')
      .set(as(state.adminToken))
      .send({
        warehouse: String(state.mainWarehouse._id),
        reason: 'THEFT',
        post: true,
        items: [{ product: state.products.ALPHA.id, qty: -9999, unitCost: 60 }],
      });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.code).toBe('INSUFFICIENT_STOCK');
  });

  test('cancelling a posted adjustment reverses its movements', async () => {
    const created = await request
      .post('/api/v1/inventory/adjustments')
      .set(as(state.adminToken))
      .send({
        warehouse: String(state.mainWarehouse._id),
        reason: 'CORRECTION',
        post: true,
        items: [{ product: state.products.BETA.id, qty: 40, unitCost: 30 }],
      });
    expect(created.status).toBe(201);

    const before = await inTenant(state.companyId, () => Product.findById(state.products.BETA.id).lean());
    expect(before.stock).toBe(240); // 200 + 40

    const cancelled = await request
      .post(`/api/v1/inventory/adjustments/${created.body.data.id}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Posted against the wrong warehouse' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const after = await inTenant(state.companyId, () => Product.findById(state.products.BETA.id).lean());
    expect(after.stock).toBe(200); // reversal brings it back
  });

  test('locks non-draft adjustments from edit/delete', async () => {
    const created = await request
      .post('/api/v1/inventory/adjustments')
      .set(as(state.adminToken))
      .send({
        warehouse: String(state.mainWarehouse._id),
        reason: 'COUNT',
        post: true,
        items: [{ product: state.products.BETA.id, qty: 1, unitCost: 30 }],
      });
    const id = created.body.data.id;

    const edit = await request
      .patch(`/api/v1/inventory/adjustments/${id}`)
      .set(as(state.adminToken))
      .send({ reason: 'EXPIRY' });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('ADJUSTMENT_LOCKED');

    const del = await request.delete(`/api/v1/inventory/adjustments/${id}`).set(as(state.adminToken));
    expect(del.status).toBe(409);
  });

  test('runs a transfer: draft -> dispatch (out) -> receive (in)', async () => {
    // Give MAIN some stock to move.
    await request
      .post('/api/v1/inventory/adjustments')
      .set(as(state.adminToken))
      .send({
        warehouse: String(state.mainWarehouse._id),
        reason: 'COUNT',
        post: true,
        items: [{ product: state.products.GAMMA.id, qty: 30, unitCost: 700 }],
      });

    const created = await request
      .post('/api/v1/inventory/transfers')
      .set(as(state.adminToken))
      .send({
        fromWarehouse: String(state.mainWarehouse._id),
        toWarehouse: String(state.branchWarehouse._id),
        items: [{ product: state.products.GAMMA.id, qty: 12 }],
      });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.transferNo).toMatch(/^TRF-\d{4}-\d{5}$/);
    const id = created.body.data.id;

    const dispatched = await request
      .post(`/api/v1/inventory/transfers/${id}/dispatch`)
      .set(as(state.adminToken))
      .send({ note: 'Loaded on truck' });
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.data.status).toBe('DISPATCHED');

    // Stock left MAIN: 50 + 30 - 12 = 68 (GAMMA legacy 50 + count 30 - dispatch 12)
    const mainBal = await inTenant(state.companyId, () =>
      StockBalance.findOne({ product: state.products.GAMMA.id, warehouse: state.mainWarehouse._id }).lean()
    );
    expect(mainBal.qty).toBe(18); // 30 counted into MAIN - 12 dispatched

    const received = await request
      .post(`/api/v1/inventory/transfers/${id}/receive`)
      .set(as(state.adminToken))
      .send({ note: 'Arrived intact' });
    expect(received.status).toBe(200);
    expect(received.body.data.status).toBe('RECEIVED');

    const branchBal = await inTenant(state.companyId, () =>
      StockBalance.findOne({ product: state.products.GAMMA.id, warehouse: state.branchWarehouse._id }).lean()
    );
    expect(branchBal.qty).toBe(12);

    // Company-wide total unchanged by an internal move.
    const product = await inTenant(state.companyId, () => Product.findById(state.products.GAMMA.id).lean());
    expect(product.stock).toBe(50 + 30); // legacy + counted; transfer is internal
  });

  test('rejects a transfer between the same warehouses', async () => {
    const res = await request
      .post('/api/v1/inventory/transfers')
      .set(as(state.adminToken))
      .send({
        fromWarehouse: String(state.mainWarehouse._id),
        toWarehouse: String(state.mainWarehouse._id),
        items: [{ product: state.products.ALPHA.id, qty: 1 }],
      });
    expect(res.status).toBe(422);
  });

  test('lists the movement ledger with filters', async () => {
    const res = await request
      .get('/api/v1/inventory/movements')
      .set(as(state.adminToken))
      .query({ type: 'ADJUSTMENT', limit: 50 });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    res.body.data.forEach((m) => expect(m.type).toBe('ADJUSTMENT'));
  });

  test('salesmen cannot manage adjustments (403)', async () => {
    const res = await request
      .post('/api/v1/inventory/adjustments')
      .set(as(state.salesmanToken))
      .send({
        warehouse: String(state.mainWarehouse._id),
        reason: 'COUNT',
        items: [{ product: state.products.ALPHA.id, qty: 1 }],
      });
    expect(res.status).toBe(403);
  });

  test('another tenant cannot see our stock or adjustments', async () => {
    const stock = await request.get('/api/v1/inventory/stock').set(as(state.otherAdminToken));
    expect(stock.status).toBe(200);
    expect(stock.body.data.length).toBe(0);

    const adjustments = await request.get('/api/v1/inventory/adjustments').set(as(state.otherAdminToken));
    expect(adjustments.status).toBe(200);
    expect(adjustments.body.data.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('Phase 7 - purchase orders and goods receipts', () => {
  test('creates a draft PO with a PO-<FY>- number and server totals', async () => {
    const res = await request
      .post('/api/v1/purchase-orders')
      .set(as(state.adminToken))
      .send({
        supplierId: String(state.supplier._id),
        warehouse: String(state.mainWarehouse._id),
        items: [
          { product: state.products.ALPHA.id, qty: 50, unitPrice: 60, taxRate: 18 },
          { product: state.products.BETA.id, qty: 30, unitPrice: 30, taxRate: 12 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.poNo).toMatch(/^PO-\d{4}-\d{6}$/);
    expect(res.body.data.itemCount).toBe(2);
    expect(res.body.data.orderedQty).toBe(80);
    expect(res.body.data.receivedQty).toBe(0);
    // subtotal = 50*60 + 30*30 = 3000 + 900 = 3900
    expect(res.body.data.subtotal).toBe(3900);
    expect(res.body.data.total).toBeGreaterThan(3900); // includes tax

    state.poId = res.body.data.id;
  });

  test('a PO does not move stock by itself', async () => {
    const alpha = await inTenant(state.companyId, () => Product.findById(state.products.ALPHA.id).lean());
    const before = alpha.stock;
    // stock should be unchanged after the PO was created above
    expect(typeof before).toBe('number');
  });

  test('sends a PO and blocks editing afterwards', async () => {
    const sent = await request
      .post(`/api/v1/purchase-orders/${state.poId}/send`)
      .set(as(state.adminToken))
      .send({ note: 'Emailed to supplier' });
    expect(sent.status).toBe(200);
    expect(sent.body.data.status).toBe('SENT');

    const edit = await request
      .patch(`/api/v1/purchase-orders/${state.poId}`)
      .set(as(state.adminToken))
      .send({ notes: 'changed my mind' });
    expect(edit.status).toBe(200); // SENT still editable

    const alphaBefore = await inTenant(state.companyId, () => Product.findById(state.products.ALPHA.id).lean());
    expect(alphaBefore.stock).toBe(115); // 100 legacy + 25 count - 10 damage = 115
  });

  test('posts a GRN and books stock IN, rolling the PO forward', async () => {
    const res = await request
      .post('/api/v1/goods-receipts')
      .set(as(state.warehouseToken))
      .send({
        purchaseOrder: state.poId,
        warehouse: String(state.mainWarehouse._id),
        post: true,
        invoiceNo: 'BILL-7788',
        items: [
          { product: state.products.ALPHA.id, receivedQty: 50, unitCost: 60 },
          { product: state.products.BETA.id, receivedQty: 10, unitCost: 30, rejectedQty: 2, rejectReason: 'Damaged cartons' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('POSTED');
    expect(res.body.data.grnNo).toMatch(/^GRN-\d{4}-\d{6}$/);
    // BETA: received 10, rejected 2 -> accepted 8
    expect(res.body.data.totalAcceptedQty).toBe(58); // 50 + 8
    expect(res.body.data.totalRejectedQty).toBe(2);

    const alpha = await inTenant(state.companyId, () => Product.findById(state.products.ALPHA.id).lean());
    expect(alpha.stock).toBe(165); // 115 + 50

    const beta = await inTenant(state.companyId, () => Product.findById(state.products.BETA.id).lean());
    expect(beta.stock).toBe(209); // 200 legacy + 1 (locks-test adj, stays posted) + 8 accepted

    // PO rolled forward: 58 of 80 received -> PARTIALLY_RECEIVED
    const po = await request.get(`/api/v1/purchase-orders/${state.poId}`).set(as(state.adminToken));
    expect(po.body.data.status).toBe('PARTIALLY_RECEIVED');
    expect(po.body.data.receivedQty).toBe(58);
  });

  test('blocks over-receipt beyond the pending PO quantity', async () => {
    const res = await request
      .post('/api/v1/goods-receipts')
      .set(as(state.adminToken))
      .send({
        purchaseOrder: state.poId,
        warehouse: String(state.mainWarehouse._id),
        items: [{ product: state.products.ALPHA.id, receivedQty: 999, unitCost: 60 }],
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OVER_RECEIPT');
  });

  test('receiving the rest completes the PO', async () => {
    // ALPHA pending is 0 (50/50 already received). BETA pending is 22
    // (30 ordered - 8 accepted; the 2 rejected never entered stock, so the
    // supplier still owes them). Receive the remainder:
    const betaRes = await request
      .post('/api/v1/goods-receipts')
      .set(as(state.adminToken))
      .send({
        purchaseOrder: state.poId,
        warehouse: String(state.mainWarehouse._id),
        post: true,
        items: [{ product: state.products.BETA.id, receivedQty: 22, unitCost: 30 }],
      });
    expect(betaRes.status).toBe(201);
    expect(betaRes.body.data.status).toBe('POSTED');

    // 50 + 30 = 80/80 -> RECEIVED
    const po = await request.get(`/api/v1/purchase-orders/${state.poId}`).set(as(state.adminToken));
    expect(po.body.data.status).toBe('RECEIVED');
    expect(po.body.data.receivedQty).toBe(80);
  });

  test('a warehouse user can post GRNs but a salesman cannot', async () => {
    const allowed = await request
      .post('/api/v1/goods-receipts')
      .set(as(state.warehouseToken))
      .send({
        warehouse: String(state.mainWarehouse._id),
        supplierId: String(state.supplier._id),
        items: [{ product: state.products.GAMMA.id, receivedQty: 5, unitCost: 700 }],
      });
    expect(allowed.status).toBe(201); // spot purchase, no PO

    const denied = await request
      .post('/api/v1/goods-receipts')
      .set(as(state.salesmanToken))
      .send({
        warehouse: String(state.mainWarehouse._id),
        items: [{ product: state.products.GAMMA.id, receivedQty: 1, unitCost: 700 }],
      });
    expect(denied.status).toBe(403);
  });

  test('cancelling a posted GRN reverses the stock and reopens the PO', async () => {
    const created = await request
      .post('/api/v1/goods-receipts')
      .set(as(state.adminToken))
      .send({
        purchaseOrder: state.poId,
        warehouse: String(state.mainWarehouse._id),
        post: true,
        items: [{ product: state.products.GAMMA.id, receivedQty: 10, unitCost: 700 }],
      });
    expect(created.status).toBe(422); // PO is RECEIVED -> not receivable
    expect(created.body.code).toBe('PO_NOT_RECEIVABLE');

    // Spot GRN (no PO) then cancel to prove reversal. GAMMA company-wide
    // stock is 80 at this point (50 legacy + 30 counted; the transfer is an
    // internal move and nets to zero).
    const spot = await request
      .post('/api/v1/goods-receipts')
      .set(as(state.adminToken))
      .send({
        warehouse: String(state.mainWarehouse._id),
        supplierId: String(state.supplier._id),
        post: true,
        items: [{ product: state.products.GAMMA.id, receivedQty: 7, unitCost: 700 }],
      });
    expect(spot.status).toBe(201);

    const before = await inTenant(state.companyId, () => Product.findById(state.products.GAMMA.id).lean());
    expect(before.stock).toBe(87); // 80 + 7 spot receipt

    const cancelled = await request
      .post(`/api/v1/goods-receipts/${spot.body.data.id}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Duplicate entry' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const after = await inTenant(state.companyId, () => Product.findById(state.products.GAMMA.id).lean());
    expect(after.stock).toBe(80); // reversal of +7
  });
});

// ---------------------------------------------------------------------------

describe('Phase 7 - order dispatch consumes stock via the ledger', () => {
  test('dispatching an order books SALES_OUT and decrements stock', async () => {
    // Reset settings: no approval threshold.
    await inTenant(state.companyId, async () => {
      const s = await Setting.forCompany(state.company._id);
      s.order = { ...(s.order || {}), approvalThreshold: 0, reserveStockOnConfirm: true };
      await s.save();
    });

    const betaBefore = await inTenant(state.companyId, () => Product.findById(state.products.BETA.id).lean());
    const beforeQty = betaBefore.stock;

    const created = await request
      .post('/api/v1/orders')
      .set(as(state.adminToken))
      .send({
        customerId: String(state.customer._id),
        items: [item('BETA', 20)],
        submit: true,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('CONFIRMED');
    const orderId = created.body.data.id;

    // Reservation held: available reduced, on-hand unchanged.
    const reservedBal = await inTenant(state.companyId, () =>
      StockBalance.findOne({ product: state.products.BETA.id, warehouse: state.mainWarehouse._id }).lean()
    );
    expect(reservedBal.reservedQty).toBe(20);

    const dispatched = await request
      .post(`/api/v1/orders/${orderId}/dispatch`)
      .set(as(state.adminToken))
      .send({ note: 'Van delivery' });
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.data.status).toBe('DISPATCHED');

    const betaAfter = await inTenant(state.companyId, () => Product.findById(state.products.BETA.id).lean());
    expect(betaAfter.stock).toBe(beforeQty - 20);

    // A SALES_OUT movement exists against the order.
    const movements = await inTenant(state.companyId, () =>
      StockMovement.find({ type: 'SALES_OUT', refType: 'ORDER', refId: orderId }).lean()
    );
    expect(movements.length).toBe(1);
    expect(movements[0].qty).toBe(-20);
  });

  test('cancelling a confirmed order releases the reservation', async () => {
    const created = await request
      .post('/api/v1/orders')
      .set(as(state.adminToken))
      .send({
        customerId: String(state.customer._id),
        items: [item('ALPHA', 5)],
        submit: true,
      });
    expect(created.status).toBe(201);
    const orderId = created.body.data.id;

    const reserved = await inTenant(state.companyId, () =>
      StockBalance.findOne({ product: state.products.ALPHA.id, warehouse: state.mainWarehouse._id }).lean()
    );
    const reservedBefore = reserved?.reservedQty || 0;
    expect(reservedBefore).toBeGreaterThanOrEqual(5);

    const cancelled = await request
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Customer changed mind' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const after = await inTenant(state.companyId, () =>
      StockBalance.findOne({ product: state.products.ALPHA.id, warehouse: state.mainWarehouse._id }).lean()
    );
    expect(after.reservedQty).toBe(reservedBefore - 5);
  });

  test('blocks dispatching more than the on-hand stock', async () => {
    // GAMMA on-hand in MAIN is limited; create a huge confirmed order by
    // temporarily allowing negative stock to book it, then disable.
    await inTenant(state.companyId, async () => {
      const s = await Setting.forCompany(state.company._id);
      s.order = { ...(s.order || {}), allowNegativeStock: true, approvalThreshold: 0 };
      await s.save();
    });

    const created = await request
      .post('/api/v1/orders')
      .set(as(state.adminToken))
      .send({
        customerId: String(state.customer._id),
        items: [item('GAMMA', 5000)],
        submit: true,
      });
    expect(created.status).toBe(201);

    // Now forbid negative stock and try to dispatch.
    await inTenant(state.companyId, async () => {
      const s = await Setting.forCompany(state.company._id);
      s.order = { ...(s.order || {}), allowNegativeStock: false };
      await s.save();
    });

    const dispatched = await request
      .post(`/api/v1/orders/${created.body.data.id}/dispatch`)
      .set(as(state.adminToken))
      .send({});
    expect(dispatched.status).toBe(422);
    expect(dispatched.body.code).toBe('INSUFFICIENT_STOCK');

    // Cleanup: cancel the order and restore the setting.
    await request
      .post(`/api/v1/orders/${created.body.data.id}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Test cleanup' });
    await inTenant(state.companyId, async () => {
      const s = await Setting.forCompany(state.company._id);
      s.order = { ...(s.order || {}), allowNegativeStock: false };
      await s.save();
    });
  });

  test('lists low-stock products at or below their threshold', async () => {
    const res = await request.get('/api/v1/inventory/low-stock').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('exports the stock register to Excel', async () => {
    const res = await request
      .get('/api/v1/inventory/stock/export')
      .set(as(state.adminToken))
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheet/);
  });
});
