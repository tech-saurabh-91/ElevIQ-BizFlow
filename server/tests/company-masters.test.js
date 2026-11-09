import { boot, shutdown, clearDb } from './helpers.js';

let app;
let request;
let mongoose;

// models (imported after boot so env is configured)
let Company;
let Setting;
let User;
let Customer;
let Product;
let PriceList;
let AuditLog;
let runWithContext;

// fixtures
const state = {};
const PASSWORD = 'Admin#Pass123';

const as = (token) => ({ Authorization: `Bearer ${token}` });

const login = async (identifier, password = PASSWORD) => {
  const res = await request.post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${identifier} (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
};

const seedTenant = async ({ code, businessName, adminEmail, managerEmail, salesmanEmail, limits = {} }) => {
  const company = await Company.create({
    code,
    slug: code.toLowerCase(),
    businessName,
    status: 'ACTIVE',
    subscriptionEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    userLimit: limits.maxUsers || 10,
    limits: {
      maxUsers: limits.maxUsers || 10,
      maxCustomers: limits.maxCustomers || 500,
      maxInvoicesPerMonth: 1000,
    },
  });

  let admin;
  let manager;
  let salesman;

  await runWithContext({ scope: 'company', companyId: String(company._id) }, async () => {
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
      title: 'Sales Manager',
    });

    salesman = await User.create({
      companyId: company._id,
      name: `${businessName} Salesman`,
      email: salesmanEmail,
      password: PASSWORD,
      role: 'SALESMAN',
      isActive: true,
      reportingManager: manager._id,
      territory: 'Pune East',
    });

    await User.updateOne({ _id: manager._id }, { $set: { teamMembers: [salesman._id] } });
  });

  await Company.updateOne({ _id: company._id }, { $set: { adminUser: admin._id } }).skipTenant();

  return { company, admin, manager, salesman };
};

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
  ({ default: AuditLog } = await import('../src/models/AuditLog.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));

  await clearDb();

  // Build unique indexes before any assertion relies on them. Mongoose builds
  // indexes in the background on connection, which races under parallel jest
  // workers and can let a duplicate insert slip through.
  await Promise.all([Company.init(), User.init(), Customer.init(), Product.init(), PriceList.init()]);

  const primary = await seedTenant({
    code: 'P3A',
    businessName: 'Phase 3 Traders',
    adminEmail: 'admin@phase3.test',
    managerEmail: 'manager@phase3.test',
    salesmanEmail: 'salesman@phase3.test',
    limits: { maxUsers: 10, maxCustomers: 5 },
  });
  state.company = primary.company;
  state.companyId = String(primary.company._id);
  state.admin = primary.admin;
  state.manager = primary.manager;
  state.salesman = primary.salesman;

  const other = await seedTenant({
    code: 'P3B',
    businessName: 'Other Tenant Co',
    adminEmail: 'admin@otherp3.test',
    managerEmail: 'manager@otherp3.test',
    salesmanEmail: 'salesman@otherp3.test',
  });
  state.otherCompany = other.company;
  state.otherCompanyId = String(other.company._id);

  state.adminToken = await login('admin@phase3.test');
  state.managerToken = await login('manager@phase3.test');
  state.salesmanToken = await login('salesman@phase3.test');
  state.otherAdminToken = await login('admin@otherp3.test');
});

