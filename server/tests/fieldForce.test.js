import { boot, shutdown, clearDb } from './helpers.js';

let app;
let request;
let mongoose;

let Company;
let Setting;
let User;
let Customer;
let Route;
let Attendance;
let Visit;
let Expense;
let Target;
let runWithContext;

const state = {};
const PASSWORD = 'FieldForce#Pass123';

const as = (token) => ({ Authorization: `Bearer ${token}` });

/** Local wall-clock time on today's date (keeps check-in/out on one day). */
const todayAt = (h, m) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const login = async (identifier, password = PASSWORD) => {
  const res = await request.post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${identifier} (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
};

const inTenant = (companyId, fn) => runWithContext({ scope: 'company', companyId }, fn);

const seedTenant = async ({ code, businessName, adminEmail, managerEmail, salesmanEmail, accountantEmail }) => {
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
  let accountant;

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
    accountant = await User.create({
      companyId: company._id,
      name: `${businessName} Accountant`,
      email: accountantEmail,
      password: PASSWORD,
      role: 'ACCOUNTANT',
      isActive: true,
    });
    await User.updateOne({ _id: manager._id }, { $set: { teamMembers: [salesman._id] } });
  });

  await Company.updateOne({ _id: company._id }, { $set: { adminUser: admin._id } }).skipTenant();

  return { company, admin, manager, salesman, accountant };
};

