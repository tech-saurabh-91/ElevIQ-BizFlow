import { boot, shutdown, clearDb } from './helpers.js';

/**
 * Phase A: warehouse hierarchy + van tracking.
 *
 * Covers the parent rules (MAIN -> SUB/TRANSIT/DAMAGED, MAIN|SUB -> VAN),
 * the transaction locks (type/parent/delete/deactivate), the isDefault-only-
 * on-MAIN invariant and the van assignment workflow (assign / reassign /
 * close / history / auto-close on deactivation).
 */

let app;
let request;

let Company;
let Setting;
let User;
let Product;
let Warehouse;
let VanAssignment;
let StockBalance;
let StockMovement;
let runWithContext;

const state = {};
const PASSWORD = 'Van#Pass123';

const as = (token) => ({ Authorization: `Bearer ${token}` });

const login = async (identifier, password = PASSWORD) => {
  const res = await request.post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${identifier} (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
};

const inTenant = (companyId, fn) => runWithContext({ scope: 'company', companyId }, fn);

const seedTenant = async ({ code, businessName, adminEmail, salesmanEmail, salesman2Email, inactiveEmail }) => {
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
  let salesman;
  let salesman2;
  let inactiveSalesman;

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
    salesman = await User.create({
      companyId: company._id,
      name: `${businessName} Salesman One`,
      email: salesmanEmail,
      password: PASSWORD,
      role: 'SALESMAN',
      isActive: true,
    });
    salesman2 = await User.create({
      companyId: company._id,
      name: `${businessName} Salesman Two`,
      email: salesman2Email,
      password: PASSWORD,
      role: 'SALESMAN',
      isActive: true,
    });
    inactiveSalesman = await User.create({
      companyId: company._id,
      name: `${businessName} Former Salesman`,
      email: inactiveEmail,
      password: PASSWORD,
      role: 'SALESMAN',
      isActive: false,
    });
  });

  await Company.updateOne({ _id: company._id }, { $set: { adminUser: admin._id } }).skipTenant();

  return { company, admin, salesman, salesman2, inactiveSalesman };
};

