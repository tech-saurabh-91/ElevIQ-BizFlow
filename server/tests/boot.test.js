/**
 * Boot smoke test: import the Express app and assert the wiring is sound.
 * Uses an in-memory MongoDB so no Atlas credentials are required.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_'.padEnd(48, 'x');
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_'.padEnd(48, 'x');
process.env.LOG_LEVEL = 'error';

let mongod;
let app;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  process.env.DB_NAME = 'SFA_ERP_TEST';
  ({ default: app } = await import('../src/app.js'));
});

afterAll(async () => {
  if (mongod) await mongod.stop();
});

describe('App bootstrap', () => {
  test('serves health endpoint', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.app).toBe('ElevIQ SFA');
  });

  test('root returns API info', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.data.docs).toBe('/api-docs');
  });

  test('unknown route returns 404 error contract', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('swagger json is served', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toContain('ElevIQ SFA');
  });

  test('company login without body returns validation error', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  test('protected route without token returns 401', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/v1/ping');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
