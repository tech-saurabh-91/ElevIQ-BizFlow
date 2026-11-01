import cron from 'node-cron';
import logger from '../utils/logger.js';

/**
 * Scheduled jobs. Each job is registered defensively so a single failure
 * never takes the process down. Jobs are added phase by phase.
 */
const registered = [];

const safeWrap = (name, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    logger.error(`Cron job "${name}" failed: ${err.message}`);
  }
};

export const startJobs = () => {
  // Daily at 01:00 - mark expired subscriptions / lapse trials.
  registered.push(
    cron.schedule(
      '0 1 * * *',
      safeWrap('subscription-expiry', async () => {
        const { runSubscriptionExpiry } = await import('./subscription.js');
        await runSubscriptionExpiry();
      }),
      { scheduled: true, timezone: 'Asia/Kolkata' }
    )
  );

  // Every hour - overdue invoice reminders.
  registered.push(
    cron.schedule(
      '0 * * * *',
      safeWrap('overdue-reminders', async () => {
        const { runOverdueReminders } = await import('./overdue.js');
        await runOverdueReminders();
      }),
      { scheduled: true, timezone: 'Asia/Kolkata' }
    )
  );

  // Daily at 02:30 - clean expired sessions.
  registered.push(
    cron.schedule(
      '30 2 * * *',
      safeWrap('session-cleanup', async () => {
        const { runSessionCleanup } = await import('./sessions.js');
        await runSessionCleanup();
      }),
      { scheduled: true, timezone: 'Asia/Kolkata' }
    )
  );

  logger.info(`Scheduled ${registered.length} cron jobs.`);
};

export const stopJobs = () => {
  registered.forEach((t) => {
    try {
      t.stop();
    } catch {
      /* noop */
    }
  });
  registered.length = 0;
  logger.info('Cron jobs stopped.');
};

export default { startJobs, stopJobs };
