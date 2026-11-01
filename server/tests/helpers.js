/**
 * Shared test bootstrap: starts an in-memory MongoDB, wires env, imports the app.
 * Call `await boot()` inside beforeAll of each test file.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod = null;

export const boot = async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'test_access_secret_'.padEnd(48, 'x');
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_'.padEnd(48, 'x');
  process.env.LOG_LEVEL = 'error';
  process.env.BCRYPT_ROUNDS = '4'; // fast tests

  if (!mongod) {
    mongod = await MongoMemoryServer.create();
  }
  process.env.MONGO_URI = mongod.getUri();
  process.env.DB_NAME = 'SFA_ERP_TEST';

  // Safety net: server/.env points at the real Atlas cluster. Tests must never
  // touch it (`shutdown()` drops the database), so refuse to boot otherwise.
  if (!/127\.0\.0\.1|localhost|\[::1\]/.test(process.env.MONGO_URI || '')) {
    throw new Error(`Refusing to run tests against a non-local MongoDB: ${process.env.MONGO_URI}`);
  }

  const app = (await import('../src/app.js')).default;
  const mongoose = (await import('mongoose')).default;

  // Establish the connection (app.js does not connect — server.js/tests do).
  const { connectDB, disconnectDB } = await import('../src/config/db.js');
  await connectDB(3, 500);

  return { app, mongoose, disconnectDB };
};

export const shutdown = async () => {
  const mongoose = (await import('mongoose')).default;
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.connection.close().catch(() => {});
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
};

export const clearDb = async () => {
  const mongoose = (await import('mongoose')).default;
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((c) => c.deleteMany({})));
};

export default { boot, shutdown, clearDb };
