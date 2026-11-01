/**
 * Temporary dev smoke harness.
 * Boots an in-memory MongoDB + the real Express app + seed data so the UI can
 * be exercised end-to-end without a real Atlas URI. Not part of the product.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'development';
process.env.JWT_ACCESS_SECRET = 'dev_access_secret_smoke_'.padEnd(48, 'x');
process.env.JWT_REFRESH_SECRET = 'dev_refresh_secret_smoke_'.padEnd(48, 'x');
process.env.BCRYPT_ROUNDS = '6';
process.env.LOG_LEVEL = 'warn';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.DB_NAME = 'SFA_ERP_SMOKE';

const { connectDB } = await import('../src/config/db.js');
await connectDB(3, 500);

const seeders = await import('../src/seeders/index.js');
const superAdmin = await seeders.seedSuperAdmin();
const plans = await seeders.seedPlans();
const growth = plans.find((p) => p.code === 'GROWTH');
const company = await seeders.seedDemoCompany(superAdmin, growth);
const users = await seeders.seedDemoUsers(company);

// Demo master data + Phase 4 orders so the UI has something to work with.
const masters = await import('../src/seeders/masters.js');
await masters.default(company, users);
const transactions = await import('../src/seeders/transactions.js');
await transactions.default(company, users);

const { default: app } = await import('../src/app.js');
const server = app.listen(5000, () => {
  console.log('SMOKE SERVER UP on http://localhost:5000');
  console.log('Platform login: superadmin@eleviqsfa.com / ChangeMe#SuperAdmin1');
  console.log('Company login : admin@demotraders.com / Eleviq@123 (code DEMO01)');
});

process.on('SIGTERM', async () => {
  server.close();
  await mongod.stop();
  process.exit(0);
});
