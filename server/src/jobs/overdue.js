import dayjs from 'dayjs';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { withoutTenant, withTenant } from '../middlewares/tenant.js';
import logger from '../utils/logger.js';
import Company from '../models/Company.js';
import { companyToday } from '../utils/companyTime.js';

/**
 * Overdue invoice reminders.
 *
 * Marks every unpaid invoice whose due date has passed as OVERDUE and creates
 * one notification per affected company (when the tenant enabled reminders).
 * Payments/credit notes keep balanceDue authoritative, so we never chase a
 * settled invoice.
 */
export const runOverdueReminders = async () => {
  // Each company's "today" is in its own timezone (the cron runs on UTC).
  const now = new Date();
  let notifications = 0;

  let Invoice, Setting;
  try {
    ({ default: Invoice } = await import('../models/Invoice.js'));
    ({ default: Setting } = await import('../models/Setting.js'));
  } catch {
    logger.info('overdue-reminders: Invoice model not available yet, skipping.');
    return { notifications: 0 };
  }

  await withoutTenant(async () => {
    const overdue = await Invoice.find({
      status: { $in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
      dueDate: { $lt: now }, // narrowed per company below
      balanceDue: { $gt: 0 },
      isDeleted: { $ne: true },
    })
      .select('companyId customerId total balanceDue dueDate invoiceNo')
      .skipTenant()
      .lean();

    if (!overdue.length) return;

    // Group by company
    const byCompany = new Map();
    for (const inv of overdue) {
      const key = String(inv.companyId);
      if (!byCompany.has(key)) byCompany.set(key, []);
      byCompany.get(key).push(inv);
    }

    const zones = new Map(
      (await Company.find({ _id: { $in: [...byCompany.keys()] } }).select('timezone').skipTenant().lean()).map((c) => [String(c._id), c.timezone])
    );

    for (const [companyId, all] of byCompany) {
      try {
        // Overdue = due before the start of the company's today, never on the due day itself.
        const startOfToday = companyToday(zones.get(companyId) || undefined).today;
        const invoices = all.filter((i) => new Date(i.dueDate) < startOfToday);
        if (!invoices.length) continue;
        const settings = await withTenant(companyId, () => Setting.forCompany(companyId));
        if (settings?.collections?.sendOverdueReminders === false) continue;

        // Mark status OVERDUE where not already
        await withTenant(companyId, async () => {
          await Invoice.updateMany(
            { _id: { $in: invoices.map((i) => i._id) }, status: { $in: ['ISSUED', 'PARTIALLY_PAID'] } },
            { $set: { status: 'OVERDUE' } }
          );

          // Remind only once an invoice is at least `overdueReminderDays` late
          // (Collections setting); the OVERDUE status above still flips on the due date.
          const graceDays = Number(settings?.collections?.overdueReminderDays ?? 0);
          const cutoff = dayjs(startOfToday).subtract(graceDays, 'day').toDate();
          const due = invoices.filter((i) => new Date(i.dueDate) < cutoff);
          if (!due.length) return;
          const totalBalance = due.reduce((s, i) => s + (Number(i.balanceDue) || 0), 0);
          const money = `${settings?.currency || ''} ${totalBalance.toFixed(2)}`.trim();

          // The cron runs hourly, so remind at most once per company per day:
          // otherwise every overdue stack would drop 24 identical items in the
          // inbox and bury everything else.
          const alreadyReminded = await Notification.exists({
            companyId,
            type: 'OVERDUE_INVOICE',
            createdAt: { $gte: dayjs().subtract(24, 'hour').toDate() },
          });
          if (alreadyReminded) return;

          // Deliver to the people who act on overdue money: admins, managers
          // and accountants. An empty `recipients` with broadcast=false would
          // be invisible to everyone, so we always resolve real recipients.
          const actors = await User.find({
            companyId,
            isDeleted: { $ne: true },
            role: { $in: ['COMPANY_ADMIN', 'MANAGER', 'ACCOUNTANT'] },
          })
            .select('_id')
            .skipTenant()
            .lean();

          await Notification.create({
            companyId,
            broadcast: false,
            recipients: actors.map((u) => u._id),
            type: 'OVERDUE_INVOICE',
            title: `${due.length} invoice(s) overdue`,
            body: `Total outstanding ${money} across ${due.length} overdue invoice(s)${graceDays ? ` (${graceDays}+ days late)` : ''}.`,
            link: '/app/invoices?overdue=true',
            entityType: 'Invoice',
            priority: 'HIGH',
          });
          notifications += 1;
        });
      } catch (e) {
        logger.error(`overdue-reminders: company ${companyId} failed: ${e.message}`);
      }
    }
  });

  logger.info(`overdue-reminders: ${notifications} notifications created`);
  return { notifications };
};

export default runOverdueReminders;