afterAll(async () => {
  await shutdown();
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Customers', () => {
  // Phone and a billing country/state/city are required for every customer.
  const ADDR = { country: 'India', state: 'Maharashtra', city: 'Pune', pincode: '411001' };
  let phoneSeq = 11100;
  const minimal = (name) => ({ name, phone: `+9198200${(phoneSeq += 1)}`, address: ADDR });

  test('creates a customer with an auto code and plan-limit accounting', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set(as(state.adminToken))
      .send({
        name: 'Sharma General Store',
        type: 'RETAIL',
        phone: '+919820011001',
        email: 'sharma@example.test',
        creditLimit: 50000,
        creditDays: 15,
        paymentTerms: 'NET_15',
        openingBalance: 12000,
        territory: 'Pune East',
        address: { line1: 'MG Road', city: 'Pune', state: 'Maharashtra', country: 'India' },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.code).toBe('CUS-00001');
    expect(res.body.data.outstanding).toBe(12000);
    state.customerId = res.body.data.id;
  });

  test('marks the onboarding checklist when the first customer arrives', async () => {
    const settings = await runWithContext(
      { scope: 'company', companyId: state.companyId },
      () => Setting.forCompany(state.companyId)
    );
    expect(settings.setupProgress.customers).toBe(true);
  });

  test('lists customers with search, filters and pagination', async () => {
    await request
      .post('/api/v1/customers')
      .set(as(state.adminToken))
      .send({ name: 'Patel Super Market', type: 'WHOLESALE', phone: '+919820011002', address: ADDR });

    const all = await request.get('/api/v1/customers').set(as(state.adminToken));
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data[0].id).toBeTruthy();

    const search = await request
      .get('/api/v1/customers?search=patel')
      .set(as(state.adminToken));
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);

    const type = await request
      .get('/api/v1/customers?type=RETAIL')
      .set(as(state.adminToken));
    expect(type.status).toBe(200);
    expect(type.body.data.every((c) => c.type === 'RETAIL')).toBe(true);

    const bad = await request.get('/api/v1/customers?type=NOT_A_TYPE').set(as(state.adminToken));
    expect(bad.status).toBe(422);
  });

  test('reads and updates a customer', async () => {
    const got = await request
      .get(`/api/v1/customers/${state.customerId}`)
      .set(as(state.adminToken));
    expect(got.status).toBe(200);
    expect(got.body.data.name).toBe('Sharma General Store');

    const patched = await request
      .patch(`/api/v1/customers/${state.customerId}`)
      .set(as(state.adminToken))
      .send({ creditLimit: 75000, type: 'DEALER', notes: 'Key account' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.creditLimit).toBe(75000);
    expect(patched.body.data.type).toBe('DEALER');
  });

  test('rejects invalid payloads with field-level errors', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set(as(state.adminToken))
      .send({ name: '', creditDays: 999, email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.some((e) => e.field === 'name')).toBe(true);
    expect(res.body.errors.some((e) => e.field === 'creditDays')).toBe(true);
  });

  test('ignores a client-supplied code: codes are always generated', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set(as(state.adminToken))
      .send({ ...minimal('Duplicate Code Store'), code: 'CUS-00001' });
    expect(res.status).toBe(201);
    expect(res.body.data.code).not.toBe('CUS-00001');

    const renamed = await request
      .patch(`/api/v1/customers/${res.body.data.id}`)
      .set(as(state.adminToken))
      .send({ code: 'HACKED' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.code).toBe(res.body.data.code);
  });

  test('soft deletes a customer and hides it from lists', async () => {
    const created = await request
      .post('/api/v1/customers')
      .set(as(state.adminToken))
      .send(minimal('Temporary Customer'));
    const id = created.body.data.id;
    expect(created.status).toBe(201);

    const del = await request.delete(`/api/v1/customers/${id}`).set(as(state.adminToken));
    expect(del.status).toBe(200);

    const got = await request.get(`/api/v1/customers/${id}`).set(as(state.adminToken));
    expect(got.status).toBe(404);

    const list = await request.get('/api/v1/customers').set(as(state.adminToken));
    expect(list.body.data.some((c) => c.id === id)).toBe(false);
  });

  test('enforces the plan customer limit', async () => {
    const current = (await request.get('/api/v1/customers').set(as(state.adminToken))).body.meta.total;
    await Company.updateOne(
      { _id: state.companyId },
      { $set: { 'limits.maxCustomers': current + 1 } }
    ).skipTenant();

    const inside = await request
      .post('/api/v1/customers')
      .set(as(state.adminToken))
      .send(minimal('Limit Boundary Store'));
    expect(inside.status).toBe(201);

    const over = await request
      .post('/api/v1/customers')
      .set(as(state.adminToken))
      .send(minimal('Over Limit Store'));
    expect(over.status).toBe(403);
    expect(over.body.code).toBe('PLAN_LIMIT_REACHED');

    await Company.updateOne(
      { _id: state.companyId },
      { $set: { 'limits.maxCustomers': 500 } }
    ).skipTenant();
  });
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Products', () => {
  test('creates products with explicit and generated SKUs', async () => {
    const first = await request
      .post('/api/v1/products')
      .set(as(state.adminToken))
      .send({
        name: 'Tata Salt 1kg',
        category: 'Staples',
        brand: 'Tata',
        mrp: 28,
        sellingPrice: 24,
        purchasePrice: 22,
        gstRate: 5,
        openingStock: 120,
        lowStockLevel: 40,
      });
    expect(first.status).toBe(201);
    expect(first.body.data.sku).toBe('PRD-00001');
    expect(first.body.data.stock).toBe(120);
    state.productId = first.body.data.id;

    const second = await request
      .post('/api/v1/products')
      .set(as(state.adminToken))
      .send({
        name: 'Dettol Soap 125g',
        sku: 'SKU-DETTOL', // ignored: codes come from the numbering series
        category: 'Personal Care',
        mrp: 65,
        sellingPrice: 58,
        openingStock: 2,
        lowStockLevel: 10,
        gstRate: 18,
      });
    expect(second.status).toBe(201);
    expect(second.body.data.sku).toBe('PRD-00002');
    state.lowStockProductId = second.body.data.id;
  });

  test('validates GST rate and required fields', async () => {
    const res = await request
      .post('/api/v1/products')
      .set(as(state.adminToken))
      .send({ name: 'Bad GST Product', gstRate: 140 }); // rates are 0-100% (any country)
    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'gstRate')).toBe(true);
  });

  test('lists, searches and filters products', async () => {
    const list = await request.get('/api/v1/products').set(as(state.adminToken));
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(2);

    const search = await request
      .get('/api/v1/products?search=dettol')
      .set(as(state.adminToken));
    expect(search.body.data).toHaveLength(1);

    const category = await request
      .get('/api/v1/products?category=Staples')
      .set(as(state.adminToken));
    expect(category.body.data).toHaveLength(1);

    const low = await request
      .get('/api/v1/products?lowStock=true')
      .set(as(state.adminToken));
    expect(low.body.data).toHaveLength(1);
    expect(low.body.data[0].sku).toBe('PRD-00002');
  });

  test('updates and soft deletes a product', async () => {
    const patched = await request
      .patch(`/api/v1/products/${state.productId}`)
      .set(as(state.adminToken))
      .send({ sellingPrice: 26, isActive: false });
    expect(patched.status).toBe(200);
    expect(patched.body.data.sellingPrice).toBe(26);
    expect(patched.body.data.isActive).toBe(false);

    const created = await request
      .post('/api/v1/products')
      .set(as(state.adminToken))
      .send({ name: 'Disposable Product' });
    const del = await request
      .delete(`/api/v1/products/${created.body.data.id}`)
      .set(as(state.adminToken));
    expect(del.status).toBe(200);

    const got = await request
      .get(`/api/v1/products/${created.body.data.id}`)
      .set(as(state.adminToken));
    expect(got.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Suppliers', () => {
  test('creates and lists suppliers', async () => {
    const res = await request
      .post('/api/v1/suppliers')
      .set(as(state.adminToken))
      .send({
        name: 'Unilever India Ltd',
        contactPerson: 'Mahesh Kulkarni',
        phone: '+912022001122',
        paymentTerms: 'NET_30',
        creditDays: 30,
        openingBalance: 84500,
        categories: ['Home Care'],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^SUP-/);
    expect(res.body.data.outstanding).toBe(84500);
    state.supplierId = res.body.data.id;

    const list = await request.get('/api/v1/suppliers?search=unilever').set(as(state.adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  test('updates and deletes a supplier', async () => {
    const patched = await request
      .patch(`/api/v1/suppliers/${state.supplierId}`)
      .set(as(state.adminToken))
      .send({ paymentTerms: 'NET_15', creditDays: 15 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.creditDays).toBe(15);

    const del = await request.delete(`/api/v1/suppliers/${state.supplierId}`).set(as(state.adminToken));
    expect(del.status).toBe(200);
    const got = await request.get(`/api/v1/suppliers/${state.supplierId}`).set(as(state.adminToken));
    expect(got.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Warehouses', () => {
  test('the first warehouse becomes the default automatically', async () => {
    const res = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({
        name: 'Main Warehouse',
        code: 'WH-MAIN',
        type: 'MAIN',
        capacity: 12000,
        manager: String(state.manager._id),
        address: { city: 'Pune', state: 'Maharashtra' },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.isDefault).toBe(true);
    expect(res.body.data.manager.name).toContain('Manager');
    state.warehouseId = res.body.data.id;
  });

  test('creates a sub warehouse nested under the main one', async () => {
    const sub = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({
        name: 'Pune City Branch',
        code: 'WH-PUNE',
        type: 'SUB',
        parent: state.warehouseId,
      });
    expect(sub.status).toBe(201);
    expect(sub.body.data.type).toBe('SUB');
    expect(sub.body.data.isDefault).toBe(false);
    expect(sub.body.data.parent?.id || sub.body.data.parent?._id).toBe(state.warehouseId);
    state.branchWarehouseId = sub.body.data.id;
  });

  test('enforces hierarchy rules and default restrictions', async () => {
    // A SUB must be nested under a MAIN.
    const orphan = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'Orphan Sub', code: 'WH-ORPH', type: 'SUB' });
    expect(orphan.status).toBe(400);
    expect(orphan.body.code).toBe('WAREHOUSE_PARENT');

    // A MAIN can never have a parent.
    const nestedMain = await request
      .post('/api/v1/warehouses')
      .set(as(state.adminToken))
      .send({ name: 'Nested Main', code: 'WH-NM', type: 'MAIN', parent: state.warehouseId });
    expect(nestedMain.status).toBe(400);
    expect(nestedMain.body.code).toBe('WAREHOUSE_PARENT');

    // Only a MAIN may become the default.
    const setDefault = await request
      .post(`/api/v1/warehouses/${state.branchWarehouseId}/set-default`)
      .set(as(state.adminToken));
    expect(setDefault.status).toBe(400);
    expect(setDefault.body.code).toBe('DEFAULT_WAREHOUSE');

    // Changing the default MAIN's type away from MAIN is refused too.
    const retyped = await request
      .patch(`/api/v1/warehouses/${state.warehouseId}`)
      .set(as(state.adminToken))
      .send({ type: 'SUB' });
    expect(retyped.status).toBe(400);
    expect(retyped.body.code).toBe('DEFAULT_WAREHOUSE');
  });

  test('blocks deleting the default warehouse', async () => {
    const res = await request
      .delete(`/api/v1/warehouses/${state.warehouseId}`)
      .set(as(state.adminToken));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DEFAULT_WAREHOUSE');
  });

  test('lists warehouses with type filters', async () => {
    const list = await request
      .get('/api/v1/warehouses?type=MAIN')
      .set(as(state.adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].code).toBe('WH-MAIN');
  });
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Routes & beats', () => {
  test('creates a route with beat days and assignments', async () => {
    const res = await request
      .post('/api/v1/routes')
      .set(as(state.adminToken))
      .send({
        name: 'Pune East Beat',
        code: 'RTE-EAST',
        territory: 'Pune East',
        warehouse: state.warehouseId,
        assignedTo: String(state.salesman._id),
        beatDays: ['MON', 'THU'],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.beatDays).toEqual(['MON', 'THU']);
    expect(res.body.data.assignedTo.name).toContain('Salesman');
    state.routeId = res.body.data.id;
  });

  test('rejects invalid beat days and unknown references', async () => {
    const badDays = await request
      .post('/api/v1/routes')
      .set(as(state.adminToken))
      .send({ name: 'Bad Beat', code: 'RTE-BAD', beatDays: ['FUNDAY'] });
    expect(badDays.status).toBe(422);

    const badRef = await request
      .post('/api/v1/routes')
      .set(as(state.adminToken))
      .send({ name: 'Bad Ref Beat', code: 'RTE-BAD2', assignedTo: new mongoose.Types.ObjectId().toString() });
    expect(badRef.status).toBe(400);
    expect(badRef.body.code).toBe('INVALID_REFERENCE');
  });

  test('updates a route and lists it', async () => {
    const patched = await request
      .patch(`/api/v1/routes/${state.routeId}`)
      .set(as(state.adminToken))
      .send({ beatDays: ['MON', 'WED', 'FRI'], sequence: 5 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.beatDays).toHaveLength(3);
    expect(patched.body.data.sequence).toBe(5);

    const list = await request.get('/api/v1/routes').set(as(state.adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data.some((r) => r.id === state.routeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Price lists', () => {
  test('creates price lists with product items', async () => {
    const retail = await request
      .post('/api/v1/price-lists')
      .set(as(state.adminToken))
      .send({
        name: 'Retail Price List',
        type: 'RETAIL',
        isDefault: true,
        items: [{ product: state.productId, price: 24 }],
      });
    expect(retail.status).toBe(201);
    expect(retail.body.data.code).toMatch(/^PL-/);
    expect(retail.body.data.items).toHaveLength(1);
    state.retailPriceListId = retail.body.data.id;

    const wholesale = await request
      .post('/api/v1/price-lists')
      .set(as(state.adminToken))
      .send({
        name: 'Wholesale Price List',
        type: 'WHOLESALE',
        items: [{ product: state.productId, price: 21, minQty: 10 }],
      });
    expect(wholesale.status).toBe(201);
    state.wholesalePriceListId = wholesale.body.data.id;
  });

  test('only one price list stays default', async () => {
    const second = await request
      .post('/api/v1/price-lists')
      .set(as(state.adminToken))
      .send({ name: 'Distributor Price List', type: 'DISTRIBUTOR', isDefault: true });
    expect(second.status).toBe(201);

    const retail = await request
      .get(`/api/v1/price-lists/${state.retailPriceListId}`)
      .set(as(state.adminToken));
    expect(retail.body.data.isDefault).toBe(false);

    const defaults = await runWithContext(
      { scope: 'company', companyId: state.companyId },
      () => PriceList.find({ isDefault: true }).lean()
    );
    expect(defaults).toHaveLength(1);
    expect(String(defaults[0]._id)).toBe(second.body.data.id);
  });

  test('rejects unknown products in a price list', async () => {
    const res = await request
      .post('/api/v1/price-lists')
      .set(as(state.adminToken))
      .send({
        name: 'Broken Price List',
        items: [{ product: new mongoose.Types.ObjectId().toString(), price: 10 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REFERENCE');
  });
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Users & teams', () => {
  test('creates a user with a generated temporary password', async () => {
    const res = await request
      .post('/api/v1/users')
      .set(as(state.adminToken))
      .send({
        name: 'Field Rep',
        email: 'fieldrep@phase3.test',
        role: 'SALESMAN',
        title: 'Sales Executive',
        reportingManager: String(state.manager._id),
        territory: 'Pune West',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('SALESMAN');
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.temporaryPassword).toMatch(/^Temp#/);
    state.fieldRepId = res.body.data.id;
    state.fieldRepPassword = res.body.data.temporaryPassword;

    // reporting manager gains the new team member
    const manager = await request
      .get(`/api/v1/users/${state.manager._id}`)
      .set(as(state.adminToken));
    expect(manager.body.data.teamMembers.some((m) => m.id === state.fieldRepId)).toBe(true);
  });

  test('employee code is issued by the system and cannot be set or changed', async () => {
    const created = await request
      .post('/api/v1/users')
      .set(as(state.adminToken))
      .send({
        name: 'Code Check',
        email: 'codecheck@phase3.test',
        role: 'SALESMAN',
        password: 'Code#Check123',
        employeeCode: 'MY-OWN-1',
        mustChangePassword: false,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.employeeCode).toMatch(/^EMP-\d{4}$/);
    expect(created.body.data.employeeCode).not.toBe('MY-OWN-1');

    const fieldRep = await request.get(`/api/v1/users/${state.fieldRepId}`).set(as(state.adminToken));
    expect(fieldRep.body.data.employeeCode).toMatch(/^EMP-\d{4}$/);
    expect(fieldRep.body.data.employeeCode).not.toBe(created.body.data.employeeCode);

    const patched = await request
      .patch(`/api/v1/users/${created.body.data.id}`)
      .set(as(state.adminToken))
      .send({ employeeCode: 'CHANGED-9', title: 'Rep' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.employeeCode).toBe(created.body.data.employeeCode);

    // Even with a password chosen by the admin, the user sets their own on first sign-in.
    const User = (await import('../src/models/User.js')).default;
    const doc = await User.findById(created.body.data.id).skipTenant().lean();
    expect(doc.mustChangePassword).toBe(true);
  });

  test('new user can sign in with the temporary password', async () => {
    const token = await login('fieldrep@phase3.test', state.fieldRepPassword);
    expect(token).toBeTruthy();
  });

  test('lists users with role filters and stats', async () => {
    const list = await request.get('/api/v1/users?role=SALESMAN').set(as(state.adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
    expect(list.body.data.every((u) => u.role === 'SALESMAN')).toBe(true);

    const stats = await request.get('/api/v1/users/stats').set(as(state.adminToken));
    expect(stats.status).toBe(200);
    expect(stats.body.data.total).toBeGreaterThanOrEqual(4);
    expect(stats.body.data.byRole.SALESMAN).toBeGreaterThanOrEqual(2);
  });

  test('updates a user and resets their password', async () => {
    const patched = await request
      .patch(`/api/v1/users/${state.fieldRepId}`)
      .set(as(state.adminToken))
      .send({ title: 'Senior Sales Executive', territory: 'Pune Central' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.territory).toBe('Pune Central');

    const reset = await request
      .post(`/api/v1/users/${state.fieldRepId}/reset-password`)
      .set(as(state.adminToken))
      .send({ newPassword: 'Field#Rep456' });
    expect(reset.status).toBe(200);

    const token = await login('fieldrep@phase3.test', 'Field#Rep456');
    expect(token).toBeTruthy();
  });

  test('prevents self-deactivation and self-role changes', async () => {
    const deactivate = await request
      .patch(`/api/v1/users/${state.admin._id}`)
      .set(as(state.adminToken))
      .send({ isActive: false });
    expect(deactivate.status).toBe(400);
    expect(deactivate.body.code).toBe('SELF_ACTION');

    const demote = await request
      .patch(`/api/v1/users/${state.admin._id}`)
      .set(as(state.adminToken))
      .send({ role: 'MANAGER' });
    expect(demote.status).toBe(400);
    expect(demote.body.code).toBe('SELF_ACTION');
  });

  test('enforces the plan user limit', async () => {
    const stats = await request.get('/api/v1/users/stats').set(as(state.adminToken));
    const current = stats.body.data.total;
    await Company.updateOne(
      { _id: state.companyId },
      { $set: { 'limits.maxUsers': current + 1, userLimit: current + 1 } }
    ).skipTenant();

    const inside = await request
      .post('/api/v1/users')
      .set(as(state.adminToken))
      .send({ name: 'Limit User', email: 'limit.user@phase3.test', role: 'WAREHOUSE', password: 'Limit#User123' });
    expect(inside.status).toBe(201);

    const over = await request
      .post('/api/v1/users')
      .set(as(state.adminToken))
      .send({ name: 'Over User', email: 'over.user@phase3.test', role: 'WAREHOUSE', password: 'Over#User123' });
    expect(over.status).toBe(403);
    expect(over.body.code).toBe('PLAN_LIMIT_REACHED');

    await Company.updateOne(
      { _id: state.companyId },
      { $set: { 'limits.maxUsers': 50, userLimit: 50 } }
    ).skipTenant();
  });

  test('soft-deleted users are excluded from stats and list totals', async () => {
    const created = await request
      .post('/api/v1/users')
      .set(as(state.adminToken))
      .send({
        name: 'Stale Seat',
        email: 'stale.seat@phase3.test',
        role: 'WAREHOUSE',
        password: 'Stale#Seat123',
      });
    expect(created.status).toBe(201);

    const before = await request.get('/api/v1/users/stats').set(as(state.adminToken));
    const listBefore = await request.get('/api/v1/users?limit=200').set(as(state.adminToken));
    expect(listBefore.body.meta.total).toBe(before.body.data.total);

    const del = await request
      .delete(`/api/v1/users/${created.body.data.id}`)
      .set(as(state.adminToken));
    expect(del.status).toBe(200);

    const after = await request.get('/api/v1/users/stats').set(as(state.adminToken));
    const listAfter = await request.get('/api/v1/users?limit=200').set(as(state.adminToken));
    expect(after.body.data.total).toBe(before.body.data.total - 1);
    expect(listAfter.body.meta.total).toBe(after.body.data.total);
  });

  test('deletes a user and blocks self-deletion', async () => {
    const self = await request.delete(`/api/v1/users/${state.admin._id}`).set(as(state.adminToken));
    expect(self.status).toBe(400);
    expect(self.body.code).toBe('SELF_ACTION');

    const del = await request.delete(`/api/v1/users/${state.fieldRepId}`).set(as(state.adminToken));
    expect(del.status).toBe(200);

    const got = await request.get(`/api/v1/users/${state.fieldRepId}`).set(as(state.adminToken));
    expect(got.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Company settings & permissions', () => {
  test('returns the full settings document with permission catalog', async () => {
    const res = await request.get('/api/v1/settings').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toContain('COMPANY_ADMIN');
    expect(res.body.data.permissionCatalog['customers.view']).toBeTruthy();
    expect(res.body.data.rolePermissions['customers.view']).toContain('SALESMAN');
    expect(res.body.data.tax.regime).toBe('GST');
  });

  test('merges partial section updates without wiping other fields', async () => {
    const res = await request
      .patch('/api/v1/settings')
      .set(as(state.adminToken))
      .send({
        displayName: 'Phase 3 Traders HQ',
        tax: { defaultTaxRate: 12 },
        invoice: { terms: 'Payment due within 15 days.' },
        featureFlags: { apiAccess: true },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Phase 3 Traders HQ');
    expect(res.body.data.tax.defaultTaxRate).toBe(12);
    expect(res.body.data.tax.regime).toBe('GST'); // preserved
    expect(res.body.data.invoice.terms).toContain('15 days');
    expect(res.body.data.featureFlags.apiAccess).toBe(true);
    expect(res.body.data.setupProgress.profile).toBe(true);
  });

  test('role permission changes take effect immediately and can be reset', async () => {
    const put = await request
      .put('/api/v1/settings/permissions')
      .set(as(state.adminToken))
      .send({
        rolePermissions: {
          'customers.view': ['COMPANY_ADMIN', 'MANAGER', 'ACCOUNTANT', 'WAREHOUSE'],
        },
      });
    expect(put.status).toBe(200);
    expect(put.body.data.rolePermissions['customers.view']).not.toContain('SALESMAN');

    const denied = await request.get('/api/v1/customers').set(as(state.salesmanToken));
    expect(denied.status).toBe(403);

    const reset = await request
      .post('/api/v1/settings/permissions/reset')
      .set(as(state.adminToken));
    expect(reset.status).toBe(200);
    expect(reset.body.data.rolePermissions['customers.view']).toContain('SALESMAN');

    const allowed = await request.get('/api/v1/customers').set(as(state.salesmanToken));
    expect(allowed.status).toBe(200);
  });

  test('settings are restricted to company admins', async () => {
    const res = await request.get('/api/v1/settings').set(as(state.managerToken));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Audit trail', () => {
  test('records master-data changes with filters and facets', async () => {
    // audit writes are fire-and-forget
    await new Promise((resolve) => setTimeout(resolve, 250));

    const res = await request.get('/api/v1/audit-logs?limit=100').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.data.some((e) => e.entityType === 'Customer' && e.action === 'CREATE')).toBe(true);
    expect(res.body.meta.entityTypes).toContain('Customer');
    expect(res.body.meta.actions).toContain('CREATE');

    const filtered = await request
      .get('/api/v1/audit-logs?action=CREATE&entityType=Product')
      .set(as(state.adminToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.every((e) => e.action === 'CREATE' && e.entityType === 'Product')).toBe(true);
  });

  test('audit trail is admin-only', async () => {
    const res = await request.get('/api/v1/audit-logs').set(as(state.managerToken));
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Tenant isolation & salesman scoping', () => {
  test('a second tenant sees none of the first tenant records', async () => {
    const list = await request.get('/api/v1/customers').set(as(state.otherAdminToken));
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(0);

    const cross = await request
      .get(`/api/v1/customers/${state.customerId}`)
      .set(as(state.otherAdminToken));
    expect(cross.status).toBe(404);

    const patch = await request
      .patch(`/api/v1/customers/${state.customerId}`)
      .set(as(state.otherAdminToken))
      .send({ name: 'Hacked' });
    expect(patch.status).toBe(404);
  });

  test('rejects client-supplied companyId (tenant spoofing)', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set(as(state.adminToken))
      .send({ name: 'Spoofed Customer', companyId: state.otherCompanyId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_SPOOF');
  });

  test('salesmen only see their own customers and cannot create them', async () => {
    const mine = await request
      .post('/api/v1/customers')
      .set(as(state.adminToken))
      .send({ name: 'Salesman Assigned Store', phone: '+91 98200 5001', address: { country: 'India', state: 'Maharashtra', city: 'Pune' }, assignedTo: String(state.salesman._id) });
    expect(mine.status).toBe(201);
    state.salesmanCustomerId = mine.body.data.id;

    const managers = await request
      .post('/api/v1/customers')
      .set(as(state.adminToken))
      .send({ name: 'Manager Assigned Store', phone: '+91 98200 5002', address: { country: 'India', state: 'Maharashtra', city: 'Pune' }, assignedTo: String(state.manager._id) });
    expect(managers.status).toBe(201);
    state.managerCustomerId = managers.body.data.id;

    const list = await request.get('/api/v1/customers?limit=100').set(as(state.salesmanToken));
    expect(list.status).toBe(200);
    expect(list.body.data.every((c) => c.assignedTo?.id === String(state.salesman._id))).toBe(true);
    expect(list.body.data.some((c) => c.id === state.managerCustomerId)).toBe(false);

    const denied = await request
      .get(`/api/v1/customers/${state.managerCustomerId}`)
      .set(as(state.salesmanToken));
    expect(denied.status).toBe(404);

    const create = await request
      .post('/api/v1/customers')
      .set(as(state.salesmanToken))
      .send({ name: 'Salesman Created Store' });
    expect(create.status).toBe(403);
  });

  test('managers see their own and their team members customers', async () => {
    const list = await request.get('/api/v1/customers?limit=100').set(as(state.managerToken));
    expect(list.status).toBe(200);
    const ids = list.body.data.map((c) => c.id);
    expect(ids).toContain(state.salesmanCustomerId);
    expect(ids).toContain(state.managerCustomerId);
  });
});

// ---------------------------------------------------------------------------
describe('Phase 3 - Lookups & dashboard', () => {
  test('returns compact select options for every master', async () => {
    const res = await request.get('/api/v1/lookups?limit=100').set(as(state.adminToken));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.customers.length).toBeGreaterThan(0);
    expect(d.products.length).toBeGreaterThan(0);
    expect(d.warehouses.length).toBeGreaterThan(0);
    expect(d.routes.length).toBeGreaterThan(0);
    expect(d.priceLists.length).toBeGreaterThan(0);
    expect(d.users.length).toBeGreaterThan(0);
    expect(d.categories).toContain('Staples');
    expect(d.customers[0].id).toBeTruthy();
    expect(d.customers[0]._id).toBeUndefined();
  });

  test('dashboard summary includes master counts and outstanding', async () => {
    const res = await request.get('/api/v1/dashboard/summary').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.masters.customers).toBeGreaterThan(0);
    expect(res.body.data.masters.products).toBeGreaterThan(0);
    expect(res.body.data.masters.warehouses).toBeGreaterThan(0);
    expect(res.body.data.masters.routes).toBeGreaterThan(0);
    expect(typeof res.body.data.lowStockCount).toBe('number');
    expect(res.body.data.outstanding).toBeGreaterThan(0);
  });

  test('lookups never leak across tenants', async () => {
    const res = await request.get('/api/v1/lookups').set(as(state.otherAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.customers).toHaveLength(0);
    expect(res.body.data.products).toHaveLength(0);
  });
});
