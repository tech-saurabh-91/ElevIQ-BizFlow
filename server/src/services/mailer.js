import env from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Outbound email (Phase 9 hardening).
 *
 * Delivery is driven entirely by `SMTP_URL`:
 *   - unset  -> graceful no-op: the call is logged and returns { sent: false }
 *               so password reset / reminders keep working in development.
 *   - set    -> nodemailer sends over that SMTP URL.
 *
 * `sendMail` NEVER throws: an SMTP outage must not break a login, a password
 * reset or a cron job. Callers get a status object and decide what to do.
 */

export const isMailConfigured = () => Boolean(env.mail.url);

// Lazily created so nodemailer only loads when SMTP is actually configured.
let transport = null;

const getTransport = async () => {
  if (transport) return transport;
  const { default: nodemailer } = await import('nodemailer');
  transport = nodemailer.createTransport(env.mail.url);
  return transport;
};

/**
 * @param {{ to: string, subject: string, text?: string, html?: string, from?: string }} message
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export const sendMail = async ({ to, subject, text, html, from }) => {
  if (!to) return { sent: false, reason: 'no-recipient' };
  if (!subject) return { sent: false, reason: 'no-subject' };

  if (!isMailConfigured()) {
    // Dev fallback: log enough to copy the link by hand, but never leak reset
    // tokens into production logs.
    logger.info(`[mailer] SMTP_URL not set - skipping email to ${to}: "${subject}"`);
    if (text && env.isDev) logger.info(`[mailer] body:\n${text}`);
    return { sent: false, reason: 'smtp-not-configured' };
  }

  try {
    const tx = await getTransport();
    await tx.sendMail({ from: from || env.mail.from, to, subject, text, html });
    logger.info(`[mailer] sent "${subject}" to ${to}`);
    return { sent: true };
  } catch (err) {
    logger.error(`[mailer] failed to send "${subject}" to ${to}: ${err.message}`);
    return { sent: false, reason: 'send-failed' };
  }
};

export default { sendMail, isMailConfigured };
