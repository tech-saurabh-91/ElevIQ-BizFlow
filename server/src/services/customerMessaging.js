import env from '../config/env.js';
import logger from '../utils/logger.js';
import Customer from '../models/Customer.js';
import Company from '../models/Company.js';
import CustomerAccount from '../models/CustomerAccount.js';
import PortalNotification from '../models/PortalNotification.js';
import Setting from '../models/Setting.js';
import { getCompanyId } from '../middlewares/tenantContext.js';

/**
 * Messages to a company's customers.
 *
 * Every message lands in the customer's portal inbox. When a messaging
 * provider is set up (env MESSAGING_DRIVER) and the company switched
 * messages on, it also goes by SMS / WhatsApp to the mobile the customer
 * signs in with. OTP codes use the same channel.
 *
 * Drivers: none (default) | log (development: written to the server log) |
 * webhook (POST JSON to MESSAGING_WEBHOOK_URL - plug in any provider).
 */

/** True when SMS / WhatsApp can actually be sent. */
export const messagingAvailable = () => ['log', 'webhook'].includes(env.messaging.driver) &&
  (env.messaging.driver !== 'webhook' || Boolean(env.messaging.webhookUrl));

/** Send one text. Never throws: returns 'SENT' | 'FAILED' | 'SKIPPED'. */
export const sendText = async ({ to, text, kind = 'NOTICE' }) => {
  if (!messagingAvailable() || !to) return 'SKIPPED';
  const channel = env.messaging.channel;
  try {
    if (env.messaging.driver === 'log') {
      logger.info(`[messaging:${channel}] to ${to} (${kind}): ${text}`);
      return 'SENT';
    }
    const res = await fetch(env.messaging.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.messaging.webhookToken ? { Authorization: `Bearer ${env.messaging.webhookToken}` } : {}),
      },
      body: JSON.stringify({ channel, to, text, kind }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      logger.warn(`messaging webhook answered ${res.status} for ${kind}`);
      return 'FAILED';
    }
    return 'SENT';
  } catch (err) {
    logger.warn(`messaging failed (${kind}): ${err.message}`);
    return 'FAILED';
  }
};

/** Indian 10-digit mobiles get the country code for providers. */
export const phoneForMessages = (mobile) => {
  const digits = String(mobile || '').replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
};

/**
 * Tell a customer something: portal inbox always, SMS / WhatsApp when on.
 * Runs inside the company's tenant context. Never throws.
 */
export const notifyCustomer = async (customerId, { type = 'INFO', title, body = '', link = '' }) => {
  try {
    if (!customerId) return null;
    const note = await PortalNotification.create({
      customer: customerId,
      type,
      title: String(title).slice(0, 160),
      body: String(body).slice(0, 500),
      link,
    });
    const companyId = getCompanyId();
    const settings = companyId ? await Setting.findOne({ companyId }).lean() : null;
    if (settings?.portal?.enabled && settings?.portal?.sendMessages && messagingAvailable()) {
      const account = await CustomerAccount.findOne({ customer: customerId, isActive: true }).lean();
      if (account) {
        const company = settings.displayName?.trim() ? null : await Company.findById(companyId).select('businessName').lean();
        const name = settings.displayName?.trim() || company?.businessName || '';
        const text = `${name ? `${name}: ` : ''}${title}${body ? ` - ${body}` : ''}`.slice(0, 320);
        note.delivery = await sendText({ to: phoneForMessages(account.mobile), text, kind: type });
        await note.save();
      }
    }
    return note;
  } catch (err) {
    logger.warn?.(`customer notification failed: ${err.message}`);
    return null;
  }
};

/** Same, for an order (only customers with a portal login get it). */
export const notifyOrderCustomer = async (order, { title, body = '' }) => {
  if (!order?.customerId) return null;
  const customerId = order.customerId?._id || order.customerId;
  const hasLogin = await CustomerAccount.exists({ customer: customerId });
  if (!hasLogin) return null;
  return notifyCustomer(customerId, { type: 'ORDER', title, body, link: `orders/${order._id}` });
};

export const customerName = async (id) => (await Customer.findById(id).select('name').lean())?.name || '';

export default { messagingAvailable, sendText, notifyCustomer, notifyOrderCustomer };
