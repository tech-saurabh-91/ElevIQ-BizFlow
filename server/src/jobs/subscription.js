import dayjs from 'dayjs';
import Company from '../models/Company.js';
import Subscription from '../models/Subscription.js';
import PlatformAuditLog from '../models/PlatformAuditLog.js';
import { COMPANY_STATUS } from '../config/constants.js';
import { withoutTenant } from '../middlewares/tenant.js';
import logger from '../utils/logger.js';

/**
 * Lapse trials and expire subscriptions whose end date has passed.
 * Runs daily. Cross-tenant by design -> uses withoutTenant().
 */
export const runSubscriptionExpiry = async () => {
  const now = new Date();
  let expired = 0;
  let lapsed = 0;

  await withoutTenant(async () => {
    // 1. TRIAL past trialEnd -> EXPIRED
    const trialRes = await Company.updateMany(
      {
        status: COMPANY_STATUS.TRIAL,
        isDeleted: { $ne: true },
        trialEndsAt: { $lt: now },
      },
      { $set: { status: COMPANY_STATUS.EXPIRED, statusReason: 'Trial period ended' } }
    );
    lapsed = trialRes.modifiedCount || 0;

    // 2. ACTIVE past subscriptionEnd -> EXPIRED
    const subRes = await Company.updateMany(
      {
        status: COMPANY_STATUS.ACTIVE,
        isDeleted: { $ne: true },
        subscriptionEnd: { $lt: now },
      },
      { $set: { status: COMPANY_STATUS.EXPIRED, statusReason: 'Subscription expired' } }
    );
    expired = subRes.modifiedCount || 0;

    // 3. Mark subscriptions expired
    await Subscription.updateMany(
      { status: 'ACTIVE', end: { $lt: now } },
      { $set: { status: 'EXPIRED' } }
    ).skipTenant();

    // 4. Audit the transitions
    const affected = await Company.find({
      status: COMPANY_STATUS.EXPIRED,
      'statusReason': { $in: ['Trial period ended', 'Subscription expired'] },
      updatedAt: { $gte: dayjs().subtract(1, 'day').toDate() },
    })
      .select('_id code businessName')
      .skipTenant()
      .lean();

    if (affected.length) {
      await PlatformAuditLog.insertMany(
        affected.map((c) => ({
          actor: { name: 'system:cron', role: 'SYSTEM' },
          action: 'STATUS_CHANGE',
          entityType: 'Company',
          entityId: c._id,
          entityLabel: `${c.code} - ${c.businessName}`,
          targetCompanyId: c._id,
          description: `Auto-expired: ${c.status === 'EXPIRED' ? 'subscription lapsed' : 'trial ended'}`,
          channel: 'CRON',
          severity: 'WARN',
          occurredAt: new Date(),
        }))
      );
    }
  });

  logger.info(`subscription-expiry: ${lapsed} trials lapsed, ${expired} subscriptions expired`);
  return { lapsed, expired };
};

export default runSubscriptionExpiry;
