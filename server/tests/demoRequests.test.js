import { boot, shutdown, clearDb } from './helpers.js';

let app;
let request;
let superToken;
let supportToken;
let companyId;

const lead = (over = {}) => ({
  name: 'Ramesh Gupta',
  business: 'Gupta Distributors',
  mobile: '+91 98765 43210',
  city: 'Indore',
  businessType: 'Distributor',
  teamSize: '6–20 salesmen',
  ...over,
});

const login = async (email, password) => {
  const res = await request.post('/api/platform/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status}`);
  return res.body.data.accessToken;
};

beforeAll(async () => {
  ({ app } = await boot());
  request = (await import('supertest')).default(app);
  await clearDb();
  const PlatformUser = (await import('../src/models/PlatformUser.js')).default;
  const Company = (await import('../src/models/Company.js')).default;
  await PlatformUser.create({ name: 'Lead Root', email: 'leadroot@eleviq.test', password: 'Root#Pass123', role: 'SUPER_ADMIN' });
  await PlatformUser.create({ name: 'Lead Support', email: 'leadsupport@eleviq.test', password: 'Support#Pass123', role: 'PLATFORM_SUPPORT' });
  superToken = await login('leadroot@eleviq.test', 'Root#Pass123');
  supportToken = await login('leadsupport@eleviq.test', 'Support#Pass123');
  const company = await Company.create({ code: 'GUPTA1', slug: 'gupta-distributors', businessName: 'Gupta Distributors', email: 'g@gupta.test', status: 'TRIAL' });
  companyId = String(company._id);
});

afterAll(async () => {
  await shutdown();
});

const asSuper = (req) => req.set('Authorization', `Bearer ${superToken}`);

describe('Public demo request form', () => {
  test('saves a request without login and normalises the mobile number', async () => {
    const res = await request.post('/api/public/demo-requests').send(lead());
    expect(res.status).toBe(201);
    expect(res.body.data.received).toBe(true);

    const DemoRequest = (await import('../src/models/DemoRequest.js')).default;
    const saved = await DemoRequest.findById(res.body.data.id).lean();
    expect(saved).toMatchObject({ mobile: '9876543210', business: 'Gupta Distributors', status: 'NEW', repeatCount: 0 });
  });

  test('rejects missing or invalid fields', async () => {
    const res = await request.post('/api/public/demo-requests').send(lead({ mobile: '12345', name: '' }));
    expect(res.status).toBe(422);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['mobile', 'name']));
  });

  test('the same mobile again updates the open lead instead of adding a new one', async () => {
    const res = await request.post('/api/public/demo-requests').send(lead({ city: 'Bhopal', mobile: '9876543210' }));
    expect(res.status).toBe(201);
    const DemoRequest = (await import('../src/models/DemoRequest.js')).default;
    const all = await DemoRequest.find({ mobile: '9876543210' }).lean();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ city: 'Bhopal', repeatCount: 1 });
  });

  test('a filled honeypot field is accepted silently but not saved', async () => {
    const res = await request.post('/api/public/demo-requests').send(lead({ mobile: '9123456780', website: 'http://spam' }));
    expect(res.status).toBe(201);
    const DemoRequest = (await import('../src/models/DemoRequest.js')).default;
    expect(await DemoRequest.countDocuments({ mobile: '9123456780' })).toBe(0);
  });
});

describe('Provider portal - demo requests', () => {
  let id;

  test('needs a platform login', async () => {
    const res = await request.get('/api/platform/demo-requests');
    expect(res.status).toBe(401);
  });

  test('lists requests with counts per status', async () => {
    await request.post('/api/public/demo-requests').send(lead({ mobile: '9000000001', business: 'Sharma Traders', city: 'Pune' }));
    const res = await asSuper(request.get('/api/platform/demo-requests'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.counts).toBeDefined();
    const counts = res.body.meta.counts;
    expect(counts.NEW).toBe(2);
    id = res.body.data.find((d) => d.business === 'Gupta Distributors').id;

    const search = await asSuper(request.get('/api/platform/demo-requests').query({ search: 'sharma' }));
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].business).toBe('Sharma Traders');
  });

  test('new-count and dashboard show NEW requests', async () => {
    const count = await asSuper(request.get('/api/platform/demo-requests/new-count'));
    expect(count.body.data.count).toBe(2);
    const dash = await asSuper(request.get('/api/platform/dashboard'));
    expect(dash.body.data.stats.newDemoRequests).toBe(2);
  });

  test('adds notes, changes status and sets a follow-up date', async () => {
    const note = await asSuper(request.post(`/api/platform/demo-requests/${id}/notes`)).send({ text: 'Called, wants demo on Friday', markContacted: true });
    expect(note.status).toBe(200);
    expect(note.body.data.status).toBe('CONTACTED');
    expect(note.body.data.notes[0]).toMatchObject({ text: 'Called, wants demo on Friday', byName: 'Lead Root' });

    const upd = await asSuper(request.patch(`/api/platform/demo-requests/${id}`)).send({ status: 'DEMO_SCHEDULED', followUpAt: '2026-11-28' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.status).toBe('DEMO_SCHEDULED');
    expect(upd.body.data.followUpAt).toBeTruthy();

    const open = await asSuper(request.get('/api/platform/demo-requests').query({ status: 'OPEN' }));
    expect(open.body.data.map((d) => d.id)).toContain(id);
  });

  test('linking a company marks the lead as won', async () => {
    const res = await asSuper(request.patch(`/api/platform/demo-requests/${id}`)).send({ convertedCompany: companyId });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('WON');
    expect(res.body.data.convertedCompany).toMatchObject({ id: companyId, name: 'Gupta Distributors', code: 'GUPTA1' });
  });

  test('platform support can read but not change', async () => {
    const read = await request.get('/api/platform/demo-requests').set('Authorization', `Bearer ${supportToken}`);
    expect(read.status).toBe(200);
    const write = await request
      .patch(`/api/platform/demo-requests/${id}`)
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ status: 'LOST' });
    expect(write.status).toBe(403);
  });

  test('delete hides the request', async () => {
    const del = await asSuper(request.delete(`/api/platform/demo-requests/${id}`));
    expect(del.status).toBe(200);
    const get = await asSuper(request.get(`/api/platform/demo-requests/${id}`));
    expect(get.status).toBe(404);
  });
});