beforeAll(async () => {
  ({ app } = await boot());
  const st = (await import('supertest')).default;
  request = st(app);

  ({ default: Company } = await import('../src/models/Company.js'));
  ({ default: Setting } = await import('../src/models/Setting.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ default: Product } = await import('../src/models/Product.js'));
  ({ default: Warehouse } = await import('../src/models/Warehouse.js'));
  ({ default: VanAssignment } = await import('../src/models/VanAssignment.js'));
  ({ default: StockBalance } = await import('../src/models/StockBalance.js'));
  ({ default: StockMovement } = await import('../src/models/StockMovement.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));

  await clearDb();
  // Unique indexes must exist before the duplicate-key assertions below.
  await Promise.all([
    Company.init(),
    User.init(),
    Product.init(),
    Warehouse.init(),
    VanAssignment.init(),
  ]);

  const tenant = await seedTenant({
    code: 'PHA',
    businessName: 'Phase A Traders',
    adminEmail: 'admin@phasea.test',
    salesmanEmail: 'amit@phasea.test',
    salesman2Email: 'ravi@phasea.test',
    inactiveEmail: 'former@phasea.test',
  });
  state.company = tenant.company;
  state.companyId = String(tenant.company._id);
  state.adminToken = await login('admin@phasea.test');
  state.salesmanToken = await login('amit@phasea.test');
  state.salesman = tenant.salesman;
  state.salesman2 = tenant.salesman2;
  state.inactiveSalesman = tenant.inactiveSalesman;

  await inTenant(state.companyId, async () => {
    state.product = await Product.create({
      name: 'Van Goods',
      sku: 'VANGOODS',
      unit: 'PCS',
      hsnCode: '9999',
      gstRate: 18,
      sellingPrice: 100,
      purchasePrice: 70,
      stock: 100,
      lowStockLevel: 5,
      isActive: true,
    });
  });
});

afterAll(async () => {
  await shutdown();
});

// ---------------------------------------------------------------------------
describe('Phase A - warehouse hierarchy', () => {
  test('creates the MAIN root and nests SUB/TRANSIT under it', async () => {
    const main = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'Root Depot', code: 'A-MAIN', type: 'MAIN' });
    expect(main.status).toBe(201);
    expect(main.body.data.isDefault).toBe(true);
    expect(main.body.data.parent).toBeFalsy();
    state.mainId = main.body.data.id;

    const sub = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'City Counter', code: 'A-SUB', type: 'SUB', parent: state.mainId });
    expect(sub.status).toBe(201);
    expect(sub.body.data.type).toBe('SUB');
    expect(sub.body.data.parent?.id || sub.body.data.parent?._id).toBe(state.mainId);
    state.subId = sub.body.data.id;

    const transit = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'On The Road', code: 'A-TRN', type: 'TRANSIT', parent: state.mainId });
    expect(transit.status).toBe(201);
    state.transitId = transit.body.data.id;
  });

  test('rejects every invalid parent combination', async () => {
    const orphan = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'Orphan', code: 'A-ORPH', type: 'SUB' });
    expect(orphan.status).toBe(400);
    expect(orphan.body.code).toBe('WAREHOUSE_PARENT');

    const nestedMain = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'Nested Root', code: 'A-NROOT', type: 'MAIN', parent: state.mainId });
    expect(nestedMain.status).toBe(400);
    expect(nestedMain.body.code).toBe('WAREHOUSE_PARENT');

    const subUnderSub = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'Sub Under Sub', code: 'A-SUB2', type: 'SUB', parent: state.subId });
    expect(subUnderSub.status).toBe(400);
    expect(subUnderSub.body.code).toBe('WAREHOUSE_PARENT');

    const unknownParent = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({
        name: 'Unknown Parent',
        code: 'A-UNK',
        type: 'SUB',
        parent: '0123456789abcdef01234567',
      });
    expect(unknownParent.status).toBe(400);
    expect(unknownParent.body.code).toBe('INVALID_REFERENCE');
  });

  test('creates a van under MAIN with a normalized vehicle number', async () => {
    const van = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({
        name: 'Delivery Van 1',
        code: 'A-VAN1',
        type: 'VAN',
        parent: state.mainId,
        vehicleNumber: '  mh12 ab 9999 ',
        vehicleType: 'Tata Ace',
        capacity: 500,
      });
    expect(van.status).toBe(201);
    expect(van.body.data.type).toBe('VAN');
    expect(van.body.data.vehicleNumber).toBe('MH12AB9999');
    expect(van.body.data.vehicleType).toBe('Tata Ace');
    state.van1Id = van.body.data.id;
  });

  test('rejects a duplicate vehicle number and a van outside MAIN/SUB', async () => {
    const dup = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({
        name: 'Copycat Van',
        code: 'A-VANX',
        type: 'VAN',
        parent: state.mainId,
        vehicleNumber: 'MH12AB9999',
      });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('DUPLICATE');

    const underTransit = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'Van In Transit', code: 'A-VANT', type: 'VAN', parent: state.transitId });
    expect(underTransit.status).toBe(400);
    expect(underTransit.body.code).toBe('WAREHOUSE_PARENT');
  });

  test('a van never becomes a parent', async () => {
    const child = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'Child Of Van', code: 'A-VCH', type: 'SUB', parent: state.van1Id });
    expect(child.status).toBe(400);
    expect(child.body.code).toBe('WAREHOUSE_PARENT');
  });

  test('drops vehicle fields for non-van types', async () => {
    const sub = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({
        name: 'No Van Here',
        code: 'A-NOVAN',
        type: 'SUB',
        parent: state.mainId,
        vehicleNumber: 'MH00XX0001',
        vehicleType: 'Truck',
      });
    expect(sub.status).toBe(201);
    expect(sub.body.data.vehicleNumber).toBe('');
    expect(sub.body.data.vehicleType).toBe('');
    state.noVanId = sub.body.data.id;
  });

  test('the default can only ever be a MAIN warehouse', async () => {
    const patch = await request
      .patch(`/api/v1/warehouses/${state.subId}`)
      .set(as(state.adminToken))
      .send({ isDefault: true });
    expect(patch.status).toBe(400);
    expect(patch.body.code).toBe('DEFAULT_WAREHOUSE');

    const setDefault = await request
      .post(`/api/v1/warehouses/${state.subId}/set-default`)
      .set(as(state.adminToken));
    expect(setDefault.status).toBe(400);
    expect(setDefault.body.code).toBe('DEFAULT_WAREHOUSE');
  });
});

