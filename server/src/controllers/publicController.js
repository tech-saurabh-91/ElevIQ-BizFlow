import DemoRequest from '../models/DemoRequest.js';
import env from '../config/env.js';
import { sendMail } from '../services/mailer.js';
import { created } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { withoutTenant } from '../middlewares/tenant.js';
import logger from '../utils/logger.js';

/** Same mobile again within this window updates the open lead instead of adding one. */
const REPEAT_WINDOW_MS = 7 * 24 * 3600 * 1000;

const alertEmail = (lead, repeat) => {
  const to = env.mail.leadAlerts;
  if (!to.length) return;
  const lines = [
    repeat ? 'A visitor asked for a demo again.' : 'New demo request from the website.',
    '',
    `Name: ${lead.name}`,
    `Business: ${lead.business}`,
    `Mobile: ${lead.mobile}`,
    `City: ${lead.city}`,
    lead.email ? `Email: ${lead.email}` : null,
    lead.businessType ? `Business type: ${lead.businessType}` : null,
    lead.teamSize ? `Sales team: ${lead.teamSize}` : null,
    lead.message ? `Message: ${lead.message}` : null,
    '',
    `Open it in the provider portal: ${env.mail.appUrl}/platform/demo-requests?open=${lead._id}`,
  ].filter((l) => l !== null);
  sendMail({
    to: to.join(','),
    subject: `${repeat ? 'Repeat demo request' : 'New demo request'}: ${lead.business} (${lead.city})`,
    text: lines.join('\n'),
    replyTo: lead.email || undefined,
  }).catch(() => {});
};

/**
 * POST /api/public/demo-requests
 * Saves a "Book a demo" request from the home page. No login.
 */
export const createDemoRequest = asyncHandler(async (req, res) => {
  const { website, ...body } = req.body;

  // Honeypot: real visitors never see this field. Pretend it worked.
  if (website) {
    logger.info('[demo-request] honeypot filled - ignored');
    return created(res, { message: 'Thank you! We will be in touch shortly.', data: { received: true } });
  }

  const mobile = body.mobile;
  const now = new Date();

  const lead = await withoutTenant(async () => {
    const open = await DemoRequest.findOne({
      mobile,
      isDeleted: { $ne: true },
      status: { $nin: ['WON', 'LOST'] },
      lastSubmittedAt: { $gte: new Date(now.getTime() - REPEAT_WINDOW_MS) },
    });
    if (open) {
      Object.assign(open, {
        name: body.name,
        business: body.business,
        city: body.city,
        email: body.email || open.email,
        businessType: body.businessType || open.businessType,
        teamSize: body.teamSize || open.teamSize,
        message: body.message || open.message,
        lastSubmittedAt: now,
        repeatCount: (open.repeatCount || 0) + 1,
      });
      await open.save();
      return { doc: open, repeat: true };
    }
    const doc = await DemoRequest.create({
      ...body,
      lastSubmittedAt: now,
      ip: req.ip || '',
      userAgent: String(req.get('user-agent') || '').slice(0, 300),
    });
    return { doc, repeat: false };
  });

  alertEmail(lead.doc, lead.repeat);

  return created(res, {
    message: 'Thank you! We will be in touch shortly.',
    data: { received: true, id: String(lead.doc._id) },
  });
});

export default { createDemoRequest };
