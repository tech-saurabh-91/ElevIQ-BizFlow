import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';

// Reuse one connection across warm invocations of this serverless function.
let dbReady;
const ensureDB = () => {
  dbReady ??= connectDB(2, 1000).catch((err) => {
    dbReady = undefined;
    throw err;
  });
  return dbReady;
};

export default async function handler(req, res) {
  try {
    await ensureDB();
  } catch {
    return res.status(503).json({ success: false, message: 'Database unavailable' });
  }
  return app(req, res);
}