beforeAll(async () => {
  ({ app, mongoose } = await boot());
  const st = (await import('supertest')).default;
  request = st(app);

  ({ default: Company } = await import('../src/models/Company.js'));
  ({ default: Setting } = await import('../src/models/Setting.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ default: Customer } = await import('../src/models/Customer.js'));
  ({ default: Route } = await import('../src/models/Route.js'));
  ({ default: Attendance } = await import('../src/models/Attendance.js'));
  ({ default: Visit } = await import('../src/models/Visit.js'));
  ({ default: Expense } = await import('../src/models/Expense.js'));
  ({ default: Target } = await import('../src/models/Target.js'));
  ({ runWithContext } = await import('../src/middlewares/tenantContext.js'));

  await clearDb();
  await Promise.all([
    Company.init(),
    User.init(),
    Customer.init(),
    Route.init(),
    Attendance.init(),
    Visit.init(),
    Expense.init(),
    Target.init(),
  ]);

  const primary = await seedTenant({
    code: 'FFA',
    businessName: 'FieldForce Traders',
    adminEmail: 'admin@fieldforce.test',
    managerEmail: 'manager@fieldforce.test',
    salesmanEmail: 'salesman@fieldforce.test',
    accountantEmail: 'accountant@fieldforce.test',
  });
  state.company = primary.company;
  state.companyId = String(primary.company._id);
  state.admin = primary.admin;
  state.manager = primary.manager;
  state.salesman = primary.salesman;
  state.accountant = primary.accountant;

  const other = await seedTenant({
    code: 'FFB',
    businessName: 'Other Field Co',
    adminEmail: 'admin@otherff.test',
    managerEmail: 'manager@otherff.test',
    salesmanEmail: 'salesman@otherff.test',
    accountantEmail: 'accountant@otherff.test',
  });
  state.otherCompany = other.company;
  state.otherCompanyId = String(other.company._id);

  await inTenant(state.companyId, async () => {
    const route = await Route.create({
      name: 'Pune City Beat',
      code: 'RT-PUN',
      territory: 'Pune',
      isActive: true,
    });
    state.route = route;

    const customer = await Customer.create({
      code: 'CUS-9501',
      name: 'Kothrud Kirana',
      type: 'RETAIL',
      phone: '+919820019501',
      gstin: '27AAAC1234A1Z5',
      address: {
        line1: '12 Paud Road',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411038',
        gps: { lat: 18.5074, lng: 73.8077 },
      },
      paymentTerms: 'IMMEDIATE',
      creditLimit: 50000,
      assignedTo: state.salesman._id,
      route: route._id,
      isActive: true,
    });
    state.customer = customer;

    const second = await Customer.create({
      code: 'CUS-9502',
      name: 'Camp Corner Store',
      type: 'RETAIL',
      phone: '+919820019502',
      address: { line1: '5 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      paymentTerms: 'IMMEDIATE',
      assignedTo: state.salesman._id,
      isActive: true,
    });
    state.secondCustomer = second;
  });

  state.adminToken = await login('admin@fieldforce.test');
  state.managerToken = await login('manager@fieldforce.test');
  state.salesmanToken = await login('salesman@fieldforce.test');
  state.accountantToken = await login('accountant@fieldforce.test');
  state.otherAdminToken = await login('admin@otherff.test');
});

afterAll(async () => {
  await shutdown();
});

// ===========================================================================
// Attendance
// ===========================================================================

describe('Phase 7 - attendance with GPS check-in/out', () => {
  test('requires a GPS location to check in', async () => {
    const res = await request.post('/api/v1/field-force/attendance/check-in').set(as(state.salesmanToken)).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('GPS_REQUIRED');
  });

  test('checks in with GPS and shows up in /today', async () => {
    const res = await request
      .post('/api/v1/field-force/attendance/check-in')
      .set(as(state.salesmanToken))
      .send({
        at: todayAt(9, 15),
        location: { lat: 18.5074, lng: 73.8077 },
        accuracy: 12,
        address: 'Paud Road, Pune',
        source: 'WEB',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PRESENT');
    expect(res.body.data.isCheckedIn).toBe(true);
    expect(res.body.data.checkIn.location.lat).toBeCloseTo(18.5074, 4);
    expect(res.body.data.checkIn.source).toBe('WEB');

    const today = await request.get('/api/v1/field-force/attendance/today').set(as(state.salesmanToken));
    expect(today.status).toBe(200);
    expect(today.body.data.attendance).toBeTruthy();
    expect(today.body.data.attendance.isCheckedIn).toBe(true);
    expect(today.body.data.config.requireGps).toBe(true);
    expect(today.body.data.config.geofenceRadiusM).toBeGreaterThan(0);

    state.attendanceId = res.body.data.id;
  });

  test('blocks a second check-in for the same day', async () => {
    const res = await request
      .post('/api/v1/field-force/attendance/check-in')
      .set(as(state.salesmanToken))
      .send({ at: todayAt(9, 30), location: { lat: 18.51, lng: 73.81 } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_CHECKED_IN');
  });

  test('checks out and derives worked minutes and distance', async () => {
    const res = await request
      .post('/api/v1/field-force/attendance/check-out')
      .set(as(state.salesmanToken))
      .send({
        at: todayAt(18, 0),
        location: { lat: 18.53, lng: 73.86 },
        accuracy: 9,
        source: 'MOBILE',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.isCheckedOut).toBe(true);
    // 09:15 -> 18:00 = 8h45m (allow a little slack for DST-odd timezones).
    expect(res.body.data.workedMinutes).toBeGreaterThanOrEqual(500);
    expect(res.body.data.workedMinutes).toBeLessThanOrEqual(540);
    expect(res.body.data.distanceMeters).toBeGreaterThan(0);
  });

  test('blocks a second check-out', async () => {
    const res = await request
      .post('/api/v1/field-force/attendance/check-out')
      .set(as(state.salesmanToken))
      .send({ at: todayAt(18, 30), location: { lat: 18.53, lng: 73.86 } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_CHECKED_OUT');
  });

  test('a salesman cannot review their own attendance (403)', async () => {
    const res = await request
      .post(`/api/v1/field-force/attendance/${state.attendanceId}/review`)
      .set(as(state.salesmanToken))
      .send({ status: 'HALF_DAY' });
    expect(res.status).toBe(403);
  });

  test('a manager corrects the day with a reason', async () => {
    const res = await request
      .patch(`/api/v1/field-force/attendance/${state.attendanceId}`)
      .set(as(state.managerToken))
      .send({
        status: 'HALF_DAY',
        manualReason: 'Left early for a medical check-up',
        notes: 'Approved verbally',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('HALF_DAY');
    expect(res.body.data.isManual).toBe(true);
    expect(res.body.data.manualReason).toMatch(/medical check-up/);
    expect(res.body.data.reviewedBy).toBeTruthy();
  });

  test('scopes the list to the signed-in rep', async () => {
    const mine = await request.get('/api/v1/field-force/attendance').set(as(state.salesmanToken)).query({ me: 'true' });
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBeGreaterThan(0);
    mine.body.data.forEach((row) => expect(String(row.user.id)).toBe(String(state.salesman._id)));

    const all = await request.get('/api/v1/field-force/attendance').set(as(state.adminToken));
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThanOrEqual(mine.body.data.length);

    const byUser = await request
      .get('/api/v1/field-force/attendance')
      .set(as(state.adminToken))
      .query({ userId: String(state.salesman._id), status: 'HALF_DAY' });
    expect(byUser.status).toBe(200);
    expect(byUser.body.data.length).toBe(1);
    expect(byUser.body.data[0].status).toBe('HALF_DAY');
  });

  test('summarises the period per rep', async () => {
    const res = await request.get('/api/v1/field-force/attendance/summary').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.config).toBeTruthy();
    expect(Array.isArray(res.body.data.users)).toBe(true);
    expect(res.body.data.users.length).toBeGreaterThanOrEqual(1);

    const row = res.body.data.users.find((u) => u.userId === String(state.salesman._id));
    expect(row).toBeTruthy();
    expect(row.days).toBeGreaterThanOrEqual(1);
    expect(res.body.data.totals.days).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Visits
// ===========================================================================

describe('Phase 7 - visits with GPS and outcomes', () => {
  test('plans a visit with a VIS-<FY>- number', async () => {
    const res = await request
      .post('/api/v1/field-force/visits')
      .set(as(state.adminToken))
      .send({
        customerId: String(state.customer._id),
        salesman: String(state.salesman._id),
        purpose: 'ORDER',
        plannedAt: todayAt(11, 0),
        notes: 'Push the new SKUs',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.visitNo).toMatch(/^VIS-\d{4}-\d{5}$/);
    expect(res.body.data.status).toBe('PLANNED');
    expect(res.body.data.purpose).toBe('ORDER');
    expect(String(res.body.data.salesman.id)).toBe(String(state.salesman._id));
    expect(res.body.data.routeName).toBe('Pune City Beat'); // inherited from the customer

    state.visitId = res.body.data.id;
  });

  test('a rep books a visit for themselves', async () => {
    const res = await request
      .post('/api/v1/field-force/visits')
      .set(as(state.salesmanToken))
      .send({ customerId: String(state.secondCustomer._id), purpose: 'COLLECTION' });

    expect(res.status).toBe(201);
    expect(String(res.body.data.salesman.id)).toBe(String(state.salesman._id));

    state.secondVisitId = res.body.data.id;
  });

  test('rejects a visit without a customer', async () => {
    const res = await request.post('/api/v1/field-force/visits').set(as(state.adminToken)).send({ purpose: 'ORDER' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('runs the lifecycle: check-in -> check-out with an outcome', async () => {
    const checkedIn = await request
      .post(`/api/v1/field-force/visits/${state.visitId}/check-in`)
      .set(as(state.salesmanToken))
      .send({ at: todayAt(10, 0), location: { lat: 18.5074, lng: 73.8077 }, accuracy: 8 });

    expect(checkedIn.status).toBe(200);
    expect(checkedIn.body.data.status).toBe('IN_PROGRESS');

    const checkedOut = await request
      .post(`/api/v1/field-force/visits/${state.visitId}/check-out`)
      .set(as(state.salesmanToken))
      .send({
        at: todayAt(10, 45),
        location: { lat: 18.5075, lng: 73.8078 },
        outcome: 'ORDER_TAKEN', // ignored: nothing was booked, so a reason is required
        notes: 'Owner will order next week',
      });
    expect(checkedOut.status).toBe(422);
    expect(checkedOut.body.code).toBe('NO_ORDER_REASON_REQUIRED');

    const withReason = await request
      .post(`/api/v1/field-force/visits/${state.visitId}/check-out`)
      .set(as(state.salesmanToken))
      .send({
        at: todayAt(10, 45),
        location: { lat: 18.5075, lng: 73.8078 },
        noOrderReason: 'STOCK_AVAILABLE',
        notes: 'Owner will order next week',
      });
    const checkedOutOk = withReason;
    expect(checkedOutOk.status).toBe(200);
    expect(checkedOutOk.body.data.status).toBe('COMPLETED');
    expect(checkedOutOk.body.data.outcome).toBe('NO_ORDER');
    expect(checkedOutOk.body.data.noOrderReason).toBe('STOCK_AVAILABLE');
    expect(checkedOutOk.body.data.durationMinutes).toBe(45);
  });

  test('locks a completed visit from edits and deletion', async () => {
    const edit = await request
      .patch(`/api/v1/field-force/visits/${state.visitId}`)
      .set(as(state.adminToken))
      .send({ notes: 'rewrite history' });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('VISIT_LOCKED');

    const del = await request.delete(`/api/v1/field-force/visits/${state.visitId}`).set(as(state.adminToken));
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('VISIT_LOCKED');
  });

  test('skips a planned visit with a reason', async () => {
    const noReason = await request
      .post(`/api/v1/field-force/visits/${state.secondVisitId}/skip`)
      .set(as(state.salesmanToken))
      .send({});
    expect(noReason.status).toBe(422);

    const skipped = await request
      .post(`/api/v1/field-force/visits/${state.secondVisitId}/skip`)
      .set(as(state.salesmanToken))
      .send({ reason: 'Shutter down for the day' });

    expect(skipped.status).toBe(200);
    expect(skipped.body.data.status).toBe('SKIPPED');
    expect(skipped.body.data.outcome).toBe('CUSTOMER_UNAVAILABLE');
    expect(skipped.body.data.skipReason).toMatch(/Shutter down/);
  });

  test('cancels a visit with a reason', async () => {
    const created = await request
      .post('/api/v1/field-force/visits')
      .set(as(state.adminToken))
      .send({ customerId: String(state.customer._id), salesman: String(state.salesman._id) });
    expect(created.status).toBe(201);

    const cancelled = await request
      .post(`/api/v1/field-force/visits/${created.body.data.id}/cancel`)
      .set(as(state.adminToken))
      .send({ reason: 'Customer asked to reschedule' });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  test('reports visit stats for the plan', async () => {
    const res = await request.get('/api/v1/field-force/visits/stats').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(3);
    expect(res.body.data.today).toHaveProperty('planned');
    expect(res.body.data.today).toHaveProperty('completed');
    expect(res.body.data.month).toHaveProperty('visits');
    expect(res.body.data.byStatus.COMPLETED).toBeGreaterThanOrEqual(1);
  });

  test('scopes the visit list to the rep and filters by status', async () => {
    const mine = await request.get('/api/v1/field-force/visits').set(as(state.salesmanToken)).query({ me: 'true' });
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBeGreaterThan(0);
    mine.body.data.forEach((row) => expect(String(row.salesman.id)).toBe(String(state.salesman._id)));

    const completed = await request
      .get('/api/v1/field-force/visits')
      .set(as(state.adminToken))
      .query({ status: 'COMPLETED' });
    expect(completed.status).toBe(200);
    expect(completed.body.data.length).toBe(1);
    expect(completed.body.data[0].outcome).toBe('NO_ORDER');
  });

  test('nearby customers are ranked by distance', async () => {
    const res = await request
      .get('/api/v1/field-force/visits/nearby')
      .set(as(state.adminToken))
      .query({ lat: 18.5074, lng: 73.8077 });

    expect(res.status).toBe(200);
    expect(res.body.data.radiusM).toBeGreaterThan(0);
    expect(res.body.data.customers.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.customers[0].distanceMeters).toBeGreaterThanOrEqual(0);
    expect(res.body.data.customers).toHaveProperty('0.withinGeofence');

    const missing = await request.get('/api/v1/field-force/visits/nearby').set(as(state.adminToken));
    expect(missing.status).toBe(400); // BadRequestError, no query validation on this route
    expect(missing.body.code).toBe('VALIDATION_ERROR');
  });

  test('another tenant cannot see our visits', async () => {
    const res = await request.get('/api/v1/field-force/visits').set(as(state.otherAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});

// ===========================================================================
// Expense claims
// ===========================================================================

describe('Phase 7 - expense claims workflow', () => {
  test('creates a draft claim with an EXP-<FY>- number', async () => {
    const res = await request
      .post('/api/v1/field-force/expenses')
      .set(as(state.salesmanToken))
      .send({
        category: 'TRAVEL',
        amount: 450,
        description: 'Pune to Paud rickshaw',
        fromPlace: 'Camp',
        toPlace: 'Paud Road',
        distanceKm: 7.5,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.expenseNo).toMatch(/^EXP-\d{4}-\d{5}$/);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.amount).toBe(450);
    expect(String(res.body.data.claimant.id)).toBe(String(state.salesman._id));

    state.expenseId = res.body.data.id;
  });

  test('locks the claim after submission', async () => {
    const submitted = await request
      .post(`/api/v1/field-force/expenses/${state.expenseId}/submit`)
      .set(as(state.salesmanToken))
      .send({ note: 'Please reimburse with salary' });

    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('SUBMITTED');
    expect(submitted.body.data.submittedAt).toBeTruthy();

    const edit = await request
      .patch(`/api/v1/field-force/expenses/${state.expenseId}`)
      .set(as(state.salesmanToken))
      .send({ amount: 9999 });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('EXPENSE_LOCKED');
  });

  test('a salesman cannot approve their own claim (403)', async () => {
    const res = await request
      .post(`/api/v1/field-force/expenses/${state.expenseId}/approve`)
      .set(as(state.salesmanToken))
      .send({});
    expect(res.status).toBe(403);
  });

  test('rejects approving more than the claimed amount', async () => {
    const res = await request
      .post(`/api/v1/field-force/expenses/${state.expenseId}/approve`)
      .set(as(state.managerToken))
      .send({ approvedAmount: 9999 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('the manager approves a partial amount', async () => {
    const res = await request
      .post(`/api/v1/field-force/expenses/${state.expenseId}/approve`)
      .set(as(state.managerToken))
      .send({ approvedAmount: 400, note: 'Only 7.5km claimed twice' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect(res.body.data.approvedAmount).toBe(400);
    expect(res.body.data.approvedBy).toBeTruthy();
  });

  test('marks an approved claim as paid', async () => {
    const res = await request
      .post(`/api/v1/field-force/expenses/${state.expenseId}/pay`)
      .set(as(state.accountantToken))
      .send({ paymentMode: 'UPI', paymentReference: 'UPI-889911' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PAID');
    expect(res.body.data.paymentMode).toBe('UPI');
    expect(res.body.data.paymentReference).toBe('UPI-889911');
  });

  test('rejects a claim then reopens it for rework', async () => {
    const created = await request
      .post('/api/v1/field-force/expenses')
      .set(as(state.salesmanToken))
      .send({ category: 'FOOD', amount: 300, description: 'Team lunch' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const submitted = await request.post(`/api/v1/field-force/expenses/${id}/submit`).set(as(state.salesmanToken)).send({});
    expect(submitted.status).toBe(200);

    const rejected = await request
      .post(`/api/v1/field-force/expenses/${id}/reject`)
      .set(as(state.managerToken))
      .send({ reason: 'Receipt missing - upload the bill' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(rejected.body.data.rejectionReason).toMatch(/Receipt missing/);

    const reopened = await request
      .post(`/api/v1/field-force/expenses/${id}/reopen`)
      .set(as(state.managerToken))
      .send({ note: 'Upload the bill and resubmit' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe('DRAFT');

    // Drafts are editable again.
    const edited = await request
      .patch(`/api/v1/field-force/expenses/${id}`)
      .set(as(state.salesmanToken))
      .send({ amount: 320 });
    expect(edited.status).toBe(200);
    expect(edited.body.data.amount).toBe(320);

    state.reworkExpenseId = id;
  });

  test('scopes claims to the claimant for a rep', async () => {
    const mine = await request.get('/api/v1/field-force/expenses').set(as(state.salesmanToken)).query({ me: 'true' });
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBeGreaterThanOrEqual(2);
    mine.body.data.forEach((row) => expect(String(row.claimant.id)).toBe(String(state.salesman._id)));

    const accountantView = await request.get('/api/v1/field-force/expenses').set(as(state.accountantToken));
    expect(accountantView.status).toBe(200);
    expect(accountantView.body.data.length).toBeGreaterThanOrEqual(mine.body.data.length);

    const pending = await request
      .get('/api/v1/field-force/expenses')
      .set(as(state.managerToken))
      .query({ status: 'SUBMITTED' });
    expect(pending.status).toBe(200);
    expect(pending.body.data.length).toBe(0); // the only submitted one was rejected
  });

  test('exposes stats and form options', async () => {
    const stats = await request.get('/api/v1/field-force/expenses/stats').set(as(state.adminToken));
    expect(stats.status).toBe(200);
    expect(stats.body.data.total).toBeGreaterThanOrEqual(2);
    expect(stats.body.data.byStatus.PAID).toBe(1);
    expect(stats.body.data.paidValue).toBeGreaterThan(0);

    const options = await request.get('/api/v1/field-force/expenses/form-options').set(as(state.adminToken));
    expect(options.status).toBe(200);
    expect(options.body.data.categories).toContain('TRAVEL');
    expect(options.body.data.statusList).toContain('SUBMITTED');
    expect(options.body.data.users.length).toBeGreaterThanOrEqual(3);
  });

  test('exports claims to Excel', async () => {
    const res = await request
      .get('/api/v1/field-force/expenses/export')
      .set(as(state.adminToken))
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (chunk) => {
          data += chunk;
        });
        r.on('end', () => cb(null, data));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheet/);
  });

  test('another tenant cannot see our claims', async () => {
    const res = await request.get('/api/v1/field-force/expenses').set(as(state.otherAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});

// ===========================================================================
// Sales targets
// ===========================================================================

describe('Phase 7 - sales targets', () => {
  test('creates a monthly target for a salesman', async () => {
    const res = await request
      .post('/api/v1/field-force/targets')
      .set(as(state.adminToken))
      .send({
        name: 'October quota',
        periodType: 'MONTH',
        salesman: String(state.salesman._id),
        targetValue: 100000,
        targetOrders: 25,
        targetVisits: 40,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.periodKey).toMatch(/^\d{4}-\d{2}$/);
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.targetValue).toBe(100000);
    expect(res.body.data.startDate).toBeTruthy();
    expect(res.body.data.endDate).toBeTruthy();
    expect(String(res.body.data.salesman.id)).toBe(String(state.salesman._id));

    state.targetId = res.body.data.id;
  });

  test('creates a route-scoped target', async () => {
    const res = await request
      .post('/api/v1/field-force/targets')
      .set(as(state.adminToken))
      .send({
        periodType: 'MONTH',
        route: String(state.route._id),
        targetValue: 250000,
      });

    expect(res.status).toBe(201);
    expect(String(res.body.data.route.id)).toBe(String(state.route._id));
    expect(res.body.data.salesman).toBeNull();

    state.routeTargetId = res.body.data.id;
  });

  test('updates a target and re-derives achievement', async () => {
    // Regression: the target arrives populated from loadDoc, so the refresh
    // must not String() the populated salesman document.
    const res = await request
      .patch(`/api/v1/field-force/targets/${state.targetId}`)
      .set(as(state.adminToken))
      .send({ targetValue: 120000, notes: 'Raised after the Diwali push' });

    expect(res.status).toBe(200);
    expect(res.body.data.targetValue).toBe(120000);
    expect(res.body.data.notes).toMatch(/Diwali/);
    expect(res.body.data.achievedValue).toBe(0);
  });

  test('requires exactly one assignee', async () => {
    const none = await request
      .post('/api/v1/field-force/targets')
      .set(as(state.adminToken))
      .send({ periodType: 'MONTH', targetValue: 10 });
    expect(none.status).toBe(422);

    const both = await request
      .post('/api/v1/field-force/targets')
      .set(as(state.adminToken))
      .send({
        periodType: 'MONTH',
        targetValue: 10,
        salesman: String(state.salesman._id),
        route: String(state.route._id),
      });
    expect(both.status).toBe(422);
    expect(both.body.code).toBe('VALIDATION_ERROR');
  });

  test('a salesman cannot create targets (403)', async () => {
    const res = await request
      .post('/api/v1/field-force/targets')
      .set(as(state.salesmanToken))
      .send({ periodType: 'MONTH', salesman: String(state.salesman._id), targetValue: 1 });
    expect(res.status).toBe(403);
  });

  test('progress rolls the goals up', async () => {
    const res = await request.get('/api/v1/field-force/targets/progress').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.totalTarget).toBe(370000); // 120000 (updated) + 250000 route
    expect(typeof res.body.data.overallPercent).toBe('number');
    expect(res.body.data.activeCount).toBe(2);
    expect(res.body.data.targets[0]).toHaveProperty('percent');
    expect(res.body.data.targets[0]).toHaveProperty('remaining');
  });

  test('scopes targets to the rep', async () => {
    const mine = await request.get('/api/v1/field-force/targets').set(as(state.salesmanToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBe(1);
    expect(String(mine.body.data[0].salesman.id)).toBe(String(state.salesman._id));

    const filtered = await request
      .get('/api/v1/field-force/targets')
      .set(as(state.adminToken))
      .query({ periodType: 'MONTH', status: 'ACTIVE' });
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.length).toBe(2);
  });

  test('refreshes achievement from booked orders', async () => {
    const res = await request
      .post(`/api/v1/field-force/targets/${state.targetId}/refresh`)
      .set(as(state.adminToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.achievedValue).toBe(0); // no orders booked yet
    expect(res.body.data.achievedOrders).toBe(0);
    expect(res.body.data.lastRefreshedAt).toBeTruthy();
    // The month hasn't ended yet (endDate = end of the current month), so an
    // unmet goal is still ACTIVE rather than MISSED.
    expect(res.body.data.status).toBe('ACTIVE');
  });

  test('closes a target and locks it', async () => {
    const closed = await request
      .post(`/api/v1/field-force/targets/${state.targetId}/close`)
      .set(as(state.adminToken))
      .send({ note: 'Period over' });

    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('CLOSED');

    const edit = await request
      .patch(`/api/v1/field-force/targets/${state.targetId}`)
      .set(as(state.adminToken))
      .send({ targetValue: 1 });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('TARGET_LOCKED');
  });

  test('exposes form options with period windows', async () => {
    const res = await request.get('/api/v1/field-force/targets/form-options').set(as(state.adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.periods).toEqual(['WEEK', 'MONTH', 'QUARTER', 'YEAR']);
    expect(res.body.data.windows.MONTH).toHaveProperty('periodKey');
    expect(res.body.data.windows.MONTH).toHaveProperty('startDate');
    expect(res.body.data.salesmen.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.routes.length).toBeGreaterThanOrEqual(1);
  });

  test('another tenant cannot see our targets', async () => {
    const res = await request.get('/api/v1/field-force/targets').set(as(state.otherAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});