// ---------------------------------------------------------------------------
describe('Phase A - transaction locks', () => {
  test('locks type/parent changes and delete once movement history exists', async () => {
    const wh = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'Locked Warehouse', code: 'A-LOCK', type: 'SUB', parent: state.mainId });
    expect(wh.status).toBe(201);
    state.lockedId = wh.body.data.id;

    await inTenant(state.companyId, async () => {
      await StockMovement.create({
        type: 'OPENING',
        product: state.product._id,
        productName: state.product.name,
        productSku: state.product.sku,
        warehouse: state.lockedId,
        warehouseCode: 'A-LOCK',
        warehouseName: 'Locked Warehouse',
        qty: 10,
        balanceAfter: 10,
        refType: 'IMPORT',
      });
    });

    const retype = await request
      .patch(`/api/v1/warehouses/${state.lockedId}`)
      .set(as(state.adminToken))
      .send({ type: 'DAMAGED' });
    expect(retype.status).toBe(409);
    expect(retype.body.code).toBe('WAREHOUSE_LOCKED');

    const reparent = await request
      .patch(`/api/v1/warehouses/${state.lockedId}`)
      .set(as(state.adminToken))
      .send({ parent: '' });
    expect(reparent.status).toBe(409);
    expect(reparent.body.code).toBe('WAREHOUSE_LOCKED');

    const del = await request
      .delete(`/api/v1/warehouses/${state.lockedId}`)
      .set(as(state.adminToken));
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('WAREHOUSE_HAS_MOVEMENTS');
  });

  test('blocks delete and deactivate while stock sits in the warehouse', async () => {
    const wh = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'Stocked Warehouse', code: 'A-STK', type: 'SUB', parent: state.mainId });
    expect(wh.status).toBe(201);
    state.stockedId = wh.body.data.id;

    await inTenant(state.companyId, async () => {
      await StockBalance.create({
        product: state.product._id,
        warehouse: state.stockedId,
        qty: 5,
        reservedQty: 0,
      });
    });

    const del = await request
      .delete(`/api/v1/warehouses/${state.stockedId}`)
      .set(as(state.adminToken));
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('WAREHOUSE_HAS_STOCK');

    const deactivate = await request
      .patch(`/api/v1/warehouses/${state.stockedId}`)
      .set(as(state.adminToken))
      .send({ isActive: false });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.code).toBe('WAREHOUSE_HAS_STOCK');
  });

  test('an empty warehouse deactivates and reactivates freely', async () => {
    const off = await request
      .patch(`/api/v1/warehouses/${state.noVanId}`)
      .set(as(state.adminToken))
      .send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);

    const on = await request
      .patch(`/api/v1/warehouses/${state.noVanId}`)
      .set(as(state.adminToken))
      .send({ isActive: true });
    expect(on.status).toBe(200);
    expect(on.body.data.isActive).toBe(true);
  });

  test('a salesman cannot manage warehouses or assignments', async () => {
    const create = await request
      .post('/api/v1/warehouses')
      .set(as(state.salesmanToken))
      .send({ name: 'Sneaky', code: 'A-SNEAK', type: 'MAIN' });
    expect(create.status).toBe(403);

    const listAssignments = await request
      .get(`/api/v1/warehouses/${state.van1Id}/assignments`)
      .set(as(state.salesmanToken));
    expect(listAssignments.status).toBe(403);

    const assign = await request
      .post(`/api/v1/warehouses/${state.van1Id}/assignments`)
      .set(as(state.salesmanToken))
      .send({ executive: String(state.salesman._id) });
    expect(assign.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('Phase A - van assignments', () => {
  test('assigns a van to a salesman', async () => {
    const res = await request
      .post(`/api/v1/warehouses/${state.van1Id}/assignments`)
      .set(as(state.adminToken))
      .send({ executive: String(state.salesman._id), notes: 'Morning round' });
    expect(res.status).toBe(201);
    expect(res.body.data.active).toBe(true);
    expect(res.body.data.toDate).toBeNull();
    expect(res.body.data.executive.id).toBe(String(state.salesman._id));
    expect(res.body.data.warehouse.id).toBe(state.van1Id);
    state.a1 = res.body.data.id;
  });

  test('refuses assignments on non-vans, inactive vans and inactive users', async () => {
    const notAVan = await request
      .post(`/api/v1/warehouses/${state.subId}/assignments`)
      .set(as(state.adminToken))
      .send({ executive: String(state.salesman._id) });
    expect(notAVan.status).toBe(400);
    expect(notAVan.body.code).toBe('NOT_A_VAN');

    const inactiveUser = await request
      .post(`/api/v1/warehouses/${state.van1Id}/assignments`)
      .set(as(state.adminToken))
      .send({ executive: String(state.inactiveSalesman._id) });
    expect(inactiveUser.status).toBe(400);
    expect(inactiveUser.body.code).toBe('USER_INACTIVE');
  });

  test('reassigning the van closes the previous spell', async () => {
    const res = await request
      .post(`/api/v1/warehouses/${state.van1Id}/assignments`)
      .set(as(state.adminToken))
      .send({ executive: String(state.salesman2._id) });
    expect(res.status).toBe(201);
    state.a2 = res.body.data.id;

    const active = await request
      .get(`/api/v1/warehouses/${state.van1Id}/assignments?active=true`)
      .set(as(state.adminToken));
    expect(active.status).toBe(200);
    expect(active.body.data).toHaveLength(1);
    expect(active.body.data[0].id).toBe(state.a2);

    const history = await request
      .get(`/api/v1/warehouses/${state.van1Id}/assignments`)
      .set(as(state.adminToken));
    const first = history.body.data.find((a) => a.id === state.a1);
    expect(first.active).toBe(false);
    expect(first.closeNotes).toBe('Reassigned');
    expect(first.toDate).toBeTruthy();
  });

  test('giving the executive a second van closes their first spell', async () => {
    const van2 = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({
        name: 'Delivery Van 2',
        code: 'A-VAN2',
        type: 'VAN',
        parent: state.mainId,
        vehicleNumber: 'MH12AB5678',
      });
    expect(van2.status).toBe(201);
    state.van2Id = van2.body.data.id;

    const res = await request
      .post(`/api/v1/warehouses/${state.van2Id}/assignments`)
      .set(as(state.adminToken))
      .send({ executive: String(state.salesman2._id) });
    expect(res.status).toBe(201);
    state.a3 = res.body.data.id;

    // The executive's old spell on van 1 is now closed - one open per user.
    const van1Active = await request
      .get(`/api/v1/warehouses/${state.van1Id}/assignments?active=true`)
      .set(as(state.adminToken));
    expect(van1Active.body.data).toHaveLength(0);

    const van2Active = await request
      .get(`/api/v1/warehouses/${state.van2Id}/assignments?active=true`)
      .set(as(state.adminToken));
    expect(van2Active.body.data).toHaveLength(1);
    expect(van2Active.body.data[0].id).toBe(state.a3);
  });

  test('closes an assignment explicitly and refuses a double close', async () => {
    const closed = await request
      .post(
        `/api/v1/warehouses/${state.van2Id}/assignments/${state.a3}/close`
      )
      .send({ closeNotes: 'Shift over' })
      .set(as(state.adminToken));
    expect(closed.status).toBe(200);
    expect(closed.body.data.active).toBe(false);
    expect(closed.body.data.toDate).toBeTruthy();
    expect(closed.body.data.closeNotes).toBe('Shift over');

    const again = await request
      .post(
        `/api/v1/warehouses/${state.van2Id}/assignments/${state.a3}/close`
      )
      .send({})
      .set(as(state.adminToken));
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('ASSIGNMENT_CLOSED');
  });

  test('rejects a close date before the start date', async () => {
    const open = await request
      .post(`/api/v1/warehouses/${state.van2Id}/assignments`)
      .set(as(state.adminToken))
      .send({ executive: String(state.salesman._id) });
    expect(open.status).toBe(201);
    state.a4 = open.body.data.id;

    const tooEarly = await request
      .post(
        `/api/v1/warehouses/${state.van2Id}/assignments/${state.a4}/close`
      )
      .send({ toDate: '2000-01-01' })
      .set(as(state.adminToken));
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.code).toBe('INVALID_DATE');

    const ok = await request
      .post(`/api/v1/warehouses/${state.van2Id}/assignments/${state.a4}/close`)
      .send({})
      .set(as(state.adminToken));
    expect(ok.status).toBe(200);
  });

  test('history lists newest first and supports the active filter', async () => {
    const all = await request
      .get(`/api/v1/warehouses/${state.van1Id}/assignments`)
      .set(as(state.adminToken));
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);
    expect(new Date(all.body.data[0].fromDate).getTime()).toBeGreaterThanOrEqual(
      new Date(all.body.data[1].fromDate).getTime()
    );

    const activeOnly = await request
      .get(`/api/v1/warehouses/${state.van1Id}/assignments?active=true`)
      .set(as(state.adminToken));
    expect(activeOnly.body.data).toHaveLength(0);

    const byExecutive = await request
      .get(
        `/api/v1/warehouses/${state.van1Id}/assignments?executive=${String(state.salesman._id)}`
      )
      .set(as(state.adminToken));
    expect(byExecutive.body.meta.total).toBe(1);
  });

  test('deactivating a van auto-closes its open assignment', async () => {
    const open = await request
      .post(`/api/v1/warehouses/${state.van1Id}/assignments`)
      .set(as(state.adminToken))
      .send({ executive: String(state.salesman._id) });
    expect(open.status).toBe(201);
    state.a5 = open.body.data.id;

    const deactivate = await request
      .patch(`/api/v1/warehouses/${state.van1Id}`)
      .set(as(state.adminToken))
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);

    const active = await request
      .get(`/api/v1/warehouses/${state.van1Id}/assignments?active=true`)
      .set(as(state.adminToken));
    expect(active.body.data).toHaveLength(0);

    const history = await request
      .get(`/api/v1/warehouses/${state.van1Id}/assignments`)
      .set(as(state.adminToken));
    const spell = history.body.data.find((a) => a.id === state.a5);
    expect(spell.active).toBe(false);
    expect(spell.closeNotes).toBe('Van warehouse deactivated');

    // Reactivate for the remaining tests.
    const on = await request
      .patch(`/api/v1/warehouses/${state.van1Id}`)
      .set(as(state.adminToken))
      .send({ isActive: true });
    expect(on.status).toBe(200);
  });

  test('locks type changes once assignment history exists', async () => {
    const retype = await request
      .patch(`/api/v1/warehouses/${state.van1Id}`)
      .set(as(state.adminToken))
      .send({ type: 'SUB' });
    expect(retype.status).toBe(409);
    expect(retype.body.code).toBe('WAREHOUSE_LOCKED');

    const reparent = await request
      .patch(`/api/v1/warehouses/${state.van1Id}`)
      .set(as(state.adminToken))
      .send({ parent: state.subId });
    expect(reparent.status).toBe(409);
    expect(reparent.body.code).toBe('WAREHOUSE_LOCKED');
  });

  test('blocks deleting a van with an active assignment, then allows it after close', async () => {
    const open = await request
      .post(`/api/v1/warehouses/${state.van2Id}/assignments`)
      .set(as(state.adminToken))
      .send({ executive: String(state.salesman2._id) });
    expect(open.status).toBe(201);
    state.a6 = open.body.data.id;

    const del = await request
      .delete(`/api/v1/warehouses/${state.van2Id}`)
      .set(as(state.adminToken));
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('ASSIGNMENT_ACTIVE');

    const closed = await request
      .post(`/api/v1/warehouses/${state.van2Id}/assignments/${state.a6}/close`)
      .send({})
      .set(as(state.adminToken));
    expect(closed.status).toBe(200);

    const gone = await request
      .delete(`/api/v1/warehouses/${state.van2Id}`)
      .set(as(state.adminToken));
    expect(gone.status).toBe(200);

    const get = await request
      .get(`/api/v1/warehouses/${state.van2Id}`)
      .set(as(state.adminToken));
    expect(get.status).toBe(404);
  });
});

