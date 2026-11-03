import { connectDB } from '../src/config/db.js';
import logger from '../src/utils/logger.js';

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

// Vercel Cron replacement for node-cron (see vercel.json "crons").
// Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically.
const JOBS = {
  'subscription-expiry': async () => (await import('../src/jobs/subscription.js')).runSubscriptionExpiry(),
  'overdue-reminders': async () => (await import('../src/jobs/overdue.js')).runOverdueReminders(),
  'session-cleanup': async () => (await import('../src/jobs/sessions.js')).runSessionCleanup(),
};

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return send(res, 401, { success: false, message: 'Unauthorized' });
  }
  const job = new URL(req.url, 'http://localhost').searchParams.get('job');
  if (!JOBS[job]) return send(res, 400, { success: false, message: 'Unknown job' });

  try {
    await connectDB(2, 1000);
    const result = await JOBS[job]();
    return send(res, 200, { success: true, job, result: result ?? null });
  } catch (err) {
    logger.error(`Cron job "${job}" failed: ${err.message}`);
    return send(res, 500, { success: false, job, message: err.message });
  }
}
