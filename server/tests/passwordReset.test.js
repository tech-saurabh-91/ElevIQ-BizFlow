import { createHash } from 'node:crypto';
import { boot, shutdown, clearDb } from './helpers.js';

/**
 * Phase 9 - forgot / reset password flow.
 *
 * The endpoints are public (no JWT), so they must:
 *   - never reveal whether an account exists,
 *   - store only a SHA-256 hash of the token (never the raw link),
 *   - accept the link exactly once and enforce the password policy,
 *   - revoke every live session after the reset,
 *   - work identically for company and platform scope.
 * With SMTP_URL unset the mailer degrades to a logged no-op, so these tests
 * run without any mail server.
 */

let app;
let request;

let PlatformUser;
let Company;
let User;
let Session;

const state = {};
const PASSWORD = 'Reset#Pass123';
const NEW_PASSWORD = 'NewReset#Pass456';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const forgot = (email, scope = 'company') =>
  request.post('/api/auth/forgot-password').send({ email, scope });

beforeAll(async () => {
  ({ app } = await boot());
  const st = (await import('supertest')).default;
  request = st(app);
  await clearDb();

  PlatformUser = (await import('../src/models/PlatformUser.js')).default;
  Company = (await import('../src/models/Company.js')).default;
  User = (await import('../src/models/User.js')).default;
  Session = (await import('../src/models/Session.js')).default;
  const { runWithContext } = await import('../src/middlewares/tenantContext.js');
  const { COMPANY_ROLES, COMPANY_STATUS, PLATFORM_ROLES } = await import(
    '../src/config/constants.js'
  );

  const platformAdmin = await PlatformUser.create({
    name: 'Reset Root',
    email: 'root@reset.test',
    password: PASSWORD,
    role: PLATFORM_ROLES.SUPER_ADMIN,
  });

  const company = await Company.create({
    code: 'RST001',
    slug: 'rst001',
    businessName: 'Reset Traders',
    status: COMPANY_STATUS.ACTIVE,
    subscriptionEnd: new Date(Date.now() + 365 * 86400000),
    userLimit: 10,
    createdBy: platformAdmin._id,
  });

  const admin = await runWithContext({ scope: 'company', companyId: String(company._id) }, () =>
    User.create({
      companyId: company._id,
      name: 'Reset Admin',
      email: 'admin@reset.test',
      phone: '+919999900001',
      password: PASSWORD,
      role: COMPANY_ROLES.COMPANY_ADMIN,
      isActive: true,
    })
  );

  Object.assign(state, { platformAdmin, company, admin });
});

afterAll(async () => {
  await shutdown();
});

describe('Phase 9 - forgot password', () => {
  it('never reveals whether the account exists', async () => {
    const res = await forgot('nobody@reset.test');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that account exists/i);
    // No token for an unknown account, in any environment.
    expect(res.body.data?.devToken).toBeUndefined();
  });

  it('stores only a SHA-256 hash of the token and expires it in 30 minutes', async () => {
    const res = await forgot('admin@reset.test');
    expect(res.status).toBe(200);
    const token = res.body.data?.devToken;
    expect(token).toBeTruthy();

    const doc = await User.findOne({ email: 'admin@reset.test' })
      .select('+passwordResetToken +passwordResetExpires')
      .skipTenant();
    expect(doc.passwordResetToken).toBe(sha256(token));
    expect(doc.passwordResetToken).not.toBe(token);
    expect(doc.passwordResetExpires.getTime()).toBeGreaterThan(Date.now() + 20 * 60 * 1000);
    expect(doc.passwordResetExpires.getTime()).toBeLessThanOrEqual(Date.now() + 31 * 60 * 1000);
  });

  it('completes without throwing when SMTP_URL is not configured', async () => {
    const { isMailConfigured, sendMail } = await import('../src/services/mailer.js');
    expect(isMailConfigured()).toBe(false);
    const result = await sendMail({
      to: 'nobody@reset.test',
      subject: 'test',
      text: 'body',
    });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('smtp-not-configured');
  });
});

describe('Phase 9 - reset password', () => {
  it('resets with a valid link, revokes sessions, and makes the link single-use', async () => {
    // A live session from before the reset must not survive it.
    const before = await request
      .post('/api/auth/login')
      .send({ identifier: 'admin@reset.test', password: PASSWORD });
    expect(before.status).toBe(200);
    const liveBefore = await Session.countDocuments({
      user: state.admin._id,
      revokedAt: null,
    }).skipTenant();
    expect(liveBefore).toBeGreaterThanOrEqual(1);

    const req = await forgot('admin@reset.test');
    const token = req.body.data.devToken;

    const reset = await request
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    // Old sessions are revoked...
    const liveAfter = await Session.countDocuments({
      user: state.admin._id,
      revokedAt: null,
    }).skipTenant();
    expect(liveAfter).toBe(0);

    // ...and the new password signs in.
    const login = await request
      .post('/api/auth/login')
      .send({ identifier: 'admin@reset.test', password: NEW_PASSWORD });
    expect(login.status).toBe(200);

    // The link is single-use: replaying it fails.
    const reuse = await request
      .post('/api/auth/reset-password')
      .send({ token, password: 'Replay#Pass1' });
    expect(reuse.status).toBe(400);
    expect(reuse.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('rejects an unknown token', async () => {
    const res = await request
      .post('/api/auth/reset-password')
      .send({ token: 'f'.repeat(64), password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('enforces the password policy', async () => {
    const req = await forgot('admin@reset.test');
    const res = await request
      .post('/api/auth/reset-password')
      .send({ token: req.body.data.devToken, password: 'weak' });
    expect(res.status).toBe(422);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it('resets the platform admin through scope=platform', async () => {
    const req = await forgot('root@reset.test', 'platform');
    expect(req.status).toBe(200);
    const token = req.body.data.devToken;
    expect(token).toBeTruthy();

    // A platform token must not be consumable as a company token.
    const cross = await request
      .post('/api/auth/reset-password')
      .send({ token, password: 'Cross#Scope1' });
    // PlatformUser and User are different collections - the lookup simply
    // misses, so the platform link is only good for scope=platform.
    expect(cross.status).toBe(400);
    expect(cross.body.code).toBe('INVALID_RESET_TOKEN');

    const reset = await request
      .post('/api/auth/reset-password')
      .send({ token, password: 'Plat#NewPass9', scope: 'platform' });
    expect(reset.status).toBe(200);

    const login = await request
      .post('/api/platform/auth/login')
      .send({ email: 'root@reset.test', password: 'Plat#NewPass9' });
    expect(login.status).toBe(200);
  });
});
