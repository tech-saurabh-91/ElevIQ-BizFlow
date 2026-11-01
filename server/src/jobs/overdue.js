import dayjs from 'dayjs';
import Notification from '../models/Notification.js';
import { withoutTenant, withTenant } from '../middlewares/tenant.js';
import logger from '../utils/logger.js';

/**
 * Overdue invoice reminders.
 *
 * Marks every unpaid invoice whose due date has passed as OVERDUE and creates
 * one notification per affected company (when the tenant enabled reminders).
 * Payments/credit notes keep balanceDue authoritative, so we never chase a
 * settled invoice.
 */
export const runOverdueReminders = async () => {
  const startOfToday = dayjs().startOf('day').toDate();
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
      dueDate: { $lt: startOfToday },
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

    for (const [companyId, invoices] of byCompany) {
      try {
        const settings = await withTenant(companyId, () => Setting.forCompany(companyId));
        if (settings?.collections?.sendOverdueReminders === false) continue;

        // Mark status OVERDUE where not already
        await withTenant(companyId, async () => {
          await Invoice.updateMany(
            { _id: { $in: invoices.map((i) => i._id) }, status: { $in: ['ISSUED', 'PARTIALLY_PAID'] } },
            { $set: { status: 'OVERDUE' } }
          );

          const totalBalance = invoices.reduce((s, i) => s + (Number(i.balanceDue) || 0), 0);
          await Notification.create({
            companyId,
            broadcast: false,
            recipients: [],
            type: 'OVERDUE_INVOICE',
            title: `${invoices.length} invoice(s) overdue`,
            body: `Total outstanding ₹${totalBalance.toFixed(2)} across ${invoices.length} overdue invoices.`,
            link: '/app/invoices?status=OVERDUE',
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
